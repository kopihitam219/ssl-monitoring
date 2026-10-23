// Dipanggil sekali oleh scripts/server.js setelah server menyala (npm start), supaya scheduler / scanner kantor
// langsung berjalan tanpa menunggu dashboard dibuka. Hanya menerima panggilan dari proses server itu sendiri.
import { loadSettings } from '@/lib/settings';
import { initService } from '@/lib/service';
import { startScheduler } from '@/lib/scheduler';
import { runWithUser } from '@/lib/context';
import { json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const key = process.env.SSL_IP_KEY;
  if (!key || req.headers.get('x-ssl-boot') !== key) return json({ error: 'Tidak diizinkan' }, 403);
  return runWithUser(null, async () => {
    await loadSettings();
    await initService();
    startScheduler();
    return json({ ok: true });
  });
}
