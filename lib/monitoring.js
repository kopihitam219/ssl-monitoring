// Dashboard Monitoring & dashboard per group.
import { getSettings } from './settings.js';
import { listGroups, listFiles, getSources } from './db.js';
import { STATUS_KEYS } from './status.js';

const DAY = 86_400_000;

/** Kelompok hasil cek sertifikat. */
export function sslGroup(d) {
  if (!d.ssl_status && !d.last_checked) return 'pending';
  if (d.ssl_status === 'CHECK_FAILED' || !d.expires_at) return 'failed';
  if (d.days_remaining < 0) return 'expired';
  return 'ok';
}

export const isRenewed = (d, days) => {
  if (!d.valid_from || !d.expires_at) return false;
  return Date.now() - new Date(d.valid_from).getTime() <= days * DAY;
};

/** Status sertifikat untuk kartu dashboard. */
export function certStatus(d) {
  if (!d.ssl_status && !d.last_checked) return 'PENDING';
  return d.status || d.ssl_status || 'CHECK_FAILED';
}

const countBy = (rows) => {
  const c = Object.fromEntries([...STATUS_KEYS, 'PENDING'].map((k) => [k, 0]));
  for (const d of rows) c[d.status] = (c[d.status] || 0) + 1;
  return c;
};

/** Group yang tampil: semua group + "Tanpa group" kalau ada file tanpa group. */
export function dashboardGroups() {
  const groups = listGroups().map((g) => ({ id: g.id, key: `group:${g.id}`, name: g.name, files: g.files, domains: g.domains }));
  const loose = listFiles().filter((f) => !f.group_id);
  if (loose.length) groups.push({ id: 'none', key: 'group:none', name: 'Tanpa group', files: loose.length, domains: loose.reduce((a, f) => a + f.domains, 0) });
  return groups;
}

const inGroup = (g) => (d) => (g.id === 'none' ? !d.group_id : d.group_id === g.id);

/** Dashboard Monitoring: kartu 7 status + Renewal, satu panel per group. rows = buildSummary().rows */
export function buildMonitoring(rows) {
  const s = getSettings();
  const renewalDays = s.monitoring?.renewalDays ?? 30;
  const kpis = { ...countBy(rows), RENEWAL: rows.filter((d) => isRenewed(d, renewalDays)).length };
  const panels = dashboardGroups().map((g) => {
    const list = rows.filter(inGroup(g));
    return { key: g.key, groupId: g.id, label: g.name, files: g.files, total: list.length, counts: countBy(list),
      fallback: list.filter((d) => d.checked_via === 'fallback').length };
  });
  return { kpis, panels, renewalDays, total: rows.length, tiers: s.tiers };
}

/** Dashboard satu group. rows = buildSummary().rows untuk domain di group itu */
export function buildGroupDashboard(g, rows) {
  const s = getSettings();
  const files = listFiles().filter((f) => (g.id === 'none' ? !f.group_id : f.group_id === g.id));
  const expiring = rows.filter((d) => d.days_remaining != null && d.days_remaining <= s.tiers.needUpdate && d.expires_at)
    .sort((a, b) => a.days_remaining - b.days_remaining).slice(0, 8)
    .map((d) => ({ id: d.id, domain: d.domain, port: d.port, days: d.days_remaining, expires_at: d.expires_at, status: d.status }));
  const env = {};
  for (const d of rows) { const e = ['Production', 'Development', 'UAT', 'Staging'].includes(d.environment) ? d.environment : 'Others'; env[e] = (env[e] || 0) + 1; }
  const lastScan = rows.reduce((m, d) => (d.last_checked && (!m || d.last_checked > m) ? d.last_checked : m), null);
  const lastUpload = files.reduce((m, f) => (f.updated_at && (!m || f.updated_at > m.updated_at) ? f : m), null);
  const proxyModes = [...new Set(files.map((f) => f.proxy_mode))];
  const scan = getSources().scan;
  return {
    group: { id: g.id, name: g.name },
    files: files.map((f) => ({ id: f.id, name: f.name, original_file: f.original_file, proxy_mode: f.proxy_mode, domains: f.domains, updated_at: f.updated_at })),
    total: rows.length, counts: countBy(rows),
    fallback: rows.filter((d) => d.checked_via === 'fallback').length,
    connTested: rows.filter((d) => d.conn_tested_at).length,
    expiring, environments: Object.entries(env).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    lastScan, lastUpload: lastUpload ? { at: lastUpload.updated_at, file: lastUpload.original_file || lastUpload.name } : null,
    proxy: proxyModes.length === 1 ? proxyModes[0] : proxyModes.length ? 'mixed' : null,
    lastScanJob: scan ? { at: scan.last_sync, ...scan.detail } : null,
    tiers: s.tiers,
  };
}
