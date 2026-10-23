// GET  /api/files                          → daftar file Source of Truth (nama, jumlah domain, pilihan proxy)
// POST /api/files {name, proxy_mode}      → buat file kosong (lalu isi lewat "Tambah domain")
import { listFiles, createFile, addActivity, listGroups } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({ files: await listFiles(), groups: await listGroups(), proxyConfigured: !!getSettings().scanProxy.url }));

export const POST = handle(async (req) => {
  const { name, proxy_mode: proxyMode = 'direct', group_id: groupId } = await req.json().catch(() => ({}));
  try {
    const f = await createFile({ name, proxyMode, groupId: Number(groupId) || null });
    await addActivity('upload', 'File Source of Truth dibuat', f.name);
    audit({ category: 'upload', action: 'file.create', target: f.name, summary: `Buat file Source of Truth "${f.name}" (${f.proxy_mode === 'proxy' ? 'dengan proxy' : 'tanpa proxy'})` });
    return json({ file: f }, 201);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });
