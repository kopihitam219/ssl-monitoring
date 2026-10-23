// POST /api/tools/conntest {host, port} → tes koneksi satu host (DNS, Ping, Telnet, Curl; langsung & lewat proxy)
// POST /api/tools/conntest {id}         → tes koneksi satu domain di inventory (hasil disimpan ke domain)
import { testConnection } from '@/lib/conntest';
import { getDomain, saveConnTest } from '@/lib/db';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const d = body.id ? getDomain(Number(body.id)) : null;
  if (body.id && !d) return json({ error: 'Domain tidak ditemukan' }, 404);
  try {
    const r = await testConnection(d ? d.domain : body.host, d ? d.port : body.port);
    if (d) saveConnTest(d.id, r);
    audit({ category: 'job', action: 'tools.conntest', target: `${r.host}:${r.port}`, summary: `Tes koneksi ${r.host}:${r.port}: ${r.conclusion.text}` });
    return json(r);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}, { access: 'sync' });
