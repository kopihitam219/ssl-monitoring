// GET /api/excel/export?file=<id> → download isi terbaru satu file Source of Truth (termasuk tambah/ubah/hapus
// dari aplikasi) dalam format template, dengan nama file aslinya. File bisa diupload ulang kapan saja.
import * as XLSX from 'xlsx';
import { getExcelDomains, getFile } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const f = await getFile(Number(req.nextUrl.searchParams.get('file')));
  if (!f) return json({ error: 'File tidak ditemukan' }, 404);
  const rows = (await getExcelDomains(f.id)).map((d) => [d.domain, d.environment || '', d.application || '', d.owner || '', d.port, d.notes || '']);
  const sheet = XLSX.utils.aoa_to_sheet([['Domain', 'Environment', 'Application', 'Owner', 'Port', 'Notes'], ...rows]);
  sheet['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 6 }, { wch: 34 }];
  audit({ category: 'export', action: 'export.excel', target: f.name, summary: `Download Excel "${f.name}" terbaru (${rows.length} domain)` });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Domains');
  const name = `${f.name.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`;
  return new Response(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name).replace(/%20/g, ' ')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}, { access: 'export' });
