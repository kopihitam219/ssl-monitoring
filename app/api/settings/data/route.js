// POST /api/settings/data
//   { action: "clear", confirm: "HAPUS" }     → kosongkan database domain (user, audit & pengaturan tetap)
import { isScanning } from '@/lib/jobs';
import { resetAll, dbStats } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { action, confirm } = await req.json().catch(() => ({}));
  if (action === 'storage') {
    const { storageStats } = await import('@/lib/backup');
    return json({ ok: true, storage: await storageStats() });
  }
  if (action === 'prune-preview') {
    const { pruneOld } = await import('@/lib/backup');
    return json({ ok: true, ...(await pruneOld({ dryRun: true })) });
  }
  if (await isScanning()) return json({ error: 'Scan sedang berjalan, tunggu sebentar' }, 409);
  if (action === 'prune') {
    const { pruneOld, storageStats } = await import('@/lib/backup');
    const r = await pruneOld();
    audit({ category: 'data', action: 'data.prune', target: 'Riwayat lama',
      summary: r.total ? `Pangkas ${r.total} baris: ${r.hasil.map((x) => `${x.label} ${x.baris}`).join(' · ')}` : 'Pangkas riwayat lama: tidak ada yang melewati batas retensi',
      details: { hasil: r.hasil } });
    return json({ ok: true, ...r, storage: await storageStats() });
  }
  if (action === 'clear') {
    if (confirm !== 'HAPUS') return json({ error: 'Ketik HAPUS untuk konfirmasi' }, 400);
    const before = await dbStats();
    await resetAll();
    audit({ category: 'data', action: 'data.clear', target: 'Database domain',
      summary: `Kosongkan data (${before.domains} domain, ${before.checks} riwayat cek dihapus)`, details: { before } });
    return json({ ok: true, db: await dbStats() });
  }
  return json({ error: 'Aksi tidak dikenal' }, 400);
}, { access: 'admin' });
