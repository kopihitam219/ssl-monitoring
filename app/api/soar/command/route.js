// POST /api/soar/command {action, group?, wait?} → SOAR menjalankan job di aplikasi
//   action: scan | retry_failed | conn_test | report
//   group : nama atau ID group dashboard (opsional, default semua)
//   wait  : true → tunggu sampai selesai & balas hasilnya; default false → langsung dibalas 202, job jalan di belakang
import { getSettings } from '@/lib/settings';
import { listGroups } from '@/lib/db';
import { runJob, getJobs } from '@/lib/runner';
import { isScanning } from '@/lib/jobs';
import { soarAudit } from '@/lib/soar-in';
import { after } from 'next/server';
import { soarHandler, readBody, reply } from '@/lib/soar-in-http';
import { shouldDelegate } from '@/lib/scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // batas Vercel (paket Hobby); scan panjang dilanjutkan otomatis

const ACTIONS = { scan: 'scan', retry_failed: 'retry_failed', retry: 'retry_failed', conn_test: 'conn_test', report: 'notify' };

export const POST = soarHandler(async (req, { ip }) => {
  if (!getSettings().soarIn.allowCommands) return reply({ error: 'Perintah dari SOAR tidak diizinkan (Settings → Integrasi → SOAR)' }, 403);
  const b = JSON.parse((await readBody(req)) || '{}');
  const job = ACTIONS[String(b.action || '').toLowerCase()];
  if (!job) return reply({ error: `action harus salah satu dari: ${Object.keys(ACTIONS).join(', ')}` }, 400);
  let groupId = null;
  if (b.group !== undefined && b.group !== null && b.group !== '') {
    const g = (await listGroups()).find((x) => String(x.id) === String(b.group) || x.name.toLowerCase() === String(b.group).toLowerCase());
    if (!g) return reply({ error: `Group "${b.group}" tidak ditemukan` }, 404);
    groupId = g.id;
  }
  if (getJobs()[job].exclusive !== false && !shouldDelegate() && await isScanning()) return reply({ error: 'Scan sedang berjalan, coba lagi nanti' }, 409);
  const label = getJobs()[job].label;
  soarAudit({ action: 'soar.in.command', target: label, ip, summary: `SOAR menjalankan ${label}${groupId ? ` (group ${b.group})` : ''}` });
  const p = runJob(job, { trigger: 'soar', groupId });
  if (b.wait === true || b.wait === 'true') {
    try { const r = await p; return reply({ ok: r.ok, job, message: r.message }); }
    catch (e) { return reply({ ok: false, job, error: e.message }, 500); }
  }
  if (shouldDelegate()) {
    const r = await p;
    return reply({ ok: true, accepted: true, queued: true, job, message: r.message }, 202);
  }
  after(() => p.catch(() => {}));
  return reply({ ok: true, accepted: true, job, message: `${label} dijalankan. Hasilnya dikirim lewat notifikasi SOAR & tercatat di menu Jobs.` }, 202);
});
