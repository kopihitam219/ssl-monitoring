// GET /api/audit?q=&category=&mode=&source=&result=&from=&to=&page=&pageSize=
import { listAudit, auditFilter } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const p = req.nextUrl.searchParams;
  const page = Math.max(1, Number(p.get('page') || 1));
  const pageSize = Math.min(200, Math.max(1, Number(p.get('pageSize') || 25)));
  return json({ page, pageSize, ...listAudit(auditFilter(p), { page, pageSize }) });
}, { access: 'audit' });
