// Filter & urutan SSL Inventory. Dipakai /api/domains, /api/export, dan dashboard per file.
//
// Parameter:
//   q            cari di domain, aplikasi, owner, environment, issuer, nama file
//   file         id file Source of Truth
//   group        id group dashboard (dropdown "Semua group"), 'none' = file tanpa group
//   status       status tampilan — dipakai kartu dashboard
//   exp          masa berlaku: expired | 7 | 30 | 60 | 90 | custom (expFrom..expTo, YYYY-MM-DD)
//   cf           filter per kolom (JSON), seperti filter di Excel:
//                  { environment: ['Production', ''], status: ['OK'], domain: 'teks', last_checked: 'never' | '1' | '7' | '30' }
//                  '' = (Kosong)
//   sort, dir    domain | file | environment | application | owner | port | status | days | issuer | last_checked ; asc | desc
//   panel, ssl, renewed, kpi, cert   drill-down dari Dashboard Monitoring
import { getDomains } from './db.js';
import { buildSummary } from './jobs.js';
import { sslGroup, isRenewed, certStatus } from './monitoring.js';
import { getSettings } from './settings.js';

const STATUS_ORDER = { CHECK_FAILED: 0, URGENT: 1, REMINDER: 2, NEED_UPDATE: 3, WARNING: 4, INFORMATIONAL: 5, PENDING: 6, OK: 7 };
const DAY = 86_400_000;

/** Kolom yang punya daftar nilai (filter centang seperti Excel). */
export const VALUE_COLUMNS = {
  group: (d) => d.group_name || '',
  file: (d) => d.file_name || '',
  environment: (d) => d.environment || '',
  application: (d) => d.application || '',
  owner: (d) => d.owner || '',
  port: (d) => String(d.port),
  status: (d) => d.status || 'PENDING',
  issuer: (d) => d.issuer || '',
  via: (d) => d.checked_via || '',
};

function parseCf(params) {
  try {
    const v = JSON.parse(params.get('cf') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** Baris setelah semua filter. skip = nama kolom yang filternya diabaikan (untuk daftar nilai kolom itu). */
export function filterDomains(params, { skip = null, sorted = true } = {}) {
  const q = (params.get('q') || '').toLowerCase().trim();
  const env = params.get('env') || '';
  const status = params.get('status') || '';
  const fileId = Number(params.get('file') || 0);
  const g = params.get('group') || '';
  const groupId = g === 'none' ? 'none' : Number(g) || null;
  const cf = parseCf(params);

  let rows = buildSummary(getDomains({ ...(fileId ? { fileId } : {}), ...(groupId ? { groupId } : {}) })).rows;
  if (q) rows = rows.filter((d) => [d.domain, d.application, d.owner, d.environment, d.issuer, d.file_name, d.group_name].some((v) => v?.toLowerCase().includes(q)));
  if (env) rows = rows.filter((d) => (env === 'Others' ? !['Production', 'Development', 'UAT', 'Staging'].includes(d.environment) : d.environment === env));
  if (status) rows = rows.filter((d) => d.status === status);

  // filter per kolom
  for (const [col, get] of Object.entries(VALUE_COLUMNS)) {
    if (col === skip || !Array.isArray(cf[col])) continue;
    const allowed = new Set(cf[col].map(String));
    rows = rows.filter((d) => allowed.has(get(d)));
  }
  if (skip !== 'domain' && typeof cf.domain === 'string' && cf.domain.trim()) {
    const t = cf.domain.trim().toLowerCase();
    rows = rows.filter((d) => d.domain.toLowerCase().includes(t) || (d.subject || '').toLowerCase().includes(t));
  }
  if (skip !== 'last_checked' && cf.last_checked) {
    const v = String(cf.last_checked);
    rows = rows.filter((d) => (v === 'never' ? !d.last_checked
      : !!d.last_checked && Date.now() - new Date(d.last_checked).getTime() > Number(v) * DAY));
  }

  // Drill-down dari Dashboard Monitoring
  const panel = params.get('panel') || '';
  if (panel.startsWith('file:')) { const id = Number(panel.slice(5)); rows = rows.filter((d) => d.file_id === id); }
  if (panel.startsWith('group:')) { const v = panel.slice(6); rows = rows.filter((d) => (v === 'none' ? !d.group_id : d.group_id === Number(v))); }
  const ssl = params.get('ssl') || '';
  if (ssl) rows = rows.filter((d) => sslGroup(d) === ssl);
  const cert = params.get('cert') || ''; // status sertifikat: OK | WARNING | URGENT | EXPIRED | CHECK_FAILED | PENDING
  if (cert) rows = rows.filter((d) => certStatus(d) === cert);
  if (params.get('renewed') === '1') { const days = getSettings().monitoring?.renewalDays ?? 30; rows = rows.filter((d) => isRenewed(d, days)); }

  // Filter masa berlaku sertifikat (berdasarkan tanggal expired)
  const exp = skip === 'days' ? '' : params.get('exp') || '';
  if (exp) {
    const now = Date.now();
    let from = -Infinity, to = Infinity;
    if (exp === 'expired') to = now;
    else if (/^\d+$/.test(exp)) { from = now; to = now + Number(exp) * DAY; }
    else if (exp === 'custom') {
      const f = params.get('expFrom'), t = params.get('expTo');
      if (f) from = new Date(`${f}T00:00:00`).getTime();
      if (t) to = new Date(`${t}T23:59:59.999`).getTime();
    }
    rows = rows.filter((d) => {
      if (!d.expires_at) return false;
      const ts = new Date(d.expires_at).getTime();
      return ts >= from && ts <= to;
    });
  }

  if (sorted) rows.sort(comparator(params.get('sort') || 'priority', params.get('dir') === 'desc' ? -1 : 1));
  return rows;
}

const text = (get) => (a, b) => {
  const x = get(a) || '', y = get(b) || '';
  if (!x && y) return 1; // kosong selalu di bawah
  if (x && !y) return -1;
  return x.localeCompare(y, 'id', { numeric: true, sensitivity: 'base' });
};
const num = (get) => (a, b) => (get(a) ?? Infinity) - (get(b) ?? Infinity);
const priority = (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.days_remaining ?? 99999) - (b.days_remaining ?? 99999);

function comparator(sort, dir) {
  const by = {
    domain: text((d) => d.domain),
    file: text((d) => d.file_name),
    group: text((d) => d.group_name),
    environment: text((d) => d.environment),
    application: text((d) => d.application),
    owner: text((d) => d.owner),
    issuer: text((d) => d.issuer),
    port: num((d) => d.port),
    days: num((d) => d.days_remaining),
    expires: num((d) => d.days_remaining),
    last_checked: num((d) => (d.last_checked ? -new Date(d.last_checked).getTime() : null)), // terbaru dulu
    status: priority,
  }[sort];
  if (!by) return priority;
  return (a, b) => dir * by(a, b) || a.domain.localeCompare(b.domain);
}

/** Daftar nilai per kolom + jumlahnya, mengikuti filter kolom lain (seperti filter di Excel). */
export function columnFacets(params) {
  const out = {};
  for (const [col, get] of Object.entries(VALUE_COLUMNS)) {
    const counts = new Map();
    for (const d of filterDomains(params, { skip: col, sorted: false })) counts.set(get(d), (counts.get(get(d)) || 0) + 1);
    out[col] = [...counts.entries()]
      .sort((a, b) => (col === 'status' ? STATUS_ORDER[a[0]] - STATUS_ORDER[b[0]] : !a[0] ? 1 : !b[0] ? -1 : a[0].localeCompare(b[0], 'id', { numeric: true })))
      .map(([value, count]) => ({ value, count }));
  }
  return out;
}
