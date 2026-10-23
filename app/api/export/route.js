import * as XLSX from 'xlsx';
import { filterDomains } from '@/lib/filter';
import { audit } from '@/lib/audit';
import { handle } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const rows = filterDomains(req.nextUrl.searchParams).map((d) => ({
    Domain: d.domain,
    File: d.file_name || '',
    Port: d.port,
    Environment: d.environment || '',
    Application: d.application || '',
    Owner: d.owner || '',
    Status: d.status,
    'Sisa Hari': d.days_remaining ?? '',
    'Tanggal Expired': d.expires_at ? new Date(d.expires_at).toLocaleDateString('en-CA') : '',
    Issuer: d.issuer || '',
    Error: d.last_error || '',
    'Cek lewat': d.checked_via === 'fallback' ? 'Proxy (otomatis, gagal langsung)' : d.checked_via === 'proxy' ? 'Proxy' : d.checked_via === 'direct' ? 'Langsung' : '',
    'Terakhir Dicek': d.last_checked || '',
  }));
  const f = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v));
  audit({ category: 'export', action: 'export.inventory', target: 'SSL Inventory',
    summary: `Export SSL Inventory (${rows.length} domain)${Object.keys(f).length ? ` · filter: ${Object.entries(f).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}` });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'SSL Inventory');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const name = `ssl_inventory_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}, { access: 'export' });
