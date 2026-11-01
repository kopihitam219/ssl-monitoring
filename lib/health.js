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
import { fmtDateTime, fmtTimeOnly } from './time.js';

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

/** Satu pemeriksaan tidak boleh menahan seluruh halaman: lewat batas waktu → tampil sebagai peringatan. */
function batas(janji, ms, cadangan) {
  let t;
  return Promise.race([
    Promise.resolve(janji).catch((e) => (typeof cadangan === 'function' ? cadangan(e) : cadangan)),
    new Promise((ok) => { t = setTimeout(() => ok(typeof cadangan === 'function' ? cadangan(null) : cadangan), ms); }),
  ]).finally(() => clearTimeout(t));
}
const lambat = (name, ms) => (e) => ({ name, status: 'warn', detail: e ? e.message : `Pemeriksaan tidak selesai dalam ${Math.round(ms / 1000)} detik` });

// Di Vercel setiap request membuka fungsi serverless dengan koneksi database terbatas (2).
// Halaman Health Check memanggil endpoint ini berulang-ulang; tanpa cache, request menumpuk,
// antre koneksi database, lalu melewati batas waktu Vercel (HTTP 504). Hasil disimpan sebentar
// dan request yang datang bersamaan menunggu hasil yang sama.
const CACHE_MS = ON_VERCEL ? 15_000 : 0;
let cacheLaporan = { at: 0, nilai: null };
let sedangJalan = null;

export async function healthReport() {
  if (CACHE_MS && cacheLaporan.nilai && Date.now() - cacheLaporan.at < CACHE_MS) return cacheLaporan.nilai;
  if (sedangJalan) return sedangJalan;
  sedangJalan = buatLaporan()
    .then((r) => { cacheLaporan = { at: Date.now(), nilai: r }; return r; })
    .finally(() => { sedangJalan = null; });
  return sedangJalan;
}

async function buatLaporan() {
  const s = getSettings();
  const total = os.totalmem(), free = os.freemem();
  const mem = process.memoryUsage();
  const dk = disk();

  const T = 8_000; // batas tiap bagian; semua berjalan bersamaan sehingga total tetap di bawah batas Vercel
  const webServer = ON_VERCEL
    ? { name: 'Web server (Vercel)', status: 'ok', detail: `Online · ${process.env.VERCEL_URL || 'vercel'} · region ${process.env.VERCEL_REGION || '—'}` }
    : { name: 'Web server (Next.js)', status: 'ok', detail: `Online · PID ${process.pid} · ${process.env.NODE_ENV === 'development' ? 'npm run dev' : 'npm start'}` };

  const runner = s.scanRunner || 'local';

  const bagianScheduler = async () => {
    if (ON_VERCEL) {
      return { name: 'Scan otomatis (Vercel Cron)', status: runner === 'local' ? 'off' : s.scanIntervalHours ? 'ok' : 'off',
        detail: runner === 'local' ? 'Scan dijalankan scanner kantor (Settings → Aturan status & scan)' : s.scanIntervalHours ? `Tiap ${s.scanIntervalHours} jam (dicek oleh Vercel Cron)` : 'Dimatikan di Settings' };
    }
    const sch = await schedulerStatus();
    return sch.active
      ? { name: 'Scheduler (scan otomatis)', status: 'ok', detail: `Tiap ${sch.hours} jam oleh ${sch.by}${sch.nextRunAt ? ` · berikutnya ${fmtDateTime(sch.nextRunAt)}` : ' · segera'}` }
      : { name: 'Scheduler (scan otomatis)', status: s.scanIntervalHours ? 'warn' : 'off', detail: s.scanIntervalHours ? (runner === 'cloud' ? 'Scan dijalankan Vercel (Settings → Aturan status & scan)' : 'Belum berjalan (aktif setelah dashboard dibuka)') : 'Dimatikan di Settings' };
  };

  const bagianScanner = async () => {
    if (runner === 'cloud') return [];
    const sc = await listScanners().catch(() => []);
    const live = sc.filter((x) => x.online);
    return [{ name: 'Scanner kantor', status: live.length ? 'ok' : dbLabel().kind === 'PGlite (lokal)' ? 'ok' : 'warn',
      detail: live.length ? live.map((x) => `${x.host} (terakhir aktif ${fmtTimeOnly(x.last_seen)})`).join(' · ')
        : dbLabel().kind === 'PGlite (lokal)' ? 'Aplikasi ini sendiri (database lokal)' : `Tidak ada scanner yang online. ${scanRunnerLabel(runner)}` }];
  };

  const bagianScan = async () => {
    let sources = {};
    try { sources = await getSources(); } catch {}
    const lock = await lockInfo('scan').catch(() => null);
    const scanning = !!lock;
    const scanSrc = sources.scan;
    const out = [{
      name: 'Scan engine (cek SSL)',
      status: scanSrc?.status === 'error' ? 'error' : scanning ? 'ok' : scanSrc ? 'ok' : 'warn',
      detail: scanning ? `Sedang scan… (${lock.owner})`
        : scanSrc ? `Scan terakhir ${fmtDateTime(scanSrc.last_sync)}${scanSrc.detail?.error ? ` · ${scanSrc.detail.error}` : ''}`
        : 'Belum pernah scan',
    }];
    if (s.scanProxy.url) out.push({ name: 'Proxy cek SSL', status: 'ok', detail: `${s.scanProxy.url}${s.scanProxy.username ? ' (dengan login)' : ''}` });
    return out;
  };

  const bagianMandiri = async () => {
    try {
      const { selfChecks } = await import('./selfcheck.js');
      return await selfChecks();
    } catch (e) {
      return [{ name: 'Pemeriksaan mandiri', status: 'error', detail: e.message }];
    }
  };

  const bagianEntra = async () => {
    if (!s.entra.enabled) return { name: 'Microsoft Entra ID', status: 'off', detail: 'Tidak dipakai' };
    const { entraConfigured } = await import('./entra.js');
    if (!entraConfigured()) return { name: 'Microsoft Entra ID', status: 'warn', detail: 'Aktif tapi konfigurasi belum lengkap' };
    const e = await lastAudit("action IN ('job.entra', 'entra.test', 'auth.login-microsoft')");
    return { name: 'Microsoft Entra ID', status: !e ? 'warn' : e.ok ? 'ok' : 'error', detail: e ? e.summary.slice(0, 140) : 'Belum pernah sync / tes koneksi' };
  };

  const bagianWazuh = async () => {
    if (!s.wazuh.enabled) return { name: 'Wazuh', status: 'off', detail: 'Tidak dipakai' };
    const { wazuhStatus } = await import('./wazuh.js');
    const z = await wazuhStatus();
    const via = z.transport === 'file' ? 'file + agent' : z.transport === 'both' ? 'API + file' : 'API';
    return { name: `Wazuh (${via})`, status: z.lastError || z.fileError ? 'error' : z.queued > 500 ? 'warn' : 'ok',
      detail: z.lastError ? `Gagal kirim: ${z.lastError} · ${z.queued} event di antrean`
        : z.fileError ? `Gagal tulis file: ${z.fileError}`
        : `${z.queued} event di antrean${z.lastOk ? ` · terakhir terkirim ${fmtDateTime(z.lastOk)}` : ''}` };
  };

  const bagianSoar = async () => {
    if (!s.soarIn.enabled) return [];
    const r = await lastAudit("(action LIKE 'soar.in%' OR action = 'soar.auth')");
    return [{ name: 'SOAR → aplikasi', status: !r ? 'ok' : r.ok ? 'ok' : 'warn',
      detail: r ? `Terakhir ${fmtDateTime(r.at)}: ${r.summary.slice(0, 120)}` : 'Aktif, belum ada request dari SOAR' }];
  };

  const bagianNotif = async () => {
    try { const { channelStatus } = await import('./notify.js'); return await channelStatus(); }
    catch (e) { return [{ name: 'Notifikasi', status: 'error', detail: e.message }]; }
  };

  // Semua bagian berjalan bersamaan, masing-masing dengan batas waktu; urutan tampilan tetap sama.
  const [cpu, db, sched, scanner, scan, mandiri, entra, wazuh, soar, notif] = await Promise.all([
    cpuUsage(),
    batas(checkDb(), T, (e) => ({ name: `Database (${dbLabel().kind})`, status: 'error', detail: e ? e.message : `Database tidak menjawab dalam ${T / 1000} detik` })),
    batas(bagianScheduler(), T, lambat('Scan otomatis', T)),
    batas(bagianScanner(), T, (e) => [lambat('Scanner kantor', T)(e)]),
    batas(bagianScan(), T, (e) => [lambat('Scan engine (cek SSL)', T)(e)]),
    batas(bagianMandiri(), 13_000, (e) => [lambat('Pemeriksaan mandiri', 13_000)(e)]),
    batas(bagianEntra(), T, lambat('Microsoft Entra ID', T)),
    batas(bagianWazuh(), T, lambat('Wazuh', T)),
    batas(bagianSoar(), T, (e) => [lambat('SOAR → aplikasi', T)(e)]),
    batas(bagianNotif(), T, (e) => [lambat('Notifikasi', T)(e)]),
  ]);
  const services = [webServer, db, sched, ...scanner, ...scan, ...mandiri, entra, wazuh, ...soar, ...notif];
  // Ukuran data diambil dari hasil "Penyimpanan database" di atas (sudah di-cache), bukan query baru:
  // query ukuran termasuk yang paling lambat dan dulu menahan koneksi database sampai request lain gagal.
  let dataSize = NaN;
  try { const { ukuranTerakhir } = await import('./selfcheck.js'); dataSize = ukuranTerakhir() ?? NaN; } catch {}

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
      dataSize,
    },
    system: {
      hostname: ON_VERCEL ? `Vercel · ${process.env.VERCEL_REGION || 'cloud'}` : os.hostname(), platform: `${os.type()} ${os.release()}`, arch: os.arch(), uptimeSec: Math.round(os.uptime()),
    },
    services,
    overall: all.includes('error') ? 'error' : all.includes('warn') ? 'warn' : 'ok',
  };
}
