import { getDomain, getChecks } from '@/lib/db';
import { decorate } from '@/lib/jobs';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const d = getDomain(Number(id));
  if (!d) return json({ error: 'Domain tidak ditemukan' }, 404);
  return json({
    domain: decorate(d),
    checks: getChecks(d.id),
  });
});
