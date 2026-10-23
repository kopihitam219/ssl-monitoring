'use client';
import { Fragment, useEffect, useState } from 'react';
import { Search, Download, ChevronLeft, ChevronRight, ChevronDown, CheckCircle2, XCircle, RotateCw, ShieldCheck } from 'lucide-react';
import { api, fmtDateTime } from './ui';

const CATEGORIES = {
  auth: 'Login & User',
  domain: 'Domain',
  upload: 'Upload Excel',
  settings: 'Pengaturan',
  data: 'Data',
  job: 'Job',
  teams: 'Teams',
  service: 'Service',
  export: 'Export',
  notify: 'Notifikasi',
  soar: 'SOAR',
};

const ACTIONS = {
  'auth.login': 'Login',
  'auth.login-microsoft': 'Login Microsoft',
  'entra.test': 'Tes Entra ID',
  'job.entra': 'Sync user Entra ID',
  'auth.logout': 'Logout',
  'auth.locked': 'Login terkunci',
  'user.setup': 'Admin pertama',
  'user.add': 'Tambah user',
  'user.update': 'Ubah user',
  'user.delete': 'Hapus user',
  'user.reset-password': 'Reset password',
  'user.password': 'Ganti password',
  'service.start': 'Service menyala',
  'data.migrate': 'Migrasi data',
  'domain.add': 'Tambah domain',
  'domain.update': 'Ubah domain',
  'domain.delete': 'Hapus domain',
  'domain.recheck': 'Cek ulang domain',
  'upload.replace': 'Upload (ganti semua)',
  'upload.merge': 'Upload (gabungkan)',
  'settings.mode': 'Pindah mode',
  'settings.update': 'Ubah pengaturan',
  'data.clear': 'Kosongkan data',
  'data.reset-demo': 'Isi ulang demo',
  'job.full': 'Sync + Scan',
  'job.scan': 'Scan SSL',
  'job.route53': 'Sync Route 53',
  'job.teams': 'Kirim ke Teams',
  'teams.test': 'Tes Teams',
  'service.restart': 'Restart ringan',
  'service.restart-full': 'Restart service',
  'export.inventory': 'Export inventory',
  'export.excel': 'Download Excel',
  'export.audit': 'Export audit log',
  'soar.ingest': 'Data dari SOAR',
  'soar.in.domains': 'Domain dari SOAR',
  'soar.in.query': 'SOAR cek status',
  'soar.in.command': 'Perintah dari SOAR',
  'wazuh.test': 'Tes Wazuh',
  'wazuh.error': 'Wazuh gagal',
  'wazuh.recovered': 'Wazuh pulih',
  'wazuh.clear': 'Antrean Wazuh dikosongkan',
  'soar.auth': 'SOAR ditolak',
  'soar.token': 'API key SOAR baru',
  'soar.unignore': 'Kembalikan domain SOAR',
  'domain.reset-manual': 'Kembalikan ke data SOAR',
  'settings.proxy-test': 'Tes proxy',
  'job.soar_all': 'Jalankan semua flow SOAR',
  'job.retry_failed': 'Retry Check Failed', 'job.conn_test': 'Tes koneksi', 'job.notify': 'Kirim notifikasi', 'tools.conntest': 'Tes koneksi manual',
  'notify.teams': 'Notifikasi Teams', 'notify.telegram': 'Notifikasi Telegram', 'notify.whatsapp': 'Notifikasi WhatsApp', 'notify.email': 'Notifikasi Email', 'notify.soar': 'Notifikasi SOAR',
  'file.create': 'Buat file', 'file.update': 'Ubah file', 'file.delete': 'Hapus file', 'group.create': 'Tambah group', 'group.update': 'Ubah group', 'group.delete': 'Hapus group', 'upload.new': 'Upload file baru', 'domain.restore': 'Kembalikan domain',
  'wazuh.test': 'Tes Wazuh',
  'wazuh.error': 'Wazuh gagal',
  'wazuh.recovered': 'Wazuh pulih',
  'wazuh.clear': 'Kosongkan antrean Wazuh',
  'splunk.test': 'Tes Splunk',
  'splunk.error': 'Splunk gagal',
  'splunk.recovered': 'Splunk pulih',
  'splunk.clear': 'Kosongkan antrean Splunk',
};

const FIELD = {
  domain: 'Domain', port: 'Port', environment: 'Environment', application: 'Application', owner: 'Owner', notes: 'Notes',
  mode: 'Mode', warningDays: 'Batas Warning (hari)', urgentDays: 'Batas Urgent (hari)', scanIntervalHours: 'Scan otomatis (jam)',
  scanConcurrency: 'Domain bersamaan', scanTimeoutMs: 'Timeout (ms)',
  'route53.mode': 'Route 53', 'route53.profile': 'AWS profile', 'route53.zones': 'Hosted zone', 'route53.includePrivate': 'Private zone',
  'teams.enabled': 'Teams aktif', 'teams.webhookUrl': 'Webhook URL', 'teams.autoAfterScan': 'Kirim otomatis', 'teams.includeWarning': 'Ikutkan Warning',
  'teams.sendWhenAllOk': 'Kirim walau aman', 'teams.sendInDemo': 'Kirim di Demo',
  'roles.monitoring': 'Izin Monitoring',
  'entra.enabled': 'Microsoft 365 aktif', 'entra.tenantId': 'Tenant ID', 'entra.clientId': 'Client ID', 'entra.clientSecret': 'Client secret',
  'entra.adminGroupId': 'Grup Admin', 'entra.monitoringGroupId': 'Grup Monitoring', 'entra.autoSync': 'Sync otomatis', 'entra.redirectUri': 'Redirect URI',
  'soar.enabled': 'SOAR aktif', 'soar.autoScanNew': 'Scan domain baru', 'soar.mapping': 'Pemetaan field', 'soar.retentionDays': 'Simpan log (hari)',
  'soar.r7ApiKey': 'API key Rapid7', 'soar.triggerIntervalHours': 'Jalankan flow otomatis (jam)', 'monitoring.renewalDays': 'Renewal (hari)',
  'soar.staleDays': 'Route 53 basi (hari)', 'soar.flows': 'Daftar flow', 'soar.defaultKind': 'Flow default',
  'wazuh.enabled': 'Wazuh aktif', 'wazuh.transport': 'Cara kirim Wazuh', 'wazuh.url': 'URL Wazuh', 'wazuh.authMode': 'Login Wazuh', 'wazuh.username': 'User API Wazuh',
  'wazuh.password': 'Password API Wazuh', 'wazuh.apiKey': 'API key Wazuh', 'wazuh.verifyTls': 'Verifikasi TLS Wazuh', 'wazuh.filePath': 'File log Wazuh',
  'wazuh.sendApp': 'Kirim log aplikasi', 'wazuh.sendSecurity': 'Kirim log keamanan', 'wazuh.sendSsl': 'Kirim temuan SSL', 'wazuh.sslMinStatus': 'Status SSL minimum',
  'wazuh.sslRepeatHours': 'Kirim ulang (jam)', 'wazuh.sslInDemo': 'Temuan SSL Demo',
  'scanProxy.url': 'Proxy', 'scanProxy.username': 'User proxy', 'scanProxy.password': 'Password proxy', via_proxy: 'Via proxy', username: 'Username', name: 'Nama', role: 'Peran', active: 'Aktif', mustChange: 'Wajib ganti password',
};

const TABS = [
  { key: 'app', label: 'Aplikasi', hint: 'Aksi pengguna: login, perubahan data, pengaturan, kelola user, export' },
  { key: 'system', label: 'Sistem', hint: 'Aksi otomatis: service menyala, scan terjadwal, kirim Teams otomatis, error' },
  { key: '', label: 'Semua', hint: 'Semua catatan' },
];

function Details({ d }) {
  if (!d) return <p className="muted small">Tidak ada detail tambahan.</p>;
  const { changes, ...rest } = d;
  return (
    <div className="audit-details">
      {changes?.length > 0 && (
        <table className="changes">
          <thead><tr><th>Field</th><th>Sebelum</th><th>Sesudah</th></tr></thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.field}>
                <td>{FIELD[c.field] || c.field}</td>
                <td className="from">{c.from}</td>
                <td className="to">{c.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.keys(rest).length > 0 && (
        <dl className="kv">
          {Object.entries(rest).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : '—') : typeof v === 'object' && v ? Object.entries(v).map(([a, b]) => `${a}: ${b}`).join(' · ') : String(v ?? '—')}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function AuditView() {
  const [f, setF] = useState({ type: 'app', q: '', category: '', mode: '', source: '', result: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const pageSize = 25;

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const params = new URLSearchParams(f);

  const load = () => {
    setLoading(true);
    return api(`/api/audit?${params}&page=${page}&pageSize=${pageSize}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const t = setTimeout(load, f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [page, f.type, f.q, f.category, f.mode, f.source, f.result, f.from, f.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const first = data.total ? (page - 1) * pageSize + 1 : 0;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const anyFilter = Object.entries(f).some(([k, v]) => k !== 'type' && v);

  return (
    <section className="panel">
      <div className="panel-head wrap">
        <div>
          <h2><ShieldCheck size={16} className="h-icon" /> Audit Log</h2>
          <p className="muted small">Catatan permanen semua perubahan dan aksi: siapa, kapan, apa, dan nilai sebelum/sesudah. Tidak terhapus saat data dikosongkan.</p>
        </div>
        <div className="toolbar">
          <button className="icon-btn" onClick={load} aria-label="Muat ulang" title="Muat ulang"><RotateCw size={15} className={loading ? 'spin' : ''} /></button>
          <a className="btn ghost" href={`/api/audit/export?${params}`}><Download size={15} /> Export</a>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key || 'all'} role="tab" aria-selected={f.type === t.key} className={f.type === t.key ? 'on' : ''}
            onClick={() => { setF({ ...f, type: t.key }); setPage(1); setOpen(new Set()); }}>
            {t.label}
          </button>
        ))}
        <span className="muted small tab-hint">{TABS.find((t) => t.key === f.type)?.hint}</span>
      </div>

      <div className="toolbar audit-filters">
        <label className="search">
          <Search size={15} />
          <input value={f.q} onChange={set('q')} placeholder="Cari domain, aksi, pengguna, IP…" aria-label="Cari" />
        </label>
        <select value={f.category} onChange={set('category')} aria-label="Kategori">
          <option value="">Semua kategori</option>
          {Object.entries(CATEGORIES).filter(([k]) => k !== 'soar').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.source} onChange={set('source')} aria-label="Sumber">
          <option value="">Semua sumber</option>
          <option value="UI">Dashboard</option>
          <option value="Scheduler">Otomatis</option>
          <option value="Terminal">Terminal</option>
          <option value="System">Sistem</option>
        </select>
        <select value={f.result} onChange={set('result')} aria-label="Hasil">
          <option value="">Semua hasil</option>
          <option value="ok">Berhasil</option>
          <option value="fail">Gagal</option>
        </select>
        <span className="date-range">
          <input type="date" value={f.from} max={f.to || undefined} onChange={set('from')} aria-label="Dari tanggal" />
          <span className="muted">–</span>
          <input type="date" value={f.to} min={f.from || undefined} onChange={set('to')} aria-label="Sampai tanggal" />
        </span>
        {anyFilter && <button className="link small" onClick={() => { setF({ type: f.type, q: '', category: '', mode: '', source: '', result: '', from: '', to: '' }); setPage(1); }}>Reset filter</button>}
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table className="audit">
          <thead>
            <tr><th></th><th>Waktu</th><th>Aksi</th><th>Target</th><th>Ringkasan</th><th>Pengguna</th><th>Hasil</th></tr>
          </thead>
          <tbody className={loading ? 'loading' : ''}>
            {data.rows.map((r) => (
              <Fragment key={r.id}>
                <tr className={`clickable ${open.has(r.id) ? 'open' : ''}`} onClick={() => toggle(r.id)}>
                  <td className="chk"><ChevronDown size={15} className={`caret ${open.has(r.id) ? 'up' : ''}`} /></td>
                  <td className="small">{fmtDateTime(r.at)}</td>
                  <td><span className={`cat cat-${r.category}`}>{CATEGORIES[r.category] || r.category}</span> {ACTIONS[r.action] || (r.action?.startsWith('job.soar.') ? `Jalankan flow ${r.action.slice(9)}` : r.action)}</td>
                  <td className="small target">{r.target || <span className="muted">—</span>}</td>
                  <td className="wrap-cell small">{r.summary}</td>
                  <td className="small">{r.type === 'system' ? <span className="sys-actor">⚙ {r.actor}</span> : r.actor}<div className="muted">{r.source === 'UI' ? 'Dashboard' : r.source === 'Scheduler' ? 'Otomatis' : r.source === 'System' ? 'Sistem' : r.source}{r.ip ? ` · ${r.ip}` : ''}</div></td>
                  <td>{r.ok ? <span className="run-state ok"><CheckCircle2 size={13} /> Berhasil</span> : <span className="run-state bad"><XCircle size={13} /> Gagal</span>}</td>
                </tr>
                {open.has(r.id) && (
                  <tr className="detail-row"><td></td><td colSpan={6}><Details d={r.details} /></td></tr>
                )}
              </Fragment>
            ))}
            {!loading && !data.rows.length && <tr><td colSpan={7} className="empty">{anyFilter ? 'Tidak ada catatan yang cocok dengan filter.' : 'Belum ada catatan.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span className="muted small">Menampilkan {first} - {Math.min(page * pageSize, data.total)} dari {data.total} catatan</span>
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Sebelumnya"><ChevronLeft size={16} /></button>
          <span className="small muted">Hal. {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Berikutnya"><ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}
