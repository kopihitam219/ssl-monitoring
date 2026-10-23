// Status & restart service.
//  - Restart ringan : tutup & buka ulang database, muat ulang pengaturan, reset scan yang macet, jalankan ulang scheduler.
//  - Restart penuh  : proses server dimatikan lalu dinyalakan lagi otomatis.
//      npm run dev   → Next.js dev me-restart server sendiri bila keluar dengan kode 77
//      npm start     → scripts/serve.js (supervisor) me-restart bila keluar dengan kode 75
import { closeAll, closeDanglingJobRuns, dbPath } from './db.js';
import { closeAudit, audit } from './audit.js';
import { startScheduler, schedulerStatus } from './scheduler.js';

const STUCK_MS = 15 * 60_000;

export function initService() {
  if (globalThis.__sslService) return globalThis.__sslService;
  globalThis.__sslService = { startedAt: new Date().toISOString(), lastRestart: null };
  try { closeDanglingJobRuns('Terhenti karena service dimatikan / di-restart'); } catch {}
  audit({ type: 'system', actor: 'system', source: 'System', category: 'service', action: 'service.start', target: 'Service',
    summary: `Service menyala (${process.env.NODE_ENV === 'development' ? 'npm run dev' : 'npm start'}, Node ${process.version}, PID ${process.pid})` });
  return globalThis.__sslService;
}

export function fullRestartMode() {
  if (process.env.NODE_ENV === 'development') return 'dev';
  if (process.env.SSL_SUPERVISED === '1') return 'supervised';
  return null;
}

export function serviceStatus() {
  const svc = initService();
  const started = globalThis.__sslScanStarted;
  return {
    online: true,
    startedAt: svc.startedAt,
    uptimeSec: Math.round(process.uptime()),
    lastRestart: svc.lastRestart,
    node: process.version,
    pid: process.pid,
    platform: process.platform,
    runMode: process.env.NODE_ENV === 'development' ? 'npm run dev' : process.env.SSL_SUPERVISED === '1' ? 'npm start (supervisor)' : 'npm start',
    fullRestart: !!fullRestartMode(),
    db: dbPath(),
    scanning: !!globalThis.__sslScanning,
    scanStartedAt: started ? new Date(started).toISOString() : null,
    scheduler: schedulerStatus(),
  };
}

export function softRestart() {
  const svc = initService();
  const stuck = globalThis.__sslScanning && Date.now() - (globalThis.__sslScanStarted || 0) > STUCK_MS;
  if (globalThis.__sslScanning && !stuck) throw new Error('Scan sedang berjalan. Tunggu sampai selesai, lalu coba lagi.');
  if (stuck) globalThis.__sslScanning = false;
  closeAll();
  closeAudit();
  globalThis.__sslSettings = null;
  closeDanglingJobRuns('Terhenti karena service di-restart');
  startScheduler({ force: true });
  svc.lastRestart = new Date().toISOString();
  return { resetStuckScan: !!stuck };
}

/** Matikan proses supaya dinyalakan ulang otomatis. Dipanggil setelah respons terkirim. */
export function scheduleFullRestart() {
  const mode = fullRestartMode();
  if (!mode) return false;
  setTimeout(() => {
    try { closeAll(); closeAudit(); } catch {}
    process.exit(mode === 'dev' ? 77 : 75);
  }, 400);
  return true;
}
