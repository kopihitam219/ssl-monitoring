// POST /api/settings/data
//   { action: "clear", confirm: "HAPUS" }     → kosongkan database domain (user, audit & pengaturan tetap)
import { isScanning } from '@/lib/jobs';
import { resetAll, dbStats } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { action, confirm } = await req.json().catch(() => ({}));
  if (isScanning()) return json({ error: 'Scan sedang berjalan, tunggu sebentar' }, 409);
  if (action === 'clear') {
    if (confirm !== 'HAPUS') return json({ error: 'Ketik HAPUS untuk konfirmasi' }, 400);
    const before = dbStats();
    resetAll();
    audit({ category: 'data', action: 'data.clear', target: 'Database domain',
      summary: `Kosongkan data (${before.domains} domain, ${before.checks} riwayat cek dihapus)`, details: { before } });
    return json({ ok: true, db: dbStats() });
  }
  return json({ error: 'Aksi tidak dikenal' }, 400);
}, { access: 'admin' });
