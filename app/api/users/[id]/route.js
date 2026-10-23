// PUT    /api/users/:id { name?, role?, active?, password?, mustChange? } → ubah user / reset password (admin)
// DELETE /api/users/:id → hapus user (admin)
import { updateUser, setPassword, deleteUser, getUser, logoutAll } from '@/lib/auth';
import { audit, diff } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PUT = handle(async (req, { params, user }) => {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  const target = getUser(id);
  try {
    if (body.password) {
      setPassword(id, String(body.password), { mustChange: body.mustChange !== false });
      logoutAll(id);
      audit({ category: 'auth', action: 'user.reset-password', target: target?.username,
        summary: `Reset password user ${target?.username}${body.mustChange !== false ? ' (wajib ganti saat login)' : ''}` });
    }
    const fields = ['name', 'role', 'active'].filter((k) => body[k] !== undefined);
    if (fields.length) {
      const { before, after } = updateUser(id, body, user.id);
      const changes = diff(before, after, ['name', 'role', 'active']);
      if (changes.length) {
        audit({ category: 'auth', action: 'user.update', target: after.username,
          summary: `Ubah user ${after.username}: ${changes.map((c) => c.field).join(', ')}`, changes });
      }
    }
    return json({ user: getUser(id) });
  } catch (e) {
    audit({ category: 'auth', action: 'user.update', target: target?.username, ok: false, summary: `Gagal ubah user: ${e.message}` });
    return json({ error: e.message }, 400);
  }
}, { access: 'admin' });

export const DELETE = handle(async (_req, { params, user }) => {
  const id = Number((await params).id);
  try {
    const u = deleteUser(id, user.id);
    audit({ category: 'auth', action: 'user.delete', target: u.username, summary: `Hapus user ${u.username} (${u.role})` });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'admin' });
