// GET  /api/settings → pengaturan + info database mode aktif
// PUT  /api/settings → simpan sebagian pengaturan
import { getSettings, saveSettings, publicSettings, CHANNELS } from '@/lib/settings';
import { dbStats, addActivity } from '@/lib/db';
import { startScheduler } from '@/lib/scheduler';
import { audit, diff } from '@/lib/audit';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

const view = () => ({ settings: publicSettings(), db: dbStats() });

export const GET = handle(async () => json(view()), { access: 'admin' });

export const PUT = handle(async (req) => {
  const patch = await req.json().catch(() => ({}));
  const before = getSettings();
  let after;
  try {
    after = saveSettings(patch);
  } catch (e) {
    audit({ category: 'settings', action: 'settings.update', ok: false, summary: `Gagal menyimpan pengaturan: ${e.message}` });
    return json({ error: e.message }, 400);
  }

  const GROUPS = [
    ['Aturan status & scan', ['tiers.urgent', 'tiers.reminder', 'tiers.needUpdate', 'tiers.warning', 'tiers.info', 'scanIntervalHours', 'scanConcurrency', 'scanTimeoutMs']],
    ['Hak akses Monitoring', ['roles.monitoring']],
    ['Dashboard Monitoring', ['monitoring.renewalDays']],
    ['Proxy cek SSL', ['scanProxy.url', 'scanProxy.username', 'scanProxy.password']],
    ['Microsoft Entra ID', ['entra.enabled', 'entra.tenantId', 'entra.clientId', 'entra.clientSecret', 'entra.adminGroupId', 'entra.monitoringGroupId', 'entra.autoSync', 'entra.redirectUri']],
    ['Wazuh', ['wazuh.enabled', 'wazuh.transport', 'wazuh.url', 'wazuh.authMode', 'wazuh.username', 'wazuh.password', 'wazuh.apiKey', 'wazuh.verifyTls', 'wazuh.filePath', 'wazuh.sendApp', 'wazuh.sendSecurity', 'wazuh.sendSsl', 'wazuh.sslStatuses', 'wazuh.sslRepeatHours']],
    ['SOAR → aplikasi', ['soarIn.enabled', 'soarIn.fileName', 'soarIn.groupId', 'soarIn.proxyMode', 'soarIn.scanOnReceive', 'soarIn.allowRemove', 'soarIn.allowCommands']],
    ['Notifikasi', ['notify.alertStatuses', 'notify.alertRepeatHours', 'notify.reportAllOk', 'notify.systemRepeatHours']],
    ...Object.entries(CHANNELS).map(([c, meta]) => [`Notifikasi ${meta.label}`, Object.keys(after.notify[c]).map((k) => `notify.${c}.${k}`)]),
  ];
  for (const [label, fields] of GROUPS) {
    const changes = diff(before, after, fields);
    if (!changes.length) continue;
    audit({ category: 'settings', action: 'settings.update', target: label, summary: `Ubah pengaturan ${label}`, changes });
  }

  for (const [c, meta] of Object.entries(CHANNELS)) {
    if (before.notify[c].enabled !== after.notify[c].enabled) addActivity('sync', `Notifikasi ${meta.label} ${after.notify[c].enabled ? 'diaktifkan' : 'dimatikan'}`, null);
  }
  if (before.wazuh.enabled !== after.wazuh.enabled) addActivity('sync', `Kirim log ke Wazuh ${after.wazuh.enabled ? 'diaktifkan' : 'dimatikan'}`, null);
  if (after.wazuh.enabled) { const { ensureTimer } = await import('@/lib/wazuh'); ensureTimer(); }
  if (before.soarIn.enabled !== after.soarIn.enabled) addActivity('sync', `SOAR → aplikasi ${after.soarIn.enabled ? 'diaktifkan' : 'dimatikan'}`, null);
  if (before.entra.enabled !== after.entra.enabled) addActivity('sync', `Login Microsoft Entra ID ${after.entra.enabled ? 'diaktifkan' : 'dimatikan'}`, null);
  startScheduler(); // terapkan interval scan baru
  return json(view());
}, { access: 'admin' });
