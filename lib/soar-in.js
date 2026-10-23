// SOAR → aplikasi (Settings → Integrasi → SOAR, bagian "SOAR → Aplikasi").
// Arah sebaliknya (aplikasi → SOAR) ada di lib/notify.js (saluran "soar").
//
// Endpoint (semua memakai API key: header "Authorization: Bearer <key>", "X-Api-Key: <key>", atau "Authorization: Splunk <key>"):
//   POST /api/soar/domains   kirim domain → masuk file Source of Truth "SOAR" (dibuat otomatis), langsung dicek, hasil dibalas
//   GET  /api/soar/domains   tanya status sertifikat (?domain=a.com,b.com  &status=URGENT,CHECK_FAILED  &group=Public)
//   POST /api/soar/command   jalankan Scan / Retry Check Failed / Tes koneksi / kirim laporan
//   POST /services/collector/event   sama dengan POST /api/soar/domains, format Splunk HEC (untuk flow SOAR lama)
import crypto from 'node:crypto';
import { getSettings, saveSettings } from './settings.js';
import * as db from './db.js';
import { normalizeDomain } from './excel.js';
import { checkDomain, mapLimit } from './ssl-check.js';
import { classifySsl, displayStatus } from './status.js';
import { freshen } from './jobs.js';
import { audit } from './audit.js';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const MAX_ITEMS = 2000;

// ---------- API key ----------
/** Buat API key baru. Key asli hanya dikembalikan sekali; yang disimpan hanya hash-nya. */
export async function generateKey() {
  const key = `sslm_${crypto.randomBytes(24).toString('base64url')}`;
  await saveSettings({ soarIn: { tokenHash: sha256(key), tokenHint: `…${key.slice(-4)}` } });
  return key;
}

export function verifyKey(req) {
  const hash = getSettings().soarIn.tokenHash;
  if (!hash) return false;
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^(?:Bearer|Splunk)\s+(.+)$/i);
  const key = (m ? m[1] : req.headers.get('x-api-key') || '').trim();
  if (!key) return false;
  const a = Buffer.from(sha256(key)), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- parsing ----------
/** Teks berisi satu/lebih JSON (objek, array, objek berurutan, NDJSON) → daftar nilai. */
export function parseJsonStream(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : [v];
  } catch {}
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) { out.push(JSON.parse(t.slice(start, i + 1))); start = -1; }
    }
  }
  if (depth !== 0 || !out.length) throw new Error('Format JSON tidak valid');
  return out;
}

const pickField = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
const clean = (v, max = 200) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);

/** Satu nilai kiriman → daftar item domain. Mengenali {domains:[…]}, {event:{…}} (Splunk HEC), string domain, dan objek. */
function flatten(v) {
  if (v == null) return [];
  if (typeof v === 'string') return [{ domain: v }];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (typeof v !== 'object') return [];
  if (Array.isArray(v.domains)) return v.domains.flatMap((d) => flatten(typeof d === 'string' ? { ...v, domains: undefined, domain: d } : { action: v.action, ...d }));
  if (v.event !== undefined && typeof v.event === 'object') return flatten(v.event);
  if (typeof v.event === 'string') return flatten(v.event.trim().startsWith('{') ? JSON.parse(v.event) : { domain: v.event });
  return [v];
}

function toItem(o) {
  const raw = pickField(o, ['domain', 'fqdn', 'host', 'hostname', 'dns_name', 'url', 'name', 'target']);
  const port = Number(pickField(o, ['port']) || 443);
  const action = String(pickField(o, ['action', 'op']) || 'add').toLowerCase();
  const parsed = normalizeDomain(String(raw ?? ''), Number.isInteger(port) && port > 0 && port <= 65535 ? port : 443);
  if (!parsed) return { invalid: true, raw: String(raw ?? JSON.stringify(o)).slice(0, 120) };
  if (parsed.domain.startsWith('*.')) parsed.domain = parsed.domain.slice(2);
  return {
    action: ['remove', 'delete', 'del'].includes(action) ? 'remove' : 'add',
    domain: parsed.domain, port: parsed.port,
    environment: clean(pickField(o, ['environment', 'env']), 50),
    application: clean(pickField(o, ['application', 'app', 'service'])),
    owner: clean(pickField(o, ['owner', 'pic', 'team'])),
    notes: clean(pickField(o, ['notes', 'note', 'description', 'comment']), 500),
  };
}

/** File Source of Truth untuk kiriman SOAR (dibuat otomatis, group & proxy mengikuti Settings). */
async function soarFile() {
  const c = getSettings().soarIn;
  let f = await db.getFileByName(c.fileName);
  const groupId = c.groupId && (await db.getGroup(c.groupId)) ? c.groupId : null;
  if (!f) {
    f = await db.createFile({ name: c.fileName, proxyMode: c.proxyMode, groupId });
    await db.addActivity('upload', 'File Source of Truth dibuat', `${c.fileName} (untuk kiriman SOAR)`);
  }
  return f;
}

export const statusRow = (d) => {
  const x = freshen(d);
  return {
    domain: x.domain, port: x.port, status: displayStatus(x), expired: x.days_remaining != null && x.days_remaining < 0,
    days_remaining: x.days_remaining ?? null, expires_at: x.expires_at || null, issuer: x.issuer_cn || x.issuer || null,
    last_checked: x.last_checked || null, error: x.last_error || null, checked_via: x.checked_via || null,
    group: x.group_name || null, file: x.file_name || null, environment: x.environment || null, application: x.application || null, owner: x.owner || null,
  };
};

/** Terima kiriman domain dari SOAR. */
export async function ingestDomains(text, { scan } = {}) {
  const c = getSettings().soarIn;
  const values = parseJsonStream(text);
  const items = values.flatMap(flatten).map((o) => (typeof o === 'object' ? toItem(o) : { invalid: true, raw: String(o) }));
  if (!items.length) throw Object.assign(new Error('Tidak ada data domain'), { code: 'NO_DATA' });
  if (items.length > MAX_ITEMS) throw new Error(`Terlalu banyak domain dalam satu kiriman (maks ${MAX_ITEMS})`);

  const file = await soarFile();
  const existing = new Map((await db.getExcelDomains(file.id)).map((d) => [`${d.domain}:${d.port}`, d]));
  const out = { file: file.name, received: items.length, added: 0, updated: 0, removed: 0, invalid: [], denied: 0, results: [] };
  const toCheck = [];
  const seen = new Set();
  for (const it of items) {
    if (it.invalid) { out.invalid.push(it.raw); continue; }
    const key = `${it.domain}:${it.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ex = existing.get(key);
    if (it.action === 'remove') {
      if (!c.allowRemove) { out.denied++; out.results.push({ domain: it.domain, port: it.port, result: 'ditolak: hapus domain tidak diizinkan (Settings)' }); continue; }
      if (ex) { await db.deleteDomains([ex.id]); out.removed++; out.results.push({ domain: it.domain, port: it.port, result: 'dihapus' }); }
      else out.results.push({ domain: it.domain, port: it.port, result: 'tidak ada di file SOAR' });
      continue;
    }
    if (ex) {
      const meta = ['environment', 'application', 'owner', 'notes'];
      const changed = meta.some((k) => it[k] !== null && it[k] !== (ex[k] ?? null));
      if (changed) await db.updateExcelDomain(ex.id, { ...ex, ...Object.fromEntries(meta.map((k) => [k, it[k] ?? ex[k] ?? null])), domain: it.domain, port: it.port });
      out.updated += changed ? 1 : 0;
      toCheck.push({ id: ex.id, result: changed ? 'diperbarui' : 'sudah ada' });
    } else {
      const { id } = await db.addExcelDomain(file.id, it);
      out.added++;
      toCheck.push({ id, result: 'ditambahkan' });
    }
  }

  const doScan = scan ?? c.scanOnReceive;
  const { shouldDelegate } = await import('./scanner.js');
  if (doScan && toCheck.length && shouldDelegate()) {
    const { runJob } = await import('./runner.js');
    await runJob('check_ids', { trigger: 'soar', ids: toCheck.map((t) => t.id) });
    out.queued = true;
  } else if (doScan && toCheck.length) {
    const { scanTimeoutMs } = getSettings();
    await mapLimit(toCheck, 8, async (t) => {
      const d = await db.getDomain(t.id);
      const r = await checkDomain(d, scanTimeoutMs);
      await db.saveCheckResult(t.id, r, classifySsl(r));
    });
  }
  for (const t of toCheck) out.results.push({ ...statusRow(await db.getDomain(t.id)), result: t.result });
  out.scanned = doScan && !out.queued ? toCheck.length : 0;
  if (out.added || out.removed || out.updated) {
    await db.addActivity('upload', 'Kiriman SOAR', `${file.name}: ${out.added} ditambahkan · ${out.updated} diperbarui · ${out.removed} dihapus${out.invalid.length ? ` · ${out.invalid.length} tidak valid` : ''}`);
  }
  return out;
}

/** Status domain untuk SOAR. */
export async function queryDomains({ domain, status, group, file } = {}) {
  const wantD = domain ? new Set(String(domain).split(',').map((s) => normalizeDomain(s.trim())?.domain).filter(Boolean)) : null;
  const wantS = status ? new Set(String(status).toUpperCase().split(',').map((s) => s.trim())) : null;
  const g = group ? String(group).toLowerCase() : null;
  const f = file ? String(file).toLowerCase() : null;
  const rows = (await db.getDomains()).map(statusRow).filter((r) =>
    (!wantD || wantD.has(r.domain)) && (!wantS || wantS.has(r.status) || (wantS.has('EXPIRED') && r.expired))
    && (!g || (r.group || '').toLowerCase() === g) && (!f || (r.file || '').toLowerCase() === f));
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { total: rows.length, counts, domains: rows.slice(0, 5000) };
}

export function soarAudit(e) {
  audit({ type: 'system', actor: 'soar', source: 'SOAR', category: 'soar', ...e });
}
