'use client';
import { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileDown, FileSpreadsheet, FilePlus2, Eye, Pencil, Trash2, Upload, Network, FolderKanban, Plus } from 'lucide-react';
import InventoryTable from './InventoryTable';
import { Modal, ConfirmDialog } from './Modal';
import { api, fmtDateTime } from './ui';
import { useSession } from './session';

export const PROXY_MODES = [
  { key: 'direct', label: 'Tanpa proxy', sub: 'Dicek langsung. Kalau hasilnya Check Failed, otomatis dicek ulang lewat proxy.' },
  { key: 'proxy', label: 'Dengan proxy', sub: 'Semua domain di file ini dicek lewat proxy.' },
];
const proxyLabel = (m) => (m === 'proxy' ? 'Dengan proxy' : 'Tanpa proxy → proxy kalau gagal');

/** Kelola group dashboard (mis. Local, Public, Partner). */
function GroupsPanel({ groups, manage, onChanged, setMsg }) {
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null); // { id, name }
  const [del, setDel] = useState(null);
  async function call(url, method, body, ok) {
    try {
      await api(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      setMsg({ ok: true, text: ok }); onChanged();
      return true;
    } catch (e) { setMsg({ ok: false, text: e.message }); return false; }
  }
  return (
    <section className="panel">
      <div className="panel-head wrap">
        <div>
          <h2><FolderKanban size={16} className="h-icon" /> Group dashboard</h2>
          <p className="muted small">Tiap group punya tab dashboard sendiri (nama tab = nama group). Masukkan file Excel ke group lewat kolom <b>Group</b> di daftar file atau saat upload.</p>
        </div>
        {manage && (
          <form className="toolbar" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await call('/api/groups', 'POST', { name: name.trim() }, `Group "${name.trim()}" ditambahkan.`)) setName(''); }}>
            <input className="inline-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama group baru, mis. Internal" maxLength={60} />
            <button className="btn ghost" disabled={!name.trim()}><Plus size={15} /> Tambah group</button>
          </form>
        )}
      </div>
      <div className="group-cards">
        {groups.map((g) => (
          <div key={g.id} className="group-card">
            {edit?.id === g.id ? (
              <form className="group-edit" onSubmit={async (e) => { e.preventDefault(); if (await call(`/api/groups/${g.id}`, 'PATCH', { name: edit.name }, `Nama group diganti menjadi "${edit.name}".`)) setEdit(null); }}>
                <input className="inline-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus maxLength={60} />
                <button className="btn primary sm">Simpan</button>
                <button type="button" className="link small" onClick={() => setEdit(null)}>Batal</button>
              </form>
            ) : (
              <>
                <b>{g.name}</b>
                <span className="muted small">{g.files} file · {g.domains} domain</span>
                {manage && (
                  <span className="row-actions">
                    <button className="icon-btn" title="Ganti nama" aria-label={`Ganti nama ${g.name}`} onClick={() => setEdit({ id: g.id, name: g.name })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title="Hapus group" aria-label={`Hapus ${g.name}`} onClick={() => setDel(g)}><Trash2 size={14} /></button>
                  </span>
                )}
              </>
            )}
          </div>
        ))}
        {!groups.length && <p className="muted">Belum ada group.</p>}
      </div>
      {del && (
        <ConfirmDialog danger title={`Hapus group "${del.name}"?`} confirmLabel="Hapus group"
          message={<p>Tab dashboard group ini hilang. {del.files ? <><b>{del.files} file</b> di dalamnya tidak dihapus, hanya jadi <b>Tanpa group</b>.</> : 'Group ini belum berisi file.'}</p>}
          onConfirm={() => call(`/api/groups/${del.id}`, 'DELETE', null, `Group "${del.name}" dihapus.`)} onClose={() => setDel(null)} />
      )}
    </section>
  );
}

function FileNameDialog({ title, initial = '', withProxy, groups = [], onSave, onClose }) {
  const [name, setName] = useState(initial);
  const [proxy, setProxy] = useState('direct');
  const [group, setGroup] = useState(groups[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await onSave({ name: name.trim(), proxy_mode: proxy, group_id: group || null }); onClose(); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose} width={460}>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Nama file (juga nama dashboard)</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={100} /></label>
        {withProxy && (
          <label className="field"><span>Group dashboard</span>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="">Tanpa group</option>
            </select>
          </label>
        )}
        {withProxy && (
          <div className="seg vertical" role="radiogroup" aria-label="Proxy">
            {PROXY_MODES.map((m) => (
              <button type="button" key={m.key} role="radio" aria-checked={proxy === m.key} className={proxy === m.key ? 'on' : ''} onClick={() => setProxy(m.key)}>
                <b>{m.label}</b><span>{m.sub}</span>
              </button>
            ))}
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function SourceOfTruthView({ reloadKey, onChanged }) {
  const { can } = useSession();
  const manage = can('manage_domains');
  const input = useRef(null);
  const reupload = useRef(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [proxyMode, setProxyMode] = useState('direct');
  const [uploadGroup, setUploadGroup] = useState('');
  const [files, setFiles] = useState(null);
  const [groups, setGroups] = useState([]);
  const [proxyConfigured, setProxyConfigured] = useState(true);
  const [sel, setSel] = useState(null);
  const [dialog, setDialog] = useState(null); // { type: 'create' | 'rename', file }
  const [confirm, setConfirm] = useState(null);
  const [reuploadId, setReuploadId] = useState(null);

  const load = () => api('/api/files').then((r) => {
    setFiles(r.files); setGroups(r.groups || []); setProxyConfigured(r.proxyConfigured);
    setUploadGroup((g) => (g === '' && r.groups?.length ? String(r.groups[0].id) : g));
    setSel((cur) => {
      let saved = null;
      try { saved = Number(localStorage.getItem('ssl-sot-file')) || null; } catch {}
      const want = cur ?? saved;
      return r.files.some((f) => f.id === want) ? want : r.files[0]?.id ?? null;
    });
  }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (id) => { setSel(id); try { localStorage.setItem('ssl-sot-file', String(id)); } catch {} };
  const changed = () => { load(); onChanged?.(); };

  async function upload(file, fileId) {
    if (!file) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    if (!fileId) fd.append('proxy_mode', proxyMode);
    if (uploadGroup && !fileId) fd.append('group_id', uploadGroup);
    if (fileId) fd.append('file_id', String(fileId));
    try {
      const r = await api('/api/upload', { method: 'POST', body: fd });
      const parts = [`${r.total} domain terbaca`, `${r.added} baru`, `${r.removed} dihapus`];
      if (r.skipped.length) parts.push(`${r.skipped.length} baris dilewati (baris ${r.skipped.map((x) => x.row).join(', ')})`);
      setMsg({ ok: true, text: `${r.created ? 'File baru' : 'File'} "${r.file.name}": ${parts.join(' · ')}. ${r.autoScan ? 'Sertifikat sedang dicek otomatis, hasilnya muncul dalam beberapa saat.' : 'Domain baru dicek setelah scan yang sedang berjalan selesai (atau klik "Sync Now").'}` });
      if (r.autoScan) setTimeout(changed, 8000);
      pick(r.file.id);
      changed();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (reupload.current) reupload.current.value = '';
    }
  }

  async function patchFile(f, body, okText) {
    try {
      await api(`/api/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setMsg({ ok: true, text: okText }); changed();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }

  const cur = files?.find((f) => f.id === sel) || null;
  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`} onClick={() => setMsg(null)}>{msg.text}</div>}

      <GroupsPanel groups={groups} manage={manage} onChanged={changed} setMsg={setMsg} />

      <section className="panel">
        <div className="panel-head wrap">
          <div>
            <h2><FileSpreadsheet size={16} className="h-icon" /> File Source of Truth</h2>
            <p className="muted small">Tiap file Excel adalah satu sumber data di dalam sebuah group dashboard. Semua file dipantau bersama.</p>
          </div>
          <div className="toolbar">
            {can('export') && <a className="btn ghost" href="/api/template"><FileDown size={15} /> Template kosong</a>}
            {manage && <button className="btn ghost" onClick={() => setDialog({ type: 'create' })}><FilePlus2 size={15} /> Buat file kosong</button>}
          </div>
        </div>
        {!proxyConfigured && (
          <div className="alert info small"><Network size={14} className="h-icon" /> Proxy belum diisi di <b>Settings → Proxy untuk cek SSL</b>. Sampai diisi, semua domain dicek langsung dan tidak ada percobaan ulang lewat proxy.</div>
        )}

        <div className="table-wrap">
          <table className="files-table">
            <thead><tr><th>Nama file</th><th>Group</th><th>Domain</th><th>Bermasalah</th><th>Proxy</th><th>Diubah</th><th>Aksi</th></tr></thead>
            <tbody>
              {files?.map((f) => (
                <tr key={f.id} className={`clickable ${f.id === sel ? 'sel' : ''}`} onClick={() => pick(f.id)}>
                  <td><b>{f.name}</b>{f.original_file && <div className="muted small">{f.original_file}</div>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {manage ? (
                      <select value={f.group_id || ''} aria-label={`Group ${f.name}`}
                        onChange={(e) => patchFile(f, { group_id: e.target.value || null }, `"${f.name}" dipindah ke ${e.target.value ? groups.find((g) => String(g.id) === e.target.value)?.name : 'Tanpa group'}.`)}>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        <option value="">Tanpa group</option>
                      </select>
                    ) : <span className="small">{f.group_name || 'Tanpa group'}</span>}
                  </td>
                  <td>{f.domains}</td>
                  <td className={f.problems ? 'txt-danger' : 'muted'}>{f.problems}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {manage ? (
                      <select value={f.proxy_mode} aria-label={`Proxy ${f.name}`}
                        onChange={(e) => patchFile(f, { proxy_mode: e.target.value }, `"${f.name}": ${proxyLabel(e.target.value)}. Berlaku mulai scan berikutnya.`)}>
                        {PROXY_MODES.map((m) => <option key={m.key} value={m.key}>{proxyLabel(m.key)}</option>)}
                      </select>
                    ) : <span className="small">{proxyLabel(f.proxy_mode)}</span>}
                  </td>
                  <td className="small">{fmtDateTime(f.updated_at)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className="row-actions">
                      <button className="icon-btn" title="Lihat & ubah isi" aria-label={`Lihat isi ${f.name}`} onClick={() => pick(f.id)}><Eye size={16} /></button>
                      {can('export') && <a className="icon-btn" title="Download Excel terbaru" aria-label={`Download ${f.name}`} href={`/api/excel/export?file=${f.id}`}><FileDown size={15} /></a>}
                      {manage && <button className="icon-btn" title="Upload ulang file ini" aria-label={`Upload ulang ${f.name}`} disabled={busy}
                        onClick={() => { setReuploadId(f.id); reupload.current?.click(); }}><Upload size={15} /></button>}
                      {manage && <button className="icon-btn" title="Ganti nama" aria-label={`Ganti nama ${f.name}`} onClick={() => setDialog({ type: 'rename', file: f })}><Pencil size={15} /></button>}
                      {manage && <button className="icon-btn danger" title="Hapus file" aria-label={`Hapus ${f.name}`} onClick={() => setConfirm(f)}><Trash2 size={15} /></button>}
                    </span>
                  </td>
                </tr>
              ))}
              {files && !files.length && <tr><td colSpan={7} className="empty">Belum ada file. Upload Excel di bawah, atau klik "Buat file kosong".</td></tr>}
            </tbody>
          </table>
        </div>
        <input ref={reupload} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => upload(e.target.files[0], reuploadId)} />

        {manage && (
          <>
            <h3 className="sub-h">Upload file Excel</h3>
            <p className="muted small">Kolom wajib: <b>Domain</b>. Opsional: Environment, Application, Owner, Port, Notes. Nama file menjadi nama sumber. Kalau nama file sudah ada, isinya diganti dengan isi file baru.</p>
            <div className="upload-opts">
              <label className="field">
                <span className="opt-label">Group dashboard</span>
                <select value={uploadGroup} onChange={(e) => setUploadGroup(e.target.value)} aria-label="Group untuk upload">
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="">Tanpa group</option>
                </select>
              </label>
              <div>
                <span className="opt-label">Cek SSL</span>
                <div className="seg" role="radiogroup" aria-label="Proxy">
                  {PROXY_MODES.map((m) => (
                    <button key={m.key} role="radio" aria-checked={proxyMode === m.key} className={proxyMode === m.key ? 'on' : ''} onClick={() => setProxyMode(m.key)}>
                      <b>{m.label}</b><span>{m.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
              onClick={() => input.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
            >
              <UploadCloud size={32} />
              <div><b>{busy ? 'Mengupload…' : 'Klik atau tarik file Excel ke sini'}</b></div>
              <div className="muted small">.xlsx, .xls, atau .csv · group: {uploadGroup ? groups.find((g) => String(g.id) === uploadGroup)?.name : 'tanpa group'} · {proxyMode === 'proxy' ? 'dengan proxy' : 'tanpa proxy (otomatis proxy kalau gagal)'}</div>
              <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => upload(e.target.files[0])} />
            </div>
          </>
        )}
      </section>

      {cur && (
        <InventoryTable key={cur.id} fileId={cur.id} title={`Isi file: ${cur.name}`}
          subtitle={manage ? `${proxyLabel(cur.proxy_mode)}. Tambah, ubah, atau hapus domain di file ini, lalu klik ikon download untuk mendapatkan file Excel terbarunya.` : 'Daftar domain di file ini.'}
          reloadKey={reloadKey} onChanged={changed} editable={manage} onNotice={setMsg} />
      )}

      {dialog?.type === 'create' && (
        <FileNameDialog title="Buat file Source of Truth kosong" withProxy groups={groups} onClose={() => setDialog(null)}
          onSave={async (b) => { const r = await api('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); pick(r.file.id); setMsg({ ok: true, text: `File "${r.file.name}" dibuat. Tambahkan domain lewat tombol "Tambah domain".` }); changed(); }} />
      )}
      {dialog?.type === 'rename' && (
        <FileNameDialog title={`Ganti nama "${dialog.file.name}"`} initial={dialog.file.name} onClose={() => setDialog(null)}
          onSave={async (b) => { await api(`/api/files/${dialog.file.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.name }) }); setMsg({ ok: true, text: `Nama file diganti menjadi "${b.name}".` }); changed(); }} />
      )}
      {confirm && (
        <ConfirmDialog danger title={`Hapus file "${confirm.name}"?`} confirmLabel="Hapus file" requireText="HAPUS"
          message={<>
            <p>File ini beserta <b>{confirm.domains} domain</b> dan seluruh riwayat scan-nya akan dihapus permanen, dan dashboard-nya hilang.</p>
            <p className="muted small">Download dulu Excel terbarunya kalau masih diperlukan.</p>
          </>}
          onConfirm={async () => { const r = await api(`/api/files/${confirm.id}`, { method: 'DELETE' }); setMsg({ ok: true, text: `File "${r.file.name}" dan ${r.domains} domain dihapus.` }); changed(); }}
          onClose={() => setConfirm(null)} />
      )}
    </>
  );
}

export { default as SettingsView } from './SettingsView';
