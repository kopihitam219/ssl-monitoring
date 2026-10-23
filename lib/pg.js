// Koneksi database Postgres.
//   DATABASE_URL diisi  → Supabase / Postgres (dipakai di Vercel dan di laptop yang terhubung ke Supabase)
//   DATABASE_URL kosong → PGlite: Postgres lokal di folder data/pg, tanpa server & tanpa internet
// Semua query memakai tanda ? untuk parameter (diubah otomatis ke $1, $2, …).
import path from 'node:path';
import fs from 'node:fs';
import { SCHEMA, SCHEMA_VERSION, seed } from './schema.js';

const URL_ = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || '';
export const usingSupabase = () => !!URL_();
export const pgliteDir = () => process.env.PGLITE_DIR || path.join(process.cwd(), 'data', 'pg');

/** "SELECT … WHERE a = ? AND b = ?" → "… $1 … $2" (tanda ? di dalam '…' tidak diubah). */
export function toPg(sql) {
  let n = 0, out = '', q = false;
  for (const c of sql) {
    if (c === "'") q = !q;
    out += !q && c === '?' ? `$${++n}` : c;
  }
  return out;
}
const clean = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

function wrapPostgres(sql) {
  const api = {
    kind: 'postgres',
    all: async (q, ...p) => [...(await sql.unsafe(toPg(q), clean(p)))],
    get: async (q, ...p) => (await sql.unsafe(toPg(q), clean(p)))[0],
    run: async (q, ...p) => { const r = await sql.unsafe(toPg(q), clean(p)); return { changes: r.count ?? 0, rows: [...r] }; },
    exec: async (q) => { await sql.unsafe(q); },
    tx: (fn) => sql.begin((t) => fn(wrapTx(t))),
    end: () => sql.end({ timeout: 5 }),
  };
  const wrapTx = (t) => ({
    ...api,
    all: async (q, ...p) => [...(await t.unsafe(toPg(q), clean(p)))],
    get: async (q, ...p) => (await t.unsafe(toPg(q), clean(p)))[0],
    run: async (q, ...p) => { const r = await t.unsafe(toPg(q), clean(p)); return { changes: r.count ?? 0, rows: [...r] }; },
    exec: async (q) => { await t.unsafe(q); },
    tx: (fn) => fn(wrapTx(t)),
  });
  return api;
}

function wrapPglite(db) {
  const make = (h) => ({
    kind: 'pglite',
    all: async (q, ...p) => (await h.query(toPg(q), clean(p))).rows,
    get: async (q, ...p) => (await h.query(toPg(q), clean(p))).rows[0],
    run: async (q, ...p) => { const r = await h.query(toPg(q), clean(p)); return { changes: r.affectedRows ?? 0, rows: r.rows }; },
    exec: async (q) => { await h.exec(q); },
    tx: h === db ? (fn) => db.transaction((t) => fn(make(t))) : (fn) => fn(make(h)),
    end: () => db.close(),
  });
  return make(db);
}

async function connect() {
  const url = URL_();
  if (url) {
    const postgres = (await import('postgres')).default;
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    // Parameter tambahan di URL (mis. ?sslmode=require&supa=base-pooler.x dari integrasi Supabase–Vercel) dibuang;
    // SSL diatur di bawah.
    let clean = url;
    try { const u = new URL(url); u.search = ''; clean = u.toString(); } catch {}
    const sql = postgres(clean, {
      prepare: false, // wajib untuk Supabase connection pooler (port 6543)
      max: process.env.VERCEL ? 2 : 8,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: local ? false : 'require',
      onnotice: () => {},
      types: { bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) } },
    });
    return wrapPostgres(sql);
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL belum diisi. Di Vercel, sambungkan Supabase (Storage → Supabase) atau isi DATABASE_URL di Settings → Environment Variables.');
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(pgliteDir(), { recursive: true });
  const db = await PGlite.create(pgliteDir(), { parsers: { 20: (x) => Number(x), 1700: (x) => Number(x) } });
  return wrapPglite(db);
}

/** Koneksi + skema siap. Dipanggil sekali per proses (disimpan di globalThis). */
export function pg() {
  globalThis.__sslPg ??= (async () => {
    const db = await connect();
    await migrate(db);
    return db;
  })().catch((e) => { globalThis.__sslPg = null; throw friendly(e); });
  return globalThis.__sslPg;
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/password authentication failed/i.test(m)) return new Error('Login database gagal: password di DATABASE_URL salah');
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return new Error('Server database tidak ditemukan: cek host di DATABASE_URL (dan koneksi internet / proxy)');
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return new Error(`Tidak bisa terhubung ke database (${m}). Cek DATABASE_URL, internet, atau firewall kantor.`);
  return e instanceof Error ? e : new Error(m);
}

async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_info (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL)');
  const cur = (await db.get('SELECT version FROM schema_info WHERE id = 1'))?.version || 0;
  if (cur >= SCHEMA_VERSION) return;
  await db.tx(async (t) => {
    if (t.kind === 'postgres') await t.run('SELECT pg_advisory_xact_lock(?)', 719_001); // dua instance Vercel start bersamaan
    const again = (await t.get('SELECT version FROM schema_info WHERE id = 1'))?.version || 0;
    if (again >= SCHEMA_VERSION) return;
    await t.exec(SCHEMA);
    await seed(t);
    await t.run(`INSERT INTO schema_info (id, version, updated_at) VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`, SCHEMA_VERSION, new Date().toISOString());
  });
}

/** Tutup koneksi (dipakai script CLI supaya proses bisa selesai). */
export async function closePg() {
  const p = globalThis.__sslPg;
  globalThis.__sslPg = null;
  if (p) { try { (await p).end(); } catch {} }
}

/** Info database untuk Settings / Health. */
export function dbLabel() {
  const url = URL_();
  if (!url) return { kind: 'PGlite (lokal)', where: path.relative(process.cwd(), pgliteDir()) || 'data/pg' };
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  return { kind: /supabase/.test(host) ? 'Supabase' : 'Postgres', where: host };
}
