// Login & manajemen user.
//   - Password di-hash dengan scrypt (bawaan Node.js) + salt acak, tidak pernah disimpan apa adanya.
//   - Sesi: token acak di cookie httpOnly; di database hanya disimpan hash-nya.
//   - Peran: admin (semua akses) dan monitoring (hanya melihat).
import crypto from 'node:crypto';
import { pg } from './pg.js';
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

const q = async () => pg();
export const userCount = async () => (await (await q()).get('SELECT COUNT(*) AS n FROM users')).n;
export const needsSetup = async () => (await userCount()) === 0;
const activeAdmins = async () => (await (await q()).get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")).n;
const rawUser = async (id) => (await q()).get('SELECT * FROM users WHERE id = ?', Number(id));

export async function listUsers() {
  return (await (await q()).all('SELECT * FROM users ORDER BY role, username')).map(publicUser);
}

export async function getUser(id) {
  return publicUser(await rawUser(id));
}

export async function createUser({ username, name, role, password, mustChange = false }, createdBy = null) {
  const db = await q();
  const u = validateUsername(username);
  if (!ROLES.includes(role)) throw new Error('Peran harus admin atau monitoring');
  validatePassword(password);
  if (await db.get('SELECT 1 AS x FROM users WHERE lower(username) = ?', u)) throw new Error(`Username "${u}" sudah dipakai`);
  const r = await db.run(`INSERT INTO users (username, name, role, password_hash, must_change, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  u, String(name || '').trim().slice(0, 80) || null, role, hashPassword(password), mustChange ? 1 : 0, now(), createdBy);
  return getUser(r.rows[0].id);
}

/** Ubah nama / peran / status aktif. Melindungi agar selalu ada minimal satu admin aktif. */
export async function updateUser(id, { name, role, active }, actingUserId) {
  const db = await q();
  const cur = await rawUser(id);
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
  if (losingAdmin && (await activeAdmins()) <= 1) throw new Error('Harus ada minimal satu admin aktif');
  const disabledBy = next.active ? null : cur.active ? 'admin' : cur.disabled_by || 'admin';
  await db.run('UPDATE users SET name = ?, role = ?, active = ?, disabled_by = ? WHERE id = ?', next.name, next.role, next.active, disabledBy, id);
  if (!next.active || next.role !== cur.role) await db.run('DELETE FROM sessions WHERE user_id = ?', id); // paksa login ulang
  return { before: publicUser(cur), after: await getUser(id) };
}

export async function setPassword(id, password, { mustChange = false } = {}) {
  const u = await rawUser(id);
  if (u?.auth_source === 'entra') throw new Error('User Entra ID login dengan akun Microsoft, password-nya tidak dikelola di sini');
  validatePassword(password);
  const r = await (await q()).run('UPDATE users SET password_hash = ?, must_change = ? WHERE id = ?', hashPassword(password), mustChange ? 1 : 0, id);
  if (!r.changes) throw new Error('User tidak ditemukan');
}

export async function changeOwnPassword(id, current, next) {
  const u = await rawUser(id);
  if (!u || !verifyPassword(current, u.password_hash)) throw new Error('Password lama salah');
  if (current === next) throw new Error('Password baru harus berbeda dari password lama');
  await setPassword(id, next);
}

export async function deleteUser(id, actingUserId) {
  const cur = await rawUser(id);
  if (!cur) throw new Error('User tidak ditemukan');
  if (id === actingUserId) throw new Error('Anda tidak bisa menghapus akun sendiri');
  if (cur.role === 'admin' && cur.active && (await activeAdmins()) <= 1) throw new Error('Harus ada minimal satu admin aktif');
  await (await q()).run('DELETE FROM users WHERE id = ?', id);
  return publicUser(cur);
}

// ---------- login & sesi ----------
// Percobaan gagal disimpan di database (bukan memori), supaya tetap berlaku di Vercel yang punya banyak instance.
async function getFail(key) {
  return (await q()).get('SELECT count, until_ms FROM login_failures WHERE username = ?', key);
}

/** Kembalikan { user, token } atau lempar error. Akun dikunci 5 menit setelah 5x gagal. */
export async function login(username, password) {
  const db = await q();
  const key = String(username || '').trim().toLowerCase();
  const f = await getFail(key);
  if (f && f.until_ms > Date.now()) {
    const min = Math.ceil((f.until_ms - Date.now()) / 60000);
    throw Object.assign(new Error(`Terlalu banyak percobaan gagal. Coba lagi dalam ${min} menit.`), { locked: true });
  }
  const u = await db.get('SELECT * FROM users WHERE lower(username) = ?', key);
  if (u?.auth_source === 'entra') throw new Error('Akun ini memakai Microsoft Entra ID. Klik "Masuk dengan Microsoft".');
  if (u && !u.password_hash) throw new Error('Akun ini belum punya password. Minta admin me-reset password Anda.');
  const ok = u && verifyPassword(String(password || ''), u.password_hash);
  if (!ok || !u.active) {
    const lockExpired = f && f.until_ms && f.until_ms <= Date.now(); // kunci lama sudah lewat → hitung dari awal
    const n = (lockExpired ? 0 : f?.count || 0) + 1;
    await db.run(`INSERT INTO login_failures (username, count, until_ms, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (username) DO UPDATE SET count = excluded.count, until_ms = excluded.until_ms, updated_at = excluded.updated_at`,
    key, n, n >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0, now());
    throw Object.assign(new Error(ok && !u.active ? 'Akun ini dinonaktifkan. Hubungi admin.' : 'Username atau password salah'), { inactive: ok && !u.active, locked: n >= MAX_FAILS });
  }
  await db.run('DELETE FROM login_failures WHERE username = ?', key);
  return createSession(u.id);
}

/** Buat sesi login baru untuk user (dipakai login lokal & login Microsoft). */
export async function createSession(userId) {
  const db = await q();
  const u = await rawUser(userId);
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)',
    sha256(token), u.id, t, new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(), t);
  await db.run('UPDATE users SET last_login = ? WHERE id = ?', t, u.id);
  await db.run('DELETE FROM sessions WHERE expires_at < ?', t);
  return { user: publicUser({ ...u, last_login: t }), token, maxAge: SESSION_HOURS * 3600 };
}

export async function userFromToken(token) {
  if (!token) return null;
  const db = await q();
  const row = await db.get(`SELECT u.*, s.expires_at AS s_exp, s.token_hash AS s_hash, s.last_seen AS s_seen FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`, sha256(token));
  if (!row || !row.active || row.s_exp < now()) return null;
  // last_seen cukup diperbarui tiap 5 menit (hemat query)
  if (!row.s_seen || Date.now() - new Date(row.s_seen).getTime() > 300_000) await db.run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', now(), row.s_hash);
  return publicUser(row);
}

export async function logout(token) {
  if (token) await (await q()).run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export async function logoutAll(userId) {
  await (await q()).run('DELETE FROM sessions WHERE user_id = ?', userId);
}
