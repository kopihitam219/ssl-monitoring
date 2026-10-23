import { NextResponse } from 'next/server';
import { COOKIE, userFromToken, PERMISSIONS, can } from './auth.js';
import { runWithUser } from './context.js';
import { loadSettings } from './settings.js';

export const json = (data, status = 200) => NextResponse.json(data, { status });

/**
 * Alamat yang benar-benar dipakai browser (mis. http://127.0.0.1:3000).
 * Jangan pakai req.nextUrl.origin: Next.js dev mengganti 127.0.0.1 menjadi localhost,
 * sehingga cookie & redirect login Microsoft jadi beda alamat.
 */
export function requestOrigin(req) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const proto = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http').split(',')[0];
  return `${proto}://${host}`;
}

/**
 * Bungkus handler API dengan pengecekan login & peran.
 *   access 'public'  → tanpa login (hanya untuk login/setup)
 *   access 'user'    → semua user yang login (admin & monitoring)  ← default
 *   access 'admin'   → hanya admin
 *   access '<izin>'  → admin, atau Monitoring yang diberi izin itu (lihat PERMISSIONS di lib/auth.js)
 * User yang sedang login tersedia lewat ctx.user dan otomatis dipakai audit log.
 */
export function handle(fn, { access = 'user' } = {}) {
  return async (req, ctx = {}) => {
    try {
      await loadSettings(); // pengaturan terbaru dari database (bisa diubah dari instance lain / laptop)
      if (!globalThis.__sslService) {
        // request pertama di proses ini: pindahkan data versi lama (kalau ada) & nyalakan scheduler (bukan di Vercel)
        const [{ initService }, { startScheduler }] = await Promise.all([import('./service.js'), import('./scheduler.js')]);
        await initService();
        startScheduler();
      }
      const user = access === 'public' ? null : await userFromToken(req.cookies?.get(COOKIE)?.value);
      if (access !== 'public' && !user) return json({ error: 'Sesi berakhir, silakan login lagi', code: 'UNAUTHORIZED' }, 401);
      if (access === 'admin' && user.role !== 'admin') return json({ error: 'Hanya admin yang boleh melakukan ini', code: 'FORBIDDEN' }, 403);
      if (PERMISSIONS[access] && !can(user, access)) return json({ error: 'Anda tidak punya izin untuk ini. Hubungi admin.', code: 'FORBIDDEN' }, 403);
      return await runWithUser(user, () => fn(req, { ...ctx, user }), req);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || 'Terjadi kesalahan' }, 500);
    }
  };
}
