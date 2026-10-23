import { getActivitiesInRange } from '@/lib/db';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (req) => {
  const p = req.nextUrl.searchParams;
  const from = DATE.test(p.get('from') || '') ? new Date(`${p.get('from')}T00:00:00`).toISOString() : null;
  const to = DATE.test(p.get('to') || '') ? new Date(`${p.get('to')}T23:59:59.999`).toISOString() : null;
  const limit = Math.min(500, Number(p.get('limit') || 200));
  return json({ activities: getActivitiesInRange(from, to, limit) });
});
