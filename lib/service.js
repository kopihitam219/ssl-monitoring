// Status & restart service.
//  - Restart ringan : sambung ulang database, muat ulang pengaturan, lepas kunci scan yang macet, jalankan ulang scheduler.
//  - Restart penuh  : proses server dimatikan lalu dinyalakan lagi otomatis.
//      npm run dev   → Next.js dev me-restart server sendiri bila keluar dengan kode 77
//      npm start     → scripts/serve.js (supervisor) me-restart bila keluar dengan kode 75
//  Di Vercel tidak ada proses yang bisa di-restart; keduanya tidak tersedia.
import { closeDanglingJobRuns } from './db.js';
import { closePg, dbLabel } from './pg.js';
import { audit } from './audit.js';
import { loadSettings } from './settings.js';
import { startScheduler, schedulerStatus } from './scheduler.js';
import { lockInfo, forceRelease, INSTANCE_ID } from './locks.js';

const ON_VERCEL = !!process.env.VERCEL;

/** Dipanggil sekali per proses (dari API dashboard / status). */
export async function initService() {
  if (globalThis.__sslService) return globalThis.__sslService;
  globalThis.__sslService = { startedAt: new Date().toISOString(), lastRestart: null };
  if (ON_VERCEL) return globalThis.__sslService; // tiap cold start Vercel tidak perlu dicatat
  // data versi lama (SQLite) → database baru, sekali saja
  try {
    const { importLegacy } = await import('./legacy.js');
    const r = await importLegacy({ log: (m) => console.log(`[impor]${m}`) });
    if (r) {
      const n = Object.entries(r.tables).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`[impor] data versi lama dipindahkan: ${n}${r.settings ? ', pengaturan' : ''}`);
      audit({ type: 'system', actor: 'system', source: 'System', category: 'data', action: 'data.import-legacy', target: 'Database',
        summary: `Data versi lama (SQLite) dipindahkan ke database baru: ${n || 'kosong'}${r.settings ? ' + pengaturan' : ''}`, details: r });
      await loadSettings();
    }
  } catch (e) { console.error('[impor] gagal memindahkan data versi lama:', e.message); }
  try { await closeDanglingJobRuns('Terhenti karena service dimatikan / di-restart', { olderThanMs: 20 * 60_000 }); } catch {}
  audit({ type: 'system', actor: 'system', source: 'System', category: 'service', action: 'service.start', target: 'Service',
    summary: `Service menyala (${process.env.NODE_ENV === 'development' ? 'npm run dev' : 'npm start'}, Node ${process.version}, PID ${process.pid}, database ${dbLabel().kind})` });
  return globalThis.__sslService;
}

export function fullRestartMode() {
  if (ON_VERCEL) return null;
  if (process.env.NODE_ENV === 'development') return 'dev';
  if (process.env.SSL_SUPERVISED === '1') return 'supervised';
  return null;
}

export async function serviceStatus() {
  const svc = await initService();
  const lock = await lockInfo('scan').catch(() => null);
  const l = dbLabel();
  return {
    online: true,
    cloud: ON_VERCEL,
    startedAt: svc.startedAt,
    uptimeSec: Math.round(process.uptime()),
    lastRestart: svc.lastRestart,
    node: process.version,
    pid: process.pid,
    platform: process.platform,
    runMode: ON_VERCEL ? 'Vercel' : process.env.NODE_ENV === 'development' ? 'npm run dev' : process.env.SSL_SUPERVISED === '1' ? 'npm start (supervisor)' : 'npm start',
    fullRestart: !!fullRestartMode(),
    softRestart: !ON_VERCEL,
    db: `${l.kind} · ${l.where}`,
    scanning: !!lock,
    scanBy: lock?.owner || null,
    scheduler: await schedulerStatus(),
  };
}

export async function softRestart() {
  if (ON_VERCEL) throw new Error('Restart tidak tersedia di Vercel (tidak ada server yang berjalan terus).');
  const svc = await initService();
  const lock = await lockInfo('scan');
  // kunci scan milik proses ini tapi tidak ada scan yang benar-benar berjalan → macet
  const stuck = lock && lock.owner === INSTANCE_ID && !globalThis.__sslScanRunning;
  if (lock && !stuck) throw new Error(`Scan sedang berjalan (${lock.owner}). Tunggu sampai selesai, lalu coba lagi.`);
  if (stuck) await forceRelease('scan');
  await closePg();
  await loadSettings();
  await closeDanglingJobRuns('Terhenti karena service di-restart', { olderThanMs: 15 * 60_000 });
  startScheduler({ force: true });
  svc.lastRestart = new Date().toISOString();
  return { resetStuckScan: !!stuck };
}

/** Matikan proses supaya dinyalakan ulang otomatis. Dipanggil setelah respons terkirim. */
export function scheduleFullRestart() {
  const mode = fullRestartMode();
  if (!mode) return false;
  setTimeout(async () => {
    try { await closePg(); } catch {}
    process.exit(mode === 'dev' ? 77 : 75);
  }, 400);
  return true;
}
