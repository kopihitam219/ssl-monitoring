// GET /api/dashboard/group?id=<id|none> → dashboard satu group (kartu, donut, akan habis, per environment, info file)
import { getDomains, getGroup } from '@/lib/db';
import { buildSummary } from '@/lib/jobs';
import { buildGroupDashboard } from '@/lib/monitoring';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const raw = req.nextUrl.searchParams.get('id');
  const g = raw === 'none' ? { id: 'none', name: 'Tanpa group' } : await getGroup(Number(raw));
  if (!g) return json({ error: 'Group tidak ditemukan' }, 404);
  const { rows } = buildSummary(await getDomains({ groupId: g.id }));
  return json(await buildGroupDashboard(g, rows));
});
