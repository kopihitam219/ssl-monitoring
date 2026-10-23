// Scan SSL semua domain dari terminal.
//   npm run scan                → scan semua domain
// Bisa dijadwalkan dengan cron (Linux/Mac) atau Task Scheduler (Windows).
import './env.js';
import { loadSettings } from '../lib/settings.js';
import { closePg } from '../lib/pg.js';

await loadSettings();
const { runJob } = await import('../lib/runner.js');
const ICON = { OK: '✔', INFORMATIONAL: '·', WARNING: '!', NEED_UPDATE: '!', REMINDER: '!!', URGENT: '!!', CHECK_FAILED: '✘' };
const onProgress = (i, n, d, r, status) => {
  const info = r.error ? r.error : `${r.daysRemaining} hari · ${r.issuer}${r.trustError ? ` · ${r.trustError}` : ''}`;
  console.log(`[${String(i).padStart(3)}/${n}] ${(ICON[status] || '?').padEnd(2)} ${status.padEnd(13)} ${`${d.domain}:${d.port}`.padEnd(34)} ${info}`);
};

try {
  const res = await runJob('scan', { trigger: 'cli', fromQueue: true, onProgress });
  console.log(`\n${res.message}`);
  console.log(Object.entries(res.result.counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('  '));
} catch (e) {
  console.error(`✘ ${e.message}`);
  process.exitCode = 1;
}
await new Promise((r) => setTimeout(r, 300)); // tunggu audit log tertulis
await closePg();
