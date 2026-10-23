// Health check: kondisi laptop/server (CPU, RAM, Disk), memori aplikasi, dan status tiap service.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './settings.js';
import { getSources } from './db.js';
import { pg, dbLabel } from './pg.js';
import { schedulerStatus } from './scheduler.js';
import { lockInfo } from './locks.js';
import { listScanners, scanRunnerLabel } from './scanner.js';

const ON_VERCEL = !!process.env.VERCEL;

function cpuTimes() {
  return os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle;
    a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
}

async function cpuUsage(sampleMs = 400) {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = cpuTimes();
  const total = b.total - a.total;
  return total > 0 ? Math.max(0, Math.min(100, (1 - (b.idle - a.idle) / total) * 100)) : 0;
}

function disk() {
  try {
    const s = fs.statfsSync(process.cwd());
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free, pct: total ? ((total - free) / total) * 100 : 0, path: path.parse(process.cwd()).root || '/' };
  } catch (e) {
    return { error: e.message };
  }
}

const level = (pct, warn, crit) => (pct >= crit ? 'error' : pct >= warn ? 'warn' : 'ok');

async function lastAudit(where) {
  try { return await (await pg()).get(`SELECT at, ok, summary FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 1`); } catch { return null; }
}

async function dbSize() {
  try { return Number((await (await pg()).get('SELECT pg_database_size(current_database()) AS n')).n); } catch { return NaN; }
}

async function checkDb() {
  const l = dbLabel();
  const t = Date.now();
  try {
    await (await pg()).get('SELECT 1 AS x');
    return { name: `Database (${l.kind})`, status: 'ok', detail: `${l.where} · respons ${Date.now() - t} ms` };
  } catch (e) {
    return { name: `Database (${l.kind})`, status: 'error', detail: e.message };
  }
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export async function healthReport() {
  const s = getSettings();
  const cpu = await cpuUsage();
  const total = os.totalmem(), free = os.freemem();
  const mem = process.memoryUsage();
  const dk = disk();

  const services = [];
  services.push(ON_VERCEL
    ? { name: 'Web server (Vercel)', status: 'ok', detail: `Online · ${process.env.VERCEL_URL || 'vercel'} · region ${process.env.VERCEL_REGION || '—'}` }
    : { name: 'Web server (Next.js)', status: 'ok', detail: `Online · PID ${process.pid} · ${process.env.NODE_ENV === 'development' ? 'npm run dev' : 'npm start'}` });

  // database
  services.push(await checkDb());

  // scheduler & scanner
  const runner = s.scanRunner || 'local';
  if (ON_VERCEL) {
    services.push({ name: 'Scan otomatis (Vercel Cron)', status: runner === 'local' ? 'off' : s.scanIntervalHours ? 'ok' : 'off',
      detail: runner === 'local' ? 'Scan dijalankan scanner kantor (Settings → Aturan status & scan)' : s.scanIntervalHours ? `Tiap ${s.scanIntervalHours} jam (dicek oleh Vercel Cron)` : 'Dimatikan di Settings' });
  } else {
    const sch = await schedulerStatus();
    services.push(sch.active
      ? { name: 'Scheduler (scan otomatis)', status: 'ok', detail: `Tiap ${sch.hours} jam oleh ${sch.by}${sch.nextRunAt ? ` · berikutnya ${new Date(sch.nextRunAt).toLocaleString('id-ID')}` : ' · segera'}` }
      : { name: 'Scheduler (scan otomatis)', status: s.scanIntervalHours ? 'warn' : 'off', detail: s.scanIntervalHours ? (runner === 'cloud' ? 'Scan dijalankan Vercel (Settings → Aturan status & scan)' : 'Belum berjalan (aktif setelah dashboard dibuka)') : 'Dimatikan di Settings' });
  }
  if (runner !== 'cloud') {
    const sc = await listScanners().catch(() => []);
    const live = sc.filter((x) => x.online);
    services.push({ name: 'Scanner kantor', status: live.length ? 'ok' : dbLabel().kind === 'PGlite (lokal)' ? 'ok' : 'warn',
      detail: live.length ? live.map((x) => `${x.host} (terakhir aktif ${new Date(x.last_seen).toLocaleTimeString('id-ID')})`).join(' · ')
        : dbLabel().kind === 'PGlite (lokal)' ? 'Aplikasi ini sendiri (database lokal)' : `Tidak ada scanner yang online. ${scanRunnerLabel(runner)}` });
  }

  // scan engine
  let sources = {};
  try { sources = await getSources(); } catch {}
  const lock = await lockInfo('scan').catch(() => null);
  const scanning = !!lock;
  const scanSrc = sources.scan;
  services.push({
    name: 'Scan engine (cek SSL)',
    status: scanSrc?.status === 'error' ? 'error' : scanning ? 'ok' : scanSrc ? 'ok' : 'warn',
    detail: scanning ? `Sedang scan… (${lock.owner})`
      : scanSrc ? `Scan terakhir ${new Date(scanSrc.last_sync).toLocaleString('id-ID')}${scanSrc.detail?.error ? ` · ${scanSrc.detail.error}` : ''}`
      : 'Belum pernah scan',
  });

  if (s.scanProxy.url) services.push({ name: 'Proxy cek SSL', status: 'ok', detail: `${s.scanProxy.url}${s.scanProxy.username ? ' (dengan login)' : ''}` });

  // Entra ID
  if (!s.entra.enabled) services.push({ name: 'Microsoft Entra ID', status: 'off', detail: 'Tidak dipakai' });
  else {
    const { entraConfigured } = await import('./entra.js');
    if (!entraConfigured()) services.push({ name: 'Microsoft Entra ID', status: 'warn', detail: 'Aktif tapi konfigurasi belum lengkap' });
    else {
      const e = await lastAudit("action IN ('job.entra', 'entra.test', 'auth.login-microsoft')");
      services.push({ name: 'Microsoft Entra ID', status: !e ? 'warn' : e.ok ? 'ok' : 'error', detail: e ? e.summary.slice(0, 140) : 'Belum pernah sync / tes koneksi' });
    }
  }

  // Wazuh
  if (!s.wazuh.enabled) services.push({ name: 'Wazuh', status: 'off', detail: 'Tidak dipakai' });
  else {
    const { wazuhStatus } = await import('./wazuh.js');
    const z = await wazuhStatus();
    const via = z.transport === 'file' ? 'file + agent' : z.transport === 'both' ? 'API + file' : 'API';
    services.push({ name: `Wazuh (${via})`, status: z.lastError || z.fileError ? 'error' : z.queued > 500 ? 'warn' : 'ok',
      detail: z.lastError ? `Gagal kirim: ${z.lastError} · ${z.queued} event di antrean`
        : z.fileError ? `Gagal tulis file: ${z.fileError}`
        : `${z.queued} event di antrean${z.lastOk ? ` · terakhir terkirim ${new Date(z.lastOk).toLocaleString('id-ID')}` : ''}` });
  }

  // SOAR → aplikasi
  if (s.soarIn.enabled) {
    const r = await lastAudit("(action LIKE 'soar.in%' OR action = 'soar.auth')");
    services.push({ name: 'SOAR → aplikasi', status: !r ? 'ok' : r.ok ? 'ok' : 'warn',
      detail: r ? `Terakhir ${new Date(r.at).toLocaleString('id-ID')}: ${r.summary.slice(0, 120)}` : 'Aktif, belum ada request dari SOAR' });
  }

  // saluran notifikasi
  try { const { channelStatus } = await import('./notify.js'); services.push(...(await channelStatus())); } catch (e) { services.push({ name: 'Notifikasi', status: 'error', detail: e.message }); }

  const cpus = os.cpus();
  const memPct = ((total - free) / total) * 100;
  // Di Vercel angka CPU/RAM/Disk milik server Vercel sesaat (bukan milik Anda), jadi tidak dijadikan alarm.
  const lv = (pct) => (ON_VERCEL ? 'ok' : level(pct, 85, 95));
  const parts = {
    cpu: { pct: cpu, cores: cpus.length, model: cpus[0]?.model?.trim() || '—', load: os.platform() === 'win32' ? null : os.loadavg(), status: lv(cpu) },
    memory: { total, free, used: total - free, pct: memPct, status: lv(memPct) },
    disk: dk.error ? { error: dk.error, status: ON_VERCEL ? 'ok' : 'warn' } : { ...dk, status: lv(dk.pct) },
    cloud: ON_VERCEL,
  };
  const all = [parts.cpu.status, parts.memory.status, parts.disk.status, ...services.map((x) => x.status)];
  return {
    at: new Date().toISOString(),
    ...parts,
    app: {
      rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external,
      uptimeSec: Math.round(process.uptime()), pid: process.pid, node: process.version,
      dataSize: await dbSize(),
    },
    system: {
      hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, arch: os.arch(), uptimeSec: Math.round(os.uptime()),
    },
    services,
    overall: all.includes('error') ? 'error' : all.includes('warn') ? 'warn' : 'ok',
  };
}
