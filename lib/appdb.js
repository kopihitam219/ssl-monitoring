// Database aplikasi (data/app.db): user, sesi login, dan audit log.
// TERPISAH dari database domain, jadi tidak ikut terhapus saat data dikosongkan.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.APP_DB_PATH || path.join(process.cwd(), 'data', 'app.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'monitoring')),
  password_hash  TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  must_change    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  last_login     TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'app',   -- app (aksi pengguna) | system (aksi otomatis / service)
  actor     TEXT NOT NULL,
  source    TEXT NOT NULL,                 -- UI | Terminal | Scheduler | System
  mode      TEXT,
  category  TEXT NOT NULL,
  action    TEXT NOT NULL,
  target    TEXT,
  summary   TEXT NOT NULL,
  ok        INTEGER NOT NULL DEFAULT 1,
  details   TEXT
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_type_idx ON audit_log (type, id DESC);
`;

export function appDb() {
  if (!globalThis.__sslAppDb) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const d = new DatabaseSync(FILE);
    d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    d.exec(SCHEMA);
    // kolom tambahan (ditambahkan otomatis di database lama)
    const cols = new Set(d.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    if (!cols.has('auth_source')) d.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'");
    if (!cols.has('external_id')) d.exec('ALTER TABLE users ADD COLUMN external_id TEXT');
    if (!cols.has('email')) d.exec('ALTER TABLE users ADD COLUMN email TEXT');
    if (!cols.has('disabled_by')) d.exec('ALTER TABLE users ADD COLUMN disabled_by TEXT'); // admin | sync
    const acols = new Set(d.prepare('PRAGMA table_info(audit_log)').all().map((c) => c.name));
    if (!acols.has('ip')) d.exec('ALTER TABLE audit_log ADD COLUMN ip TEXT'); // alamat IP pengirim request
    // antrean Splunk dari versi lama tidak dipakai lagi
    d.exec('DROP TABLE IF EXISTS splunk_outbox; DROP TABLE IF EXISTS splunk_ssl_state;');
    // antrean kiriman ke Wazuh (tetap ada walau aplikasi restart / Wazuh sedang mati)
    d.exec(`CREATE TABLE IF NOT EXISTS wazuh_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, log_type TEXT NOT NULL, event TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS wazuh_ssl_state (
      key TEXT PRIMARY KEY, status TEXT NOT NULL, sent_at TEXT NOT NULL);`);
    d.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_external_idx ON users (external_id) WHERE external_id IS NOT NULL');
    globalThis.__sslAppDb = d;
  }
  return globalThis.__sslAppDb;
}

export function closeAppDb() {
  try { globalThis.__sslAppDb?.close(); } catch {}
  globalThis.__sslAppDb = null;
}
