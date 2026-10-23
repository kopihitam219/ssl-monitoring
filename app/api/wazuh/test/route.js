// POST /api/wazuh/test { url?, username?, password?, apiKey?, authMode?, transport?, verifyTls?, filePath? }
// Tes koneksi ke Wazuh dengan nilai di form (field rahasia kosong = pakai yang tersimpan), kirim 1 event tes.
import { testWazuh } from '@/lib/wazuh';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  const o = {};
  for (const k of ['url', 'username', 'authMode', 'transport', 'filePath']) if (typeof b[k] === 'string') o[k] = b[k].trim().replace(/\/+$/, '');
  if (typeof b.verifyTls === 'boolean') o.verifyTls = b.verifyTls;
  if (b.password) o.password = String(b.password);
  if (b.apiKey) o.apiKey = String(b.apiKey).trim();
  if (o.url && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(o.url)) return json({ error: 'URL Wazuh harus seperti https://wazuh-manager:55000' }, 400);
  if (o.filePath && !/\.(json|log|txt)$/i.test(o.filePath)) return json({ error: 'File log harus berakhiran .json, .log, atau .txt' }, 400);
  try {
    const r = await testWazuh(o);
    audit({ category: 'settings', action: 'wazuh.test', target: o.url || 'Wazuh', summary: `Tes koneksi Wazuh berhasil: ${Object.values(r).join(' · ')}` });
    return json({ ok: true, ...r });
  } catch (e) {
    audit({ category: 'settings', action: 'wazuh.test', target: o.url || 'Wazuh', ok: false, summary: `Tes koneksi Wazuh gagal: ${e.message}` });
    return json({ ok: false, error: e.message });
  }
}, { access: 'admin' });
