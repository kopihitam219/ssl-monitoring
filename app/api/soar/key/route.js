// POST /api/soar/key → buat API key baru untuk SOAR → aplikasi (key lama langsung tidak berlaku). Hanya admin.
import { generateKey } from '@/lib/soar-in';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async () => {
  const key = await generateKey();
  audit({ category: 'settings', action: 'soar.token', target: 'SOAR → aplikasi', summary: 'API key SOAR → aplikasi dibuat ulang (key lama tidak berlaku)' });
  return json({ key });
}, { access: 'admin' });
