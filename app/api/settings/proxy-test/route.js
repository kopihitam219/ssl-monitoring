// POST /api/settings/proxy-test { url?, username?, password?, domain? } → coba cek sertifikat lewat proxy.
// Field yang kosong memakai nilai yang sudah tersimpan (password tidak pernah dikirim balik ke browser).
import { getSettings } from '@/lib/settings';
import { checkCertificate } from '@/lib/ssl-check';
import { normalizeDomain } from '@/lib/excel';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  const saved = getSettings().scanProxy;
  const url = String(b.url ?? saved.url ?? '').trim();
  if (!/^https?:\/\/[^\s/:]+(:\d+)?\/?$/.test(url)) return json({ error: 'Isi alamat proxy dulu, contoh: http://proxy.kantor:8080' }, 400);
  const target = normalizeDomain(b.domain || 'www.google.com', 443);
  if (!target) return json({ error: 'Domain uji tidak valid' }, 400);
  const proxy = {
    url,
    username: b.username !== undefined && b.username !== '' ? String(b.username) : saved.username,
    password: b.password ? String(b.password) : saved.password,
  };
  const r = await checkCertificate(target.domain, target.port, getSettings().scanTimeoutMs, { proxy });
  audit({ category: 'settings', action: 'settings.proxy-test', target: url, ok: !r.error, summary: `Tes proxy ${url} → ${target.domain}: ${r.error || `OK, sertifikat s/d ${r.validTo?.slice(0, 10)}`}` });
  return json({ ok: !r.error, domain: target.domain, port: target.port, error: r.error || null, validTo: r.validTo || null, issuer: r.issuer || null, durationMs: r.durationMs });
}, { access: 'admin' });
