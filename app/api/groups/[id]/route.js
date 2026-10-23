// PATCH  /api/groups/:id {name} → ganti nama group
// DELETE /api/groups/:id        → hapus group (file di dalamnya jadi "Tanpa group", tidak ikut terhapus)
import { renameGroup, deleteGroup, addActivity } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { name } = await req.json().catch(() => ({}));
  try {
    const { before, after } = renameGroup(Number(id), name);
    audit({ category: 'upload', action: 'group.update', target: after.name, summary: `Ganti nama group "${before.name}" → "${after.name}"`,
      changes: [{ field: 'name', label: 'Nama group', before: before.name, after: after.name }] });
    return json({ group: after });
  } catch (e) { return json({ error: e.message }, 400); }
}, { access: 'manage_domains' });

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  try {
    const r = deleteGroup(Number(id));
    addActivity('mismatch', 'Group dashboard dihapus', `${r.group.name} (${r.files} file jadi tanpa group)`);
    audit({ category: 'upload', action: 'group.delete', target: r.group.name, summary: `Hapus group dashboard "${r.group.name}" (${r.files} file jadi tanpa group)` });
    return json({ ok: true, ...r });
  } catch (e) { return json({ error: e.message }, 400); }
}, { access: 'manage_domains' });
