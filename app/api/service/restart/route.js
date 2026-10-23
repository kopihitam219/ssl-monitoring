// POST /api/service/restart  { full: true|false }
//   full=false → restart ringan (database, pengaturan, scheduler, scan macet)
//   full=true  → proses server dimatikan lalu dinyalakan ulang otomatis (kalau didukung)
import { softRestart, scheduleFullRestart, fullRestartMode } from '@/lib/service';
import { addActivity } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { full = false } = await req.json().catch(() => ({}));
  let soft;
  try {
    soft = softRestart();
  } catch (e) {
    audit({ category: 'service', action: full ? 'service.restart-full' : 'service.restart', ok: false, summary: `Restart gagal: ${e.message}` });
    return json({ error: e.message }, 409);
  }
  if (full) {
    if (!fullRestartMode()) {
      return json({ ok: true, full: false, soft,
        message: 'Restart ringan selesai. Restart penuh hanya tersedia kalau aplikasi dijalankan dengan "npm run dev" atau "npm start".' });
    }
    addActivity('sync', 'Service di-restart', 'Restart penuh dari menu Jobs');
    audit({ category: 'service', action: 'service.restart-full', target: 'Service', summary: 'Restart service (penuh)' });
    scheduleFullRestart();
    return json({ ok: true, full: true, message: 'Service sedang di-restart…' });
  }
  addActivity('sync', 'Service di-restart', `Restart ringan${soft.resetStuckScan ? ' (scan macet direset)' : ''}`);
  audit({ category: 'service', action: 'service.restart', target: 'Service', summary: `Restart ringan${soft.resetStuckScan ? ' (scan macet direset)' : ''}` });
  return json({ ok: true, full: false, soft, message: 'Restart ringan selesai.' });
}, { access: 'admin' });
