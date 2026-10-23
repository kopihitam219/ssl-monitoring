// Scan SSL semua domain dari terminal.
//   npm run scan                → scan semua domain
// Bisa dijadwalkan dengan cron (Linux/Mac) atau Task Scheduler (Windows).
import { runJob } from '../lib/runner.js';

const ICON = { OK: '✔', WARNING: '!', URGENT: '!!', EXPIRED: '✘', CHECK_FAILED: '✘' };
const onProgress = (i, n, d, r, status) => {
  const info = r.error ? r.error : `${r.daysRemaining} hari · ${r.issuer}${r.trustError ? ` · ${r.trustError}` : ''}`;
  console.log(`[${String(i).padStart(3)}/${n}] ${(ICON[status] || '?').padEnd(2)} ${status.padEnd(12)} ${`${d.domain}:${d.port}`.padEnd(34)} ${info}`);
};

const res = await runJob('scan', { trigger: 'cli', onProgress });
const scan = res.result;
console.log(`\n${res.message}`);
console.log(Object.entries(scan.counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('  '));
