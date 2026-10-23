// Tombol "Sync Now": scan SSL semua domain, tercatat di riwayat Jobs.
import { isScanning } from '@/lib/jobs';
import { runJob } from '@/lib/runner';
import { handle, json } from '@/lib/api';
import { shouldDelegate } from '@/lib/scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // batas Vercel (paket Hobby); scan panjang dilanjutkan otomatis

export const POST = handle(async () => {
  if (!shouldDelegate() && await isScanning()) return json({ error: 'Scan sedang berjalan, tunggu sebentar' }, 409);
  const r = await runJob('scan', { trigger: 'manual' });
  return json({ scan: r.result, message: r.message, queued: !!r.queued });
}, { access: 'sync' });
