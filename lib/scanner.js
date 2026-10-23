// Mode hybrid: dashboard di Vercel, scan dijalankan "scanner kantor" (aplikasi ini juga, dijalankan di laptop/server kantor
// dengan DATABASE_URL yang sama). Vercel tidak bisa menjangkau domain internal / proxy kantor, jadi:
//   - Settings → "Scan dijalankan oleh": local (scanner kantor) | cloud (Vercel Cron)
//   - Mode local: tombol Scan / Retry / Tes koneksi / Cek ulang di Vercel memasukkan job ke antrean (job_queue);
//     scanner kantor mengambilnya tiap ±10 detik, menjalankan, dan menyimpan hasilnya.
import os from 'node:os';
import { pg, usingSupabase } from './pg.js';
import { getSettings } from './settings.js';
import { INSTANCE_ID } from './locks.js';

export const ON_VERCEL = !!process.env.VERCEL;
const ONLINE_MS = 90_000;
const now = () => new Date().toISOString();

export const scanRunner = () => getSettings().scanRunner || 'local';

export function scanRunnerLabel(runner = scanRunner()) {
  return runner === 'cloud'
    ? 'Scan dijalankan Vercel (Vercel Cron).'
    : 'Scan dijalankan scanner kantor: jalankan aplikasi ini di laptop/server kantor dengan DATABASE_URL yang sama (lihat README).';
}

/** Job dari instance ini harus dititipkan ke scanner kantor? (hanya di Vercel dengan mode "scanner kantor") */
export const shouldDelegate = () => ON_VERCEL && scanRunner() === 'local';

/** Instance ini bertugas sebagai scanner kantor? (bukan Vercel, terhubung ke database bersama) */
export const isOfficeScanner = () => !ON_VERCEL && usingSupabase();

// ---------- heartbeat ----------
export async function heartbeat(busy = null) {
  const db = await pg();
  const t = now();
  await db.run(`INSERT INTO scanners (id, host, version, started_at, last_seen, busy) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, busy = excluded.busy`,
  INSTANCE_ID, os.hostname(), process.env.npm_package_version || '2', globalThis.__sslStartedAt || t, t, busy);
  if (Math.random() < 0.05) await db.run('DELETE FROM scanners WHERE last_seen < ?', new Date(Date.now() - 7 * 86_400_000).toISOString());
}

export async function listScanners() {
  const rows = await (await pg()).all('SELECT * FROM scanners ORDER BY last_seen DESC LIMIT 50');
  const seen = new Set(); // satu baris per komputer (yang terbaru), walaupun aplikasi sudah di-restart berkali-kali
  return rows.filter((r) => !seen.has(r.host) && seen.add(r.host))
    .map((r) => ({ ...r, online: Date.now() - new Date(r.last_seen).getTime() < ONLINE_MS }));
}

export async function scannerOnline() {
  return (await listScanners()).some((x) => x.online);
}

// ---------- antrean job ----------
export async function enqueueJob(job, params = {}, { trigger = 'manual', requestedBy = null } = {}) {
  const db = await pg();
  // job yang sama (dan parameter sama) masih menunggu → jangan dobel
  const same = await db.get("SELECT id FROM job_queue WHERE job = ? AND params = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1", job, JSON.stringify(params));
  if (same) return { id: same.id, duplicate: true };
  const r = await db.run('INSERT INTO job_queue (job, params, trigger, requested_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    job, JSON.stringify(params), trigger, requestedBy, 'queued', now());
  return { id: r.rows[0].id, duplicate: false };
}

/** Ambil satu job antrean (aman dipakai beberapa scanner sekaligus). */
export async function claimJob() {
  const db = await pg();
  // job lama yang tidak diambil siapa pun (scanner mati) → kedaluwarsa
  await db.run("UPDATE job_queue SET status = 'expired', finished_at = ?, ok = 0, message = 'Tidak ada scanner kantor yang mengambil job ini dalam 6 jam' WHERE status = 'queued' AND created_at < ?",
    now(), new Date(Date.now() - 6 * 3_600_000).toISOString());
  // job yang "running" tapi scanner-nya hilang > 30 menit → gagal
  await db.run("UPDATE job_queue SET status = 'failed', finished_at = ?, ok = 0, message = 'Scanner berhenti di tengah jalan' WHERE status = 'running' AND started_at < ?",
    now(), new Date(Date.now() - 30 * 60_000).toISOString());
  const r = await db.run(`UPDATE job_queue SET status = 'running', runner = ?, started_at = ?
    WHERE id = (SELECT id FROM job_queue WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, INSTANCE_ID, now());
  const j = r.rows[0];
  if (!j) return null;
  try { j.params = JSON.parse(j.params || '{}'); } catch { j.params = {}; }
  return j;
}

export async function finishQueued(id, ok, message, result = null) {
  await (await pg()).run('UPDATE job_queue SET status = ?, finished_at = ?, ok = ?, message = ?, result = ? WHERE id = ?',
    ok ? 'done' : 'failed', now(), ok ? 1 : 0, message ?? null, result ? JSON.stringify(result).slice(0, 20_000) : null, id);
}

export async function getQueue(limit = 15) {
  return (await pg()).all('SELECT id, job, params, trigger, requested_by, status, created_at, started_at, finished_at, runner, ok, message FROM job_queue ORDER BY id DESC LIMIT ?', limit);
}

export async function cancelQueued(id) {
  const r = await (await pg()).run("UPDATE job_queue SET status = 'cancelled', finished_at = ?, ok = 0, message = 'Dibatalkan' WHERE id = ? AND status = 'queued'", now(), id);
  return r.changes > 0;
}
