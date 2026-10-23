// GET /api/auth/microsoft/login → arahkan browser ke halaman login Microsoft 365
import { NextResponse } from 'next/server';
import { startLogin } from '@/lib/entra';
import { handle, requestOrigin } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  try {
    const { url, state } = startLogin(requestOrigin(req));
    const res = NextResponse.redirect(url);
    res.cookies.set('ssl_oidc', state, { httpOnly: true, sameSite: 'lax', path: '/api/auth/microsoft', maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(`${requestOrigin(req)}/?login_error=${encodeURIComponent(e.message)}`);
  }
}, { access: 'public' });
