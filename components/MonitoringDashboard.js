'use client';
import { useEffect, useState } from 'react';
import { RotateCcw, FileText, FolderKanban } from 'lucide-react';
import { api, STATUS, CARD_KEYS, statusSub } from './ui';

// warna tab / panel per group (bergiliran)
export const GROUP_COLORS = ['#fbbf24', '#22d3a5', '#a855f7', '#22d3ee', '#f472b6', '#fb923c', '#60a5fa', '#a3e635'];
export const groupColor = (i) => GROUP_COLORS[i % GROUP_COLORS.length];

/** Donut status 7 tingkat. counts = { STATUS: n } */
export function StatusDonut({ counts, total, label = 'Total', size = 160 }) {
  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const keys = [...CARD_KEYS, 'PENDING'].filter((k) => counts[k] > 0);
  return (
    <svg viewBox="0 0 160 160" className="mon-donut" style={{ maxWidth: size }} role="img" aria-label={`${label}: ${total} domain`}>
      <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(148,163,184,.15)" strokeWidth="20" />
      {total > 0 && keys.map((k) => {
        const len = (counts[k] / total) * C;
        const el = (
          <circle key={k} cx="80" cy="80" r={R} fill="none" stroke={STATUS[k].color} strokeWidth="20"
            strokeDasharray={`${Math.max(len - (keys.length > 1 ? 1.5 : 0), 0.8)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)">
            <title>{`${STATUS[k].label}: ${counts[k]}`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      <text x="80" y="77" textAnchor="middle" className="mon-donut-label">{label}</text>
      <text x="80" y="99" textAnchor="middle" className="mon-donut-value">{total}</text>
    </svg>
  );
}

export default function MonitoringDashboard({ reloadKey, onDrill }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/api/dashboard/monitoring').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Memuat…</p>;

  const kpis = [...CARD_KEYS.map((k) => ({ key: k, ...STATUS[k], sub: statusSub(k, data.tiers), go: { status: k } })),
    { key: 'RENEWAL', label: 'Renewal', color: '#ec4899', icon: RotateCcw, sub: `diperbarui ≤ ${data.renewalDays} hari`, go: { renewed: '1' } }];

  return (
    <div className="mon">
      <div className="mon-kpis">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <button key={k.key} className="mon-kpi" style={{ '--c': k.color }} title={`${k.label}: ${k.sub}`}
              onClick={() => onDrill({ ...k.go, label: k.label })}>
              <span className="mon-kpi-icon"><Icon size={20} strokeWidth={2.4} /></span>
              <span className="mon-kpi-body">
                <span className="mon-kpi-label">{k.label}</span>
                <span className="mon-kpi-value">{data.kpis[k.key] ?? 0}</span>
              </span>
            </button>
          );
        })}
      </div>

      {data.panels.length === 0 && (
        <section className="panel mon-empty">
          <h2>Belum ada group dashboard</h2>
          <p className="muted">Buat group (mis. Local, Public, Partner) dan upload file Excel ke group itu di menu <b>Source of Truth</b>.</p>
        </section>
      )}
      <div className="mon-grid" style={{ '--n': Math.min(data.panels.length, 3) }}>
        {data.panels.map((p, i) => {
          const color = groupColor(i);
          const rows = [...CARD_KEYS, ...(p.counts.PENDING ? ['PENDING'] : [])];
          return (
            <div key={p.key} className="mon-col" style={{ '--c': color }}>
              <section className="mon-card">
                <header className="mon-card-head">
                  <span className="mon-card-icon"><FolderKanban size={19} /></span>
                  <h3>{p.label}<span className="mon-src">{p.files} file</span></h3>
                </header>
                <div className="mon-donut-wrap">
                  <StatusDonut counts={p.counts} total={p.total} />
                  <ul className="mon-legend">
                    {rows.filter((k) => p.counts[k] > 0).map((k) => <li key={k}><i style={{ background: STATUS[k].color }} />{STATUS[k].label}</li>)}
                    {p.total === 0 && <li className="muted">Belum ada data</li>}
                  </ul>
                </div>
                <p className="mon-foot muted small">{p.fallback ? `${p.fallback} domain berhasil lewat proxy (otomatis)` : 'Group dashboard'}</p>
              </section>

              <section className="mon-card">
                <header className="mon-card-head">
                  <span className="mon-card-icon"><FileText size={18} /></span>
                  <h3>Detail - {p.label}</h3>
                </header>
                <table className="mon-table">
                  <thead><tr><th>Status</th><th>Total</th></tr></thead>
                  <tbody>
                    {rows.map((k) => {
                      const SIcon = STATUS[k].icon;
                      return (
                        <tr key={k} className="clickable" onClick={() => onDrill({ panel: p.key, status: k, label: `${p.label} · ${STATUS[k].label}` })}>
                          <td><span className="mon-st" style={{ '--ic': STATUS[k].color }}><SIcon size={14} strokeWidth={3} /></span>{STATUS[k].label}</td>
                          <td>{p.counts[k] || 0}</td>
                        </tr>
                      );
                    })}
                    <tr className="clickable mon-total" onClick={() => onDrill({ panel: p.key, label: p.label })}>
                      <td>Total</td><td>{p.total}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          );
        })}
      </div>
    </div>
  );
}
