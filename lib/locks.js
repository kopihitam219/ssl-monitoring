// Kunci sederhana di database (tabel app_locks), supaya scan tidak jalan dobel
// walaupun ada beberapa instance Vercel + scanner di laptop kantor sekaligus.
import os from 'node:os';
import crypto from 'node:crypto';
import { pg } from './pg.js';

export const INSTANCE_ID = (globalThis.__sslInstance ??= `${process.env.VERCEL ? 'vercel' : os.hostname()}-${crypto.randomBytes(3).toString('hex')}`);

/** Ambil kunci. true = berhasil. Kunci kedaluwarsa otomatis setelah ttlMs (mis. proses mati di tengah jalan). */
export async function acquireLock(name, ttlMs, info = '') {
  const db = await pg();
  const now = Date.now();
  const r = await db.run(`INSERT INTO app_locks (name, owner, until_ms, info) VALUES (?, ?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, until_ms = excluded.until_ms, info = excluded.info
    WHERE app_locks.until_ms < ? OR app_locks.owner = excluded.owner RETURNING name`, name, INSTANCE_ID, now + ttlMs, info, now);
  return r.rows.length > 0;
}

export async function extendLock(name, ttlMs) {
  await (await pg()).run('UPDATE app_locks SET until_ms = ? WHERE name = ? AND owner = ?', Date.now() + ttlMs, name, INSTANCE_ID);
}

export async function releaseLock(name) {
  await (await pg()).run('UPDATE app_locks SET until_ms = 0 WHERE name = ? AND owner = ?', name, INSTANCE_ID);
}

/** Info kunci yang masih berlaku (null = bebas). */
export async function lockInfo(name) {
  const r = await (await pg()).get('SELECT owner, until_ms, info FROM app_locks WHERE name = ?', name);
  return r && Number(r.until_ms) > Date.now() ? r : null;
}

/** Lepas paksa (Restart ringan / scan macet). */
export async function forceRelease(name) {
  await (await pg()).run('UPDATE app_locks SET until_ms = 0 WHERE name = ?', name);
}
