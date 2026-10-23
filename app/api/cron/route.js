// GET /api/cron → dipanggil Vercel Cron (lihat vercel.json) atau layanan cron lain (mis. cron-job.org).
//   - scan otomatis kalau sudah waktunya (Settings → "Scan dijalankan oleh" = Vercel), melanjutkan scan yang terpotong batas waktu
//   - cek kondisi sistem → notifikasi "Sistem bermasalah / kembali normal"
//   - kirim antrean Wazuh
// Wajib header "Authorization: Bearer <CRON_SECRET>" (Vercel Cron mengirimnya otomatis kalau env CRON_SECRET diisi).
import crypto from 'node:crypto';
import { loadSettings } from '@/lib/settings';
import { cronTick } from '@/lib/scheduler';
import { runWithUser } from '@/lib/context';
import { json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers.get('authorization') || '';
  const got = Buffer.from(h.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function GET(req) {
  if (!process.env.CRON_SECRET) return json({ error: 'CRON_SECRET belum diisi di Environment Variables' }, 503);
  if (!authorized(req)) return json({ error: 'Tidak diizinkan' }, 401);
  try {
    return await runWithUser(null, async () => {
      await loadSettings();
      return json({ ok: true, at: new Date().toISOString(), ...(await cronTick()) });
    }, req);
  } catch (e) {
    console.error('[cron]', e);
    return json({ ok: false, error: e.message }, 500);
  }
}
