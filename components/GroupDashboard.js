'use client';
// Dashboard satu group (tab di menu Dashboard, nama tab = nama group, mis. Local / Public / Partner).
import { useEffect, useState } from 'react';
import { FolderKanban, Download, ScanLine, RotateCw, Activity, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import InventoryTable from './InventoryTable';
import { StatusDonut } from './MonitoringDashboard';
import { api, fmtDateTime, fmtDate, STATUS, CARD_KEYS, statusSub, pct } from './ui';
import { useSession } from './session';

const PROXY_TEXT = { direct: 'Tanpa proxy → proxy kalau gagal', proxy: 'Dengan proxy', mixed: 'Campuran (lihat per file)' };

export default function GroupDashboard({ groupId, color, reloadKey, onChanged }) {
  const { can } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState('');
  const [msg, setMsg] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api(`/api/dashboard/group?id=${groupId}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [groupId, reloadKey, tick]);

  async function run(job, label) {
    setRunning(job); setMsg(null);
    try {
      const r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job, groupId }) });
      setMsg({ ok: r.ok !== false, text: r.message || r.error });
    } catch (e) { setMsg({ ok: false, text: `${label}: ${e.message}` }); }
    finally { setRunning(''); setTick((t) => t + 1); onChanged?.(); }
  }

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Memuat…</p>;
  const c = data.counts;
  const failed = c.CHECK_FAILED || 0;
  const maxEnv = Math.max(1, ...data.environments.map((e) => e.count));
  const job = data.lastScanJob;

  return (
    <div className="gd" style={{ '--gc': color }}>
      <section className="gd-head">
        <span className="gd-icon"><FolderKanban size={26} /></span>
        <div className="gd-title">
          <h2>{data.group.name}</h2>
          <div className="gd-chips">
            <span>Sumber: <b>Source of Truth · {data.files.length} file Excel</b></span>
            <span>Jalur cek: <b>{PROXY_TEXT[data.proxy] || '—'}</b></span>
            <span>Upload terakhir: <b>{data.lastUpload ? `${fmtDateTime(data.lastUpload.at)} (${data.lastUpload.file})` : '—'}</b></span>
            <span>Scan terakhir: <b>{fmtDateTime(data.lastScan)}</b></span>
          </div>
          {data.files.length > 0 && <div className="gd-files muted small">File: {data.files.map((f) => `${f.name} (${f.domains})`).join(' · ')}</div>}
        </div>
        {can('export') && <a className="btn ghost" href={`/api/export?group=${groupId}`}><Download size={15} /> Export Excel</a>}
      </section>

      {can('sync') && (
        <div className="gd-actions">
          <button className="btn primary" disabled={!!running || !data.total} onClick={() => run('scan', 'Scan')}>
            {running === 'scan' ? <Loader2 size={15} className="spin" /> : <ScanLine size={15} />} Scan dashboard ini <span className="gd-badge">{data.total}</span>
          </button>
          <button className="btn ghost" disabled={!!running || !failed} onClick={() => run('retry_failed', 'Retry')}>
            {running === 'retry_failed' ? <Loader2 size={15} className="spin" /> : <RotateCw size={15} />} Retry Check Failed <span className="gd-badge warn">{failed}</span>
          </button>
          <button className="btn ghost" disabled={!!running || !failed} onClick={() => run('conn_test', 'Tes koneksi')}
            title="DNS, Ping, Telnet (port) & Curl (HTTPS) untuk domain Check Failed, langsung dan lewat proxy">
            {running === 'conn_test' ? <Loader2 size={15} className="spin" /> : <Activity size={15} />} Tes koneksi Check Failed
          </button>
          {job?.at && (
            <span className="gd-last small muted">
              <CheckCircle2 size={13} /> Scan terakhir {fmtDateTime(job.at)} · {job.scope || 'semua domain'}: {job.total} domain dalam {job.seconds} detik
              {job.failed != null ? ` · ${job.failed} Check Failed` : ''}
            </span>
          )}
        </div>
      )}
      {running && <div className="alert info small"><Loader2 size={14} className="spin h-icon" /> Sedang berjalan… untuk banyak domain ini bisa beberapa menit.</div>}
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`} onClick={() => setMsg(null)}>{msg.ok ? <CheckCircle2 size={14} className="h-icon" /> : <XCircle size={14} className="h-icon" />} {msg.text}</div>}

      <div className="gd-kpis">
        <button className={`gd-kpi ${!status ? 'on' : ''}`} style={{ '--c': color }} onClick={() => setStatus('')}>
          <span className="gd-kpi-label"><i />Total domain</span><b>{data.total}</b><small>di group ini</small>
        </button>
        {CARD_KEYS.map((k) => (
          <button key={k} className={`gd-kpi ${status === k ? 'on' : ''}`} style={{ '--c': STATUS[k].color }} onClick={() => setStatus(status === k ? '' : k)}>
            <span className="gd-kpi-label"><i />{STATUS[k].label}</span><b>{c[k] || 0}</b><small>{statusSub(k, data.tiers)}</small>
          </button>
        ))}
      </div>

      <div className="gd-grid">
        <section className="panel">
          <h2>Status sertifikat</h2>
          <div className="gd-donut">
            <StatusDonut counts={c} total={data.total} />
            <ul className="legend">
              {CARD_KEYS.map((k) => (
                <li key={k}><span className="dot" style={{ background: STATUS[k].color }} /><span className="legend-name">{STATUS[k].label}</span><b>{c[k] || 0}</b><span className="muted">{pct(c[k] || 0, data.total)}%</span></li>
              ))}
            </ul>
          </div>
        </section>
        <section className="panel">
          <h2>Akan habis ≤ {data.tiers.needUpdate} hari</h2>
          <ul className="gd-exp">
            {data.expiring.map((e) => (
              <li key={e.id}>
                <i style={{ background: STATUS[e.status]?.color }} />
                <span className="gd-exp-name">{e.domain}{e.port !== 443 ? `:${e.port}` : ''}</span>
                <span className="muted small">{fmtDate(e.expires_at)}</span>
                <b style={{ color: STATUS[e.status]?.color }}>{e.days < 0 ? `lewat ${-e.days} hari` : `${e.days} hari`}</b>
              </li>
            ))}
            {!data.expiring.length && <li className="muted">Tidak ada sertifikat yang akan habis.</li>}
          </ul>
        </section>
        <section className="panel">
          <h2>Per environment</h2>
          <ul className="gd-env">
            {data.environments.map((e) => (
              <li key={e.name}><span>{e.name}</span><b>{e.count}</b><span className="gd-bar"><i style={{ width: `${(e.count / maxEnv) * 100}%` }} /></span></li>
            ))}
            {!data.environments.length && <li className="muted">Belum ada data.</li>}
          </ul>
        </section>
      </div>

      <div className="gd-status-chips">
        <button className={!status ? 'on' : ''} style={{ '--c': color }} onClick={() => setStatus('')}>Semua {data.total}</button>
        {CARD_KEYS.map((k) => (
          <button key={k} className={status === k ? 'on' : ''} style={{ '--c': STATUS[k].color }} onClick={() => setStatus(k)}>{STATUS[k].label} {c[k] || 0}</button>
        ))}
      </div>
      <InventoryTable key={groupId} groupId={groupId} initialStatus={status} hideStatusChip title={`Domain di ${data.group.name}`}
        subtitle="Klik status di atas untuk menyaring tabel · klik domain untuk detail sertifikat" reloadKey={`${reloadKey}-${tick}`} onChanged={onChanged} pageSize={25} />
    </div>
  );
}
