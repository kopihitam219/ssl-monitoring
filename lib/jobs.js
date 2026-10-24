// Pekerjaan utama: import Excel, scan SSL. Dipakai oleh API (tombol Sync Now / Upload)
// dan oleh script CLI (npm run scan) / scheduler.
import path from 'node:path';
import * as db from './db.js';
import { acquireLock, extendLock, releaseLock, lockInfo } from './locks.js';
import { parseSourceOfTruth, normalizeDomain } from './excel.js';
import { checkDomain, mapLimit } from './ssl-check.js';
import { classifySsl, displayStatus, thresholds, tierOf, STATUS_KEYS } from './status.js';
import { getSettings } from './settings.js';

const DAY = 86_400_000;

/**
 * Import Excel ke satu file Source of Truth. Nama file (tanpa ekstensi) = nama sumber & nama dashboard.
 *   - nama file belum ada → file baru dibuat (pilihan proxy dari proxyMode)
 *   - nama file sudah ada → isi file itu diganti (merge=false) atau digabung (merge=true)
 *   - fileId diisi → upload ke file tertentu (mis. tombol "Upload ulang" di daftar file)
 */
export async function importExcel(buffer, filename = 'upload.xlsx', { merge = false, proxyMode, fileId, groupId } = {}) {
  const parsed = parseSourceOfTruth(buffer);
  if (!parsed.domains.length) throw new Error('Tidak ada domain yang valid di file ini');
  // Isi Excel disimpan sebagai baris domain di database (bisa di-download lagi lewat Export). File aslinya tidak disimpan.
  const stored = `${new Date().toISOString()} ${path.basename(filename)}`;

  let file = fileId ? await db.getFile(Number(fileId)) : await db.getFileByName(db.fileBaseName(filename));
  if (fileId && !file) throw new Error('File Source of Truth tidak ditemukan');
  const created = !file;
  if (created) file = await db.createFile({ name: db.fileBaseName(filename) || 'Source of Truth', proxyMode: proxyMode || 'direct', originalFile: path.basename(filename), storedFile: stored, groupId: groupId || null });
  else await db.updateFile(file.id, { originalFile: path.basename(filename), storedFile: stored, ...(proxyMode ? { proxyMode } : {}), ...(groupId ? { groupId } : {}) });

  const res = await db.syncExcel(file.id, parsed.domains, { merge });
  await db.setSource('excel', 'connected', { file: filename, rows: (await db.getDomains()).length, skipped: parsed.skipped.length, merge });
  await db.addActivity('upload', `Upload Excel berhasil${created ? ' (file baru)' : merge ? ' (digabung)' : ''}`,
    `${file.name} — ${parsed.domains.length} domain (${res.added} baru${merge ? `, ${res.updated} diperbarui` : `, ${res.removed} dihapus`})`);
  if (parsed.skipped.length) {
    await db.addActivity('mismatch', 'Baris Excel dilewati', `${file.name}: ${parsed.skipped.length} baris dengan domain tidak valid`);
  }
  return { ...res, skipped: parsed.skipped, file: await db.getFile(file.id), created };
}

const SCAN_LOCK = 'scan';
const LOCK_TTL = 15 * 60_000;

/** Ada scan yang sedang berjalan (di instance mana pun: Vercel atau scanner kantor)? */
export const isScanning = async () => !!(await lockInfo(SCAN_LOCK));
export const scanLockInfo = () => lockInfo(SCAN_LOCK);

/**
 * Scan SSL.
 *   groupId    → hanya domain di group dashboard itu
 *   onlyFailed → hanya domain yang statusnya Check Failed (tombol "Retry Check Failed")
 *   budgetMs   → batas waktu (Vercel): domain yang paling lama tidak dicek didahulukan; sisanya dilanjutkan scan berikutnya
 */
export async function runScan({ onProgress, groupId = null, onlyFailed = false, budgetMs = 0 } = {}) {
  if (!(await acquireLock(SCAN_LOCK, LOCK_TTL, `${groupId ? `group ${groupId}` : 'semua'}${onlyFailed ? ' · Check Failed' : ''}`))) {
    throw new Error('Scan sedang berjalan');
  }
  const started = Date.now();
  globalThis.__sslScanRunning = true;
  const beat = setInterval(() => { extendLock(SCAN_LOCK, LOCK_TTL).catch(() => {}); }, 60_000);
  try {
    let domains = await db.getDomains(groupId ? { groupId } : {});
    if (onlyFailed) domains = domains.filter((d) => freshen(d).ssl_status === 'CHECK_FAILED');
    const scope = `${groupId ? `group ${(await db.getGroup(groupId))?.name || groupId}` : 'semua domain'}${onlyFailed ? ' · hanya Check Failed' : ''}`;
    const totalInScope = domains.length;
    if (budgetMs) domains.sort((a, b) => String(a.last_checked || '').localeCompare(String(b.last_checked || '')));
    await db.setSource('scan', 'running', { total: domains.length, scope }, false);

    let done = 0, skipped = 0;
    const { scanConcurrency, scanTimeoutMs } = getSettings();
    const deadline = budgetMs ? started + budgetMs - scanTimeoutMs * 1.5 : Infinity;
    const results = (await mapLimit(domains, scanConcurrency, async (d) => {
      if (Date.now() > deadline) { skipped++; return null; }
      const r = await checkDomain(d, scanTimeoutMs);
      const status = classifySsl(r);
      await db.saveCheckResult(d.id, r, status);
      onProgress?.(++done, domains.length, d, r, status);
      return { d, r, status };
    })).filter(Boolean);

    const summary = buildSummary(await db.getDomains());
    try {
      const { reportSslFindings } = await import('./wazuh.js');
      await reportSslFindings(summary.rows);
    } catch (e) { console.error('[wazuh] temuan SSL:', e.message); }
    try { await db.saveDailyStats(summary.counts); } catch (e) { console.error('[scan] simpan tren harian:', e.message); }

    // aktivitas penting
    const list = (xs) => xs.map((x) => x.d.domain).slice(0, 3).join(', ') + (xs.length > 3 ? ` +${xs.length - 3} lainnya` : '');
    const urgent = results.filter((x) => x.status === 'URGENT').sort((a, b) => a.r.daysRemaining - b.r.daysRemaining);
    const soon = results.filter((x) => ['REMINDER', 'NEED_UPDATE'].includes(x.status)).sort((a, b) => a.r.daysRemaining - b.r.daysRemaining);
    const failed = results.filter((x) => x.status === 'CHECK_FAILED');
    if (urgent.length) await db.addActivity('failed', 'Urgent renewal (≤ batas Urgent / sudah expired)', list(urgent));
    if (soon.length) await db.addActivity('expiring', 'Domain mendekati expired', `${soon[0].d.domain} (${soon[0].r.daysRemaining} hari lagi)${soon.length > 1 ? ` +${soon.length - 1} lainnya` : ''}`);
    if (failed.length) await db.addActivity('failed', 'Check Failed (sertifikat tidak terbaca)', list(failed));
    const recovered = onlyFailed ? results.filter((x) => x.status !== 'CHECK_FAILED') : [];
    if (recovered.length) await db.addActivity('scan', 'Retry Check Failed: berhasil dibaca', list(recovered));

    const fallback = results.filter((x) => x.r.via === 'fallback');
    if (fallback.length) await db.addActivity('sync', 'Gagal langsung, berhasil lewat proxy', list(fallback));
    const seconds = Math.round((Date.now() - started) / 1000);
    const scanCounts = Object.fromEntries(results.reduce((m, x) => m.set(x.status, (m.get(x.status) || 0) + 1), new Map()));
    const rest = skipped ? ` · ${skipped} domain dilanjutkan di scan berikutnya (batas waktu)` : '';
    await db.setSource('scan', 'connected', { total: results.length, seconds, fallback: fallback.length, scope, failed: failed.length, remaining: skipped });
    await db.addActivity('scan', 'SSL scan selesai', `${scope}: ${results.length} domain dicek dalam ${seconds} detik${fallback.length ? ` · ${fallback.length} lewat proxy (otomatis)` : ''}${rest}`);
    return { total: results.length, inScope: totalInScope, remaining: skipped, seconds, fallback: fallback.length, recovered: recovered.length, failed: failed.length, scope, scanCounts, counts: summary.counts };
  } catch (e) {
    await db.setSource('scan', 'error', { error: e.message }).catch(() => {});
    throw e;
  } finally {
    clearInterval(beat);
    globalThis.__sslScanRunning = false;
    await releaseLock(SCAN_LOCK).catch(() => {});
  }
}

/**
 * Hitung ulang sisa hari & status dari tanggal expired (bukan nilai saat scan), supaya angka selalu
 * terkini dan perubahan ambang di Settings langsung berlaku tanpa scan ulang.
 * Tanggal expired ada = sertifikat terakhir berhasil dibaca → status mengikuti sisa hari.
 */
export function freshen(d) {
  if (!d.expires_at) return d.last_checked && d.ssl_status !== 'CHECK_FAILED' ? { ...d, ssl_status: 'CHECK_FAILED' } : d;
  const days = Math.floor((new Date(d.expires_at).getTime() - Date.now()) / DAY);
  return { ...d, days_remaining: days, ssl_status: tierOf(days) };
}

/** Satu domain dengan status tampilan (dipakai halaman detail). */
export function decorate(raw) {
  const d = freshen(raw);
  return { ...d, status: displayStatus(d) };
}

export function buildSummary(domains) {
  const counts = Object.fromEntries([...STATUS_KEYS, 'PENDING'].map((k) => [k, 0]));
  const rows = domains.map((raw) => { const d = freshen(raw); return { ...d, status: displayStatus(d) }; });
  for (const d of rows) counts[d.status] = (counts[d.status] || 0) + 1;
  const cards = Object.fromEntries(STATUS_KEYS.map((k) => [k, counts[k] || 0]));
  return { total: rows.length, counts, cards, rows, tiers: thresholds() };
}

// ---------- Source of Truth manual: tambah / ubah / hapus ----------
const clean = (v, max = 200) => (String(v ?? '').trim().slice(0, max) || null);

function parseInput(input) {
  const port = Number(input.port || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port harus angka 1–65535');
  const parsed = normalizeDomain(input.domain, port);
  if (!parsed) throw new Error(`Domain tidak valid: "${input.domain || ''}"`);
  if (parsed.domain.startsWith('*.')) parsed.domain = parsed.domain.slice(2);
  return {
    ...parsed,
    environment: clean(input.environment, 50),
    application: clean(input.application),
    owner: clean(input.owner),
    notes: clean(input.notes, 500),
  };
}

/** Cek sekarang, atau (di Vercel dengan mode scanner kantor) titipkan ke antrean. Mengembalikan {id: status | 'PENDING'}. */
export async function checkOrQueue(ids) {
  const { shouldDelegate } = await import('./scanner.js');
  if (shouldDelegate()) {
    const { runJob } = await import('./runner.js');
    await runJob('check_ids', { trigger: 'manual', ids });
    return Object.fromEntries(ids.map((i) => [i, 'PENDING']));
  }
  const out = {};
  for (const i of ids) out[i] = await checkNow(i);
  return out;
}

export async function checkNow(id) {
  const d = await db.getDomain(id);
  const { scanTimeoutMs } = getSettings();
  const r = await checkDomain(d, scanTimeoutMs);
  const status = classifySsl(r);
  await db.saveCheckResult(id, r, status);
  return status;
}

export async function addDomainManual(input) {
  const row = parseInput(input);
  const fileId = Number(input.file_id);
  const { id } = await db.addExcelDomain(fileId, row);
  await db.addActivity('upload', 'Domain ditambahkan', `${row.domain}${row.port !== 443 ? `:${row.port}` : ''} → ${(await db.getFile(fileId))?.name || 'file'} (manual)`);
  const status = await checkOrQueue([id]).then((r) => r[id]);
  return { id, domain: row.domain, port: row.port, status };
}

export async function updateDomainManual(id, input) {
  const row = { ...parseInput(input), file_id: input.file_id ? Number(input.file_id) : undefined };
  const cur = await db.getDomain(id);
  if (!cur || cur.deleted) throw new Error('Domain tidak ditemukan');
  const res = await db.updateExcelDomain(id, row);
  await db.addActivity('upload', 'Domain diperbarui', `${row.domain}${row.port !== 443 ? `:${row.port}` : ''}${res.renamed ? ' (nama/port diganti, dicek ulang)' : ''}${res.moved ? ` (dipindah ke file ${(await db.getDomain(id))?.file_name})` : ''}`);
  if (res.renamed) await checkOrQueue([id]);
  return res;
}

export async function removeDomainsManual(ids) {
  const clean = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!clean.length) throw new Error('Tidak ada domain yang dipilih');
  const res = await db.deleteDomains(clean);
  if (res.removed) {
    await db.addActivity('mismatch', 'Domain dihapus (tidak dipantau lagi)',
      res.domains.slice(0, 3).join(', ') + (res.removed > 3 ? ` +${res.removed - 3} lainnya` : ''));
  }
  return res;
}
