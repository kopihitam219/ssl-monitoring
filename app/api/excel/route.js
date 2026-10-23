// Source of Truth manual:
//   POST   /api/excel           → tambah satu domain (langsung dicek SSL-nya)
//   DELETE /api/excel {ids:[]}  → hapus beberapa domain dari Source of Truth
import { addDomainManual, removeDomainsManual } from '@/lib/jobs';
import { audit, diff } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

const FIELDS = ['domain', 'port', 'environment', 'application', 'owner', 'notes'];

export const POST = handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await addDomainManual(body);
    audit({ category: 'domain', action: 'domain.add', target: `${r.domain}:${r.port}`,
      summary: `Tambah domain ${r.domain}${r.port !== 443 ? `:${r.port}` : ''} (status awal: ${r.status})`,
      changes: diff({}, { ...body, domain: r.domain, port: r.port }, FIELDS) });
    return json(r, 201);
  } catch (e) {
    audit({ category: 'domain', action: 'domain.add', target: String(body.domain || ''), ok: false, summary: `Gagal tambah domain: ${e.message}` });
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });

export const DELETE = handle(async (req) => {
  const { ids } = await req.json().catch(() => ({}));
  try {
    const r = removeDomainsManual(ids);
    audit({ category: 'domain', action: 'domain.delete', target: r.domains.slice(0, 5).join(', ') + (r.removed > 5 ? ` +${r.removed - 5}` : ''),
      summary: `Hapus ${r.removed} domain dari Source of Truth`, details: { domains: r.domains } });
    return json(r);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });
