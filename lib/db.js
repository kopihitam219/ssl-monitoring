// Database lokal: SQLite bawaan Node.js (node:sqlite) — tidak butuh server / koneksi internet.
// File database: data/real.db (atau DB_PATH).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');

export function dbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(DATA_DIR, 'real.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sot_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE, -- nama file Excel tanpa ekstensi (dipakai sebagai nama dashboard)
  original_file TEXT,                                -- nama file asli terakhir diupload (mis. aplikasi.xlsx)
  stored_file   TEXT,                                -- salinan file asli di data/uploads
  proxy_mode    TEXT NOT NULL DEFAULT 'direct',      -- direct: tanpa proxy, otomatis coba proxy kalau gagal | proxy: selalu lewat proxy
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS domains (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id        INTEGER,
  domain         TEXT    NOT NULL,
  port           INTEGER NOT NULL DEFAULT 443,
  environment    TEXT,
  application    TEXT,
  owner          TEXT,
  notes          TEXT,
  in_excel       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  ssl_status     TEXT,
  days_remaining INTEGER,
  valid_from     TEXT,
  expires_at     TEXT,
  issuer         TEXT,
  subject        TEXT,
  san            TEXT,
  protocol       TEXT,
  last_error     TEXT,
  last_checked   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (file_id, domain, port)
);
CREATE TABLE IF NOT EXISTS ssl_checks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id      INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  checked_at     TEXT NOT NULL,
  ssl_status     TEXT NOT NULL,
  days_remaining INTEGER,
  expires_at     TEXT,
  issuer         TEXT,
  error          TEXT,
  duration_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS ssl_checks_domain_idx ON ssl_checks (domain_id, checked_at DESC);
CREATE TABLE IF NOT EXISTS data_sources (
  name      TEXT PRIMARY KEY,
  status    TEXT NOT NULL,
  last_sync TEXT,
  detail    TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,
  message     TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_idx ON job_runs (job, id DESC);
CREATE TABLE IF NOT EXISTS daily_stats (
  date       TEXT PRIMARY KEY,
  counts     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // kolom tambahan (ditambahkan otomatis di database lama)
  const cols = new Set(db.prepare('PRAGMA table_info(domains)').all().map((c) => c.name));
  if (!cols.has('issuer_cn')) db.exec('ALTER TABLE domains ADD COLUMN issuer_cn TEXT');
  if (!cols.has('fingerprint')) db.exec('ALTER TABLE domains ADD COLUMN fingerprint TEXT');
  if (!cols.has('via_proxy')) db.exec('ALTER TABLE domains ADD COLUMN via_proxy INTEGER NOT NULL DEFAULT 0'); // cek SSL lewat proxy
  if (!cols.has('deleted')) {
    // domain yang dihapus admin (tidak dipantau, bisa dikembalikan dari Settings)
    db.exec('ALTER TABLE domains ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
    if (cols.has('soar_ignored')) db.exec('UPDATE domains SET deleted = soar_ignored'); // database versi lama
  }
  if (!cols.has('checked_via')) db.exec('ALTER TABLE domains ADD COLUMN checked_via TEXT'); // direct | proxy | fallback (gagal langsung → lewat proxy)
  if (!cols.has('file_id')) db.exec('ALTER TABLE domains ADD COLUMN file_id INTEGER');
  if (!cols.has('conn_test')) db.exec('ALTER TABLE domains ADD COLUMN conn_test TEXT'); // hasil tes koneksi terakhir (JSON: DNS, ping, port, HTTPS)
  if (!cols.has('conn_tested_at')) db.exec('ALTER TABLE domains ADD COLUMN conn_tested_at TEXT');
  // group dashboard (mis. Local, Public, Partner): satu group berisi satu atau beberapa file Source of Truth
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_groups'").get()) {
    db.exec(`CREATE TABLE dashboard_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
    const t = new Date().toISOString();
    ['Local', 'Public', 'Partner'].forEach((n, i) => db.prepare('INSERT INTO dashboard_groups (name, sort, created_at) VALUES (?, ?, ?)').run(n, i + 1, t));
  }
  const fcols = new Set(db.prepare('PRAGMA table_info(sot_files)').all().map((c) => c.name));
  if (!fcols.has('group_id')) db.exec('ALTER TABLE sot_files ADD COLUMN group_id INTEGER');
  const ccols = new Set(db.prepare('PRAGMA table_info(ssl_checks)').all().map((c) => c.name));
  if (!ccols.has('via')) db.exec('ALTER TABLE ssl_checks ADD COLUMN via TEXT');
  migrateToFiles(db);
  // Domain dipantau kalau ada di salah satu file Source of Truth dan tidak dihapus admin.
  // Domain lama yang hanya berasal dari SOAR / Route 53 tidak dipantau lagi (riwayatnya tetap tersimpan).
  db.exec('UPDATE domains SET active = CASE WHEN deleted = 0 AND in_excel = 1 AND file_id IS NOT NULL THEN 1 ELSE 0 END');
  return db;
}

/**
 * Versi lama: satu daftar Source of Truth, domain unik per (domain, port).
 * Versi baru: tiap file Excel = satu sumber, domain unik per (file, domain, port).
 * Database lama dibangun ulang sekali, lalu semua domain lama dimasukkan ke satu file.
 */
function migrateToFiles(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'domains'").get()?.sql || '';
  if (/UNIQUE\s*\(\s*domain\s*,\s*port\s*\)/i.test(sql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(sql.replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?domains"?/i, 'CREATE TABLE domains_new')
        .replace(/UNIQUE\s*\(\s*domain\s*,\s*port\s*\)/i, 'UNIQUE (file_id, domain, port)'));
      db.exec('INSERT INTO domains_new SELECT * FROM domains; DROP TABLE domains; ALTER TABLE domains_new RENAME TO domains;');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  const orphan = db.prepare('SELECT COUNT(*) n FROM domains WHERE file_id IS NULL AND (in_excel = 1 OR deleted = 1)').get().n;
  if (!orphan) return;
  // nama file = file Excel terakhir yang diupload (kalau tercatat), atau "Source of Truth"
  let original = null;
  try { original = JSON.parse(db.prepare("SELECT detail FROM data_sources WHERE name = 'excel'").get()?.detail || '{}').file || null; } catch {}
  const name = fileBaseName(original) || 'Source of Truth';
  const t = now();
  let f = db.prepare('SELECT id FROM sot_files WHERE name = ?').get(name);
  if (!f) f = { id: Number(db.prepare('INSERT INTO sot_files (name, original_file, proxy_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, original, 'direct', t, t).lastInsertRowid) };
  db.prepare('UPDATE domains SET file_id = ? WHERE file_id IS NULL AND (in_excel = 1 OR deleted = 1)').run(f.id);
}

/** "Aplikasi Internal.xlsx" → "Aplikasi Internal" */
export function fileBaseName(filename) {
  if (!filename) return '';
  return String(filename).split(/[\\/]/).pop().replace(/\.(xlsx|xls|csv)$/i, '').replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_/, '').trim().slice(0, 100);
}

// Satu koneksi per file per proses (aman untuk hot-reload Next.js dev).
export function getDb() {
  const file = dbPath();
  globalThis.__sslDbs ??= {};
  globalThis.__sslDbs[file] ??= open(file);
  return globalThis.__sslDbs[file];
}

/** Tutup semua koneksi database (dipakai saat restart service). Akan dibuka ulang otomatis. */
export function closeAll() {
  for (const [file, db] of Object.entries(globalThis.__sslDbs || {})) {
    try { db.close(); } catch {}
    delete globalThis.__sslDbs[file];
  }
}

const now = () => new Date().toISOString();
const bool = (r) => r && { ...r, in_excel: !!r.in_excel, active: !!r.active, via_proxy: r.proxy_mode === 'proxy', deleted: !!r.deleted };
const SELECT_D = 'SELECT d.*, f.name AS file_name, f.proxy_mode, f.group_id, g.name AS group_name FROM domains d LEFT JOIN sot_files f ON f.id = d.file_id LEFT JOIN dashboard_groups g ON g.id = f.group_id';

function tx(fn) {
  const db = getDb();
  db.exec('BEGIN');
  try { const r = fn(db); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- domains ----------
export function getDomains({ activeOnly = true, fileId = null, groupId = null } = {}) {
  const w = [], p = [];
  if (activeOnly) w.push('d.active = 1');
  if (fileId) { w.push('d.file_id = ?'); p.push(fileId); }
  if (groupId === 'none') w.push('f.group_id IS NULL');
  else if (groupId) { w.push('f.group_id = ?'); p.push(groupId); }
  const sql = `${SELECT_D} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY d.domain, d.port`;
  return getDb().prepare(sql).all(...p).map(bool);
}

/** Simpan hasil tes koneksi (DNS / ping / port / HTTPS) satu domain. */
export function saveConnTest(id, result) {
  getDb().prepare('UPDATE domains SET conn_test = ?, conn_tested_at = ? WHERE id = ?').run(JSON.stringify(result), now(), id);
}

// ---------- group dashboard ----------
export function listGroups() {
  return getDb().prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM sot_files f WHERE f.group_id = g.id) AS files,
      (SELECT COUNT(*) FROM domains d JOIN sot_files f ON f.id = d.file_id WHERE f.group_id = g.id AND d.active = 1) AS domains
    FROM dashboard_groups g ORDER BY g.sort, g.name COLLATE NOCASE`).all();
}
export const getGroup = (id) => getDb().prepare('SELECT * FROM dashboard_groups WHERE id = ?').get(id) || null;

export function createGroup(name) {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw new Error('Nama group tidak boleh kosong');
  if (getDb().prepare('SELECT 1 FROM dashboard_groups WHERE name = ?').get(n)) throw new Error(`Group "${n}" sudah ada`);
  const sort = (getDb().prepare('SELECT MAX(sort) m FROM dashboard_groups').get().m || 0) + 1;
  const id = Number(getDb().prepare('INSERT INTO dashboard_groups (name, sort, created_at) VALUES (?, ?, ?)').run(n, sort, now()).lastInsertRowid);
  return getGroup(id);
}

export function renameGroup(id, name) {
  const cur = getGroup(id);
  if (!cur) throw new Error('Group tidak ditemukan');
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw new Error('Nama group tidak boleh kosong');
  const clash = getDb().prepare('SELECT id FROM dashboard_groups WHERE name = ?').get(n);
  if (clash && clash.id !== id) throw new Error(`Group "${n}" sudah ada`);
  getDb().prepare('UPDATE dashboard_groups SET name = ? WHERE id = ?').run(n, id);
  return { before: cur, after: getGroup(id) };
}

/** Hapus group. File di dalamnya TIDAK dihapus, hanya jadi "Tanpa group". */
export function deleteGroup(id) {
  const cur = getGroup(id);
  if (!cur) throw new Error('Group tidak ditemukan');
  const files = getDb().prepare('SELECT COUNT(*) n FROM sot_files WHERE group_id = ?').get(id).n;
  getDb().prepare('UPDATE sot_files SET group_id = NULL WHERE group_id = ?').run(id);
  getDb().prepare('DELETE FROM dashboard_groups WHERE id = ?').run(id);
  return { group: cur, files };
}

export function getDomain(id) {
  return bool(getDb().prepare(`${SELECT_D} WHERE d.id = ?`).get(id));
}

const refreshActive = (db) => db.prepare('UPDATE domains SET active = CASE WHEN deleted = 0 AND in_excel = 1 AND file_id IS NOT NULL THEN 1 ELSE 0 END').run();

// ---------- file Source of Truth ----------
export const PROXY_MODES = ['direct', 'proxy'];

export function listFiles() {
  return getDb().prepare(`SELECT f.*, g.name AS group_name,
      (SELECT COUNT(*) FROM domains d WHERE d.file_id = f.id AND d.active = 1) AS domains,
      (SELECT COUNT(*) FROM domains d WHERE d.file_id = f.id AND d.active = 1 AND d.ssl_status IN ('URGENT', 'EXPIRED', 'CHECK_FAILED')) AS problems,
      (SELECT MAX(d.last_checked) FROM domains d WHERE d.file_id = f.id AND d.active = 1) AS last_checked
    FROM sot_files f LEFT JOIN dashboard_groups g ON g.id = f.group_id ORDER BY g.sort IS NULL, g.sort, f.name COLLATE NOCASE`).all();
}

export const getFile = (id) => getDb().prepare('SELECT * FROM sot_files WHERE id = ?').get(id) || null;
export const getFileByName = (name) => getDb().prepare('SELECT * FROM sot_files WHERE name = ?').get(name) || null;

export function createFile({ name, proxyMode = 'direct', originalFile = null, storedFile = null, groupId = null }) {
  const n = String(name || '').trim().slice(0, 100);
  if (!n) throw new Error('Nama file tidak boleh kosong');
  if (!PROXY_MODES.includes(proxyMode)) throw new Error('Pilihan proxy tidak valid');
  if (getFileByName(n)) throw new Error(`File "${n}" sudah ada`);
  const t = now();
  if (groupId && !getGroup(groupId)) throw new Error('Group tidak ditemukan');
  const id = Number(getDb().prepare('INSERT INTO sot_files (name, original_file, stored_file, proxy_mode, group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(n, originalFile, storedFile, proxyMode, groupId || null, t, t).lastInsertRowid);
  return getFile(id);
}

export function updateFile(id, { name, proxyMode, originalFile, storedFile, groupId } = {}) {
  const cur = getFile(id);
  if (!cur) throw new Error('File tidak ditemukan');
  const next = { ...cur };
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 100);
    if (!n) throw new Error('Nama file tidak boleh kosong');
    const clash = getFileByName(n);
    if (clash && clash.id !== id) throw new Error(`File "${n}" sudah ada`);
    next.name = n;
  }
  if (proxyMode !== undefined) {
    if (!PROXY_MODES.includes(proxyMode)) throw new Error('Pilihan proxy tidak valid');
    next.proxy_mode = proxyMode;
  }
  if (groupId !== undefined) {
    if (groupId && !getGroup(Number(groupId))) throw new Error('Group tidak ditemukan');
    next.group_id = groupId ? Number(groupId) : null;
  }
  if (originalFile !== undefined) next.original_file = originalFile;
  if (storedFile !== undefined) next.stored_file = storedFile;
  getDb().prepare('UPDATE sot_files SET name = ?, proxy_mode = ?, group_id = ?, original_file = ?, stored_file = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.proxy_mode, next.group_id ?? null, next.original_file, next.stored_file, now(), id);
  return { before: cur, after: getFile(id) };
}

export const touchFile = (id) => getDb().prepare('UPDATE sot_files SET updated_at = ? WHERE id = ?').run(now(), id);

/** Hapus file beserta semua domain & riwayat scan-nya (permanen). */
export function deleteFile(id) {
  return tx((db) => {
    const f = db.prepare('SELECT * FROM sot_files WHERE id = ?').get(id);
    if (!f) throw new Error('File tidak ditemukan');
    const n = db.prepare('SELECT COUNT(*) n FROM domains WHERE file_id = ?').get(id).n;
    db.prepare('DELETE FROM domains WHERE file_id = ?').run(id); // ssl_checks ikut terhapus (ON DELETE CASCADE)
    db.prepare('DELETE FROM sot_files WHERE id = ?').run(id);
    return { file: f, domains: n };
  });
}

/**
 * Sinkronkan satu file Source of Truth dari upload Excel.
 * merge=false → domain di file itu yang tidak ada di upload dikeluarkan (dinonaktifkan, riwayat tetap tersimpan).
 * merge=true  → hanya tambah / perbarui.
 */
export function syncExcel(fileId, rows, { merge = false } = {}) {
  return tx((db) => {
    const before = new Set(db.prepare("SELECT domain || ':' || port k FROM domains WHERE file_id = ? AND in_excel = 1 AND deleted = 0").all(fileId).map((r) => r.k));
    const existedBefore = before.size;
    if (!merge) db.prepare('UPDATE domains SET in_excel = 0 WHERE file_id = ?').run(fileId);
    const upsert = db.prepare(`INSERT INTO domains (file_id, domain, port, environment, application, owner, notes, in_excel)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(file_id, domain, port) DO UPDATE SET environment = excluded.environment, application = excluded.application,
          owner = excluded.owner, notes = excluded.notes, in_excel = 1, deleted = 0, updated_at = ?`);
    let added = 0;
    const t = now();
    for (const r of rows) {
      const k = `${r.domain}:${r.port}`;
      if (!before.has(k)) added++;
      before.delete(k);
      upsert.run(fileId, r.domain, r.port, r.environment, r.application, r.owner, r.notes, t);
    }
    db.prepare('UPDATE sot_files SET updated_at = ? WHERE id = ?').run(t, fileId);
    refreshActive(db);
    return { total: rows.length, added, updated: rows.length - added, removed: merge ? 0 : before.size, existedBefore };
  });
}

// ---------- Source of Truth: tambah / ubah / hapus manual (per file) ----------
export function addExcelDomain(fileId, r) {
  return tx((db) => {
    if (!db.prepare('SELECT 1 FROM sot_files WHERE id = ?').get(fileId)) throw new Error('Pilih file Source of Truth dulu');
    const ex = db.prepare('SELECT id, in_excel, deleted FROM domains WHERE file_id = ? AND domain = ? AND port = ?').get(fileId, r.domain, r.port);
    if (ex?.in_excel && !ex.deleted) throw new Error(`${r.domain}:${r.port} sudah ada di file ini`);
    let id;
    if (ex) {
      // pernah dihapus / dikeluarkan → ditambahkan lagi secara manual
      db.prepare('UPDATE domains SET environment = ?, application = ?, owner = ?, notes = ?, in_excel = 1, deleted = 0, updated_at = ? WHERE id = ?')
        .run(r.environment, r.application, r.owner, r.notes, now(), ex.id);
      id = ex.id;
    } else {
      id = Number(db.prepare('INSERT INTO domains (file_id, domain, port, environment, application, owner, notes, in_excel) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
        .run(fileId, r.domain, r.port, r.environment, r.application, r.owner, r.notes).lastInsertRowid);
    }
    db.prepare('UPDATE sot_files SET updated_at = ? WHERE id = ?').run(now(), fileId);
    refreshActive(db);
    return { id, existed: !!ex };
  });
}

export function updateExcelDomain(id, r) {
  return tx((db) => {
    const cur = db.prepare('SELECT * FROM domains WHERE id = ? AND deleted = 0').get(id);
    if (!cur || !cur.in_excel) throw new Error('Domain tidak ditemukan di Source of Truth');
    const renamed = cur.domain !== r.domain || cur.port !== r.port;
    // pindah ke file lain
    const targetFile = r.file_id ? Number(r.file_id) : cur.file_id;
    const moved = targetFile !== cur.file_id;
    if (moved && !db.prepare('SELECT 1 FROM sot_files WHERE id = ?').get(targetFile)) throw new Error('File tujuan tidak ditemukan');
    if (renamed || moved) {
      const clash = db.prepare('SELECT id, deleted FROM domains WHERE file_id IS ? AND domain = ? AND port = ? AND id != ?').get(targetFile, r.domain, r.port, id);
      if (clash && !clash.deleted) throw new Error(`${r.domain}:${r.port} sudah ada di file tujuan`);
      if (clash) db.prepare('DELETE FROM domains WHERE id = ?').run(clash.id); // sisa domain yang pernah dihapus di file tujuan
    }
    if (moved) {
      db.prepare('UPDATE domains SET file_id = ? WHERE id = ?').run(targetFile, id);
      db.prepare('UPDATE sot_files SET updated_at = ? WHERE id = ?').run(now(), targetFile);
    }
    if (renamed) {
      // domain/port berubah → hasil scan lama tidak berlaku lagi
      db.prepare(`UPDATE domains SET domain = ?, port = ?, ssl_status = NULL, days_remaining = NULL, valid_from = NULL, expires_at = NULL,
          issuer = NULL, subject = NULL, san = NULL, protocol = NULL, last_error = NULL, last_checked = NULL, checked_via = NULL WHERE id = ?`).run(r.domain, r.port, id);
      db.prepare('DELETE FROM ssl_checks WHERE domain_id = ?').run(id);
    }
    db.prepare('UPDATE domains SET environment = ?, application = ?, owner = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(r.environment, r.application, r.owner, r.notes, now(), id);
    if (cur.file_id) db.prepare('UPDATE sot_files SET updated_at = ? WHERE id = ?').run(now(), cur.file_id);
    return { id, renamed, moved };
  });
}

/**
 * Hapus domain oleh admin: hilang dari SSL Inventory & dashboard. Riwayat scan tetap tersimpan.
 * Bisa dikembalikan dari Settings → Domain yang dihapus, atau dengan menambahkannya lagi (manual / upload Excel).
 */
export function deleteDomains(ids) {
  return tx((db) => {
    const rows = ids.map((id) => db.prepare('SELECT id, domain, port FROM domains WHERE id = ? AND deleted = 0').get(id)).filter(Boolean);
    const upd = db.prepare('UPDATE domains SET deleted = 1, updated_at = ? WHERE id = ?');
    const t = now();
    rows.forEach((r) => upd.run(t, r.id));
    refreshActive(db);
    return { removed: rows.length, domains: rows.map((r) => r.domain) };
  });
}

/** Domain yang dihapus admin. */
export function getDeletedDomains() {
  return getDb().prepare(`SELECT d.id, d.domain, d.port, d.updated_at AS deleted_at, f.name AS file_name
      FROM domains d LEFT JOIN sot_files f ON f.id = d.file_id WHERE d.deleted = 1 AND d.file_id IS NOT NULL ORDER BY d.updated_at DESC`).all();
}

/** Kembalikan domain yang dihapus ke Source of Truth. */
export function restoreDomain(id) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM domains WHERE id = ? AND deleted = 1').get(id);
  if (!cur) throw new Error('Domain tidak ada di daftar yang dihapus');
  db.prepare('UPDATE domains SET deleted = 0, in_excel = 1, updated_at = ? WHERE id = ?').run(now(), id);
  refreshActive(db);
  return bool(cur);
}

export function getExcelDomains(fileId) {
  return getDb().prepare(`${SELECT_D} WHERE d.file_id = ? AND d.in_excel = 1 AND d.deleted = 0 ORDER BY d.domain, d.port`).all(fileId).map(bool);
}

export function dbStats() {
  const db = getDb();
  return {
    file: dbPath(),
    domains: db.prepare('SELECT COUNT(*) n FROM domains WHERE active = 1').get().n,
    excel: db.prepare('SELECT COUNT(*) n FROM domains WHERE active = 1').get().n,
    files: db.prepare('SELECT COUNT(*) n FROM sot_files').get().n,
    checks: db.prepare('SELECT COUNT(*) n FROM ssl_checks').get().n,
  };
}

export function saveCheckResult(id, result, status) {
  const t = now();
  tx((db) => {
    db.prepare(`UPDATE domains SET ssl_status = ?, days_remaining = ?, valid_from = ?, expires_at = ?, issuer = ?, subject = ?,
        san = ?, protocol = ?, last_error = ?, last_checked = ?, updated_at = ?, issuer_cn = ?, fingerprint = ?, checked_via = ? WHERE id = ?`)
      .run(status, result.daysRemaining ?? null, result.validFrom ?? null, result.validTo ?? null, result.issuer ?? null,
        result.subject ?? null, result.san ?? null, result.protocol ?? null, result.error || result.trustError || null, t, now(),
        result.issuerCn ?? null, result.fingerprint ?? null, result.via || 'direct', id);
    db.prepare(`INSERT INTO ssl_checks (domain_id, checked_at, ssl_status, days_remaining, expires_at, issuer, error, duration_ms, via)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t, status, result.daysRemaining ?? null, result.validTo ?? null, result.issuer ?? null,
        result.error || result.trustError || null, result.durationMs ?? null, result.via || 'direct');
  });
}

export function getChecks(domainId, limit = 30) {
  return getDb().prepare('SELECT * FROM ssl_checks WHERE domain_id = ? ORDER BY checked_at DESC LIMIT ?').all(domainId, limit);
}

// ---------- data sources ----------
export function setSource(name, status, detail = {}, touchSync = true) {
  const prev = getDb().prepare('SELECT * FROM data_sources WHERE name = ?').get(name);
  const merged = { ...(prev ? JSON.parse(prev.detail) : {}), ...detail };
  getDb().prepare(`INSERT INTO data_sources (name, status, last_sync, detail) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET status = excluded.status, last_sync = excluded.last_sync, detail = excluded.detail`)
    .run(name, status, touchSync ? now() : prev?.last_sync ?? null, JSON.stringify(merged));
}

export function getSources() {
  return Object.fromEntries(getDb().prepare('SELECT * FROM data_sources').all()
    .map((r) => [r.name, { ...r, detail: JSON.parse(r.detail) }]));
}

// ---------- activity ----------
export function addActivity(type, title, detail = null) {
  getDb().prepare('INSERT INTO activity_log (type, title, detail, created_at) VALUES (?, ?, ?, ?)').run(type, title, detail, now());
}

export function getActivities(limit = 10) {
  return getDb().prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit);
}

// ---------- trend ----------
export function saveDailyStats(counts) {
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD waktu lokal
  getDb().prepare(`INSERT INTO daily_stats (date, counts, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET counts = excluded.counts, updated_at = excluded.updated_at`)
    .run(date, JSON.stringify(counts), now());
}

/** Tren harian dalam rentang tanggal (YYYY-MM-DD, inklusif). Tanpa rentang = 7 hari terakhir yang ada datanya. */
export function getTrend(from, to) {
  const rows = from || to
    ? getDb().prepare('SELECT * FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date').all(from || '0000-00-00', to || '9999-12-31')
    : getDb().prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7').all().reverse();
  return rows.map((r) => ({ date: r.date, ...JSON.parse(r.counts) }));
}

/** Aktivitas dalam rentang waktu (ISO timestamp). */
export function getActivitiesInRange(fromIso, toIso, limit = 50) {
  return getDb().prepare('SELECT * FROM activity_log WHERE created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT ?')
    .all(fromIso || '0000', toIso || '9999', limit);
}

export function countActivitiesInRange(fromIso, toIso) {
  return getDb().prepare('SELECT COUNT(*) n FROM activity_log WHERE created_at >= ? AND created_at <= ?')
    .get(fromIso || '0000', toIso || '9999').n;
}

export function resetAll() {
  getDb().exec('DELETE FROM ssl_checks; DELETE FROM domains; DELETE FROM sot_files; DELETE FROM data_sources; DELETE FROM activity_log; DELETE FROM daily_stats; DELETE FROM job_runs;');
}

// ---------- riwayat job ----------
export function startJobRun(job, trigger) {
  return Number(getDb().prepare('INSERT INTO job_runs (job, trigger, started_at) VALUES (?, ?, ?)').run(job, trigger, now()).lastInsertRowid);
}

export function finishJobRun(id, ok, message) {
  getDb().prepare('UPDATE job_runs SET finished_at = ?, ok = ?, message = ? WHERE id = ?').run(now(), ok ? 1 : 0, message ?? null, id);
}

export function getJobRuns(limit = 20) {
  return getDb().prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT ?').all(limit);
}

export function getLastJobRuns() {
  return getDb().prepare('SELECT j.* FROM job_runs j JOIN (SELECT job, MAX(id) id FROM job_runs GROUP BY job) m ON m.id = j.id').all();
}

/** Job yang tercatat mulai tapi tidak pernah selesai (mis. server mati di tengah jalan). */
export function closeDanglingJobRuns(message) {
  getDb().prepare('UPDATE job_runs SET finished_at = ?, ok = 0, message = ? WHERE finished_at IS NULL').run(now(), message);
}
