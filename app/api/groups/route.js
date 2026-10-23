// GET  /api/groups          → daftar group dashboard (+ jumlah file & domain)
// POST /api/groups {name}   → tambah group
import { listGroups, createGroup, addActivity } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({ groups: listGroups() }));

export const POST = handle(async (req) => {
  const { name } = await req.json().catch(() => ({}));
  try {
    const g = createGroup(name);
    addActivity('upload', 'Group dashboard ditambahkan', g.name);
    audit({ category: 'upload', action: 'group.create', target: g.name, summary: `Tambah group dashboard "${g.name}"` });
    return json({ group: g }, 201);
  } catch (e) { return json({ error: e.message }, 400); }
}, { access: 'manage_domains' });
