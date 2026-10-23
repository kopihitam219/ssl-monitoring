// GET /api/auth/microsoft/callback → Microsoft mengembalikan user ke sini setelah login
import { NextResponse } from 'next/server';
import { finishLogin } from '@/lib/entra';
import { COOKIE } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handle, requestOrigin } from '@/lib/api';

export const dynamic = 'force-dynamic';

const back = (req, error) => {
  const res = NextResponse.redirect(`${requestOrigin(req)}${error ? `/?login_error=${encodeURIComponent(error)}` : '/'}`);
  res.cookies.set('ssl_oidc', '', { path: '/api/auth/microsoft', maxAge: 0 });
  return res;
};

export const GET = handle(async (req) => {
  const p = req.nextUrl.searchParams;
  if (p.get('error')) {
    const msg = (p.get('error_description') || p.get('error')).split('\r\n')[0].slice(0, 300);
    audit({ type: 'app', actor: 'microsoft', source: 'UI', category: 'auth', action: 'auth.login-microsoft', ok: false, summary: `Login Microsoft dibatalkan/gagal: ${msg}` });
    return back(req, `Login Microsoft gagal: ${msg}`);
  }
  try {
    const s = await finishLogin({ code: p.get('code'), state: p.get('state'), cookieState: req.cookies.get('ssl_oidc')?.value });
    audit({ type: 'app', actor: s.user.username, source: 'UI', category: 'auth', action: 'auth.login-microsoft', target: s.user.username,
      summary: `Login Microsoft 365 berhasil (${s.role})` });
    const res = back(req);
    res.cookies.set(COOKIE, s.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: s.maxAge });
    return res;
  } catch (e) {
    audit({ type: 'app', actor: e.upn || 'microsoft', source: 'UI', category: 'auth', action: 'auth.login-microsoft', target: e.upn, ok: false,
      summary: `Login Microsoft gagal: ${e.message}` });
    return back(req, e.message);
  }
}, { access: 'public' });
