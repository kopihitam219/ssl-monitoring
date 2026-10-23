// DELETE /api/domains/deleted/:id → kembalikan domain yang dihapus ke Source of Truth
import { restoreDomain, addActivity } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const d = restoreDomain(Number(id));
  addActivity('upload', 'Domain dikembalikan', `${d.domain}${d.port !== 443 ? `:${d.port}` : ''}`);
  audit({ category: 'domain', action: 'domain.restore', target: d.domain, summary: `Kembalikan domain ${d.domain} ke Source of Truth` });
  return json({ ok: true });
}, { access: 'manage_domains' });
