'use client';
import { useEffect, useState } from 'react';
import { Save, Network, PlugZap } from 'lucide-react';
import { api } from './ui';

/** Kartu Settings → Proxy untuk cek SSL (dipakai domain bertanda "via proxy"). */
export default function ProxySettings({ settings, put, saving, setMsg }) {
  const s = settings.scanProxy;
  const [url, setUrl] = useState(s.url);
  const [user, setUser] = useState(s.username);
  const [pass, setPass] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setUrl(s.url); setUser(s.username); }, [s.url, s.username]);
  const dirty = url !== s.url || user !== s.username || !!pass;

  async function save() {
    const patch = { url: url.trim(), username: user.trim() };
    if (pass) patch.password = pass;
    if (await put({ scanProxy: patch }, 'Proxy disimpan.')) setPass('');
  }
  async function test() {
    setBusy(true); setMsg(null);
    try {
      const r = await api('/api/settings/proxy-test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), username: user.trim(), password: pass || undefined, domain: domain.trim() || undefined }) });
      setMsg(r.ok
        ? { ok: true, text: `Proxy berfungsi: sertifikat ${r.domain} terbaca (${r.issuer || '-'}, berlaku s/d ${r.validTo?.slice(0, 10)}) dalam ${r.durationMs} ms.` }
        : { ok: false, text: `Tes proxy gagal untuk ${r.domain}: ${r.error}` });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <h2><Network size={16} className="h-icon" /> Proxy untuk cek SSL</h2>
      <p className="muted small">
        Dipakai untuk file Source of Truth <b>Dengan proxy</b>, dan untuk percobaan ulang otomatis file <b>Tanpa proxy</b> yang hasilnya Check Failed.
        Koneksi lewat HTTP CONNECT, jadi sertifikat yang terbaca tetap sertifikat asli server. Kosongkan kalau tidak dipakai: semua domain dicek langsung.
      </p>
      <div className="form grid3">
        <label className="field"><span>Alamat proxy</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://proxy.kantor.co.id:8080" className="mono" /></label>
        <label className="field"><span>Username (opsional)</span><input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" /></label>
        <label className="field">
          <span>Password (opsional)</span>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" placeholder={s.passwordSet ? 'Tersimpan · isi untuk mengganti' : ''} />
        </label>
        <label className="field"><span>Domain uji</span><input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.google.com" /></label>
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}><Save size={15} /> Simpan proxy</button>
        <button className="btn ghost" disabled={busy || !url.trim()} onClick={test}><PlugZap size={15} /> {busy ? 'Mengetes…' : 'Tes proxy'}</button>
        {dirty && <button className="link small" onClick={() => { setUrl(s.url); setUser(s.username); setPass(''); }}>Batal</button>}
      </div>
    </section>
  );
}
