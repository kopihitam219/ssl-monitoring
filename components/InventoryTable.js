'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search, Download, Eye, ChevronLeft, ChevronRight, RotateCw, Plus, Pencil, Trash2, X, Filter, FolderKanban } from 'lucide-react';
import { StatusBadge, STATUS, fmtDateTime, fmtDate, fmtExpiresIn, trustNote, api } from './ui';
import DomainDrawer from './DomainDrawer';
import { DomainForm, ConfirmDialog } from './Modal';
import ColumnFilter from './ColumnFilter';
import { useSession } from './session';

const statusLabel = (v) => STATUS[v]?.label || v;
const EXP_LABEL = { expired: 'Sudah expired', 7: 'Habis ≤ 7 hari', 30: 'Habis ≤ 30 hari', 60: 'Habis ≤ 60 hari', 90: 'Habis ≤ 90 hari', custom: 'Expired antara tanggal' };
const LAST_LABEL = { never: 'Belum pernah dicek', 1: '> 1 hari lalu', 7: '> 7 hari lalu', 30: '> 30 hari lalu' };
const COL_LABEL = { group: 'Group', file: 'File', domain: 'Domain', environment: 'Environment', application: 'Application', owner: 'Owner', port: 'Port', status: 'Status SSL', issuer: 'Issuer', last_checked: 'Last Checked' };

/** Tag cara cek terakhir: lewat proxy / lewat proxy otomatis karena gagal langsung. */
export function ViaTag({ via }) {
  if (via === 'fallback') return <span className="dtag fallback" title="Cek langsung gagal, lalu otomatis berhasil lewat proxy">proxy (otomatis)</span>;
  if (via === 'proxy') return <span className="dtag proxy" title="Dicek lewat proxy">proxy</span>;
  return null;
}

/** Ringkasan tes koneksi terakhir, mis. "DNS ✓ · Ping ✗ · Port 443 ✓ · HTTPS 200 · Proxy ✓" */
export function connLine(raw) {
  let r = null;
  try { r = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
  if (!r) return null;
  const m = (x) => (x?.ok ? '✓' : x?.ok === null ? '–' : '✗');
  return {
    text: [`DNS ${m(r.dns)}`, `Ping ${m(r.ping)}`, `Port ${r.port} ${m(r.tcp)}`, `HTTPS ${r.https?.ok ? r.https.status || 'TLS ✓' : '✗'}`, r.proxy ? `Proxy ${r.proxy.https?.ok ? r.proxy.https.status || '✓' : '✗'}` : null].filter(Boolean).join(' · '),
    level: r.conclusion?.level, conclusion: r.conclusion?.text, raw: r,
  };
}

/**
 * fileId diisi  → tabel hanya untuk satu file Source of Truth (halaman Source of Truth): kolom File disembunyikan, "Tambah domain" langsung ke file itu.
 * groupId diisi → tabel hanya untuk satu group dashboard (dropdown group disembunyikan).
 */
export default function InventoryTable({ title = 'SSL Inventory', subtitle = 'Daftar domain dan status sertifikat SSL',
  initialStatus = '', pageSize = 10, reloadKey = 0, onChanged, editable = false, onNotice, preset = null, onClearPreset, hidePresetChip = false, fileId = null, groupId = null, hideStatusChip = false }) {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [group, setGroup] = useState('');
  const [files, setFiles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [cf, setCf] = useState({}); // filter per kolom
  const [expF, setExpF] = useState(null); // { exp, expFrom, expTo }
  const [sort, setSort] = useState({ key: 'priority', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, facets: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [confirmDel, setConfirmDel] = useState(null); // null | array of rows
  // preset = filter dari Dashboard Monitoring (panel / hasil cek / renewal / kartu)
  const pre = preset ? Object.fromEntries(['panel', 'ssl', 'renewed', 'kpi', 'cert'].filter((k) => preset[k]).map((k) => [k, preset[k]])) : {};
  const preKey = JSON.stringify(pre);
  const scope = fileId ? String(fileId) : '';
  const groupScope = groupId != null ? String(groupId) : group;

  const loadFiles = useCallback(() => api('/api/files').then((r) => { setFiles(r.files); setGroups(r.groups || []); }).catch(() => {}), []);
  useEffect(() => { loadFiles(); }, [loadFiles, reloadKey]);
  useEffect(() => setStatus(initialStatus), [initialStatus]);

  const cfKey = JSON.stringify(cf);
  const filterKey = [q, status, scope, groupScope, cfKey, JSON.stringify(expF), preKey].join('|');
  useEffect(() => setPage(1), [filterKey]);
  useEffect(() => setSelected(new Set()), [reloadKey, filterKey, page]);

  const params = new URLSearchParams({
    q, status, file: scope, group: groupScope, exp: expF?.exp || '', expFrom: expF?.exp === 'custom' ? expF.expFrom || '' : '', expTo: expF?.exp === 'custom' ? expF.expTo || '' : '',
    cf: Object.keys(cf).length ? cfKey : '', sort: sort.key, dir: sort.dir, ...pre,
  });
  for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api(`/api/domains?${params}&page=${page}&pageSize=${pageSize}&facets=1`)
        .then((d) => alive && (setData(d), setError('')))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    }, q || cf.domain ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, sort.key, sort.dir, page, pageSize, reloadKey]);

  const allOnPage = data.rows.length > 0 && data.rows.every((d) => selected.has(d.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(data.rows.map((d) => d.id)));

  async function doDelete(rows) {
    const res = await api('/api/excel', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: rows.map((r) => r.id) }) });
    onNotice?.({ ok: true, text: `${res.removed} domain dihapus dan tidak dipantau lagi (bisa dikembalikan di Settings → Domain yang dihapus).` });
    onChanged?.();
  }

  const setCol = (col) => (v) => setCf((c) => { const n = { ...c }; if (v === undefined || v === '') delete n[col]; else n[col] = v; return n; });
  const onSort = (key, dir) => setSort({ key, dir });
  const col = (key, label, extra = {}) => (
    <ColumnFilter label={label} sortKey={key} sort={sort.key} dir={sort.dir} onSort={onSort}
      facet={data.facets?.[key] || []} value={cf[key]} onChange={setCol(key)} {...extra} />
  );

  // chip filter aktif
  const chips = [
    ...Object.entries(cf).map(([k, v]) => ({
      key: `cf-${k}`, text: `${COL_LABEL[k] || k}: ${Array.isArray(v) ? (v.length > 2 ? `${v.length} nilai` : v.map((x) => (k === 'status' ? statusLabel(x) : x || '(Kosong)')).join(', ')) : k === 'last_checked' ? LAST_LABEL[v] : v}`,
      clear: () => setCol(k)(undefined),
    })),
    ...(expF?.exp ? [{ key: 'exp', text: `Masa berlaku: ${EXP_LABEL[expF.exp]}${expF.exp === 'custom' ? ` ${expF.expFrom || '…'} – ${expF.expTo || '…'}` : ''}`, clear: () => setExpF(null) }] : []),
    ...(status && !hideStatusChip ? [{ key: 'st', text: `Status: ${statusLabel(status)}`, clear: () => setStatus('') }] : []),
  ];
  const clearAll = () => { setCf({}); setExpF(null); if (!hideStatusChip) setStatus(''); setQ(''); if (groupId == null) setGroup(''); };

  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const from = data.total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, data.total);
  const pageList = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === pages);
  const showFile = !fileId;
  const nCols = 12 + (editable ? 1 : 0) + (showFile ? 1 : 0);

  return (
    <section className="panel">
      <div className="panel-head wrap">
        <div>
          <h2>{title}</h2>
          <p className="muted small">{subtitle}</p>
        </div>
        <div className="toolbar">
          <label className="search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari domain, aplikasi, owner…" aria-label="Cari" />
          </label>
          {!fileId && groupId == null && (
            <label className="file-select">
              <FolderKanban size={15} />
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group dashboard">
                <option value="">Semua group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.domains})</option>)}
                {files.some((f) => !f.group_id) && <option value="none">Tanpa group</option>}
              </select>
            </label>
          )}
          {can('export') && <a className="btn ghost" href={`/api/export?${params}`}><Download size={15} /> Export</a>}
          {editable && <button className="btn primary" onClick={() => setEditing('new')} disabled={!files.length}
            title={!files.length ? 'Upload Excel atau buat file dulu di menu Source of Truth' : ''}><Plus size={15} /> Tambah domain</button>}
        </div>
      </div>

      {(chips.length > 0 || (preset && !hidePresetChip)) && (
        <div className="chips">
          {preset && !hidePresetChip && (
            <span className="preset-chip">
              <Filter size={14} /> {preset.label || 'Filter dari Dashboard Monitoring'}
              {onClearPreset && <button onClick={onClearPreset} aria-label="Hapus filter" title="Hapus filter"><X size={13} /></button>}
            </span>
          )}
          {chips.map((c) => (
            <span key={c.key} className="preset-chip">
              <Filter size={13} /> {c.text}
              <button onClick={c.clear} aria-label="Hapus filter" title="Hapus filter"><X size={13} /></button>
            </span>
          ))}
          {chips.length > 1 && <button className="link small" onClick={clearAll}>Hapus semua filter</button>}
        </div>
      )}

      {editable && selected.size > 0 && (
        <div className="selbar">
          <span><b>{selected.size}</b> domain dipilih</span>
          <button className="btn danger sm" onClick={() => setConfirmDel(data.rows.filter((d) => selected.has(d.id)))}><Trash2 size={14} /> Hapus terpilih</button>
          <button className="link small" onClick={() => setSelected(new Set())}>Batal pilih</button>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {editable && <th className="chk"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Pilih semua di halaman ini" /></th>}
              <th>No</th>
              <ColumnFilter label="Domain" sortKey="domain" sort={sort.key} dir={sort.dir} onSort={onSort} kind="text" value={cf.domain} onChange={setCol('domain')} />
              {showFile && col('file', 'File')}
              {col('environment', 'Environment')}
              {col('application', 'Application')}
              {col('owner', 'Owner')}
              {col('port', 'Port')}
              {col('status', 'Status SSL', { format: statusLabel })}
              <ColumnFilter label="Expires In" sortKey="days" sort={sort.key} dir={sort.dir} onSort={onSort} kind="exp" value={expF} onChange={setExpF} />
              <ColumnFilter label="Tanggal Expired" sortKey="days" sort={sort.key} dir={sort.dir} onSort={onSort} kind="exp" value={expF} onChange={setExpF} />
              {col('issuer', 'Issuer')}
              <ColumnFilter label="Last Checked" sortKey="last_checked" sort={sort.key} dir={sort.dir} onSort={onSort} kind="last" value={cf.last_checked} onChange={setCol('last_checked')} />
              <th>Action</th>
            </tr>
          </thead>
          <tbody className={loading ? 'loading' : ''}>
            {data.rows.map((d, i) => (
              <tr key={d.id} className={selected.has(d.id) ? 'sel' : ''}>
                {editable && <td className="chk"><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Pilih ${d.domain}`} /></td>}
                <td className="muted">{from + i}</td>
                <td>
                  <button className="link" onClick={() => setOpenId(d.id)}>{d.domain}</button>
                  {(d.checked_via === 'proxy' || d.checked_via === 'fallback') && <span className="dom-tags"><ViaTag via={d.checked_via} /></span>}
                  {d.last_error && (d.status === 'CHECK_FAILED'
                    ? <div className="err-line" title={d.last_error}>{d.last_error}</div>
                    : <div className="warn-line" title={d.last_error}>{trustNote(d.last_error, d)}</div>)}
                  {!d.last_error && d.subject && d.subject.toLowerCase() !== d.domain && !d.subject.startsWith('*.') && <div className="cert-name" title="Nama di sertifikat (Common Name)">sertifikat: {d.subject}</div>}
                  {d.status === 'CHECK_FAILED' && connLine(d.conn_test) && (() => { const c = connLine(d.conn_test); return <div className={`conn-line ${c.level}`} title={c.conclusion}>Tes koneksi: {c.text}</div>; })()}
                </td>
                {showFile && <td className="small"><span className="file-chip" title={d.proxy_mode === 'proxy' ? 'Dengan proxy' : 'Tanpa proxy (otomatis coba proxy kalau gagal)'}>{d.file_name || '—'}</span>{d.group_name && <div className="muted small">{d.group_name}</div>}</td>}
                <td>{d.environment || <span className="muted">—</span>}</td>
                <td>{d.application || <span className="muted">—</span>}</td>
                <td>{d.owner || <span className="muted">—</span>}</td>
                <td>{d.port}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className={d.days_remaining < 0 ? 'txt-danger' : ''}>{d.expires_at ? fmtExpiresIn(d.days_remaining) : <span className="muted">—</span>}</td>
                <td className={d.days_remaining < 0 ? 'txt-danger' : ''}>{d.expires_at ? fmtDate(d.expires_at) : <span className="muted">—</span>}</td>
                <td className="small">{d.issuer || <span className="muted">—</span>}</td>
                <td className="small">{fmtDateTime(d.last_checked)}</td>
                <td>
                  <span className="row-actions">
                    <button className="icon-btn" onClick={() => setOpenId(d.id)} aria-label={`Detail ${d.domain}`} title="Detail"><Eye size={16} /></button>
                    {editable && <button className="icon-btn" onClick={() => setEditing(d)} aria-label={`Ubah ${d.domain}`} title="Ubah"><Pencil size={15} /></button>}
                    {editable && <button className="icon-btn danger" onClick={() => setConfirmDel([d])} aria-label={`Hapus ${d.domain}`} title="Hapus"><Trash2 size={15} /></button>}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && !data.rows.length && (
              <tr><td colSpan={nCols} className="empty">{editable && !chips.length && !q ? 'Belum ada domain. Upload Excel atau klik "Tambah domain".' : 'Tidak ada domain yang cocok dengan filter.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span className="muted small">Menampilkan {from} - {to} dari {data.total} domain</span>
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Sebelumnya"><ChevronLeft size={16} /></button>
          {pageList.map((p, i) => (
            <span key={p} className="pager-item">
              {i > 0 && p - pageList[i - 1] > 1 && <span className="muted">…</span>}
              <button className={p === page ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
            </span>
          ))}
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Berikutnya"><ChevronRight size={16} /></button>
          {loading && <RotateCw size={14} className="spin muted" />}
        </div>
      </div>

      {openId && <DomainDrawer id={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
      {editing && (
        <DomainForm domain={editing === 'new' ? null : editing} files={files} fileId={fileId || null} onClose={() => setEditing(null)}
          onSaved={(r) => {
            onNotice?.({ ok: true, text: editing === 'new'
              ? `${r.domain} ditambahkan dan sudah dicek (status: ${STATUS[r.status]?.label || r.status}).`
              : 'Perubahan disimpan.' });
            onChanged?.();
          }} />
      )}
      {confirmDel && (
        <ConfirmDialog danger title={confirmDel.length > 1 ? `Hapus ${confirmDel.length} domain?` : `Hapus ${confirmDel[0].domain}?`}
          confirmLabel="Hapus"
          message={<>
            <p>{confirmDel.length > 1 ? 'Domain berikut' : 'Domain ini'} akan dihapus dari file Source of Truth-nya dan tidak lagi dipantau:</p>
            <p className="del-list">{confirmDel.slice(0, 8).map((d) => d.domain).join(', ')}{confirmDel.length > 8 ? ` +${confirmDel.length - 8} lainnya` : ''}</p>
            <p className="muted small">Domain bisa dikembalikan di <b>Settings → Domain yang dihapus</b>, atau dengan menambahkannya lagi secara manual / upload Excel. Riwayat scan tidak dihapus.</p>
          </>}
          onConfirm={() => doDelete(confirmDel)} onClose={() => setConfirmDel(null)} />
      )}
    </section>
  );
}
