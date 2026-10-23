'use client';
import { useState } from 'react';
import { ShieldHalf, LogIn, UserPlus, Eye, EyeOff, KeyRound } from 'lucide-react';

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
import { api } from './ui';
import { Modal } from './Modal';

function PasswordInput({ value, onChange, autoComplete, placeholder, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw">
      <input type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} autoFocus={autoFocus} required />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <ShieldHalf size={40} className="brand-icon" />
          <div>
            <div className="brand-name">SSL Monitoring</div>
            <div className="brand-tag">Safe Today, Secure Tomorrow</div>
          </div>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function LoginView({ onLogin, expired, microsoft, loginError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loginError || '');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      onLogin(r.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Masuk" subtitle="Gunakan akun Admin atau Monitoring Anda.">
      {expired && !error && <div className="alert info">Sesi Anda berakhir. Silakan login lagi.</div>}
      {microsoft && (
        <>
          <a className="btn ms full" href="/api/auth/microsoft/login"><MicrosoftLogo /> Masuk dengan Microsoft</a>
          <div className="or"><span>atau akun lokal</span></div>
        </>
      )}
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field"><span>Password</span>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary full" disabled={busy}><LogIn size={16} /> {busy ? 'Memeriksa…' : 'Masuk'}</button>
      </form>
      <p className="muted small">Lupa password? Minta admin untuk me-reset password Anda di menu Users.</p>
    </AuthShell>
  );
}

export function SetupView({ onDone }) {
  const [f, setF] = useState({ username: 'admin', name: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (f.password !== f.confirm) { setError('Konfirmasi password tidak sama'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      onDone(r.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Buat akun Admin" subtitle="Belum ada akun di aplikasi ini. Buat akun admin pertama. Admin bisa menambah user lain setelah ini.">
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Username</span><input value={f.username} onChange={set('username')} autoComplete="username" required /></label>
        <label className="field"><span>Nama</span><input value={f.name} onChange={set('name')} placeholder="mis. Tegar" /></label>
        <label className="field"><span>Password</span>
          <PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" placeholder="Minimal 8 karakter, huruf & angka" />
        </label>
        <label className="field"><span>Ulangi password</span>
          <PasswordInput value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary full" disabled={busy}><UserPlus size={16} /> {busy ? 'Membuat…' : 'Buat akun & masuk'}</button>
      </form>
      <p className="muted small">Simpan password ini baik-baik. Kalau lupa, admin lain bisa me-reset-nya.</p>
    </AuthShell>
  );
}

/** Ganti password sendiri. forced=true → muncul otomatis setelah admin me-reset password. */
export function ChangePasswordDialog({ forced, onClose, onDone }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (f.next !== f.confirm) { setError('Konfirmasi password baru tidak sama'); return; }
    setBusy(true); setError('');
    try {
      await api('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: f.current, next: f.next }) });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={forced ? 'Buat password baru' : 'Ganti password'} onClose={forced || busy ? () => {} : onClose} width={420}>
      {forced && <div className="alert info">Admin telah me-reset password Anda. Buat password baru sebelum melanjutkan.</div>}
      <form className="form" onSubmit={submit}>
        <label className="field"><span>{forced ? 'Password dari admin' : 'Password lama'}</span>
          <PasswordInput value={f.current} onChange={set('current')} autoComplete="current-password" autoFocus />
        </label>
        <label className="field"><span>Password baru</span>
          <PasswordInput value={f.next} onChange={set('next')} autoComplete="new-password" placeholder="Minimal 8 karakter, huruf & angka" />
        </label>
        <label className="field"><span>Ulangi password baru</span>
          <PasswordInput value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </label>
        {error && <div className="alert error">{error}</div>}
        <div className="modal-foot">
          {!forced && <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>}
          <button className="btn primary" disabled={busy}><KeyRound size={15} /> {busy ? 'Menyimpan…' : 'Simpan password'}</button>
        </div>
      </form>
    </Modal>
  );
}
