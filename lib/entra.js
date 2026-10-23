// Integrasi Microsoft 365 / Entra ID (Azure AD):
//   1. Login dengan Microsoft  : OpenID Connect, authorization code + PKCE.
//   2. Peran dari grup         : anggota grup Admin → admin, anggota grup Monitoring → monitoring
//                                (dicek lewat Microsoft Graph checkMemberGroups, termasuk grup bersarang).
//   3. Sync user               : anggota kedua grup dibuat/diperbarui di menu Users; yang keluar dari grup
//                                atau dinonaktifkan di Microsoft 365 → dinonaktifkan di aplikasi.
// Butuh App Registration di Entra ID dengan izin Microsoft Graph (Application): User.Read.All & GroupMember.Read.All.
import crypto from 'node:crypto';
import { pg } from './pg.js';
import { getSettings } from './settings.js';
import { createSession } from './auth.js';

// Bisa diarahkan ke server tiruan saat pengujian. Di pemakaian normal tidak perlu diubah.
const LOGIN_HOST = process.env.ENTRA_LOGIN_HOST || 'https://login.microsoftonline.com';
const GRAPH_HOST = process.env.ENTRA_GRAPH_HOST || 'https://graph.microsoft.com';
const CALLBACK_PATH = '/api/auth/microsoft/callback';

const cfg = () => getSettings().entra;
export const entraConfigured = () => {
  const e = cfg();
  return !!(e.enabled && e.tenantId && e.clientId && e.clientSecret && (e.adminGroupId || e.monitoringGroupId));
};

export function redirectUri(origin) {
  return cfg().redirectUri || `${origin}${CALLBACK_PATH}`;
}

async function http(url, opts = {}, label = 'Microsoft') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 200) }; }
    if (!res.ok) {
      const msg = body.error_description || body.error?.message || body.error || body.raw || `HTTP ${res.status}`;
      throw Object.assign(new Error(`${label}: ${String(msg).split('\r\n')[0]}`), { status: res.status, body });
    }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${label}: timeout 15 detik`);
    if (e.cause?.code) throw new Error(`${label}: tidak bisa terhubung (${e.cause.code}). Cek internet / proxy kantor.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ---------- token aplikasi (client credentials) untuk Microsoft Graph ----------
async function appToken() {
  const e = cfg();
  const cache = globalThis.__sslGraphToken;
  if (cache && cache.key === `${e.tenantId}:${e.clientId}:${e.clientSecret}` && cache.exp > Date.now() + 60_000) return cache.token;
  const body = await http(`${LOGIN_HOST}/${e.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: e.clientId, client_secret: e.clientSecret, grant_type: 'client_credentials', scope: `${GRAPH_HOST}/.default`,
    }),
  }, 'Token Entra ID');
  globalThis.__sslGraphToken = { key: `${e.tenantId}:${e.clientId}:${e.clientSecret}`, token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 };
  return body.access_token;
}

async function graph(path, opts = {}) {
  const token = await appToken();
  return http(path.startsWith('http') ? path : `${GRAPH_HOST}/v1.0${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }, 'Microsoft Graph');
}

/** Peran user berdasarkan keanggotaan grup (admin menang kalau ada di keduanya). null = tidak punya akses. */
export async function roleForObjectId(oid) {
  const e = cfg();
  const groupIds = [e.adminGroupId, e.monitoringGroupId].filter(Boolean);
  const r = await graph(`/users/${encodeURIComponent(oid)}/checkMemberGroups`, { method: 'POST', body: JSON.stringify({ groupIds }) });
  const member = new Set((r.value || []).map((x) => x.toLowerCase()));
  if (e.adminGroupId && member.has(e.adminGroupId)) return 'admin';
  if (e.monitoringGroupId && member.has(e.monitoringGroupId)) return 'monitoring';
  return null;
}

async function groupMembers(groupId) {
  const out = [];
  let url = `/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=id,displayName,userPrincipalName,mail,accountEnabled&$top=999`;
  while (url) {
    const r = await graph(url);
    out.push(...(r.value || []));
    url = r['@odata.nextLink'] || null;
  }
  return out;
}

/** Tes koneksi: ambil token aplikasi dan nama kedua grup. */
export async function testConnection() {
  const e = cfg();
  if (!e.tenantId || !e.clientId || !e.clientSecret) throw new Error('Isi Tenant ID, Client ID, dan Client Secret dulu');
  globalThis.__sslGraphToken = null;
  const groups = {};
  for (const [k, id] of [['admin', e.adminGroupId], ['monitoring', e.monitoringGroupId]]) {
    if (!id) continue;
    const g = await graph(`/groups/${id}?$select=id,displayName`);
    const members = await groupMembers(id);
    groups[k] = { name: g.displayName, members: members.length };
  }
  return { ok: true, groups };
}

// ---------- simpan user Entra ke database aplikasi ----------
async function upsertEntraUser({ oid, upn, name, email, role, active }) {
  const db = await pg();
  const username = String(upn || email || oid).toLowerCase();
  const byOid = await db.get('SELECT * FROM users WHERE external_id = ?', oid);
  const t = new Date().toISOString();
  if (byOid) {
    // akun yang dinonaktifkan manual oleh admin tetap nonaktif sampai admin mengaktifkannya lagi
    const lockedByAdmin = !byOid.active && byOid.disabled_by === 'admin';
    const nextActive = lockedByAdmin ? 0 : active ? 1 : 0;
    const disabledBy = nextActive ? null : lockedByAdmin ? 'admin' : 'sync';
    await db.run('UPDATE users SET username = ?, name = ?, email = ?, role = ?, active = ?, disabled_by = ? WHERE id = ?',
      username, name || byOid.name, email || byOid.email, role || byOid.role, nextActive, disabledBy, byOid.id);
    if (!nextActive || (role && role !== byOid.role)) await db.run('DELETE FROM sessions WHERE user_id = ?', byOid.id);
    return { id: byOid.id, created: false, before: byOid, active: !!nextActive, lockedByAdmin };
  }
  const local = await db.get('SELECT * FROM users WHERE lower(username) = ?', username);
  if (local) {
    if (local.auth_source !== 'entra') throw new Error(`Username ${username} sudah dipakai akun lokal`);
  }
  const id = (await db.run(`INSERT INTO users (username, name, role, password_hash, active, must_change, created_at, created_by, auth_source, external_id, email, disabled_by)
      VALUES (?, ?, ?, '!', ?, 0, ?, 'Microsoft Entra ID', 'entra', ?, ?, ?) RETURNING id`,
  username, name || null, role, active ? 1 : 0, t, oid, email || null, active ? null : 'sync')).rows[0].id;
  return { id, created: true, active };
}

/** Sync anggota grup Admin & Monitoring → menu Users. */
export async function syncUsers() {
  const e = cfg();
  if (!entraConfigured()) throw new Error('Microsoft 365 belum dikonfigurasi atau belum diaktifkan di Settings');
  const found = new Map(); // oid → data
  if (e.monitoringGroupId) for (const u of await groupMembers(e.monitoringGroupId)) found.set(u.id, { ...u, role: 'monitoring' });
  if (e.adminGroupId) for (const u of await groupMembers(e.adminGroupId)) found.set(u.id, { ...u, role: 'admin' }); // admin menang

  const stats = { total: found.size, created: 0, updated: 0, disabled: 0, skipped: [] };
  for (const [oid, u] of found) {
    try {
      const r = await upsertEntraUser({ oid, upn: u.userPrincipalName, name: u.displayName, email: u.mail, role: u.role, active: u.accountEnabled !== false });
      if (r.created) stats.created++;
      else if (r.before && (r.before.role !== u.role || !!r.before.active !== (u.accountEnabled !== false) || r.before.name !== u.displayName)) stats.updated++;
      if (u.accountEnabled === false && (r.created || r.before?.active)) stats.disabled++; // hanya yang baru dinonaktifkan
    } catch (err) {
      stats.skipped.push(`${u.userPrincipalName}: ${err.message}`);
    }
  }
  // user Entra yang sudah tidak ada di kedua grup → nonaktifkan
  const db = await pg();
  for (const u of await db.all("SELECT id, external_id FROM users WHERE auth_source = 'entra' AND active = 1")) {
    if (!found.has(u.external_id)) {
      await db.run("UPDATE users SET active = 0, disabled_by = COALESCE(disabled_by, 'sync') WHERE id = ?", u.id);
      await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      stats.disabled++;
    }
  }
  return stats;
}

// ---------- login dengan Microsoft (OIDC + PKCE) ----------
// State login disimpan di database (bukan memori), karena di Vercel request login & callback bisa ditangani instance berbeda.
const states = {
  async set(state, data) {
    const db = await pg();
    await db.run("DELETE FROM app_locks WHERE name LIKE 'oidc:%' AND until_ms < ?", Date.now());
    await db.run('INSERT INTO app_locks (name, owner, until_ms, info) VALUES (?, ?, ?, ?)', `oidc:${state}`, 'entra', data.exp, JSON.stringify(data));
  },
  async take(state) {
    const db = await pg();
    const r = (await db.run('DELETE FROM app_locks WHERE name = ? RETURNING info', `oidc:${String(state || '').slice(0, 100)}`)).rows[0];
    try { return r ? JSON.parse(r.info) : null; } catch { return null; }
  },
};
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function startLogin(origin) {
  if (!entraConfigured()) throw new Error('Login Microsoft 365 belum diaktifkan');
  const e = cfg();
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const redirect = redirectUri(origin);
  await states.set(state, { nonce, verifier, redirect, exp: Date.now() + 10 * 60_000 });
  const url = new URL(`${LOGIN_HOST}/${e.tenantId}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: e.clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query',
    scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return { url: url.toString(), state };
}

function decodeJwt(token) {
  const [, payload] = String(token).split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/**
 * Selesaikan login: tukar code → token, cek id_token, tentukan peran dari grup, simpan user, buat sesi.
 * id_token diterima langsung dari endpoint token Microsoft lewat TLS, sehingga cukup divalidasi isinya
 * (OpenID Connect Core 3.1.3.7).
 */
export async function finishLogin({ code, state, cookieState }) {
  const e = cfg();
  const st = await states.take(state);
  if (!st || st.exp < Date.now() || !cookieState || cookieState !== state) throw new Error('Sesi login Microsoft kedaluwarsa atau tidak valid. Coba lagi.');

  const tok = await http(`${LOGIN_HOST}/${e.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: e.clientId, client_secret: e.clientSecret, grant_type: 'authorization_code',
      code, redirect_uri: st.redirect, code_verifier: st.verifier, scope: 'openid profile email',
    }),
  }, 'Login Microsoft');

  const c = decodeJwt(tok.id_token);
  const nowSec = Math.floor(Date.now() / 1000);
  if (c.aud !== e.clientId) throw new Error('Token Microsoft tidak untuk aplikasi ini (aud tidak cocok)');
  if (String(c.tid).toLowerCase() !== e.tenantId) throw new Error('Akun dari tenant lain tidak diizinkan');
  if (c.iss !== `${LOGIN_HOST}/${c.tid}/v2.0` && c.iss !== `https://login.microsoftonline.com/${c.tid}/v2.0`) throw new Error('Penerbit token tidak dikenal');
  if (!c.exp || c.exp < nowSec - 60) throw new Error('Token Microsoft sudah kedaluwarsa');
  if (c.nonce !== st.nonce) throw new Error('Nonce token tidak cocok');

  const upn = c.preferred_username || c.upn || c.email;
  const acct = await graph(`/users/${encodeURIComponent(c.oid)}?$select=id,accountEnabled`);
  if (acct.accountEnabled === false) throw Object.assign(new Error(`Akun ${upn} dinonaktifkan di Microsoft 365.`), { upn, denied: true });
  const role = await roleForObjectId(c.oid);
  if (!role) throw Object.assign(new Error(`Akun ${upn} tidak termasuk grup Admin maupun Monitoring di Entra ID. Hubungi admin.`), { upn, denied: true });
  const r = await upsertEntraUser({ oid: c.oid, upn, name: c.name, email: c.email || upn, role, active: true });
  if (!r.active) throw Object.assign(new Error(`Akun ${upn} dinonaktifkan oleh admin aplikasi ini. Hubungi admin.`), { upn, denied: true });
  return { ...(await createSession(r.id)), upn, role };
}

export async function entraStatus() {
  const e = cfg();
  const db = await pg();
  const r = await db.get("SELECT at, ok, summary FROM audit_log WHERE action = 'job.entra' ORDER BY id DESC LIMIT 1");
  return {
    enabled: !!e.enabled,
    configured: entraConfigured(),
    users: (await db.get("SELECT COUNT(*) AS n FROM users WHERE auth_source = 'entra'")).n,
    activeUsers: (await db.get("SELECT COUNT(*) AS n FROM users WHERE auth_source = 'entra' AND active = 1")).n,
    lastSync: r ? { at: r.at, ok: !!r.ok, summary: r.summary } : null,
  };
}
