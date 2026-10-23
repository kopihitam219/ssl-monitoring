// Integrasi Wazuh (Settings → Integrasi → Wazuh): kirim log aplikasi, log keamanan, dan temuan SSL ke Wazuh.
//
// Cara kirim (bisa dua-duanya):
//   api  → Wazuh server API  POST /events  (Wazuh 4.6+). Login: user/password API → JWT, atau token/API key tetap.
//          Batas Wazuh: maks 100 event per request & 30 request per menit → dikirim bertahap dari antrean.
//   file → tulis JSON per baris ke file lokal, dibaca Wazuh agent (<localfile> log_format json).
//
// Semua event masuk ke antrean wazuh_outbox (data/app.db) dulu, jadi tidak hilang kalau Wazuh sedang mati
// atau aplikasi di-restart. Event di Wazuh tiba dengan location "API-Webhook" dan di-decode oleh decoder JSON bawaan;
// rules contoh ada di wazuh/ssl_monitoring_rules.xml.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { appDb } from './appdb.js';
import { getSettings } from './settings.js';
import { outsideRequest } from './context.js';

const MAX_BATCH = 100;           // batas Wazuh per request
const MIN_GAP_MS = 2100;         // ≤ 30 request / menit
const MAX_OUTBOX = 50_000;       // antrean maksimal; yang paling lama dibuang
const MAX_EVENT_BYTES = 30_000;  // Wazuh memotong event > 64 KB; jaga tetap kecil
const HOST = os.hostname();

const state = (globalThis.__sslWazuh ??= { token: null, tokenExp: 0, timer: null, busy: false, lastOk: null, lastError: null, lastErrorAt: null, sent: 0, failing: false, nextAt: 0 });

export const DEFAULT_FILE = path.join(process.cwd(), 'data', 'logs', 'ssl-monitoring-wazuh.json');

// ---------- klasifikasi ----------
const SECURITY_CATEGORIES = new Set(['auth', 'settings', 'service', 'export', 'data']);
const SECURITY_ACTIONS = /^(user\.|entra\.|soar\.auth|soar\.token|soar\.in|wazuh\.|job\.entra|settings\.)/;

/** Log keamanan: login, kelola user, perubahan pengaturan, token, export, kosongkan data, restart service. */
export function logTypeOf(category, action) {
  return SECURITY_CATEGORIES.has(category) || SECURITY_ACTIONS.test(action || '') ? 'security' : 'app';
}

function severityOf(e) {
  if (e.log_type === 'ssl') return { EXPIRED: 'critical', URGENT: 'high', CHECK_FAILED: 'medium', REMINDER: 'medium', NEED_UPDATE: 'low', WARNING: 'low' }[e.ssl_status] || 'info';
  if (!e.ok) return e.action === 'auth.locked' || e.action === 'soar.auth' ? 'high' : e.log_type === 'security' ? 'medium' : 'low';
  if (/^(user\.(add|delete|update|reset-password)|settings\.|soar\.token|data\.clear|service\.restart)/.test(e.action)) return 'medium';
  return 'info';
}

function trimEvent(ev) {
  let s = JSON.stringify(ev);
  if (s.length <= MAX_EVENT_BYTES) return s;
  const { details, ...rest } = ev;
  s = JSON.stringify({ ...rest, details_truncated: true, details: JSON.stringify(details ?? null).slice(0, 5000) });
  return s.length <= MAX_EVENT_BYTES ? s : JSON.stringify({ ...rest, summary: String(rest.summary || '').slice(0, 2000), details_truncated: true });
}

function enqueue(logType, ev) {
  const w = getSettings().wazuh;
  const line = trimEvent(ev);
  // mode file: langsung ditulis (Wazuh agent yang membaca); mode API: lewat antrean
  if (w.transport === 'file' || w.transport === 'both') {
    try { appendFile(w, [line]); state.fileError = null; } catch (e) { state.fileError = e.message; console.error('[wazuh] gagal tulis file:', e.message); }
  }
  if (w.transport === 'file') return;
  const db = appDb();
  db.prepare('INSERT INTO wazuh_outbox (created_at, log_type, event) VALUES (?, ?, ?)').run(new Date().toISOString(), logType, line);
  const n = db.prepare('SELECT COUNT(*) n FROM wazuh_outbox').get().n;
  if (n > MAX_OUTBOX) db.prepare('DELETE FROM wazuh_outbox WHERE id IN (SELECT id FROM wazuh_outbox ORDER BY id LIMIT ?)').run(n - MAX_OUTBOX);
  ensureTimer();
}

// ---------- sumber event ----------
/** Dipanggil oleh audit() untuk setiap catatan audit log. */
export function forwardAudit(row) {
  const w = getSettings().wazuh;
  if (!w?.enabled) return;
  const log_type = logTypeOf(row.category, row.action);
  if (log_type === 'security' ? !w.sendSecurity : !w.sendApp) return;
  const ev = {
    app: 'ssl-monitoring', log_type, timestamp: row.at, host: HOST,
    event_id: row.id, category: row.category, action: row.action,
    outcome: row.ok ? 'success' : 'failure',
    actor: row.actor, actor_type: row.type, source: row.source,
    src_ip: row.ip || null, user_agent: row.ua ? String(row.ua).slice(0, 200) : null,
    target: row.target, summary: row.summary,
    ...(row.details ? { details: row.details } : {}),
  };
  ev.severity = severityOf({ ...ev, ok: row.ok });
  enqueue(log_type, ev);
}

/**
 * Dipanggil setelah scan: kirim temuan SSL dengan status yang dipilih di Settings → Integrasi → Wazuh.
 * Sertifikat yang sudah lewat tanggal dikirim dengan ssl_status EXPIRED (di aplikasi tampil sebagai Urgent Renewal).
 * Agar Wazuh tidak dibanjiri, satu domain dikirim saat statusnya berubah, atau diulang setiap N jam selama masih bermasalah.
 * rows = hasil buildSummary().rows
 */
export function reportSslFindings(rows, { mode } = {}) {
  const w = getSettings().wazuh;
  if (!w?.enabled || !w.sendSsl) return { queued: 0 };
  const pick = new Set(w.sslStatuses || []);
  const db = appDb();
  const now = Date.now();
  const repeatMs = Math.max(1, Number(w.sslRepeatHours) || 24) * 3_600_000;
  const prev = new Map(db.prepare('SELECT key, status, sent_at FROM wazuh_ssl_state').all().map((r) => [r.key, r]));
  const upsert = db.prepare('INSERT INTO wazuh_ssl_state (key, status, sent_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, sent_at = excluded.sent_at');
  let queued = 0;
  const seen = new Set();
  for (const d of rows) {
    const expired = d.status === 'URGENT' && d.days_remaining != null && d.days_remaining < 0;
    const status = expired ? 'EXPIRED' : d.status;
    const key = `${d.file_id || ''}|${d.domain}:${d.port}`;
    seen.add(key);
    const wanted = pick.has(d.status);
    const p = prev.get(key);
    if (!wanted) {
      // pulih → kirim sekali "resolved" supaya alert di Wazuh bisa ditutup
      if (p && p.status !== 'OK') {
        enqueue('ssl', sslEvent(d, 'OK', mode, { resolved: true, previous_status: p.status }));
        upsert.run(key, 'OK', new Date(now).toISOString());
        queued++;
      }
      continue;
    }
    if (p && p.status === status && now - new Date(p.sent_at).getTime() < repeatMs) continue;
    enqueue('ssl', sslEvent(d, status, mode, p && p.status !== status ? { previous_status: p.status } : {}));
    upsert.run(key, status, new Date(now).toISOString());
    queued++;
  }
  return { queued };
}

function sslEvent(d, status, mode, extra = {}) {
  const ev = {
    app: 'ssl-monitoring', log_type: 'ssl', timestamp: new Date().toISOString(), host: HOST,
    category: 'ssl', action: extra.resolved ? 'ssl.resolved' : 'ssl.finding',
    outcome: extra.resolved ? 'success' : 'failure',
    ssl_status: status, domain: d.domain, port: d.port, days_remaining: d.days_remaining ?? null,
    expires_at: d.expires_at || null, issuer: d.issuer || null, issuer_cn: d.issuer_cn || null, subject: d.subject || null,
    fingerprint: d.fingerprint || null, error: d.last_error || null,
    environment: d.environment || null, application: d.application || null, owner: d.owner || null,
    group: d.group_name || null, file: d.file_name || null, checked_via: d.checked_via || null,
    summary: extra.resolved
      ? `SSL ${d.domain}:${d.port} kembali normal (sebelumnya ${extra.previous_status})`
      : `SSL ${d.domain}:${d.port} ${status}${d.days_remaining != null ? ` (sisa ${d.days_remaining} hari)` : ''}${d.last_error ? ` — ${d.last_error}` : ''}`,
    ...extra,
  };
  ev.severity = severityOf(ev);
  return ev;
}

// ---------- HTTP ke Wazuh API ----------
function request(method, url, { headers = {}, body, verifyTls, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('URL Wazuh tidak valid')); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...headers },
      timeout: timeoutMs, ...(u.protocol === 'https:' ? { rejectUnauthorized: !!verifyTls } : {}),
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (data.length < 1_000_000) data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${timeoutMs / 1000}s`)));
    req.on('error', (e) => reject(new Error(e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e.code === 'SELF_SIGNED_CERT_IN_CHAIN' || e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      ? `sertifikat HTTPS Wazuh tidak dipercaya (${e.code}). Matikan "Verifikasi sertifikat" atau pasang sertifikat dari CA kantor.`
      : e.code || e.message)));
    if (body) req.write(body);
    req.end();
  });
}

const apiError = (r) => r.json?.detail || r.json?.title || r.json?.message || r.text?.slice(0, 200) || `HTTP ${r.status}`;

async function getToken(w, force = false) {
  if (w.authMode === 'token') {
    if (!w.apiKey) throw new Error('API key / token Wazuh belum diisi');
    return w.apiKey;
  }
  if (!force && state.token && Date.now() < state.tokenExp - 60_000) return state.token;
  if (!w.username || !w.password) throw new Error('Username / password API Wazuh belum diisi');
  const r = await request('POST', `${w.url}/security/user/authenticate`, {
    headers: { Authorization: `Basic ${Buffer.from(`${w.username}:${w.password}`).toString('base64')}` }, verifyTls: w.verifyTls,
  });
  if (r.status !== 200 || !r.json?.data?.token) throw new Error(r.status === 401 ? 'login API Wazuh gagal: username/password salah' : `login API Wazuh gagal: ${apiError(r)}`);
  state.token = r.json.data.token;
  let exp = Date.now() + 900_000; // default Wazuh 900 detik
  try { const p = JSON.parse(Buffer.from(state.token.split('.')[1], 'base64url').toString()); if (p.exp) exp = p.exp * 1000; } catch {}
  state.tokenExp = exp;
  return state.token;
}

async function postEvents(w, events) {
  let token = await getToken(w);
  const body = JSON.stringify({ events });
  let r = await request('POST', `${w.url}/events`, { headers: { Authorization: `Bearer ${token}` }, body, verifyTls: w.verifyTls });
  if (r.status === 401 && w.authMode !== 'token') {
    token = await getToken(w, true);
    r = await request('POST', `${w.url}/events`, { headers: { Authorization: `Bearer ${token}` }, body, verifyTls: w.verifyTls });
  }
  if (r.status === 401) throw new Error(w.authMode === 'token' ? 'API key / token ditolak Wazuh (401)' : 'token login Wazuh ditolak (401)');
  if (r.status === 429) throw Object.assign(new Error('Wazuh membatasi kiriman (429), dicoba lagi'), { retryAfter: 60_000 });
  if (r.status === 403) throw new Error('user API Wazuh tidak punya izin "event:ingest"');
  if (r.status === 404) throw new Error('endpoint /events tidak ada — butuh Wazuh 4.6 atau lebih baru (atau pakai mode file + Wazuh agent)');
  if (r.status !== 200) throw new Error(`Wazuh menolak kiriman: ${apiError(r)}`);
  const failed = r.json?.data?.total_failed_items || 0;
  return { accepted: r.json?.data?.total_affected_items ?? events.length, failed };
}

function appendFile(w, events) {
  const file = w.filePath || DEFAULT_FILE;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // rotasi sederhana: > 50 MB → .1
  try { if (fs.statSync(file).size > 50 * 1024 * 1024) fs.renameSync(file, `${file}.1`); } catch {}
  fs.appendFileSync(file, events.map((e) => `${e}\n`).join(''));
}

// ---------- pengirim antrean ----------
async function audit(e) {
  try { (await import('./audit.js')).audit({ type: 'system', actor: 'system', source: 'System', category: 'settings', ...e }); } catch {}
}

/** Kirim satu batch dari antrean. Dipanggil berkala oleh timer. */
export async function flushOnce() {
  const w = getSettings().wazuh;
  if (!w?.enabled || state.busy || Date.now() < state.nextAt) return { skipped: true };
  if (w.transport === 'file') return { skipped: true };
  const db = appDb();
  const rows = db.prepare('SELECT id, event FROM wazuh_outbox ORDER BY id LIMIT ?').all(MAX_BATCH);
  if (!rows.length) return { sent: 0 };
  state.busy = true;
  try {
    await postEvents(w, rows.map((r) => r.event));
    db.prepare(`DELETE FROM wazuh_outbox WHERE id <= ?`).run(rows[rows.length - 1].id);
    state.sent += rows.length;
    state.lastOk = new Date().toISOString();
    state.nextAt = Date.now() + MIN_GAP_MS;
    if (state.failing) {
      state.failing = false;
      await audit({ action: 'wazuh.recovered', target: w.url || w.filePath, summary: `Kiriman ke Wazuh pulih (${rows.length} event terkirim)` });
    }
    return { sent: rows.length };
  } catch (e) {
    db.prepare(`UPDATE wazuh_outbox SET attempts = attempts + 1 WHERE id <= ?`).run(rows[rows.length - 1].id);
    state.lastError = e.message;
    state.lastErrorAt = new Date().toISOString();
    // coba lagi dengan jeda bertambah: 10s, 30s, 1m, 5m (maks)
    const attempts = db.prepare('SELECT attempts FROM wazuh_outbox ORDER BY id LIMIT 1').get()?.attempts || 1;
    state.nextAt = Date.now() + (e.retryAfter || [10_000, 30_000, 60_000, 300_000][Math.min(attempts - 1, 3)]);
    if (!state.failing) {
      state.failing = true;
      console.error('[wazuh] gagal kirim:', e.message);
      await audit({ action: 'wazuh.error', ok: false, target: w.url || w.filePath, summary: `Gagal kirim log ke Wazuh: ${e.message}. Event disimpan di antrean dan dicoba lagi.` });
    }
    return { error: e.message };
  } finally {
    state.busy = false;
  }
}

export function ensureTimer() {
  if (state.timer) return;
  state.timer = outsideRequest(() => setInterval(() => { flushOnce().catch((e) => console.error('[wazuh]', e.message)); }, 2500));
  state.timer.unref?.();
}

export function wazuhStatus() {
  const w = getSettings().wazuh;
  let queued = 0, oldest = null;
  try {
    const r = appDb().prepare('SELECT COUNT(*) n, MIN(created_at) oldest FROM wazuh_outbox').get();
    queued = r.n; oldest = r.oldest;
  } catch {}
  return {
    enabled: !!w?.enabled, transport: w?.transport, queued, oldest,
    sent: state.sent, lastOk: state.lastOk, lastError: state.failing ? state.lastError : null, lastErrorAt: state.failing ? state.lastErrorAt : null,
    fileError: state.fileError || null,
    file: w?.transport === 'api' ? null : (w?.filePath || DEFAULT_FILE),
  };
}

/** Tes koneksi: login (kalau perlu) lalu kirim satu event tes langsung (tidak lewat antrean). */
export async function testWazuh(override = {}) {
  const w = { ...getSettings().wazuh, ...override };
  const ev = JSON.stringify({
    app: 'ssl-monitoring', log_type: 'security', timestamp: new Date().toISOString(), host: HOST,
    category: 'wazuh', action: 'wazuh.test', outcome: 'success', severity: 'info', actor: 'system',
    summary: 'Tes koneksi dari SSL Monitoring ke Wazuh',
  });
  const out = {};
  if (w.transport !== 'file') {
    if (!w.url) throw new Error('Isi URL Wazuh API dulu, contoh: https://wazuh-manager:55000');
    state.token = null;
    const r = await postEvents(w, [ev]);
    out.api = `event tes diterima Wazuh (${r.accepted} diterima, ${r.failed} gagal)`;
  }
  if (w.transport !== 'api') {
    appendFile(w, [ev]);
    out.file = `event tes ditulis ke ${w.filePath || DEFAULT_FILE}`;
  }
  return out;
}

export function clearOutbox() {
  return Number(appDb().prepare('DELETE FROM wazuh_outbox').run().changes);
}
