// GET /api/audit/export?… (filter sama dengan /api/audit) → file Excel
import * as XLSX from 'xlsx';
import { allAudit, audit, auditFilter } from '@/lib/audit';
import { handle } from '@/lib/api';
import { fmtDateTime, isoDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const filter = auditFilter(req.nextUrl.searchParams);
  const rows = (await allAudit(filter)).map((r) => ({
    Waktu: fmtDateTime(r.at),
    Pengguna: r.actor,
    'Alamat IP': r.ip || '',
    Sumber: r.source,
    Kategori: r.category,
    Aksi: r.action,
    Target: r.target || '',
    Ringkasan: r.summary,
    Hasil: r.ok ? 'Berhasil' : 'Gagal',
    Perubahan: (r.details?.changes || []).map((c) => `${c.field}: ${c.from} → ${c.to}`).join('\n'),
  }));
  const used = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ');
  audit({ category: 'export', action: 'export.audit', target: 'Audit log', summary: `Export audit log (${rows.length} baris)${used ? ` · filter: ${used}` : ''}` });
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 6 }, { wch: 10 }, { wch: 20 }, { wch: 28 }, { wch: 60 }, { wch: 9 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Audit Log');
  return new Response(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="audit_log_${isoDate()}.xlsx"`,
    },
  });
}, { access: 'audit' });
