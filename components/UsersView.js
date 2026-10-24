'use client';
import { useEffect, useState } from 'react';
import { UserPlus, Pencil, KeyRound, Trash2, ShieldCheck, Eye, Save, Lock } from 'lucide-react';
import { api, fmtDateTime } from './ui';
import { Modal, ConfirmDialog } from './Modal';
import { useSession, ROLE_LABEL } from './session';

function UserForm({ user, onClose, onSaved }) {
  const editing = !!user;
  const [f, setF] = useState({ username: user?.username || '', name: user?.name || '', role: user?.role || 'monitoring', active: user?.active ?? true, password: '', mustChange: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = editing ? { name: f.name, role: f.role, active: f.active } : f;
      await api(editing ? `/api/users/${user.id}` : '/api/users', { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onSaved(editing ? `User ${f.username} diperbarui.` : `User ${f.username} ditambahkan.`);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Ubah user ${user.username}` : 'Tambah user'} onClose={busy ? () => {} : onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="field grow"><span>Username *</span>
            <input value={f.username} onChange={set('username')} disabled={editing} placeholder="mis. budi.s" autoFocus={!editing} required />
          </label>
          <label className="field grow"><span>Nama</span><input value={f.name} onChange={set('name')} placeholder="Budi Santoso" autoFocus={editing} /></label>
        </div>
        {user?.authSource === 'entra' && <div className="alert info">User Microsoft Entra ID: peran diatur lewat grup di Entra ID dan diperbarui saat sync. Di sini hanya bisa ubah nama dan status aktif.</div>}
        <div className="field" style={user?.authSource === 'entra' ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          <span>Peran</span>
          <div className="seg">
            <button type="button" className={f.role === 'admin' ? 'on' : ''} onClick={() => setF({ ...f, role: 'admin' })}>
              <b>Admin</b><span>Akses penuh: semua menu, Settings, Users, Restart service.</span>
            </button>
            <button type="button" className={f.role === 'monitoring' ? 'on' : ''} onClick={() => setF({ ...f, role: 'monitoring' })}>
              <b>Monitoring</b><span>Melihat dashboard. Izin tambahan diatur di "Hak akses Monitoring".</span>
            </button>
          </div>
        </div>
        {!editing && (
          <>
            <label className="field"><span>Password awal *</span>
              <input type="text" value={f.password} onChange={set('password')} placeholder="Minimal 8 karakter, huruf & angka" autoComplete="off" required />
            </label>
            <label className="check"><input type="checkbox" checked={f.mustChange} onChange={set('mustChange')} /> Wajib ganti password saat pertama login</label>
          </>
        )}
        {editing && (
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Akun aktif (nonaktif = tidak bisa login)</label>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordForm({ user, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/api/users/${user.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, mustChange }) });
      onSaved(`Password ${user.username} di-reset. Sampaikan password baru ke yang bersangkutan.`);
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Modal title={`Reset password ${user.username}`} onClose={busy ? () => {} : onClose} width={420}>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Password baru</span>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 8 karakter, huruf & angka" autoComplete="off" autoFocus required />
        </label>
        <label className="check"><input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /> Wajib ganti password saat login berikutnya</label>
        <p className="muted small">User ini otomatis keluar dari semua sesi login yang sedang aktif.</p>
        {error && <div className="alert error">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn primary" disabled={busy}><KeyRound size={15} /> {busy ? 'Menyimpan…' : 'Reset password'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersView() {
  const { user: me } = useSession();
  const [data, setData] = useState(null);
  const [perms, setPerms] = useState([]);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(null);       // 'new' | user
  const [reset, setReset] = useState(null);     // user
  const [confirm, setConfirm] = useState(null); // user
  const [savingPerms, setSavingPerms] = useState(false);

  const load = () => api('/api/users').then((d) => { setData(d); setPerms(d.monitoringPermissions); }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);
  const saved = (text) => { setMsg({ ok: true, text }); load(); };

  async function savePerms() {
    setSavingPerms(true); setMsg(null);
    try {
      await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: { monitoring: perms } }) });
      saved('Hak akses peran Monitoring disimpan. Berlaku langsung untuk semua user Monitoring.');
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setSavingPerms(false); }
  }

  if (!data) return <section className="panel">{msg ? <div className="alert error">{msg.text}</div> : <p className="muted">Memuat…</p>}</section>;
  const dirtyPerms = [...perms].sort().join() !== [...data.monitoringPermissions].sort().join();

  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}

      <section className="panel">
        <div className="panel-head wrap">
          <div>
            <h2>Users</h2>
            <p className="muted small">Kelola akun yang bisa login ke aplikasi ini.</p>
          </div>
          <button className="btn primary" onClick={() => setForm('new')}><UserPlus size={15} /> Tambah user</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Username</th><th>Nama</th><th>Peran</th><th>Status</th><th>Login terakhir</th><th>Dibuat</th><th>Action</th></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="cell-domain"><b>{u.username}</b>{u.id === me.id && <span className="pill">Anda</span>}{u.authSource === 'entra' && <span className="ms-badge">Entra ID</span>}</td>
                  <td data-label="Nama">{u.name || <span className="muted">—</span>}</td>
                  <td className="cell-status" data-label="Peran"><span className={`role-badge ${u.role}`}>{u.role === 'admin' ? <ShieldCheck size={12} /> : <Eye size={12} />} {ROLE_LABEL[u.role]}</span></td>
                  <td data-label="Status">
                    {u.active ? <span className="run-state ok">Aktif</span> : <span className="run-state bad">Nonaktif</span>}
                    {u.mustChange && <div className="muted small">wajib ganti password</div>}
                  </td>
                  <td className="small" data-label="Login terakhir">{u.lastLogin ? fmtDateTime(u.lastLogin) : <span className="muted">Belum pernah</span>}</td>
                  <td className="small cell-opt" data-label="Dibuat">{fmtDateTime(u.createdAt)}<div className="muted">oleh {u.createdBy || '—'}</div></td>
                  <td className="cell-actions">
                    <span className="row-actions">
                      <button className="icon-btn" title="Ubah" aria-label={`Ubah ${u.username}`} onClick={() => setForm(u)}><Pencil size={15} /></button>
                      <button className="icon-btn" title={u.authSource === 'entra' ? 'Password dikelola Microsoft Entra ID' : 'Reset password'} aria-label={`Reset password ${u.username}`} disabled={u.authSource === 'entra'} onClick={() => setReset(u)}><KeyRound size={15} /></button>
                      <button className="icon-btn danger" title="Hapus" aria-label={`Hapus ${u.username}`} disabled={u.id === me.id} onClick={() => setConfirm(u)}><Trash2 size={15} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2><Lock size={16} className="h-icon" /> Hak akses peran Monitoring</h2>
        <p className="muted small">
          <b>Admin</b> selalu punya akses penuh. <b>Monitoring</b> selalu bisa melihat Dashboard, SSL Inventory, dan Source of Truth.
          Centang izin tambahan untuk semua user Monitoring. Settings, Users, dan Restart service tetap khusus admin.
        </p>
        <div className="perm-grid">
          {Object.entries(data.permissions).map(([key, label]) => (
            <label key={key} className={`perm ${perms.includes(key) ? 'on' : ''}`}>
              <input type="checkbox" checked={perms.includes(key)}
                onChange={(e) => setPerms(e.target.checked ? [...perms, key] : perms.filter((p) => p !== key))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="toolbar">
          <button className="btn primary" disabled={!dirtyPerms || savingPerms} onClick={savePerms}><Save size={15} /> Simpan hak akses</button>
          {dirtyPerms && <button className="link small" onClick={() => setPerms(data.monitoringPermissions)}>Batal</button>}
        </div>
      </section>

      {form && <UserForm user={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={saved} />}
      {reset && <ResetPasswordForm user={reset} onClose={() => setReset(null)} onSaved={saved} />}
      {confirm && (
        <ConfirmDialog danger title={`Hapus user ${confirm.username}?`} confirmLabel="Hapus"
          message={<p>Akun ini akan dihapus permanen dan langsung keluar dari aplikasi. Catatan audit atas namanya tetap tersimpan.</p>}
          onConfirm={async () => { await api(`/api/users/${confirm.id}`, { method: 'DELETE' }); saved(`User ${confirm.username} dihapus.`); }}
          onClose={() => setConfirm(null)} />
      )}
    </>
  );
}
