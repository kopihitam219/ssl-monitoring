// POST /api/auth/logout
import { logout, COOKIE } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req, { user }) => {
  logout(req.cookies.get(COOKIE)?.value);
  audit({ category: 'auth', action: 'auth.logout', target: user.username, summary: 'Logout' });
  const res = json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
});
