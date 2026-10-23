// POST /api/auth/login { username, password }
import { login, COOKIE } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { username, password } = await req.json().catch(() => ({}));
  const who = String(username || '').trim().toLowerCase().slice(0, 40) || '(kosong)';
  try {
    const s = login(username, password);
    audit({ type: 'app', actor: s.user.username, source: 'UI', category: 'auth', action: 'auth.login', target: s.user.username,
      summary: `Login berhasil (${s.user.role})` });
    const res = json({ user: s.user });
    res.cookies.set(COOKIE, s.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: s.maxAge });
    return res;
  } catch (e) {
    audit({ type: 'app', actor: who, source: 'UI', category: 'auth', action: e.locked ? 'auth.locked' : 'auth.login', target: who, ok: false,
      summary: e.locked ? 'Login ditolak: akun terkunci sementara' : `Login gagal: ${e.message}` });
    return json({ error: e.message }, e.locked ? 429 : 401);
  }
}, { access: 'public' });
