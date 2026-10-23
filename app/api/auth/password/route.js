// POST /api/auth/password { current, next } → ganti password sendiri
import { changeOwnPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req, { user }) => {
  const { current, next } = await req.json().catch(() => ({}));
  try {
    changeOwnPassword(user.id, String(current || ''), String(next || ''));
    audit({ category: 'auth', action: 'user.password', target: user.username, summary: 'Ganti password sendiri' });
    return json({ ok: true });
  } catch (e) {
    audit({ category: 'auth', action: 'user.password', target: user.username, ok: false, summary: `Ganti password gagal: ${e.message}` });
    return json({ error: e.message }, 400);
  }
});
