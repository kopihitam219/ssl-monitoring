// Cek ulang satu domain sekarang juga.
import { getDomain, saveCheckResult } from '@/lib/db';
import { checkDomain } from '@/lib/ssl-check';
import { classifySsl } from '@/lib/status';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';
import { shouldDelegate } from '@/lib/scanner';
import { runJob } from '@/lib/runner';

export const dynamic = 'force-dynamic';

export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  const d = await getDomain(Number(id));
  if (!d) return json({ error: 'Domain tidak ditemukan' }, 404);
  if (shouldDelegate()) {
    const q = await runJob('check_ids', { trigger: 'manual', ids: [d.id] });
    audit({ category: 'domain', action: 'domain.recheck', target: `${d.domain}:${d.port}`, summary: `Cek ulang ${d.domain} dikirim ke scanner kantor` });
    return json({ queued: true, message: q.message });
  }
  const r = await checkDomain(d);
  const status = classifySsl(r);
  await saveCheckResult(d.id, r, status);
  audit({ category: 'domain', action: 'domain.recheck', target: `${d.domain}:${d.port}`, summary: `Cek ulang ${d.domain}${r.via === 'proxy' ? ' (lewat proxy)' : r.via === 'fallback' ? ' (gagal langsung, berhasil lewat proxy)' : ''}: ${status}` });
  return json({ status, result: r });
}, { access: 'sync' });
