// GET /api/users → daftar user.  POST /api/users { username, name, role, password, mustChange } → tambah user (admin)
import { listUsers, createUser, PERMISSIONS } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({
  users: await listUsers(),
  permissions: PERMISSIONS,
  monitoringPermissions: getSettings().roles?.monitoring || [],
}), { access: 'admin' });

export const POST = handle(async (req, { user }) => {
  const body = await req.json().catch(() => ({}));
  try {
    const u = await createUser(body, user.username);
    audit({ category: 'auth', action: 'user.add', target: u.username,
      summary: `Tambah user ${u.username} (${u.role})`,
      changes: [
        { field: 'username', from: '—', to: u.username },
        { field: 'name', from: '—', to: u.name || '—' },
        { field: 'role', from: '—', to: u.role },
        { field: 'mustChange', from: '—', to: u.mustChange ? 'Ya' : 'Tidak' },
      ] });
    return json({ user: u }, 201);
  } catch (e) {
    audit({ category: 'auth', action: 'user.add', target: String(body.username || ''), ok: false, summary: `Gagal tambah user: ${e.message}` });
    return json({ error: e.message }, 400);
  }
}, { access: 'admin' });
