'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';

/** Tanggal lokal → 'YYYY-MM-DD' */
export const ymd = (d) => d.toLocaleDateString('en-CA');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

export const PRESETS = [
  { key: 'today', label: 'Hari ini', range: () => ({ from: ymd(new Date()), to: ymd(new Date()) }) },
  { key: '7d', label: '7 hari terakhir', range: () => ({ from: ymd(daysAgo(6)), to: ymd(new Date()) }) },
  { key: '30d', label: '30 hari terakhir', range: () => ({ from: ymd(daysAgo(29)), to: ymd(new Date()) }) },
  { key: '90d', label: '90 hari terakhir', range: () => ({ from: ymd(daysAgo(89)), to: ymd(new Date()) }) },
  { key: 'all', label: 'Semua waktu', range: () => ({ from: '', to: '' }) },
];

const FMT = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const fmt = (s) => FMT.format(new Date(`${s}T00:00:00`));

export function periodLabel(p) {
  const preset = PRESETS.find((x) => x.key === p.key);
  if (preset && p.key !== 'custom') return preset.label;
  if (p.from && p.to) return p.from === p.to ? fmt(p.from) : `${fmt(p.from)} – ${fmt(p.to)}`;
  if (p.from) return `Sejak ${fmt(p.from)}`;
  if (p.to) return `Sampai ${fmt(p.to)}`;
  return 'Semua waktu';
}

/** value = { key, from, to }  (from/to 'YYYY-MM-DD' atau '') */
export default function PeriodPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const ref = useRef(null);

  useEffect(() => { setFrom(value.from); setTo(value.to); }, [value.from, value.to, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const invalid = from && to && from > to;

  return (
    <div className="period" ref={ref}>
      <button className="chip chip-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Pilih periode">
        <CalendarDays size={15} /> {periodLabel(value)} <ChevronDown size={14} />
      </button>
      {open && (
        <div className="period-pop" role="dialog" aria-label="Periode">
          <div className="period-presets">
            {PRESETS.map((p) => (
              <button key={p.key} className={value.key === p.key ? 'active' : ''}
                onClick={() => { onChange({ key: p.key, ...p.range() }); setOpen(false); }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="period-custom">
            <div className="small muted">Rentang tanggal sendiri</div>
            <label>Dari <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>Sampai <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
            {invalid && <div className="small txt-danger">Tanggal "Dari" harus sebelum "Sampai"</div>}
            <button className="btn primary full" disabled={invalid || (!from && !to)}
              onClick={() => { onChange({ key: 'custom', from, to }); setOpen(false); }}>
              Terapkan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
