// SOAR → aplikasi
//   POST /api/soar/domains  → kirim domain (masuk file Source of Truth SOAR, langsung dicek, hasil dibalas)
//   GET  /api/soar/domains  → status sertifikat (?domain=a.com,b.com &status=URGENT,CHECK_FAILED &group=Public &file=SOAR)
import { ingestDomains, queryDomains, soarAudit } from '@/lib/soar-in';
import { soarHandler, readBody, reply } from '@/lib/soar-in-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = soarHandler(async (req, { ip }) => {
  const q = req.nextUrl.searchParams;
  const scan = q.has('scan') ? !['0', 'false', 'no'].includes(q.get('scan')) : undefined;
  const r = await ingestDomains(await readBody(req), { scan });
  soarAudit({ action: 'soar.in.domains', target: r.file, ip, ok: !r.invalid.length,
    summary: `SOAR mengirim ${r.received} domain → ${r.file}: ${r.added} ditambahkan · ${r.updated} diperbarui · ${r.removed} dihapus${r.denied ? ` · ${r.denied} ditolak` : ''}${r.invalid.length ? ` · ${r.invalid.length} tidak valid` : ''}${r.scanned ? ` · ${r.scanned} dicek` : ''}`,
    details: r.invalid.length ? { invalid: r.invalid.slice(0, 50) } : undefined });
  return reply({ ok: true, ...r });
});

export const GET = soarHandler(async (req, { ip }) => {
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const r = queryDomains(q);
  soarAudit({ action: 'soar.in.query', target: q.domain || q.status || q.group || 'semua domain', ip, summary: `SOAR menanyakan status sertifikat: ${r.total} domain` });
  return reply({ ok: true, ...r });
});
