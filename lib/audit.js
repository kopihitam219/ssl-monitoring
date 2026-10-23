// Audit log: catatan permanen siapa melakukan apa, kapan, dan perubahan apa (sebelum → sesudah).
//   type 'app'    → aksi pengguna (login, ubah domain, upload, settings, kelola user, …)
//   type 'system' → aksi otomatis / service (start, scan terjadwal, kirim Teams otomatis, error)
// Disimpan di data/app.db, terpisah dari data domain. Tidak ada fitur hapus dari aplikasi.
import os from 'node:os';
import { appDb, closeAppDb } from './appdb.js';
import { currentUser, currentIp, currentUserAgent } from './context.js';
import { getSettings } from './settings.js';
import { forwardAudit } from './wazuh.js';

export const closeAudit = closeAppDb;

/** Akun OS yang menjalankan aplikasi (dipakai untuk perintah terminal). */
export function osActor() {
  let user = 'unknown';
  try { user = os.userInfo().username; } catch {}
  return `${user}@${os.hostname()}`;
}

const SECRET_FIELDS = new Set(['password', 'scanProxy.password', 'notify.teams.webhookUrl', 'notify.telegram.botToken', 'notify.whatsapp.token', 'notify.email.pass', 'notify.soar.token', 'entra.clientSecret', 'wazuh.password', 'wazuh.apiKey', 'soarIn.tokenHash']);
const show = (field, v) => {
  if (SECRET_FIELDS.has(field)) return v ? '(diisi)' : '(kosong)';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 500);
  return typeof v === 'boolean' ? (v ? 'Ya' : 'Tidak') : String(v);
};
const cmp = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

/** Bandingkan dua objek → daftar perubahan {field, from, to}. fields = daftar key (boleh 'a.b'). */
export function diff(before = {}, after = {}, fields) {
  const get = (o, k) => k.split('.').reduce((x, p) => (x == null ? x : x[p]), o);
  const keys = fields || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return keys
    .filter((k) => cmp(get(before, k)) !== cmp(get(after, k)))
    .map((k) => ({ field: k, from: show(k, get(before, k)), to: show(k, get(after, k)) }));
}

/**
 * Catat satu kejadian. Tidak pernah melempar error (audit tidak boleh menggagalkan aksi utamanya).
 * Pelaku & tipe ditentukan otomatis:
 *   - ada user login di request ini → type 'app', actor = username
 *   - source 'Terminal'             → type 'app', actor = akun OS
 *   - selain itu                    → type 'system', actor = 'system'
 */
export function audit(e) {
  try {
    const user = currentUser();
    const source = e.source || (user ? 'UI' : 'System');
    const type = e.type || (user || source === 'Terminal' ? 'app' : 'system');
    const actor = e.actor || (user ? user.username : source === 'Terminal' ? osActor() : 'system');
    const details = e.changes || e.details ? JSON.stringify({ ...(e.details || {}), ...(e.changes ? { changes: e.changes } : {}) }) : null;
    let mode = e.mode;
    if (mode === undefined) { try { mode = getSettings().mode; } catch { mode = null; } }
    const at = new Date().toISOString();
    const ip = e.ip ?? currentIp();
    const r = appDb().prepare(`INSERT INTO audit_log (at, type, actor, source, mode, category, action, target, summary, ok, details, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(at, type, actor, source, mode, e.category, e.action, e.target ?? null, e.summary, e.ok === false ? 0 : 1, details, ip);
    try {
      forwardAudit({ id: Number(r.lastInsertRowid), at, type, actor, source, category: e.category, action: e.action, target: e.target ?? null,
        summary: e.summary, ok: e.ok !== false, details: details ? JSON.parse(details) : null, ip, ua: currentUserAgent() });
    } catch (err) { console.error('[wazuh] gagal antre:', err.message); }
  } catch (err) {
    console.error('[audit] gagal mencatat:', err.message);
  }
}

function where({ type, q, category, mode, source, from, to, result }) {
  const w = [], p = [];
  if (type) { w.push('type = ?'); p.push(type); }
  if (q) { w.push('(summary LIKE ? OR target LIKE ? OR actor LIKE ? OR action LIKE ? OR ip LIKE ?)'); p.push(...Array(5).fill(`%${q}%`)); }
  if (category) { w.push('category = ?'); p.push(category); }
  if (mode) { w.push('mode = ?'); p.push(mode); }
  if (source) { w.push('source = ?'); p.push(source); }
  if (result === 'ok') w.push('ok = 1');
  if (result === 'fail') w.push('ok = 0');
  if (from) { w.push('at >= ?'); p.push(new Date(`${from}T00:00:00`).toISOString()); }
  if (to) { w.push('at <= ?'); p.push(new Date(`${to}T23:59:59.999`).toISOString()); }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

const parse = (r) => ({ ...r, ok: !!r.ok, details: r.details ? JSON.parse(r.details) : null });

export function listAudit(filter = {}, { page = 1, pageSize = 25 } = {}) {
  const { sql, params } = where(filter);
  const total = appDb().prepare(`SELECT COUNT(*) n FROM audit_log ${sql}`).get(...params).n;
  const rows = appDb().prepare(`SELECT * FROM audit_log ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize).map(parse);
  return { total, rows };
}

export function allAudit(filter = {}, limit = 50_000) {
  const { sql, params } = where(filter);
  return appDb().prepare(`SELECT * FROM audit_log ${sql} ORDER BY id DESC LIMIT ?`).all(...params, limit).map(parse);
}

/** Ambil filter audit dari URLSearchParams. */
export function auditFilter(p) {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  return {
    type: ['app', 'system'].includes(p.get('type')) ? p.get('type') : '',
    q: (p.get('q') || '').trim().slice(0, 100),
    category: p.get('category') || '',
    mode: ['demo', 'real'].includes(p.get('mode')) ? p.get('mode') : '',
    source: p.get('source') || '',
    result: p.get('result') || '',
    from: DATE.test(p.get('from') || '') ? p.get('from') : '',
    to: DATE.test(p.get('to') || '') ? p.get('to') : '',
  };
}
