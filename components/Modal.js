'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from './ui';

export function Modal({ title, onClose, children, width = 480 }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: `min(${width}px, 100%)` }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Dialog konfirmasi. danger=true → tombol merah. requireText → user harus mengetik teks itu. */
export function ConfirmDialog({ title, message, confirmLabel = 'Ya, lanjutkan', danger, requireText, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  async function go() {
    setBusy(true); setError('');
    try { await onConfirm(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose} width={440}>
      <div className="modal-body">{message}</div>
      {requireText && (
        <label className="field">
          <span>Ketik <b>{requireText}</b> untuk konfirmasi</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={go} disabled={busy || (requireText && typed !== requireText)}>
          {busy ? 'Memproses…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const ENVS = ['Production', 'Development', 'UAT', 'Staging'];

/** Form tambah / ubah domain Source of Truth. domain=null → tambah baru. */
export const FILE_MANUAL = 'Input Manual';

export function DomainForm({ domain, onClose, onSaved, files = [], fileId = null, groups = [] }) {
  const editing = !!domain;
  const [f, setF] = useState({
    domain: domain?.domain || '',
    port: domain?.port || 443,
    environment: domain?.environment || '',
    application: domain?.application || '',
    owner: domain?.owner || '',
    notes: domain?.notes || '',
    file_id: domain?.file_id || fileId || files[0]?.id || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Belum ada file Source of Truth sama sekali → domain disimpan ke file "Input Manual" (dibuat otomatis).
  const tanpaFile = !editing && !fileId && !files.length;
  const [groupId, setGroupId] = useState('');

  /** Cari / buat file "Input Manual" untuk domain yang ditambahkan tanpa Excel. */
  async function fileManual() {
    try {
      const r = await api('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FILE_MANUAL, proxy_mode: 'direct', group_id: groupId || null }) });
      return r.file.id;
    } catch (e) {
      const r = await api('/api/files');
      const ada = r.files.find((x) => x.name.toLowerCase() === FILE_MANUAL.toLowerCase());
      if (ada) return ada.id;
      throw e;
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = tanpaFile ? { ...f, file_id: await fileManual() } : f;
      const res = await api(editing ? `/api/excel/${domain.id}` : '/api/excel', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSaved(res);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'Ubah domain' : 'Tambah domain'} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="form">
        {tanpaFile ? (
          <label className="field">
            <span>Group dashboard</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Tanpa group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <small className="muted">Belum ada file Excel — domain disimpan ke file "{FILE_MANUAL}" yang dibuat otomatis.</small>
          </label>
        ) : (
        <label className="field">
          <span>File Source of Truth *{editing ? ' (pilih file lain untuk memindahkan domain)' : ''}</span>
          <select value={f.file_id} onChange={set('file_id')} required>
            {files.map((x) => <option key={x.id} value={x.id}>{x.name}{x.group_name ? ` · ${x.group_name}` : ''} ({x.proxy_mode === 'proxy' ? 'dengan proxy' : 'tanpa proxy'})</option>)}
            {f.file_id && !files.some((x) => String(x.id) === String(f.file_id)) && <option value={f.file_id}>File ini</option>}
          </select>
        </label>
        )}
        <div className="form-row">
          <label className="field grow">
            <span>Domain *</span>
            <input value={f.domain} onChange={set('domain')} placeholder="app.perusahaan.co.id" required autoFocus />
          </label>
          <label className="field port">
            <span>Port</span>
            <input type="number" min="1" max="65535" value={f.port} onChange={set('port')} />
          </label>
        </div>
        <label className="field">
          <span>Environment</span>
          <input value={f.environment} onChange={set('environment')} list="env-list" placeholder="mis. Production" />
          <datalist id="env-list">{ENVS.map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <div className="form-row">
          <label className="field grow"><span>Application</span><input value={f.application} onChange={set('application')} /></label>
          <label className="field grow"><span>Owner</span><input value={f.owner} onChange={set('owner')} placeholder="mis. IT Team" /></label>
        </div>
        <label className="field"><span>Notes</span><input value={f.notes} onChange={set('notes')} /></label>
        <p className="muted small">
          {editing
            ? 'Kalau domain atau port diganti, riwayat scan lama dihapus dan domain langsung dicek ulang.'
            : 'Setelah disimpan, sertifikat domain ini langsung dicek dan muncul di SSL Inventory.'}
        </p>
        {error && <div className="alert error">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? (editing ? 'Menyimpan…' : 'Menambah & mengecek…') : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
}
