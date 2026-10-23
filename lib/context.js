// Menyimpan "siapa yang sedang melakukan request" selama satu request berjalan,
// sehingga audit log otomatis tahu nama user tanpa harus dioper ke setiap fungsi.
import { AsyncLocalStorage } from 'node:async_hooks';

globalThis.__sslCtx ??= new AsyncLocalStorage();
const store = globalThis.__sslCtx;

export const runWithUser = (user, fn, req = null) => store.run({ user, ip: req ? clientIp(req) : null, ua: req?.headers?.get?.('user-agent') || null }, fn);
/** Jalankan fn di luar konteks request (untuk timer latar belakang, supaya tidak mewarisi user/IP request). */
export const outsideRequest = (fn) => store.exit(fn);
export const currentUser = () => store.getStore()?.user || null;
export const currentIp = () => store.getStore()?.ip || null;
export const currentUserAgent = () => store.getStore()?.ua || null;

/**
 * IP pengirim request.
 * Dengan `npm start` (scripts/server.js) IP diambil dari koneksi TCP dan ditandai kunci rahasia per proses → tidak bisa dipalsukan.
 * Dengan `npm run dev` hanya tersedia X-Forwarded-For (bisa dipalsukan client); cukup untuk uji coba lokal.
 */
export function clientIp(req) {
  const h = req?.headers;
  if (!h?.get) return null;
  const key = process.env.SSL_IP_KEY;
  if (key && h.get('x-ssl-client-sig') === key) return h.get('x-ssl-client-ip') || null;
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || null;
  return ip ? ip.replace(/^::ffff:/, '') : null;
}
