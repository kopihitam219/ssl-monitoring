import { filterDomains, columnFacets } from '@/lib/filter';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

// ?facets=1 → ikut kirim daftar nilai tiap kolom (untuk filter di header tabel)
export const GET = handle(async (req) => {
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get('page') || 1));
  const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize') || 10)));
  const rows = filterDomains(params);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return json({ total: rows.length, page, pageSize, rows: pageRows, ...(params.get('facets') === '1' ? { facets: columnFacets(params) } : {}) });
});
