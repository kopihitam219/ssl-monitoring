// Download template Excel kosong untuk Source of Truth.
import * as XLSX from 'xlsx';
import { handle } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Domain', 'Environment', 'Application', 'Owner', 'Port', 'Notes'],
    ['app.perusahaan.co.id', 'Production', 'Portal', 'IT Team', 443, ''],
  ]);
  sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 6 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Domains');
  return new Response(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="template_source_of_truth.xlsx"',
    },
  });
}, { access: 'export' });
