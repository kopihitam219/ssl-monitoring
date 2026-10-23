'use client';
import { STATUS, CARD_KEYS, pct } from './ui';

export function Donut({ cards, total }) {
  const R = 58, C = 2 * Math.PI * R;
  let offset = 0;
  const sum = CARD_KEYS.reduce((a, k) => a + (cards[k] || 0), 0);
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut" role="img" aria-label={`Total ${total} domain`}>
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--line)" strokeWidth="22" />
        {sum > 0 && CARD_KEYS.map((k) => {
          const v = cards[k] || 0;
          if (!v) return null;
          const len = (v / sum) * C;
          const el = (
            <circle key={k} cx="80" cy="80" r={R} fill="none" stroke={STATUS[k].color} strokeWidth="22"
              strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)">
              <title>{`${STATUS[k].label}: ${v}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="80" y="76" textAnchor="middle" className="donut-label">Total Domain</text>
        <text x="80" y="98" textAnchor="middle" className="donut-value">{total}</text>
      </svg>
      <ul className="legend">
        {CARD_KEYS.map((k) => (
          <li key={k}>
            <span className="dot" style={{ background: STATUS[k].color }} />
            <span className="legend-name">{STATUS[k].label}</span>
            <b>{cards[k] || 0}</b>
            <span className="muted">{pct(cards[k] || 0, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// tren harian (data lama memakai EXPIRED; sekarang termasuk Urgent)
const SERIES = [
  { key: 'OK', label: 'OK + Info', color: STATUS.OK.color, get: (d) => (d.OK || 0) + (d.INFORMATIONAL || 0) },
  { key: 'SOON', label: 'Warning–Reminder', color: STATUS.WARNING.color, get: (d) => (d.WARNING || 0) + (d.NEED_UPDATE || 0) + (d.REMINDER || 0) },
  { key: 'URGENT', label: 'Urgent', color: STATUS.URGENT.color, get: (d) => (d.URGENT || 0) + (d.EXPIRED || 0) },
  { key: 'CHECK_FAILED', label: 'Check Failed', color: STATUS.CHECK_FAILED.color, get: (d) => d.CHECK_FAILED || 0 },
];

export function TrendChart({ trend }) {
  const W = 340, H = 160, L = 30, B = 22, T = 8, Rp = 10;
  if (!trend.length) return <div className="empty">Tidak ada data scan pada periode ini.</div>;
  const step = Math.ceil(trend.length / 7); // maksimal ~7 label tanggal supaya tidak bertumpuk
  const dot = trend.length <= 31;
  const max = Math.max(5, ...trend.flatMap((d) => SERIES.map((s) => s.get(d))));
  const top = Math.ceil(max / 5) * 5;
  const x = (i) => (trend.length === 1 ? (L + W - Rp) / 2 : L + (i * (W - L - Rp)) / (trend.length - 1));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const label = (s) => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });

  return (
    <div>
      <div className="chart-legend">
        {SERIES.map((s) => <span key={s.key}><i className="dot" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Tren status sertifikat 7 hari">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - Rp} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className="axis">{t}</text>
          </g>
        ))}
        {trend.map((d, i) => ((trend.length - 1 - i) % step === 0) && <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" className="axis">{label(d.date)}</text>)}
        {SERIES.map((s) => {
          const pts = trend.map((d, i) => `${x(i)},${y(s.get(d))}`);
          return (
            <g key={s.key}>
              {s.key === 'OK' && trend.length > 1 && (
                <polygon points={`${x(0)},${y(0)} ${pts.join(' ')} ${x(trend.length - 1)},${y(0)}`} fill={s.color} opacity="0.12" />
              )}
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" />
              {trend.map((d, i) => (
                <circle key={i} cx={x(i)} cy={y(s.get(d))} r={dot ? 3 : 1.5} fill={s.color}>
                  <title>{`${label(d.date)} · ${s.label}: ${s.get(d)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EnvBars({ environments }) {
  const W = 300, H = 170, L = 26, B = 24, T = 16;
  const max = Math.max(5, ...environments.map((e) => e.count));
  const top = Math.ceil(max / 5) * 5;
  const colors = ['var(--info)', 'var(--ok)', 'var(--warn)', 'var(--violet)', 'var(--slate)'];
  const bw = (W - L) / environments.length;
  const y = (v) => T + (1 - v / top) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Distribusi domain per environment">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W} y1={y(top * f)} y2={y(top * f)} stroke="var(--line)" />
          <text x={L - 6} y={y(top * f) + 3} textAnchor="end" className="axis">{Math.round(top * f)}</text>
        </g>
      ))}
      {environments.map((e, i) => {
        const cx = L + i * bw + bw / 2;
        return (
          <g key={e.name}>
            <rect x={cx - bw * 0.28} y={y(e.count)} width={bw * 0.56} height={Math.max(y(0) - y(e.count), 0)} rx="3" fill={colors[i]} />
            <text x={cx} y={y(e.count) - 5} textAnchor="middle" className="bar-val">{e.count}</text>
            <text x={cx} y={H - 7} textAnchor="middle" className="axis">{e.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
