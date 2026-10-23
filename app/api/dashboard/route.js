import { getDomains, getSources, getActivitiesInRange, countActivitiesInRange, getTrend } from '@/lib/db';
import { dashboardGroups } from '@/lib/monitoring';
import { buildSummary, isScanning } from '@/lib/jobs';
import { handle, json } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { startScheduler } from '@/lib/scheduler';
import { initService } from '@/lib/service';
import { usingSupabase } from '@/lib/pg';

export const dynamic = 'force-dynamic';

const ENV_ORDER = ['Production', 'Development', 'UAT', 'Staging'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (req) => {
  await initService();
  startScheduler(); // scan otomatis berkala; aman dipanggil berkali-kali (hanya jalan sekali)
  // Periode: ?from=YYYY-MM-DD&to=YYYY-MM-DD (tanggal lokal, inklusif). Kosong = semua.
  const p = req.nextUrl.searchParams;
  const from = DATE.test(p.get('from') || '') ? p.get('from') : null;
  const to = DATE.test(p.get('to') || '') ? p.get('to') : null;
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const toIso = to ? new Date(`${to}T23:59:59.999`).toISOString() : null;

  const { total, counts, cards, rows } = buildSummary(await getDomains());

  const envCount = {};
  for (const d of rows) {
    const env = ENV_ORDER.includes(d.environment) ? d.environment : 'Others';
    envCount[env] = (envCount[env] || 0) + 1;
  }
  const environments = [...ENV_ORDER, 'Others'].map((name) => ({ name, count: envCount[name] || 0 }));

  return json({
    total,
    counts,
    cards,
    environments,
    period: { from, to },
    trend: await getTrend(from || '0000-00-00', to || '9999-12-31'),
    sources: await getSources(),
    activities: await getActivitiesInRange(fromIso, toIso, 8),
    activityTotal: await countActivitiesInRange(fromIso, toIso),
    scanning: await isScanning(),
    groups: await dashboardGroups(),
    mode: getSettings().mode,
    deploy: process.env.VERCEL ? 'Vercel + Supabase' : usingSupabase() ? 'Supabase (scanner kantor)' : 'lokal',
    config: (() => {
      const st = getSettings();
      return {
        tiers: st.tiers,
        scanIntervalHours: st.scanIntervalHours,
        concurrency: st.scanConcurrency,
        timeoutMs: st.scanTimeoutMs,
      };
    })(),
    generatedAt: new Date().toISOString(),
  });
});
