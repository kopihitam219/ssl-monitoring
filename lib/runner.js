// Daftar job yang bisa dijalankan manual (menu Jobs, tombol Sync Now, tombol di dashboard group), oleh scheduler, atau dari terminal.
// Setiap run dicatat di tabel job_runs (riwayat di menu Jobs).
import { runScan, freshen } from './jobs.js';
import { startJobRun, finishJobRun, getDomains, getGroup, saveConnTest, addActivity } from './db.js';
import { audit } from './audit.js';
import { notifyAfterScan, sendReportNow, notifySystemEvent } from './notify.js';
import { testConnection } from './conntest.js';
import { mapLimit } from './ssl-check.js';
import { syncUsers, entraConfigured } from './entra.js';

const SOURCE = { manual: 'UI', scheduler: 'Scheduler', cli: 'Terminal', soar: 'SOAR' };

const scopeName = (o) => (o.groupId ? (o.groupId === 'none' ? 'Tanpa group' : getGroup(Number(o.groupId))?.name || `group ${o.groupId}`) : 'semua domain');
const scanMsg = (r) => `Scan ${r.scope}: ${r.total} domain dalam ${r.seconds} detik${r.fallback ? ` · ${r.fallback} berhasil lewat proxy (otomatis)` : ''}`;

/** Tes koneksi domain Check Failed (atau semua domain bila onlyFailed=false). */
async function runConnTest({ groupId = null, onlyFailed = true, onProgress } = {}) {
  let list = getDomains(groupId ? { groupId } : {});
  if (onlyFailed) list = list.filter((d) => freshen(d).ssl_status === 'CHECK_FAILED');
  const tally = { ok: 0, warn: 0, error: 0 };
  let done = 0;
  await mapLimit(list, 8, async (d) => {
    const r = await testConnection(d.domain, d.port);
    saveConnTest(d.id, r);
    tally[r.conclusion.level]++;
    onProgress?.(++done, list.length, d, r);
  });
  const scope = `${scopeName({ groupId })}${onlyFailed ? ' · Check Failed' : ''}`;
  if (list.length) addActivity('sync', 'Tes koneksi selesai', `${scope}: ${list.length} domain · ${tally.ok} normal · ${tally.warn} hanya lewat proxy · ${tally.error} tidak terjangkau`);
  return { total: list.length, ...tally, scope };
}

export const JOBS = {
  scan: {
    label: 'Scan SSL',
    description: 'Cek sertifikat SSL semua domain di Source of Truth (atau satu group). Sama dengan tombol Sync Now dan scan otomatis.',
    run: (o) => runScan({ ...o, groupId: o.groupId || null }),
    message: scanMsg,
    notify: true,
  },
  retry_failed: {
    label: 'Retry Check Failed',
    description: 'Scan ulang hanya domain yang statusnya Check Failed (sertifikat tidak terbaca). Lebih cepat daripada scan semua.',
    run: (o) => runScan({ ...o, groupId: o.groupId || null, onlyFailed: true }),
    message: (r) => `Retry ${r.scope}: ${r.total} domain dicek ulang dalam ${r.seconds} detik · ${r.recovered} berhasil dibaca · ${r.failed} masih Check Failed${r.fallback ? ` · ${r.fallback} lewat proxy (otomatis)` : ''}`,
    notify: true,
  },
  conn_test: {
    label: 'Tes koneksi Check Failed',
    description: 'Untuk tiap domain Check Failed: DNS, Ping, Telnet (port), dan Curl (HTTPS), langsung dan lewat proxy. Hasilnya tampil di tabel & detail domain.',
    run: (o) => runConnTest({ groupId: o.groupId || null, onProgress: o.onProgress }),
    message: (r) => (r.total ? `Tes koneksi ${r.scope}: ${r.total} domain · ${r.ok} normal · ${r.warn} hanya lewat proxy · ${r.error} tidak terjangkau` : `Tidak ada domain Check Failed (${r.scope})`),
    exclusive: false,
  },
  notify: {
    label: 'Kirim notifikasi sekarang',
    description: 'Kirim ringkasan status sertifikat saat ini ke semua saluran notifikasi yang menerima "Hasil scan" (Settings → Notifikasi).',
    run: () => sendReportNow(),
    message: (r) => (r.sent ? `Terkirim ke ${r.channels} saluran` : r.skipped),
    ok: (r) => r.sent,
    exclusive: false,
  },
  entra: {
    label: 'Sync user Entra ID',
    description: 'Ambil anggota grup Admin & Monitoring dari Microsoft Entra ID ke menu Users. Yang keluar dari grup dinonaktifkan.',
    run: () => syncUsers(),
    message: (r) => `${r.total} user di grup · ${r.created} baru · ${r.updated} diubah · ${r.disabled} dinonaktifkan${r.skipped.length ? ` · ${r.skipped.length} dilewati` : ''}`,
    available: () => entraConfigured(),
    reason: 'Atur & aktifkan dulu di Settings → Integrasi → Entra ID',
    exclusive: false,
  },
};

// Nama job lama di riwayat (fitur yang sudah dihapus / diganti)
export const LEGACY_JOB_LABELS = { full: 'Sync + Scan', route53: 'Sync Route 53', soar_all: 'Jalankan semua flow SOAR', teams: 'Kirim ringkasan ke Teams' };

export const getJobs = () => JOBS;

export async function runJob(name, { trigger = 'manual', ...opts } = {}) {
  const job = JOBS[name];
  if (!job) throw new Error(`Job tidak dikenal: ${name}`);
  const id = startJobRun(name, trigger);
  const category = name === 'notify' ? 'notify' : name === 'entra' ? 'auth' : 'job';
  const scope = opts.groupId ? ` (${scopeName(opts)})` : '';
  const base = { category, action: `job.${name}`, target: `${job.label}${scope}`, source: SOURCE[trigger] || trigger, actor: trigger === 'scheduler' ? 'system (otomatis)' : trigger === 'soar' ? 'soar' : undefined };
  try {
    const result = await job.run({ ...opts, trigger });
    let message = job.message(result);
    const ok = job.ok ? job.ok(result) : true;

    // setelah scan: alert (semua scan) + hasil scan (scan scheduler) ke saluran notifikasi
    if (job.notify) {
      try {
        const n = await notifyAfterScan({ trigger, scan: result });
        const sent = (n.results || []).filter((r) => r.ok).length;
        const failed = (n.results || []).filter((r) => !r.ok).length;
        if (sent || failed) message += ` · Notifikasi: ${sent} terkirim${failed ? `, ${failed} gagal` : ''}`;
      } catch (e) {
        message += ` · Notifikasi gagal: ${e.message}`;
      }
    }
    finishJobRun(id, ok, message);
    audit({ ...base, ok, summary: `${job.label}${scope}: ${message}` });
    return { ok, message, result };
  } catch (e) {
    finishJobRun(id, false, e.message);
    audit({ ...base, ok: false, summary: `${job.label}${scope} gagal: ${e.message}` });
    if (['scan', 'retry_failed'].includes(name) && !/sedang berjalan/i.test(e.message)) {
      notifySystemEvent(`Job ${job.label} gagal`, e.message).catch(() => {});
    }
    throw e;
  }
}
