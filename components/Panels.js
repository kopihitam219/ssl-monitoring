'use client';
import { FileSpreadsheet, ScanLine, CheckCircle2, RefreshCw, AlertTriangle, XCircle, FileUp, ShieldCheck, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { STATUS, CARD_KEYS, statusSub, fmtDateTime, pct, api } from './ui';
import { periodLabel } from './PeriodPicker';

export function KpiCards({ cards, total, onPick, config }) {
  return (
    <div className="kpis">
      {CARD_KEYS.map((k) => {
        const s = STATUS[k];
        const Icon = s.icon;
        const sub = statusSub(k, config?.tiers);
        return (
          <button key={k} className="kpi" style={{ '--c': s.color }} onClick={() => onPick(k)} title={`${s.label}: ${sub}`}>
            <span className="kpi-icon"><Icon size={22} strokeWidth={2.5} /></span>
            <span className="kpi-body">
              <span className="kpi-label">{s.label}</span>
              <span className="kpi-value">{cards[k] || 0}</span>
              <span className="kpi-sub">{sub}</span>
              <span className="kpi-sub">{pct(cards[k] || 0, total)}% dari total</span>
            </span>
            <ChevronRight size={16} className="kpi-arrow" />
          </button>
        );
      })}
    </div>
  );
}

const STATE = {
  connected: { label: 'Connected', color: 'var(--ok)' },
  running: { label: 'Running', color: 'var(--info)' },
  error: { label: 'Error', color: 'var(--danger)' },
  idle: { label: 'Belum ada data', color: 'var(--muted)' },
};

export function SourcesPanel({ sources, scanning }) {
  const xl = sources.excel, scan = sources.scan;
  const items = [
    {
      icon: FileSpreadsheet, name: 'Source of Truth (Excel)',
      state: xl?.status || 'idle',
      lines: [xl?.last_sync && `Latest upload: ${fmtDateTime(xl.last_sync)}`, xl?.detail?.file && `File: ${xl.detail.file}`],
    },
    {
      icon: ScanLine, name: 'SSL Scan',
      state: scanning ? 'running' : scan?.status || 'idle',
      lines: [scan?.last_sync && `Last scan: ${fmtDateTime(scan.last_sync)}`, scan?.detail?.seconds != null && `${scan.detail.total} domain · ${scan.detail.seconds} detik`, scan?.detail?.error],
    },
  ];
  return (
    <section className="panel">
      <h2>Status Data Source</h2>
      <ul className="sources">
        {items.map((it) => {
          const st = STATE[it.state] || STATE.idle;
          const Icon = it.icon;
          return (
            <li key={it.name}>
              <span className="src-icon"><Icon size={18} /></span>
              <div>
                <div className="src-name">{it.name}</div>
                <div className="src-state" style={{ color: st.color }}><i className="dot" style={{ background: st.color }} />{st.label}</div>
                {it.lines.filter(Boolean).map((l) => <div key={l} className="muted small">{l}</div>)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const ACT = {
  upload: { icon: FileUp, color: 'var(--ok)' },
  sync: { icon: RefreshCw, color: 'var(--info)' },
  scan: { icon: CheckCircle2, color: 'var(--ok)' },
  expiring: { icon: AlertTriangle, color: 'var(--warn)' },
  failed: { icon: XCircle, color: 'var(--danger)' },
  mismatch: { icon: RefreshCw, color: 'var(--violet)' },
};

export function ActivityPanel({ activities, total = 0, period }) {
  const [all, setAll] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => setAll(null), [period?.from, period?.to, activities]);

  async function showAll() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: period?.from || '', to: period?.to || '', limit: '200' });
      setAll((await api(`/api/activities?${qs}`)).activities);
    } finally { setLoading(false); }
  }

  const list = all || activities;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Aktivitas</h2>
          <p className="muted small">{period ? periodLabel(period) : ''} · {total} aktivitas</p>
        </div>
        {total > activities.length && (
          all
            ? <button className="link small" onClick={() => setAll(null)}>Ringkas</button>
            : <button className="link small accent" onClick={showAll} disabled={loading}>{loading ? 'Memuat…' : 'Lihat semua'}</button>
        )}
      </div>
      <ul className={`activity ${all ? 'scroll' : ''}`}>
        {list.map((a) => {
          const m = ACT[a.type] || { icon: ShieldCheck, color: 'var(--muted)' };
          const Icon = m.icon;
          return (
            <li key={a.id}>
              <span className="act-icon" style={{ '--c': m.color }}><Icon size={16} /></span>
              <div>
                <div className="act-title">{a.title}</div>
                {a.detail && <div className="act-detail">{a.detail}</div>}
                <div className="muted small">{fmtDateTime(a.created_at)}</div>
              </div>
            </li>
          );
        })}
        {!list.length && <li className="muted">Tidak ada aktivitas pada periode ini.</li>}
      </ul>
    </section>
  );
}
