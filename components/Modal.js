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
export function DomainForm({ domain, onClose, onSaved, files = [], fileId = null }) {
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

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await api(editing ? `/api/excel/${domain.id}` : '/api/excel', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
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
        <label className="field">
          <span>File Source of Truth *{editing ? ' (pilih file lain untuk memindahkan domain)' : ''}</span>
          <select value={f.file_id} onChange={set('file_id')} required>
            {files.map((x) => <option key={x.id} value={x.id}>{x.name}{x.group_name ? ` · ${x.group_name}` : ''} ({x.proxy_mode === 'proxy' ? 'dengan proxy' : 'tanpa proxy'})</option>)}
          </select>
        </label>
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
