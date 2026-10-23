// Pekerjaan utama: import Excel, scan SSL. Dipakai oleh API (tombol Sync Now / Upload)
// dan oleh script CLI (npm run scan) / scheduler.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
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
export function importExcel(buffer, filename = 'upload.xlsx', { merge = false, proxyMode, fileId, groupId } = {}) {
  const parsed = parseSourceOfTruth(buffer);
  if (!parsed.domains.length) throw new Error('Tidak ada domain yang valid di file ini');

  // simpan salinan file yang diupload (lokal)
  const dir = path.join(process.cwd(), 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stored = `${stamp}_${path.basename(filename)}`;
  fs.writeFileSync(path.join(dir, stored), buffer);

  let file = fileId ? db.getFile(Number(fileId)) : db.getFileByName(db.fileBaseName(filename));
  if (fileId && !file) throw new Error('File Source of Truth tidak ditemukan');
  const created = !file;
  if (created) file = db.createFile({ name: db.fileBaseName(filename) || 'Source of Truth', proxyMode: proxyMode || 'direct', originalFile: path.basename(filename), storedFile: stored, groupId: groupId || null });
  else db.updateFile(file.id, { originalFile: path.basename(filename), storedFile: stored, ...(proxyMode ? { proxyMode } : {}), ...(groupId ? { groupId } : {}) });

  const res = db.syncExcel(file.id, parsed.domains, { merge });
  db.setSource('excel', 'connected', { file: filename, rows: db.getDomains().length, skipped: parsed.skipped.length, merge });
  db.addActivity('upload', `Upload Excel berhasil${created ? ' (file baru)' : merge ? ' (digabung)' : ''}`,
    `${file.name} — ${parsed.domains.length} domain (${res.added} baru${merge ? `, ${res.updated} diperbarui` : `, ${res.removed} dihapus`})`);
  if (parsed.skipped.length) {
    db.addActivity('mismatch', 'Baris Excel dilewati', `${file.name}: ${parsed.skipped.length} baris dengan domain tidak valid`);
  }
  return { ...res, skipped: parsed.skipped, file: db.getFile(file.id), created };
}

// disimpan di globalThis karena Next.js bisa memuat modul ini lebih dari sekali (per route)
export const isScanning = () => !!globalThis.__sslScanning;

/**
 * Scan SSL.
 *   groupId    → hanya domain di group dashboard itu
 *   onlyFailed → hanya domain yang statusnya Check Failed (tombol "Retry Check Failed")
 */
export async function runScan({ onProgress, groupId = null, onlyFailed = false } = {}) {
  if (globalThis.__sslScanning) throw new Error('Scan sedang berjalan');
  globalThis.__sslScanning = true;
  globalThis.__sslScanStarted = Date.now();
  const started = Date.now();
  try {
    let domains = db.getDomains(groupId ? { groupId } : {});
    if (onlyFailed) domains = domains.filter((d) => freshen(d).ssl_status === 'CHECK_FAILED');
    const scope = `${groupId ? `group ${db.getGroup(groupId)?.name || groupId}` : 'semua domain'}${onlyFailed ? ' · hanya Check Failed' : ''}`;
    db.setSource('scan', 'running', { total: domains.length, scope }, false);

    let done = 0;
    const { scanConcurrency, scanTimeoutMs } = getSettings();
    const results = await mapLimit(domains, scanConcurrency, async (d) => {
      const r = await checkDomain(d, scanTimeoutMs);
      const status = classifySsl(r);
      db.saveCheckResult(d.id, r, status);
      onProgress?.(++done, domains.length, d, r, status);
      return { d, r, status };
    });

    const summary = buildSummary(db.getDomains());
    try {
      const { reportSslFindings } = await import('./wazuh.js');
      reportSslFindings(summary.rows);
    } catch (e) { console.error('[wazuh] temuan SSL:', e.message); }
    db.saveDailyStats(summary.counts);

    // aktivitas penting
    const list = (xs) => xs.map((x) => x.d.domain).slice(0, 3).join(', ') + (xs.length > 3 ? ` +${xs.length - 3} lainnya` : '');
    const urgent = results.filter((x) => x.status === 'URGENT').sort((a, b) => a.r.daysRemaining - b.r.daysRemaining);
    const soon = results.filter((x) => ['REMINDER', 'NEED_UPDATE'].includes(x.status)).sort((a, b) => a.r.daysRemaining - b.r.daysRemaining);
    const failed = results.filter((x) => x.status === 'CHECK_FAILED');
    if (urgent.length) db.addActivity('failed', 'Urgent renewal (≤ batas Urgent / sudah expired)', list(urgent));
    if (soon.length) db.addActivity('expiring', 'Domain mendekati expired', `${soon[0].d.domain} (${soon[0].r.daysRemaining} hari lagi)${soon.length > 1 ? ` +${soon.length - 1} lainnya` : ''}`);
    if (failed.length) db.addActivity('failed', 'Check Failed (sertifikat tidak terbaca)', list(failed));
    const recovered = onlyFailed ? results.filter((x) => x.status !== 'CHECK_FAILED') : [];
    if (recovered.length) db.addActivity('scan', 'Retry Check Failed: berhasil dibaca', list(recovered));

    const fallback = results.filter((x) => x.r.via === 'fallback');
    if (fallback.length) db.addActivity('sync', 'Gagal langsung, berhasil lewat proxy', list(fallback));
    const seconds = Math.round((Date.now() - started) / 1000);
    const scanCounts = Object.fromEntries(results.reduce((m, x) => m.set(x.status, (m.get(x.status) || 0) + 1), new Map()));
    db.setSource('scan', 'connected', { total: domains.length, seconds, fallback: fallback.length, scope, failed: failed.length });
    db.addActivity('scan', 'SSL scan selesai', `${scope}: ${domains.length} domain dicek dalam ${seconds} detik${fallback.length ? ` · ${fallback.length} lewat proxy (otomatis)` : ''}`);
    return { total: domains.length, seconds, fallback: fallback.length, recovered: recovered.length, failed: failed.length, scope, scanCounts, counts: summary.counts };
  } catch (e) {
    db.setSource('scan', 'error', { error: e.message });
    throw e;
  } finally {
    globalThis.__sslScanning = false;
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

async function checkNow(id) {
  const d = db.getDomain(id);
  const { scanTimeoutMs } = getSettings();
  const r = await checkDomain(d, scanTimeoutMs);
  const status = classifySsl(r);
  db.saveCheckResult(id, r, status);
  return status;
}

export async function addDomainManual(input) {
  const row = parseInput(input);
  const fileId = Number(input.file_id);
  const { id } = db.addExcelDomain(fileId, row);
  db.addActivity('upload', 'Domain ditambahkan', `${row.domain}${row.port !== 443 ? `:${row.port}` : ''} → ${db.getFile(fileId)?.name || 'file'} (manual)`);
  const status = await checkNow(id);
  return { id, domain: row.domain, port: row.port, status };
}

export async function updateDomainManual(id, input) {
  const row = { ...parseInput(input), file_id: input.file_id ? Number(input.file_id) : undefined };
  const cur = db.getDomain(id);
  if (!cur || cur.deleted) throw new Error('Domain tidak ditemukan');
  const res = db.updateExcelDomain(id, row);
  db.addActivity('upload', 'Domain diperbarui', `${row.domain}${row.port !== 443 ? `:${row.port}` : ''}${res.renamed ? ' (nama/port diganti, dicek ulang)' : ''}${res.moved ? ` (dipindah ke file ${db.getDomain(id)?.file_name})` : ''}`);
  if (res.renamed) await checkNow(id);
  return res;
}

export function removeDomainsManual(ids) {
  const clean = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!clean.length) throw new Error('Tidak ada domain yang dipilih');
  const res = db.deleteDomains(clean);
  if (res.removed) {
    db.addActivity('mismatch', 'Domain dihapus (tidak dipantau lagi)',
      res.domains.slice(0, 3).join(', ') + (res.removed > 3 ? ` +${res.removed - 3} lainnya` : ''));
  }
  return res;
}
