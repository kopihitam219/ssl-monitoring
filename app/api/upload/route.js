// Upload Excel Source of Truth.
// form-data: file, proxy_mode = "direct" (tanpa proxy, otomatis proxy kalau gagal) | "proxy" (dengan proxy), group_id (group dashboard),
//            file_id (opsional: upload ulang ke file tertentu)
// Nama file = nama sumber. Kalau nama file sudah ada, isinya diganti dengan isi file baru.
import { importExcel, isScanning } from '@/lib/jobs';
import { runJob } from '@/lib/runner';
import { audit } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  const proxyMode = ['direct', 'proxy'].includes(form.get('proxy_mode')) ? form.get('proxy_mode') : undefined;
  const fileId = form.get('file_id') || undefined;
  const groupId = Number(form.get('group_id')) || undefined;
  if (!file || typeof file === 'string') return json({ error: 'File tidak ditemukan' }, 400);
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return json({ error: 'Format harus .xlsx, .xls, atau .csv' }, 400);
  try {
    const res = importExcel(Buffer.from(await file.arrayBuffer()), file.name, { proxyMode, fileId, groupId });
    audit({ category: 'upload', action: res.created ? 'upload.new' : 'upload.replace', target: res.file.name,
      summary: `Upload Excel ${res.created ? 'file baru' : '(ganti isi)'} "${res.file.name}": ${res.total} domain, ${res.added} baru, ${res.removed} dihapus · ${res.file.proxy_mode === 'proxy' ? 'dengan proxy' : 'tanpa proxy'}`,
      details: { file: file.name, size: file.size, proxyMode: res.file.proxy_mode, groupId: res.file.group_id, total: res.total, added: res.added, updated: res.updated, removed: res.removed, skippedRows: res.skipped } });
    // domain hasil upload langsung dicek di belakang layar (tanpa menunggu Sync Now / jadwal)
    const autoScan = !isScanning();
    if (autoScan) runJob('scan', { trigger: 'manual' }).catch((e) => console.error('[upload] scan otomatis gagal:', e.message));
    return json({ ...res, autoScan });
  } catch (e) {
    audit({ category: 'upload', action: 'upload.replace', target: file.name, ok: false, summary: `Upload Excel gagal: ${e.message}` });
    return json({ error: e.message }, 400);
  }
}, { access: 'manage_domains' });
