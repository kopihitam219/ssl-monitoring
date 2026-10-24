// GET /api/backup → seluruh isi database sebagai satu berkas JSON untuk diunduh.
// Dipakai sebelum memangkas riwayat lama, supaya tidak ada data yang hilang.
import { exportAll, namaBerkasBackup } from '@/lib/backup';
import { audit } from '@/lib/audit';
import { handle } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = handle(async () => {
  const isi = await exportAll();
  const total = Object.values(isi.jumlah).reduce((a, b) => a + b, 0);
  const teks = JSON.stringify(isi, null, 2);
  audit({
    category: 'data', action: 'data.backup', target: 'Backup database',
    summary: `Unduh backup: ${total} baris dari ${Object.keys(isi.jumlah).length} tabel (${Math.round(teks.length / 1024)} KB)`,
    details: { jumlah: isi.jumlah },
  });
  return new Response(teks, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${namaBerkasBackup()}"`,
      'Cache-Control': 'no-store',
    },
  });
}, { access: 'admin' });
