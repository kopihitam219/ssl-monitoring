// POST /api/wazuh/queue { action: 'flush' | 'clear' } → kirim antrean sekarang / kosongkan antrean
import { flushOnce, clearOutbox, wazuhStatus } from '@/lib/wazuh';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { action } = await req.json().catch(() => ({}));
  if (action === 'clear') {
    const n = await clearOutbox();
    audit({ category: 'settings', action: 'wazuh.clear', target: 'Antrean Wazuh', summary: `Antrean Wazuh dikosongkan (${n} event dibuang)` });
    return json({ ok: true, removed: n, status: await wazuhStatus() });
  }
  if (action === 'flush') {
    globalThis.__sslWazuh && (globalThis.__sslWazuh.nextAt = 0);
    const r = await flushOnce();
    return json({ ok: !r.error, ...r, status: await wazuhStatus() });
  }
  return json({ error: 'Aksi tidak dikenal' }, 400);
}, { access: 'admin' });
