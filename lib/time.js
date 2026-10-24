// Waktu untuk teks yang dibuat di server (Health Check, notifikasi, Export Excel).
// Server bisa berada di zona waktu lain — di Vercel UTC — jadi semua teks dipaksa memakai zona aplikasi (default WIB),
// supaya jam yang dibaca pengguna sama di mana pun aplikasi berjalan.
// Catatan: process.env.TZ tidak dipakai karena di Vercel isinya ":UTC" (format tzfile) yang ditolak Intl.

/** Zona waktu aplikasi: dari env APP_TZ kalau diisi & valid, selain itu Asia/Jakarta. */
export const APP_TZ = (() => {
  for (const raw of [process.env.APP_TZ, 'Asia/Jakarta']) {
    const t = String(raw || '').replace(/^:/, '').trim();
    if (!t) continue;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: t }); return t; } catch {}
  }
  return 'UTC';
})();

const ok = (d) => { const x = d instanceof Date ? d : new Date(d); return Number.isNaN(x.getTime()) ? null : x; };

/** 24 Okt 2026, 05.30 */
export function fmtDateTime(d = new Date()) {
  const x = ok(d);
  return x ? x.toLocaleString('id-ID', { timeZone: APP_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** 24 Okt 2026 */
export function fmtDate(d) {
  const x = ok(d);
  return x ? x.toLocaleDateString('id-ID', { timeZone: APP_TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/** 05.30 */
export function fmtTimeOnly(d) {
  const x = ok(d);
  return x ? x.toLocaleTimeString('id-ID', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' }) : '—';
}

/** 2026-10-24 (dipakai untuk tanggal tren harian & nama file export) */
export function isoDate(d = new Date()) {
  const x = ok(d);
  return x ? x.toLocaleDateString('en-CA', { timeZone: APP_TZ }) : '';
}
