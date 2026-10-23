// POST /api/entra/test → tes koneksi ke Entra ID (token aplikasi + baca grup)
import { testConnection } from '@/lib/entra';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async () => {
  try {
    const r = await testConnection();
    const g = Object.entries(r.groups).map(([k, v]) => `${k}: ${v.name} (${v.members} anggota)`).join(', ');
    audit({ category: 'auth', action: 'entra.test', target: 'Microsoft 365', summary: `Tes koneksi Entra ID berhasil · ${g}` });
    return json(r);
  } catch (e) {
    audit({ category: 'auth', action: 'entra.test', target: 'Microsoft 365', ok: false, summary: `Tes koneksi Entra ID gagal: ${e.message}` });
    return json({ error: e.message }, 400);
  }
}, { access: 'admin' });
