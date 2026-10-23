// GET /api/auth/status → { needsSetup, user }
import { needsSetup, userFromToken, COOKIE } from '@/lib/auth';
import { entraConfigured } from '@/lib/entra';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  return json({ needsSetup: await needsSetup(), user: await userFromToken(req.cookies.get(COOKIE)?.value), microsoft: entraConfigured() });
}, { access: 'public' });
