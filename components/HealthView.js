'use client';
import { useEffect, useRef, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Box, Pause, Play, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Server } from 'lucide-react';
import { api, fmtDateTime } from './ui';

const MAX = 60; // jumlah titik grafik (60 × 5 detik = 5 menit)

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function uptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d} hari`, h && `${h} jam`, `${m} menit`].filter(Boolean).join(' ');
}

const COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--danger)', off: 'var(--muted)' };
const LABEL = { ok: 'Normal', warn: 'Perhatian', error: 'Bermasalah', off: 'Tidak dipakai' };
const ICON = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle, off: MinusCircle };

function Spark({ data, color }) {
  if (data.length < 2) return <div className="spark-empty" />;
  const W = 220, H = 44;
  const x = (i) => (i / (MAX - 1)) * W;
  const off = MAX - data.length;
  const pts = data.map((v, i) => `${x(i + off)},${H - (Math.min(100, v) / 100) * H}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={W} y1={H * 0.15} y2={H * 0.15} stroke="var(--line)" strokeDasharray="3 3" />
      <polygon points={`${x(off)},${H} ${pts} ${W},${H}`} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

function Metric({ icon: Icon, title, pct, status, lines, history }) {
  const c = COLOR[status] || COLOR.ok;
  return (
    <section className="panel metric" style={{ '--c': c }}>
      <div className="metric-head">
        <span className="metric-icon"><Icon size={18} /></span>
        <b>{title}</b>
        <span className="metric-state" style={{ color: c }}>{LABEL[status]}</span>
      </div>
      <div className="metric-value">{pct == null ? '—' : `${pct.toFixed(1)}%`}</div>
      <div className="bar"><span style={{ width: `${Math.min(100, pct || 0)}%`, background: c }} /></div>
      {lines.map((l) => <div key={l} className="muted small">{l}</div>)}
      {history && <Spark data={history} color={c} />}
    </section>
  );
}

export default function HealthView() {
  const [h, setH] = useState(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const hist = useRef({ cpu: [], mem: [], app: [] });
  const [, force] = useState(0);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const load = () => api('/api/health').then((r) => {
      if (!alive) return;
      const H = hist.current;
      H.cpu = [...H.cpu, r.cpu.pct].slice(-MAX);
      H.mem = [...H.mem, r.memory.pct].slice(-MAX);
      H.app = [...H.app, (r.app.rss / r.memory.total) * 100].slice(-MAX);
      setH(r); setError(''); force((n) => n + 1);
    }).catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [paused]);

  if (!h) return <section className="panel">{error ? <div className="alert error">{error}</div> : <p className="muted">Mengukur…</p>}</section>;
  const Overall = ICON[h.overall];

  return (
    <>
      <div className={`health-banner ${h.overall}`}>
        <Overall size={20} />
        <div>
          <b>{h.overall === 'ok' ? 'Semua normal' : h.overall === 'warn' ? 'Ada yang perlu diperhatikan' : 'Ada yang bermasalah'}</b>
          <div className="small">Diperbarui {fmtDateTime(h.at)} · otomatis tiap 5 detik{paused ? ' (dijeda)' : ''}</div>
        </div>
        <button className="btn ghost sm" onClick={() => setPaused(!paused)}>{paused ? <><Play size={14} /> Lanjutkan</> : <><Pause size={14} /> Jeda</>}</button>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="metrics">
        <Metric icon={Cpu} title="CPU" pct={h.cpu.pct} status={h.cpu.status} history={hist.current.cpu}
          lines={[`${h.cpu.cores} core · ${h.cpu.model}`, h.cpu.load ? `Load avg: ${h.cpu.load.map((v) => v.toFixed(2)).join(' / ')}` : 'Riwayat 5 menit terakhir']} />
        <Metric icon={MemoryStick} title="RAM" pct={h.memory.pct} status={h.memory.status} history={hist.current.mem}
          lines={[`${fmtBytes(h.memory.used)} terpakai dari ${fmtBytes(h.memory.total)}`, `${fmtBytes(h.memory.free)} tersedia`]} />
        <Metric icon={HardDrive} title={`Disk ${h.disk.path || ''}`} pct={h.disk.pct ?? null} status={h.disk.status}
          lines={h.disk.error ? [h.disk.error] : [`${fmtBytes(h.disk.used)} terpakai dari ${fmtBytes(h.disk.total)}`, `${fmtBytes(h.disk.free)} kosong · data aplikasi ${fmtBytes(h.app.dataSize)}`]} />
        <Metric icon={Box} title="Memori aplikasi" pct={(h.app.rss / h.memory.total) * 100} status="ok" history={hist.current.app}
          lines={[`RSS ${fmtBytes(h.app.rss)} · Heap ${fmtBytes(h.app.heapUsed)} / ${fmtBytes(h.app.heapTotal)}`, `% dari total RAM`]} />
      </div>

      <div className="health-grid">
        <section className="panel">
          <h2><Server size={16} className="h-icon" /> Status service</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Status</th><th>Keterangan</th></tr></thead>
              <tbody>
                {h.services.map((s) => {
                  const I = ICON[s.status];
                  return (
                    <tr key={s.name}>
                      <td className="cell-domain"><b>{s.name}</b></td>
                      <td className="cell-status"><span className={`svc-state ${s.status}`}><I size={13} /> {LABEL[s.status]}</span></td>
                      <td className="small wrap-cell cell-note">{s.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>Sistem</h2>
          <dl className="kv">
            <div><dt>Komputer</dt><dd>{h.system.hostname}</dd></div>
            <div><dt>OS</dt><dd>{h.system.platform} ({h.system.arch})</dd></div>
            <div><dt>Komputer menyala</dt><dd>{uptime(h.system.uptimeSec)}</dd></div>
            <div><dt>Aplikasi berjalan</dt><dd>{uptime(h.app.uptimeSec)}</dd></div>
            <div><dt>Node.js</dt><dd>{h.app.node} · PID {h.app.pid}</dd></div>
            <div><dt>Data aplikasi</dt><dd>{fmtBytes(h.app.dataSize)}</dd></div>
          </dl>
          <p className="muted small">{h.cloud ? 'Aplikasi berjalan di Vercel: angka CPU, RAM, dan Disk di atas milik server Vercel sesaat, bukan komputer Anda, jadi tidak dipakai untuk alarm.' : 'Batas: Perhatian ≥ 85%, Bermasalah ≥ 95% untuk CPU, RAM, dan Disk.'}</p>
        </section>
      </div>
    </>
  );
}
