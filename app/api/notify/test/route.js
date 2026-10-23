// POST /api/notify/test {channel} → kirim pesan tes ke satu saluran notifikasi (pengaturan yang sudah disimpan)
import { sendTest } from '@/lib/notify';
import { CHANNELS } from '@/lib/settings';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { channel } = await req.json().catch(() => ({}));
  if (!CHANNELS[channel]) return json({ error: 'Saluran tidak dikenal' }, 400);
  try {
    await sendTest(channel);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'admin' });
