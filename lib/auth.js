// Login & manajemen user.
//   - Password di-hash dengan scrypt (bawaan Node.js) + salt acak, tidak pernah disimpan apa adanya.
//   - Sesi: token acak di cookie httpOnly; di database hanya disimpan hash-nya.
//   - Peran: admin (semua akses) dan monitoring (hanya melihat).
import crypto from 'node:crypto';
import { appDb } from './appdb.js';
import { getSettings } from './settings.js';

export const ROLES = ['admin', 'monitoring'];

/** Izin yang bisa diberikan ke peran Monitoring. Admin selalu punya semuanya. Melihat dashboard selalu boleh. */
export const PERMISSIONS = {
  export: 'Export / download Excel',
  sync: 'Sync Now & cek ulang domain',
  manage_domains: 'Tambah, ubah, hapus domain & upload Excel',
  jobs: 'Lihat & jalankan Jobs',
  audit: 'Lihat Audit Log',
  health: 'Lihat Health Check',
};

export function permissionsFor(role) {
  if (role === 'admin') return Object.keys(PERMISSIONS);
  const granted = getSettings().roles?.monitoring || [];
  return Object.keys(PERMISSIONS).filter((p) => granted.includes(p));
}

export const can = (user, perm) => !!user && (user.role === 'admin' || permissionsFor(user.role).includes(perm));
export const COOKIE = 'ssl_session';
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 5;

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- password ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [algo, s, h] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(h, 'base64');
    const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Password minimal 8 karakter');
  if (pw.length > 200) throw new Error('Password terlalu panjang');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new Error('Password harus berisi huruf dan angka');
}

function validateUsername(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(s)) throw new Error('Username 3–32 karakter: huruf kecil, angka, titik, minus, atau garis bawah');
  return s;
}

// ---------- users ----------
const publicUser = (u) => u && ({
  id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active,
  mustChange: !!u.must_change, createdAt: u.created_at, createdBy: u.created_by, lastLogin: u.last_login,
  authSource: u.auth_source || 'local', email: u.email || null,
  permissions: permissionsFor(u.role),
});

export const userCount = () => appDb().prepare('SELECT COUNT(*) n FROM users').get().n;
export const needsSetup = () => userCount() === 0;
const activeAdmins = () => appDb().prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;

export function listUsers() {
  return appDb().prepare('SELECT * FROM users ORDER BY role, username').all().map(publicUser);
}

export function getUser(id) {
  return publicUser(appDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function createUser({ username, name, role, password, mustChange = false }, createdBy = null) {
  const u = validateUsername(username);
  if (!ROLES.includes(role)) throw new Error('Peran harus admin atau monitoring');
  validatePassword(password);
  if (appDb().prepare('SELECT 1 FROM users WHERE username = ?').get(u)) throw new Error(`Username "${u}" sudah dipakai`);
  const id = Number(appDb().prepare(`INSERT INTO users (username, name, role, password_hash, must_change, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(u, String(name || '').trim().slice(0, 80) || null, role, hashPassword(password), mustChange ? 1 : 0, now(), createdBy).lastInsertRowid);
  return getUser(id);
}

/** Ubah nama / peran / status aktif. Melindungi agar selalu ada minimal satu admin aktif. */
export function updateUser(id, { name, role, active }, actingUserId) {
  const cur = appDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new Error('User tidak ditemukan');
  const next = {
    name: name !== undefined ? String(name).trim().slice(0, 80) || null : cur.name,
    role: role !== undefined ? role : cur.role,
    active: active !== undefined ? (active ? 1 : 0) : cur.active,
  };
  if (!ROLES.includes(next.role)) throw new Error('Peran harus admin atau monitoring');
  if (cur.auth_source === 'entra' && next.role !== cur.role) throw new Error('Peran user Entra ID diatur lewat grup di Entra ID, bukan di sini');
  if (id === actingUserId && (next.role !== 'admin' || !next.active)) throw new Error('Anda tidak bisa menurunkan peran atau menonaktifkan akun sendiri');
  const losingAdmin = cur.role === 'admin' && cur.active && (next.role !== 'admin' || !next.active);
  if (losingAdmin && activeAdmins() <= 1) throw new Error('Harus ada minimal satu admin aktif');
  const disabledBy = next.active ? null : cur.active ? 'admin' : cur.disabled_by || 'admin';
  appDb().prepare('UPDATE users SET name = ?, role = ?, active = ?, disabled_by = ? WHERE id = ?').run(next.name, next.role, next.active, disabledBy, id);
  if (!next.active || next.role !== cur.role) appDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // paksa login ulang
  return { before: publicUser(cur), after: getUser(id) };
}

export function setPassword(id, password, { mustChange = false } = {}) {
  const u = appDb().prepare('SELECT auth_source FROM users WHERE id = ?').get(id);
  if (u?.auth_source === 'entra') throw new Error('User Entra ID login dengan akun Microsoft, password-nya tidak dikelola di sini');
  validatePassword(password);
  const r = appDb().prepare("UPDATE users SET password_hash = ?, must_change = ? WHERE id = ?").run(hashPassword(password), mustChange ? 1 : 0, id);
  if (!r.changes) throw new Error('User tidak ditemukan');
}

export function changeOwnPassword(id, current, next) {
  const u = appDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u || !verifyPassword(current, u.password_hash)) throw new Error('Password lama salah');
  if (current === next) throw new Error('Password baru harus berbeda dari password lama');
  setPassword(id, next);
}

export function deleteUser(id, actingUserId) {
  const cur = appDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new Error('User tidak ditemukan');
  if (id === actingUserId) throw new Error('Anda tidak bisa menghapus akun sendiri');
  if (cur.role === 'admin' && cur.active && activeAdmins() <= 1) throw new Error('Harus ada minimal satu admin aktif');
  appDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  return publicUser(cur);
}

// ---------- login & sesi ----------
globalThis.__sslLoginFails ??= new Map();
const fails = globalThis.__sslLoginFails;

/** Kembalikan { user, token } atau lempar error. Akun dikunci 5 menit setelah 5x gagal. */
export function login(username, password) {
  const key = String(username || '').trim().toLowerCase();
  const f = fails.get(key);
  if (f && f.until > Date.now()) {
    const min = Math.ceil((f.until - Date.now()) / 60000);
    throw Object.assign(new Error(`Terlalu banyak percobaan gagal. Coba lagi dalam ${min} menit.`), { locked: true });
  }
  const u = appDb().prepare('SELECT * FROM users WHERE username = ?').get(key);
  if (u?.auth_source === 'entra') throw new Error('Akun ini memakai Microsoft Entra ID. Klik "Masuk dengan Microsoft".');
  if (u && !u.password_hash) throw new Error('Akun ini belum punya password. Minta admin me-reset password Anda.');
  const ok = u && verifyPassword(String(password || ''), u.password_hash);
  if (!ok || !u.active) {
    const lockExpired = f && f.until && f.until <= Date.now(); // kunci lama sudah lewat → hitung dari awal
    const n = (lockExpired ? 0 : f?.count || 0) + 1;
    fails.set(key, { count: n, until: n >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0 });
    throw Object.assign(new Error(ok && !u.active ? 'Akun ini dinonaktifkan. Hubungi admin.' : 'Username atau password salah'), { inactive: ok && !u.active });
  }
  fails.delete(key);
  return createSession(u.id);
}

/** Buat sesi login baru untuk user (dipakai login lokal & login Microsoft). */
export function createSession(userId) {
  const u = appDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  appDb().prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), u.id, t, new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(), t);
  appDb().prepare('UPDATE users SET last_login = ? WHERE id = ?').run(t, u.id);
  appDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  return { user: publicUser({ ...u, last_login: t }), token, maxAge: SESSION_HOURS * 3600 };
}

export function userFromToken(token) {
  if (!token) return null;
  const row = appDb().prepare(`SELECT u.*, s.expires_at s_exp, s.token_hash s_hash FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || !row.active || row.s_exp < now()) return null;
  appDb().prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), row.s_hash);
  return publicUser(row);
}

export function logout(token) {
  if (token) appDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function logoutAll(userId) {
  appDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
