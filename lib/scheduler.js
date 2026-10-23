// Scheduler bawaan: selama aplikasi berjalan, job "Scan SSL" dijalankan otomatis tiap N jam.
// Interval diatur di menu Settings (0 = mati, scan hanya manual / lewat cron).
import { isScanning } from './jobs.js';
import { runJob } from './runner.js';
import { getSettings } from './settings.js';
import { outsideRequest } from './context.js';

/** Mulai scheduler. Kalau interval berubah (atau force=true), scheduler dijalankan ulang. */
export function startScheduler({ force = false } = {}) {
  startSystemWatch();
  // lanjutkan kirim antrean Wazuh setelah restart
  if (getSettings().wazuh?.enabled) import('./wazuh.js').then((m) => m.ensureTimer()).catch(() => {});
  const hours = Number(getSettings().scanIntervalHours || 0);
  const cur = globalThis.__sslScheduler;
  if (cur && cur.hours === hours && !force) return;
  if (cur) clearInterval(cur.timer);
  globalThis.__sslScheduler = null;
  if (!hours) return;

  const ms = hours * 3_600_000;
  const state = { hours, nextRunAt: new Date(Date.now() + ms).toISOString(), lastRunAt: cur?.lastRunAt || null };
  const tick = async () => {
    state.nextRunAt = new Date(Date.now() + ms).toISOString();
    if (isScanning()) return;
    state.lastRunAt = new Date().toISOString();
    try {
      const r = await runJob('scan', { trigger: 'scheduler' });
      console.log(`[scheduler] ${r.message}`);
    } catch (e) {
      console.error('[scheduler] gagal:', e.message);
    }
    try {
      const { entraConfigured } = await import('./entra.js');
      if (entraConfigured() && getSettings().entra.autoSync) {
        await runJob('entra', { trigger: 'scheduler' }).catch((e) => console.error('[scheduler] sync Entra ID gagal:', e.message));
      }
    } catch {}
  };
  state.timer = outsideRequest(() => setInterval(tick, ms)); // jangan mewarisi user/IP request yang memicu start
  globalThis.__sslScheduler = state;
  console.log(`[scheduler] scan otomatis tiap ${hours} jam`);
}

/** Cek kondisi sistem tiap 5 menit → notifikasi "Sistem bermasalah" / "Sistem kembali normal" (Settings → Notifikasi). */
function startSystemWatch() {
  if (globalThis.__sslSystemWatch) return;
  const tick = async () => {
    try {
      const { checkSystem } = await import('./notify.js');
      await checkSystem();
    } catch (e) { console.error('[scheduler] cek sistem:', e.message); }
  };
  globalThis.__sslSystemWatch = outsideRequest(() => setInterval(tick, 5 * 60_000));
  outsideRequest(() => setTimeout(tick, 60_000));
}

export function schedulerStatus() {
  const s = globalThis.__sslScheduler;
  return s ? { active: true, hours: s.hours, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt } : { active: false };
}
