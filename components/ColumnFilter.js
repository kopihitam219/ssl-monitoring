'use client';
// Header kolom tabel dengan urut & filter seperti di Excel:
//   klik judul → urutkan (naik / turun), ikon corong → pilih nilai yang ditampilkan.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownAZ, ArrowUpZA, ArrowUp, ArrowDown, Filter, Search, X } from 'lucide-react';

const EXP_OPTIONS = [
  ['', 'Semua'], ['expired', 'Sudah expired'], ['7', 'Habis ≤ 7 hari'], ['30', 'Habis ≤ 30 hari'],
  ['60', 'Habis ≤ 60 hari'], ['90', 'Habis ≤ 90 hari'], ['custom', 'Expired antara tanggal…'],
];
const LAST_OPTIONS = [['', 'Semua'], ['never', 'Belum pernah dicek'], ['1', 'Lebih dari 1 hari lalu'], ['7', 'Lebih dari 7 hari lalu'], ['30', 'Lebih dari 30 hari lalu']];

function Popover({ anchor, onClose, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = 280;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      setPos({ top: r.bottom + 6, left, width: w });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  if (!pos) return null;
  return createPortal(
    <div ref={ref} className="colf-pop" style={{ top: pos.top, left: pos.left, width: pos.width }} role="dialog">{children}</div>,
    document.body,
  );
}

/**
 * kind: 'values' (daftar centang) | 'text' (berisi teks) | 'exp' (masa berlaku) | 'last' (terakhir dicek) | 'none' (urut saja)
 * value: filter aktif → values: array | text: string | exp: { exp, expFrom, expTo } | last: string
 */
export default function ColumnFilter({ label, sortKey, sort, dir, onSort, kind = 'values', facet = [], value, onChange, format = (v) => v || '(Kosong)', align }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const active = kind === 'values' ? Array.isArray(value) : kind === 'exp' ? !!value?.exp : !!value;
  const sorted = sortKey && sort === sortKey;

  return (
    <th className={`colf ${active ? 'on' : ''} ${align === 'right' ? 'r' : ''}`}>
      <span className="colf-in">
        {sortKey
          ? <button className="colf-label" onClick={() => onSort(sortKey, sorted && dir === 'asc' ? 'desc' : 'asc')} title="Klik untuk mengurutkan">
              {label}{sorted && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
          : <span className="colf-label">{label}</span>}
        {kind !== 'none' && (
          <button ref={btn} className="colf-btn" onClick={() => setOpen((o) => !o)} aria-label={`Filter ${label}`} title={active ? 'Filter aktif' : 'Filter'}>
            <Filter size={12} />
          </button>
        )}
      </span>
      {open && (
        <Popover anchor={btn} onClose={() => setOpen(false)}>
          {sortKey && (
            <div className="colf-sort">
              <button onClick={() => { onSort(sortKey, 'asc'); setOpen(false); }}><ArrowDownAZ size={14} /> Urutkan naik</button>
              <button onClick={() => { onSort(sortKey, 'desc'); setOpen(false); }}><ArrowUpZA size={14} /> Urutkan turun</button>
            </div>
          )}
          {kind === 'values' && <ValuesBody facet={facet} value={value} format={format} onApply={(v) => { onChange(v); setOpen(false); }} />}
          {kind === 'text' && <TextBody label={label} value={value} onApply={(v) => { onChange(v); setOpen(false); }} />}
          {kind === 'exp' && <ExpBody value={value} onApply={(v) => { onChange(v); setOpen(false); }} />}
          {kind === 'last' && <RadioBody options={LAST_OPTIONS} value={value || ''} onApply={(v) => { onChange(v || undefined); setOpen(false); }} />}
        </Popover>
      )}
    </th>
  );
}

function ValuesBody({ facet, value, format, onApply }) {
  const [q, setQ] = useState('');
  const all = facet.map((f) => f.value);
  const [sel, setSel] = useState(() => new Set(Array.isArray(value) ? value : all));
  const shown = useMemo(() => facet.filter((f) => format(f.value).toLowerCase().includes(q.toLowerCase())), [facet, q, format]);
  const allShownOn = shown.length > 0 && shown.every((f) => sel.has(f.value));
  const toggle = (v) => setSel((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  const toggleShown = () => setSel((s) => { const n = new Set(s); shown.forEach((f) => (allShownOn ? n.delete(f.value) : n.add(f.value))); return n; });
  // semua dicentang = tidak ada filter
  const apply = () => onApply(all.every((v) => sel.has(v)) && !q ? undefined : [...sel].filter((v) => !q || shown.some((f) => f.value === v)));
  return (
    <>
      <label className="colf-search"><Search size={13} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nilai…" /></label>
      <div className="colf-list">
        {shown.length > 0 && (
          <label className="colf-item all"><input type="checkbox" checked={allShownOn} onChange={toggleShown} /> <span>(Pilih semua)</span></label>
        )}
        {shown.map((f) => (
          <label key={f.value} className="colf-item">
            <input type="checkbox" checked={sel.has(f.value)} onChange={() => toggle(f.value)} />
            <span className={f.value ? '' : 'muted'}>{format(f.value)}</span><em>{f.count}</em>
          </label>
        ))}
        {!shown.length && <p className="muted small">Tidak ada nilai.</p>}
      </div>
      <div className="colf-foot">
        <button className="link small" onClick={() => onApply(undefined)} disabled={!Array.isArray(value)}><X size={13} /> Hapus filter</button>
        <button className="btn primary sm" onClick={apply} disabled={!sel.size}>OK</button>
      </div>
    </>
  );
}

function TextBody({ label, value, onApply }) {
  const [t, setT] = useState(value || '');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(t.trim() || undefined); }}>
      <label className="colf-search"><Search size={13} /><input autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder={`${label} berisi…`} /></label>
      <div className="colf-foot">
        <button type="button" className="link small" onClick={() => onApply(undefined)} disabled={!value}><X size={13} /> Hapus filter</button>
        <button type="submit" className="btn primary sm">OK</button>
      </div>
    </form>
  );
}

function RadioBody({ options, value, onApply }) {
  const [v, setV] = useState(value);
  return (
    <>
      <div className="colf-list">
        {options.map(([k, l]) => (
          <label key={k} className="colf-item"><input type="radio" checked={v === k} onChange={() => setV(k)} /> <span>{l}</span></label>
        ))}
      </div>
      <div className="colf-foot">
        <button className="link small" onClick={() => onApply('')} disabled={!value}><X size={13} /> Hapus filter</button>
        <button className="btn primary sm" onClick={() => onApply(v)}>OK</button>
      </div>
    </>
  );
}

function ExpBody({ value, onApply }) {
  const [v, setV] = useState(value || { exp: '', expFrom: '', expTo: '' });
  return (
    <>
      <div className="colf-list">
        {EXP_OPTIONS.map(([k, l]) => (
          <label key={k} className="colf-item"><input type="radio" checked={v.exp === k} onChange={() => setV({ ...v, exp: k })} /> <span>{l}</span></label>
        ))}
        {v.exp === 'custom' && (
          <span className="date-range colf-dates">
            <input type="date" value={v.expFrom} max={v.expTo || undefined} onChange={(e) => setV({ ...v, expFrom: e.target.value })} aria-label="Expired dari tanggal" />
            <span className="muted">–</span>
            <input type="date" value={v.expTo} min={v.expFrom || undefined} onChange={(e) => setV({ ...v, expTo: e.target.value })} aria-label="Expired sampai tanggal" />
          </span>
        )}
      </div>
      <div className="colf-foot">
        <button className="link small" onClick={() => onApply(undefined)} disabled={!value?.exp}><X size={13} /> Hapus filter</button>
        <button className="btn primary sm" onClick={() => onApply(v.exp ? v : undefined)}>OK</button>
      </div>
    </>
  );
}
