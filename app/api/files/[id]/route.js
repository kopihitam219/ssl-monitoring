// PATCH  /api/files/:id {name?, proxy_mode?, group_id?} → ganti nama / pilihan proxy file
// DELETE /api/files/:id                       → hapus file beserta semua domain & riwayat scan-nya
import { updateFile, deleteFile, addActivity, getGroup } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

const PROXY_LABEL = { direct: 'Tanpa proxy (otomatis coba proxy kalau gagal)', proxy: 'Dengan proxy' };
const groupName = async (id) => (id ? (await getGroup(id))?.name || `#${id}` : 'Tanpa group');

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const { before, after } = await updateFile(Number(id), { name: body.name, proxyMode: body.proxy_mode, groupId: body.group_id });
    const changes = [];
    if (before.name !== after.name) changes.push({ field: 'name', label: 'Nama file', before: before.name, after: after.name });
    if ((before.group_id || null) !== (after.group_id || null)) changes.push({ field: 'group', label: 'Group', before: await groupName(before.group_id), after: await groupName(after.group_id) });
    if (before.proxy_mode !== after.proxy_mode) changes.push({ field: 'proxy_mode', label: 'Proxy', before: PROXY_LABEL[before.proxy_mode], after: PROXY_LABEL[after.proxy_mode] });
    if (changes.length) {
      audit({ category: 'upload', action: 'file.update', target: after.name, summary: `Ubah file Source of Truth "${after.name}": ${changes.map((c) => c.label).join(', ')}`, changes });
      await addActivity('upload', 'File Source of Truth diubah', `${after.name} · ${changes.map((c) => `${c.label}: ${c.after}`).join(' · ')}`);
    }
    return json({ file: after });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  try {
    const r = await deleteFile(Number(id));
    await addActivity('mismatch', 'File Source of Truth dihapus', `${r.file.name} (${r.domains} domain)`);
    audit({ category: 'upload', action: 'file.delete', target: r.file.name, summary: `Hapus file Source of Truth "${r.file.name}" beserta ${r.domains} domain` });
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });
