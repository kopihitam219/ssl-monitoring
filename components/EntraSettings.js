'use client';
import { useEffect, useState } from 'react';
import { Building, Save, PlugZap, RefreshCw, Copy, Check } from 'lucide-react';
import { api, fmtDateTime } from './ui';

/** Kartu Settings → Microsoft 365 (Entra ID). put(patch, okText) menyimpan & mengembalikan true/false. */
export default function EntraSettings({ settings, put, saving, setMsg, page = false }) {
  const s = settings.entra;
  const [f, setF] = useState({ ...s });
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState(null);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  const loadStatus = () => api('/api/entra/status').then(setStatus).catch(() => {});
  useEffect(() => { setOrigin(window.location.origin); loadStatus(); }, []);
  useEffect(() => { setF({ ...settings.entra }); }, [settings.entra]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const keys = ['enabled', 'tenantId', 'clientId', 'adminGroupId', 'monitoringGroupId', 'autoSync', 'redirectUri'];
  const dirty = !!secret || keys.some((k) => String(f[k] ?? '') !== String(s[k] ?? ''));
  const redirect = f.redirectUri || `${origin}/api/auth/microsoft/callback`;

  async function save() {
    const patch = Object.fromEntries(keys.map((k) => [k, f[k]]));
    if (secret) patch.clientSecret = secret;
    if (await put({ entra: patch }, 'Pengaturan Entra ID disimpan.')) { setSecret(''); loadStatus(); }
  }

  async function action(kind) {
    setBusy(kind); setMsg(null);
    try {
      if (kind === 'test') {
        const r = await api('/api/entra/test', { method: 'POST' });
        const g = Object.entries(r.groups).map(([k, v]) => `${k === 'admin' ? 'Admin' : 'Monitoring'}: "${v.name}" (${v.members} anggota)`).join(' · ');
        setMsg({ ok: true, text: `Koneksi ke Entra ID berhasil. ${g}` });
      } else {
        const r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: 'entra' }) });
        setMsg({ ok: r.ok, text: `Sync user Entra ID: ${r.message}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); loadStatus(); }
  }

  return (
    <section className={page ? 'nch-page' : 'panel'}>
      {!page && <h2><Building size={16} className="h-icon" /> Microsoft Entra ID (Azure AD)</h2>}
      <p className="muted small">
        User login dengan akun Microsoft kantor. Peran ditentukan dari grup di Entra ID: anggota grup Admin → <b>Admin</b>, anggota grup Monitoring → <b>Monitoring</b>.
        Anggota kedua grup di-sync ke menu Users; yang keluar dari grup atau dinonaktifkan di Entra ID otomatis dinonaktifkan di sini. Login lokal tetap bisa dipakai sebagai cadangan.
      </p>

      <details className="guide">
        <summary>Cara menyiapkan di Entra ID (sekali saja, oleh admin Microsoft 365)</summary>
        <ol>
          <li>Buka <b>entra.microsoft.com</b> → <b>App registrations</b> → <b>New registration</b>. Nama bebas, mis. <i>SSL Monitoring</i>. Supported account types: <i>Single tenant</i>.</li>
          <li>Redirect URI: platform <b>Web</b>, isi persis: <code>{redirect}</code></li>
          <li>Salin <b>Application (client) ID</b> dan <b>Directory (tenant) ID</b> dari halaman Overview.</li>
          <li><b>Certificates &amp; secrets</b> → <b>New client secret</b> → salin <i>Value</i>-nya (hanya tampil sekali).</li>
          <li><b>API permissions</b> → Add → Microsoft Graph → <b>Application permissions</b>: <code>User.Read.All</code> dan <code>GroupMember.Read.All</code> → klik <b>Grant admin consent</b>.</li>
          <li>Buat (atau pakai) dua grup Security, mis. <i>SSL-Monitoring-Admin</i> dan <i>SSL-Monitoring-Viewer</i>. Salin <b>Object ID</b> masing-masing.</li>
          <li>Isi semua nilai di bawah, simpan, klik <b>Tes koneksi</b>, lalu centang <b>Aktifkan</b>.</li>
        </ol>
        <p className="small muted">Buka aplikasi dengan alamat yang sama dengan Redirect URI (mis. selalu <code>{origin}</code>), supaya login tidak gagal.</p>
      </details>

      <label className="check toggle"><input type="checkbox" checked={f.enabled} onChange={set('enabled')} /> <b>Aktifkan login & sync Entra ID</b></label>

      <div className="form grid2">
        <label className="field"><span>Directory (tenant) ID</span><input value={f.tenantId} onChange={set('tenantId')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" /></label>
        <label className="field"><span>Application (client) ID</span><input value={f.clientId} onChange={set('clientId')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" /></label>
        <label className="field">
          <span>Client secret</span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password"
            placeholder={s.secretSet ? `Tersimpan (${s.secretHint}) · isi untuk mengganti` : 'Value dari Certificates & secrets'} />
          <small className="muted">Disimpan hanya di laptop ini (data/settings.json). Secret Microsoft punya masa berlaku. Perbarui sebelum habis.</small>
        </label>
        <label className="field">
          <span>Redirect URI</span>
          <span className="copy-row">
            <input value={f.redirectUri} onChange={set('redirectUri')} placeholder={`${origin}/api/auth/microsoft/callback (otomatis)`} />
            <button type="button" className="icon-btn" title="Salin" aria-label="Salin redirect URI"
              onClick={() => { navigator.clipboard?.writeText(redirect); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </span>
          <small className="muted">Kosongkan untuk otomatis. Daftarkan nilai ini persis di App registration.</small>
        </label>
        <label className="field"><span>Object ID grup → Admin</span><input value={f.adminGroupId} onChange={set('adminGroupId')} placeholder="Object ID grup admin" autoComplete="off" /></label>
        <label className="field"><span>Object ID grup → Monitoring</span><input value={f.monitoringGroupId} onChange={set('monitoringGroupId')} placeholder="Object ID grup monitoring" autoComplete="off" /></label>
      </div>
      <label className="check"><input type="checkbox" checked={f.autoSync} onChange={set('autoSync')} /> Sync user otomatis setiap scan terjadwal</label>

      {status && (
        <div className="db-info">
          <span>User dari Entra ID: <b>{status.activeUsers}</b> aktif / {status.users} total</span>
          {status.lastSync && <span>· Sync terakhir {fmtDateTime(status.lastSync.at)} — {status.lastSync.ok ? 'berhasil' : 'gagal'}</span>}
        </div>
      )}

      <div className="toolbar">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}><Save size={15} /> Simpan</button>
        <button className="btn ghost" disabled={!!busy || dirty || !s.tenantId || !s.secretSet} onClick={() => action('test')} title={dirty ? 'Simpan dulu' : ''}>
          <PlugZap size={15} /> {busy === 'test' ? 'Mengetes…' : 'Tes koneksi'}
        </button>
        <button className="btn ghost" disabled={!!busy || dirty || !status?.configured} onClick={() => action('sync')} title={!status?.configured ? 'Aktifkan & lengkapi dulu' : ''}>
          <RefreshCw size={15} className={busy === 'sync' ? 'spin' : ''} /> {busy === 'sync' ? 'Sync…' : 'Sync user sekarang'}
        </button>
        {dirty && <button className="link small" onClick={() => { setF({ ...s }); setSecret(''); }}>Batal</button>}
      </div>
      <p className="muted small">Butuh akses internet ke <code>login.microsoftonline.com</code> dan <code>graph.microsoft.com</code>. Di jaringan kantor dengan proxy, lihat README.</p>
    </section>
  );
}
