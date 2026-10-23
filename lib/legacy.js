// Pindahkan data versi lama (SQLite: data/real.db, data/app.db, data/settings.json) ke database baru
// (PGlite lokal atau Supabase). Jalan otomatis sekali saat aplikasi start di laptop, hanya kalau database baru masih kosong.
// Bisa juga dijalankan manual: npm run import-local
import fs from 'node:fs';
import path from 'node:path';
import { pg, dbLabel } from './pg.js';
import { writeRawSettings } from './settings.js';

const DATA = path.join(process.cwd(), 'data');
// penanda per database tujuan (lokal / Supabase), supaya pindah ke Supabase belakangan tetap mengimpor data lama
const MARK = () => { const l = dbLabel(); return path.join(DATA, `legacy-imported-${`${l.kind}-${l.where}`.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}.json`); };

const TABLES_REAL = ['dashboard_groups', 'sot_files', 'domains', 'ssl_checks', 'data_sources', 'activity_log', 'job_runs', 'daily_stats'];
const TABLES_APP = ['users', 'audit_log', 'notify_alert_state', 'notify_system_state', 'wazuh_ssl_state'];
const IDENTITY = new Set(['dashboard_groups', 'sot_files', 'domains', 'ssl_checks', 'activity_log', 'job_runs', 'users', 'audit_log']);

export const legacyFiles = () => ({
  real: path.join(DATA, 'real.db'),
  app: path.join(DATA, 'app.db'),
  settings: path.join(DATA, 'settings.json'),
});

export function hasLegacy() {
  const f = legacyFiles();
  return fs.existsSync(f.real) || fs.existsSync(f.app) || fs.existsSync(f.settings);
}

async function targetEmpty(db) {
  const r = await db.get(`SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM sot_files) AS f, (SELECT COUNT(*) FROM app_settings) AS s`);
  return !Number(r.u) && !Number(r.f) && !Number(r.s);
}

async function copyTable(src, db, table, log) {
  let rows;
  try { rows = src.prepare(`SELECT * FROM ${table}`).all(); } catch { return 0; } // tabel tidak ada di versi lama
  if (!rows.length) return 0;
  const target = new Set((await db.all('SELECT column_name FROM information_schema.columns WHERE table_name = ?', table)).map((r) => r.column_name));
  const cols = Object.keys(rows[0]).filter((c) => target.has(c));
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const values = part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
    const params = part.flatMap((r) => cols.map((c) => (typeof r[c] === 'bigint' ? Number(r[c]) : r[c])));
    await db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values} ON CONFLICT DO NOTHING`, ...params);
  }
  if (IDENTITY.has(table) && cols.includes('id')) {
    await db.run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`);
  }
  log?.(`  ${table}: ${rows.length} baris`);
  return rows.length;
}

/**
 * Impor data lama. force=true → tetap impor walaupun penanda "sudah diimpor" ada (database tujuan tetap harus kosong).
 * Mengembalikan ringkasan, atau null kalau tidak ada yang perlu diimpor.
 */
export async function importLegacy({ force = false, log = null } = {}) {
  if (process.env.VERCEL || !hasLegacy()) return null;
  if (!force && fs.existsSync(MARK())) return null;
  const db = await pg();
  if (!(await targetEmpty(db))) {
    if (!fs.existsSync(MARK())) fs.writeFileSync(MARK(), JSON.stringify({ skipped: 'database tujuan sudah berisi data', at: new Date().toISOString() }, null, 2));
    return null;
  }
  const SQLITE = 'node:sqlite'; // dimuat hanya saat impor (tidak ikut di Vercel)
  const { DatabaseSync } = await import(/* webpackIgnore: true */ SQLITE);
  const f = legacyFiles();
  const out = { tables: {}, settings: false };
  await db.tx(async (t) => {
    if (fs.existsSync(f.real)) {
      const src = new DatabaseSync(f.real, { readOnly: true });
      try {
        await t.run('DELETE FROM dashboard_groups'); // group bawaan diganti group dari data lama
        for (const tb of TABLES_REAL) out.tables[tb] = await copyTable(src, t, tb, log);
        // file tanpa group lama tetap aman; domain tanpa file (sisa versi sangat lama) diabaikan
      } finally { src.close(); }
      if (!out.tables.dashboard_groups) {
        // versi lama belum punya group → buat Local / Public / Partner lagi
        const { seed } = await import('./schema.js');
        await seed(t);
      }
    }
    if (fs.existsSync(f.app)) {
      const src = new DatabaseSync(f.app, { readOnly: true });
      try { for (const tb of TABLES_APP) out.tables[tb] = await copyTable(src, t, tb, log); } finally { src.close(); }
    }
  });
  if (fs.existsSync(f.settings)) {
    try {
      const saved = JSON.parse(fs.readFileSync(f.settings, 'utf8'));
      await writeRawSettings(saved);
      out.settings = true;
    } catch (e) { out.settingsError = e.message; }
  }
  fs.writeFileSync(MARK(), JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
  return out;
}
