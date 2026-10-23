// POST /api/auth/setup { username, name, password } → buat akun admin PERTAMA (hanya bila belum ada user sama sekali)
import { needsSetup, createUser, login, COOKIE } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  if (!await needsSetup()) return json({ error: 'Akun admin sudah dibuat. Silakan login.' }, 409);
  const { username, name, password } = await req.json().catch(() => ({}));
  try {
    const u = await createUser({ username, name, role: 'admin', password }, 'setup');
    const s = await login(u.username, password);
    audit({ type: 'app', actor: u.username, source: 'UI', category: 'auth', action: 'user.setup', target: u.username,
      summary: `Akun admin pertama dibuat: ${u.username}` });
    const res = json({ user: s.user });
    res.cookies.set(COOKIE, s.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: s.maxAge });
    return res;
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'public' });
