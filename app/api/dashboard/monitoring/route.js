// GET /api/dashboard/monitoring → kartu ringkasan + panel per group dashboard
import { getDomains } from '@/lib/db';
import { buildSummary } from '@/lib/jobs';
import { buildMonitoring } from '@/lib/monitoring';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({
  ...buildMonitoring(buildSummary(getDomains()).rows),
  generatedAt: new Date().toISOString(),
}));
