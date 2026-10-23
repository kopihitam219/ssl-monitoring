// POST /services/collector/event → kompatibel Splunk HEC, untuk flow SOAR lama yang masih mengirim ke format Splunk.
// Sama dengan POST /api/soar/domains. Auth: "Authorization: Splunk <API key>".
import { ingestDomains, soarAudit } from '@/lib/soar-in';
import { soarHandler, readBody, reply } from '@/lib/soar-in-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // batas Vercel (paket Hobby); scan panjang dilanjutkan otomatis

export const POST = soarHandler(async (req, { ip }) => {
  const r = await ingestDomains(await readBody(req));
  soarAudit({ action: 'soar.in.domains', target: r.file, ip, ok: !r.invalid.length,
    summary: `SOAR (format Splunk HEC) mengirim ${r.received} domain → ${r.file}: ${r.added} ditambahkan · ${r.updated} diperbarui · ${r.removed} dihapus${r.invalid.length ? ` · ${r.invalid.length} tidak valid` : ''}` });
  return reply({ text: 'Success', code: 0 });
}, { hec: true });
