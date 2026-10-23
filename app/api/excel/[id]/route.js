// PUT /api/excel/:id → ubah domain (domain dari sumber mana pun: Environment, Application, Owner, Notes).
// DELETE /api/excel/:id → hapus domain: tidak dipantau lagi (bisa dikembalikan dari Settings → Domain yang dihapus).
import { updateDomainManual, removeDomainsManual } from '@/lib/jobs';
import { getDomain } from '@/lib/db';
import { audit, diff } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

const FIELDS = ['domain', 'port', 'environment', 'application', 'owner', 'notes'];

export const PUT = handle(async (req, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const before = await getDomain(Number(id));
  try {
    const r = await updateDomainManual(Number(id), body);
    const after = await getDomain(Number(id));
    const changes = diff(before, after, FIELDS);
    audit({ category: 'domain', action: 'domain.update', target: `${after.domain}:${after.port}`,
      summary: changes.length ? `Ubah domain ${after.domain}: ${changes.map((c) => c.field).join(', ')}` : `Simpan domain ${after.domain} (tanpa perubahan)`,
      changes });
    return json(r);
  } catch (e) {
    audit({ category: 'domain', action: 'domain.update', target: before?.domain, ok: false, summary: `Gagal ubah domain: ${e.message}` });
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  try {
    const r = await removeDomainsManual([Number(id)]);
    audit({ category: 'domain', action: 'domain.delete', target: r.domains.join(', '), summary: `Hapus domain ${r.domains.join(', ')} (tidak dipantau lagi)` });
    return json(r);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });
