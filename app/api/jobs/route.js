// GET  /api/jobs           → daftar job, run terakhir per job, riwayat
// POST /api/jobs {job}     → jalankan job sekarang
import { getJobs, runJob, LEGACY_JOB_LABELS } from '@/lib/runner';
import { getJobRuns, getLastJobRuns } from '@/lib/db';
import { isScanning } from '@/lib/jobs';
import { schedulerStatus } from '@/lib/scheduler';
import { handle, json } from '@/lib/api';
import { can } from '@/lib/auth';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = handle(async () => {
  const last = Object.fromEntries(getLastJobRuns().map((r) => [r.job, r]));
  const s = getSettings();
  return json({
    jobs: Object.entries(getJobs()).map(([key, j]) => ({
      key, label: j.label, description: j.description,
      available: j.available ? j.available() : true,
      reason: j.reason || '',
      last: last[key] || null,
    })),
    mode: s.mode,
    history: getJobRuns(25),
    scanning: isScanning(),
    scheduler: schedulerStatus(),
    legacyLabels: LEGACY_JOB_LABELS,
  });
}, { access: 'jobs' });

// Scan, Retry Check Failed & Tes koneksi boleh dijalankan user dengan izin "Sync Now" (tombol di dashboard group);
// job lain butuh izin "Jobs".
const SYNC_JOBS = ['scan', 'retry_failed', 'conn_test'];

export const POST = handle(async (req, { user }) => {
  const { job, groupId } = await req.json().catch(() => ({}));
  const jobs = getJobs();
  if (!jobs[job]) return json({ error: 'Job tidak dikenal' }, 400);
  if (!can(user, SYNC_JOBS.includes(job) ? 'sync' : 'jobs') && !can(user, 'jobs')) return json({ error: 'Anda tidak punya izin untuk ini. Hubungi admin.' }, 403);
  if (jobs[job].exclusive !== false && isScanning()) return json({ error: 'Scan sedang berjalan, tunggu sebentar' }, 409);
  try {
    const r = await runJob(job, { trigger: 'manual', groupId: groupId === 'none' ? 'none' : Number(groupId) || null });
    return json({ ok: r.ok, message: r.message });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
});
