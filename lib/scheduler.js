// Scan otomatis & tugas latar belakang.
//   Laptop / server (npm start): timer di proses ini.
//     - database lokal (PGlite)          → scan tiap N jam di sini
//     - database bersama (Supabase)      → jadi "scanner kantor": kirim detak, ambil job antrean dari Vercel,
//                                          dan scan otomatis kalau Settings "Scan dijalankan oleh" = scanner kantor
//   Vercel: tidak ada timer. /api/cron (Vercel Cron) memanggil cronTick() yang memakai fungsi yang sama.
// Jadwal dihitung dari scan otomatis terakhir di database, jadi tidak dobel walaupun ada beberapa instance.
import { runJob } from './runner.js';
import { getSettings, loadSettings } from './settings.js';
import { outsideRequest } from './context.js';
import { pg, usingSupabase } from './pg.js';
import { isScanning } from './jobs.js';
import { ON_VERCEL, isOfficeScanner, heartbeat, claimJob, finishQueued, scanRunner } from './scanner.js';

const TICK_MS = 60_000;

/** Waktu scan otomatis terakhir (dari riwayat job). */
async function lastAutoScan() {
  const r = await (await pg()).get("SELECT started_at FROM job_runs WHERE job = 'scan' AND trigger IN ('scheduler', 'cron') ORDER BY id DESC LIMIT 1");
  return r?.started_at || null;
}
/** Scan terakhir yang belum selesai karena batas waktu Vercel (sisa domain > 0). */
async function unfinishedScan() {
  const r = await (await pg()).get("SELECT detail FROM data_sources WHERE name = 'scan'");
  try { return JSON.parse(r?.detail || '{}').remaining > 0; } catch { return false; }
}

/** Apakah instance ini yang bertugas scan otomatis? */
function iAmScanRunner() {
  if (ON_VERCEL) return scanRunner() === 'cloud';
  if (!usingSupabase()) return true; // database lokal: selalu
  return scanRunner() === 'local';
}

/** Scan otomatis kalau sudah waktunya. Dipanggil timer (laptop) atau Vercel Cron. */
export async function autoScanIfDue(trigger = 'scheduler') {
  const hours = Number(getSettings().scanIntervalHours || 0);
  if (!hours || !iAmScanRunner()) return { skipped: !hours ? 'Scan otomatis dimatikan' : 'Bukan tugas instance ini' };
  if (await isScanning()) return { skipped: 'Scan sedang berjalan' };
  const last = await lastAutoScan();
  const due = !last || Date.now() - new Date(last).getTime() >= hours * 3_600_000 - 60_000;
  const resume = !due && ON_VERCEL && (await unfinishedScan());
  if (!due && !resume) return { skipped: 'Belum waktunya', last, next: new Date(new Date(last).getTime() + hours * 3_600_000).toISOString() };
  const r = await runJob('scan', { trigger });
  try {
    const { entraConfigured } = await import('./entra.js');
    if (due && entraConfigured() && getSettings().entra.autoSync) await runJob('entra', { trigger }).catch(() => {});
  } catch {}
  return { ran: true, message: r.message };
}

/** Jalankan job antrean dari Vercel (khusus scanner kantor). */
export async function runQueuedJobs(max = 3) {
  let n = 0;
  while (n < max) {
    const j = await claimJob();
    if (!j) break;
    n++;
    try {
      const r = await runJob(j.job, { trigger: j.trigger || 'manual', fromQueue: true, requestedBy: j.requested_by, ...(j.params || {}) });
      await finishQueued(j.id, r.ok, r.message, r.result);
    } catch (e) {
      await finishQueued(j.id, false, e.message);
    }
  }
  return n;
}

async function tick() {
  try {
    await loadSettings();
    const r = await autoScanIfDue('scheduler');
    if (r.ran) console.log(`[scheduler] ${r.message}`);
    const st = globalThis.__sslScheduler;
    if (st) { st.lastCheck = new Date().toISOString(); st.next = r.next || null; st.last = r.last || st.last || null; }
  } catch (e) { console.error('[scheduler]', e.message); }
}

/** Mulai timer latar belakang (tidak dipakai di Vercel). Aman dipanggil berkali-kali. */
export function startScheduler({ force = false } = {}) {
  if (ON_VERCEL) return;
  globalThis.__sslStartedAt ??= new Date().toISOString();
  if (globalThis.__sslScheduler && !force) return;
  if (globalThis.__sslScheduler) for (const t of globalThis.__sslScheduler.timers) clearInterval(t);
  const timers = [];
  outsideRequest(() => {
    timers.push(setInterval(tick, TICK_MS));
    setTimeout(tick, 15_000);
    // cek kondisi sistem tiap 5 menit
    timers.push(setInterval(async () => {
      try { await loadSettings(); const { checkSystem } = await import('./notify.js'); await checkSystem(); } catch (e) { console.error('[scheduler] cek sistem:', e.message); }
    }, 5 * 60_000));
    // lanjutkan kirim antrean Wazuh
    import('./wazuh.js').then((m) => { if (getSettings().wazuh?.enabled) m.ensureTimer(); }).catch(() => {});
    // scanner kantor: detak + ambil job antrean dari Vercel
    if (isOfficeScanner()) {
      let busy = false;
      const poll = async () => {
        if (busy) return;
        busy = true;
        try { await loadSettings(); await heartbeat(); await runQueuedJobs(); } catch (e) { console.error('[scanner]', e.message); } finally { busy = false; }
      };
      timers.push(setInterval(poll, 10_000));
      setTimeout(poll, 3_000);
      console.log('[scanner] scanner kantor aktif: mengambil job dari antrean database bersama');
    }
  });
  globalThis.__sslScheduler = { timers, startedAt: new Date().toISOString(), last: null, next: null, lastCheck: null };
  const h = getSettings().scanIntervalHours;
  console.log(h ? `[scheduler] scan otomatis tiap ${h} jam${iAmScanRunner() ? '' : ' (dijalankan Vercel, bukan komputer ini)'}` : '[scheduler] scan otomatis dimatikan');
}

/** Status scan otomatis (untuk Jobs & Health). */
export async function schedulerStatus() {
  const hours = Number(getSettings().scanIntervalHours || 0);
  const runner = scanRunner();
  const by = !usingSupabase() ? 'Komputer ini' : runner === 'cloud' ? 'Vercel Cron' : 'Scanner kantor';
  if (!hours) return { active: false, hours, by };
  const last = await lastAutoScan().catch(() => null);
  const nextRunAt = last ? new Date(new Date(last).getTime() + hours * 3_600_000).toISOString() : null;
  const running = ON_VERCEL ? true : !!globalThis.__sslScheduler;
  return { active: running, hours, lastRunAt: last, nextRunAt, runner, by, here: iAmScanRunner() };
}

/** Dipanggil /api/cron (Vercel Cron). */
export async function cronTick() {
  const out = {};
  out.scan = await autoScanIfDue('cron').catch((e) => ({ error: e.message }));
  try { const { checkSystem } = await import('./notify.js'); out.system = (await checkSystem()) ? 'dikirim' : 'tidak ada perubahan'; } catch (e) { out.system = e.message; }
  try { const { flushOnce } = await import('./wazuh.js'); if (getSettings().wazuh?.enabled) out.wazuh = await flushOnce(); } catch (e) { out.wazuh = e.message; }
  return out;
}
