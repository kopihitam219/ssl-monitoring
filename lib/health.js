// Health check: kondisi laptop/server (CPU, RAM, Disk), memori aplikasi, dan status tiap service.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getSettings } from './settings.js';
import { dbPath, getSources } from './db.js';
import { appDb } from './appdb.js';
import { schedulerStatus } from './scheduler.js';

const DATA = path.join(process.cwd(), 'data');
const STUCK_MS = 15 * 60_000;

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

function fileSize(f) {
  let n = 0;
  for (const ext of ['', '-wal', '-shm']) { try { n += fs.statSync(f + ext).size; } catch {} }
  return n;
}

function dirSize(dir) {
  let n = 0;
  try { for (const f of fs.readdirSync(dir)) { try { n += fs.statSync(path.join(dir, f)).size; } catch {} } } catch {}
  return n;
}

const level = (pct, warn, crit) => (pct >= crit ? 'error' : pct >= warn ? 'warn' : 'ok');

function lastAudit(where) {
  try { return appDb().prepare(`SELECT at, ok, summary FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 1`).get(); } catch { return null; }
}

function checkDb(label, file, active) {
  if (!fs.existsSync(file)) return { name: label, status: 'off', detail: 'Belum dibuat (belum pernah dipakai)' };
  const t = Date.now();
  try {
    const d = new DatabaseSync(file, { readOnly: true });
    d.prepare('SELECT 1').get();
    d.close();
    return { name: label, status: 'ok', detail: `${active ? 'Aktif · ' : ''}${fmtBytes(fileSize(file))} · respons ${Date.now() - t} ms` };
  } catch (e) {
    return { name: label, status: 'error', detail: e.message };
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
  services.push({ name: 'Web server (Next.js)', status: 'ok', detail: `Online · PID ${process.pid} · ${process.env.NODE_ENV === 'development' ? 'npm run dev' : 'npm start'}` });

  // database
  services.push(checkDb('Database domain', dbPath(), true));
  services.push(checkDb('Database aplikasi (user & audit)', process.env.APP_DB_PATH || path.join(DATA, 'app.db'), true));

  // scheduler
  const sch = schedulerStatus();
  services.push(sch.active
    ? { name: 'Scheduler (scan otomatis)', status: 'ok', detail: `Tiap ${sch.hours} jam · berikutnya ${new Date(sch.nextRunAt).toLocaleString('id-ID')}` }
    : { name: 'Scheduler (scan otomatis)', status: s.scanIntervalHours ? 'warn' : 'off', detail: s.scanIntervalHours ? 'Belum berjalan (aktif setelah dashboard dibuka)' : 'Dimatikan di Settings' });

  // scan engine
  let sources = {};
  try { sources = getSources(); } catch {}
  const scanning = !!globalThis.__sslScanning;
  const stuck = scanning && Date.now() - (globalThis.__sslScanStarted || 0) > STUCK_MS;
  const scanSrc = sources.scan;
  services.push({
    name: 'Scan engine (cek SSL)',
    status: stuck ? 'error' : scanSrc?.status === 'error' ? 'error' : scanning ? 'ok' : scanSrc ? 'ok' : 'warn',
    detail: stuck ? 'Scan macet > 15 menit. Pakai Restart ringan di menu Jobs.'
      : scanning ? 'Sedang scan…'
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
      const e = appDb().prepare("SELECT ok, summary FROM audit_log WHERE action IN ('job.entra', 'entra.test', 'auth.login-microsoft') ORDER BY id DESC LIMIT 1").get();
      services.push({ name: 'Microsoft Entra ID', status: !e ? 'warn' : e.ok ? 'ok' : 'error', detail: e ? e.summary.slice(0, 140) : 'Belum pernah sync / tes koneksi' });
    }
  }

  // Wazuh
  if (!s.wazuh.enabled) services.push({ name: 'Wazuh', status: 'off', detail: 'Tidak dipakai' });
  else {
    const { wazuhStatus } = await import('./wazuh.js');
    const z = wazuhStatus();
    const via = z.transport === 'file' ? 'file + agent' : z.transport === 'both' ? 'API + file' : 'API';
    services.push({ name: `Wazuh (${via})`, status: z.lastError || z.fileError ? 'error' : z.queued > 500 ? 'warn' : 'ok',
      detail: z.lastError ? `Gagal kirim: ${z.lastError} · ${z.queued} event di antrean`
        : z.fileError ? `Gagal tulis file: ${z.fileError}`
        : `${z.queued} event di antrean${z.lastOk ? ` · terakhir terkirim ${new Date(z.lastOk).toLocaleString('id-ID')}` : ''}` });
  }

  // SOAR → aplikasi
  if (s.soarIn.enabled) {
    const r = appDb().prepare("SELECT at, ok, summary FROM audit_log WHERE action LIKE 'soar.in%' OR action = 'soar.auth' ORDER BY id DESC LIMIT 1").get();
    services.push({ name: 'SOAR → aplikasi', status: !r ? 'ok' : r.ok ? 'ok' : 'warn',
      detail: r ? `Terakhir ${new Date(r.at).toLocaleString('id-ID')}: ${r.summary.slice(0, 120)}` : 'Aktif, belum ada request dari SOAR' });
  }

  // saluran notifikasi
  try { const { channelStatus } = await import('./notify.js'); services.push(...channelStatus()); } catch (e) { services.push({ name: 'Notifikasi', status: 'error', detail: e.message }); }

  const cpus = os.cpus();
  const memPct = ((total - free) / total) * 100;
  const parts = {
    cpu: { pct: cpu, cores: cpus.length, model: cpus[0]?.model?.trim() || '—', load: os.platform() === 'win32' ? null : os.loadavg(), status: level(cpu, 85, 95) },
    memory: { total, free, used: total - free, pct: memPct, status: level(memPct, 85, 95) },
    disk: dk.error ? { error: dk.error, status: 'warn' } : { ...dk, status: level(dk.pct, 85, 95) },
  };
  const all = [parts.cpu.status, parts.memory.status, parts.disk.status, ...services.map((x) => x.status)];
  return {
    at: new Date().toISOString(),
    ...parts,
    app: {
      rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external,
      uptimeSec: Math.round(process.uptime()), pid: process.pid, node: process.version,
      dataSize: fileSize(dbPath()) + fileSize(path.join(DATA, 'app.db')) + dirSize(path.join(DATA, 'uploads')),
    },
    system: {
      hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, arch: os.arch(), uptimeSec: Math.round(os.uptime()),
    },
    services,
    overall: all.includes('error') ? 'error' : all.includes('warn') ? 'warn' : 'ok',
  };
}
