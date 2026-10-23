'use client';
import { useEffect, useState } from 'react';
import { ShieldAlert, Save, PlugZap, Send, Trash2, Download } from 'lucide-react';
import { api, fmtDateTime, STATUS } from './ui';
import { ConfirmDialog } from './Modal';

const SSL_STATUSES = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL'];

/** Settings → Integrasi → Wazuh. */
export default function WazuhSettings({ settings, put, saving, setMsg, page = false }) {
  const [confirm, setConfirm] = useState(null);
  const s = settings.wazuh;
  const keys = ['enabled', 'transport', 'url', 'authMode', 'username', 'verifyTls', 'filePath', 'sendApp', 'sendSecurity', 'sendSsl', 'sslStatuses', 'sslRepeatHours'];
  const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  const [f, setF] = useState(pick(s));
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');

  const loadStatus = () => api('/api/wazuh/status').then(setStatus).catch(() => {});
  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 10_000); return () => clearInterval(t); }, []);
  useEffect(() => { setF(pick(settings.wazuh)); }, [settings.wazuh]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const dirty = !!password || !!apiKey || keys.some((k) => JSON.stringify(f[k] ?? '') !== JSON.stringify(s[k] ?? ''));
  const toggleStatus = (k) => setF({ ...f, sslStatuses: f.sslStatuses.includes(k) ? f.sslStatuses.filter((x) => x !== k) : [...f.sslStatuses, k] });
  const useApi = f.transport !== 'file';
  const useFile = f.transport !== 'api';

  async function save() {
    const patch = { ...f };
    if (password) patch.password = password;
    if (apiKey) patch.apiKey = apiKey;
    if (await put({ wazuh: patch }, 'Pengaturan Wazuh disimpan.')) { setPassword(''); setApiKey(''); loadStatus(); }
  }

  async function test() {
    setBusy('test'); setMsg(null);
    try {
      const r = await api('/api/wazuh/test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, password: password || undefined, apiKey: apiKey || undefined }) });
      setMsg(r.ok ? { ok: true, text: `Wazuh OK: ${[r.api, r.file].filter(Boolean).join(' · ')}. Cek di Wazuh: Threat Hunting → cari rule.groups: ssl_monitoring.` } : { ok: false, text: `Tes Wazuh gagal: ${r.error}` });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); loadStatus(); }
  }

  async function queue(action) {
    setBusy(action); setMsg(null);
    try {
      const r = await api('/api/wazuh/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      setStatus(r.status);
      setMsg(action === 'clear' ? { ok: true, text: `Antrean dikosongkan (${r.removed} event dibuang).` }
        : r.error ? { ok: false, text: `Gagal kirim: ${r.error}` } : { ok: true, text: r.sent ? `${r.sent} event terkirim ke Wazuh.` : 'Antrean kosong.' });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  }

  const filePath = f.filePath || status?.file || 'data/logs/ssl-monitoring-wazuh.json';
  const ossec = `<localfile>\n  <log_format>json</log_format>\n  <location>${filePath}</location>\n</localfile>`;

  return (
    <section className={page ? 'nch-page' : 'panel'}>
      {!page && <h2><ShieldAlert size={16} className="h-icon" /> Integrasi Wazuh</h2>}
      <p className="muted small">
        Kirim <b>log aplikasi</b> (ubah domain, upload, job, scan, SOAR), <b>log keamanan</b> (login berhasil/gagal, akun terkunci, kelola user, perubahan pengaturan, API key, export)
        dan <b>temuan SSL</b> (Check Failed, Urgent / Expired, Reminder, …) ke Wazuh dalam format JSON. Event masuk antrean dulu, jadi tidak hilang kalau Wazuh sedang tidak bisa dihubungi.
      </p>

      <label className="check toggle"><input type="checkbox" checked={f.enabled} onChange={set('enabled')} /> <b>Kirim log ke Wazuh</b></label>

      {status && (status.enabled || status.queued > 0) && (
        <div className="db-info soar-stat">
          <span>Antrean: <b>{status.queued}</b> event{status.oldest ? ` (tertua ${fmtDateTime(status.oldest)})` : ''}</span>
          <span>· Terkirim sejak start: {status.sent}</span>
          {status.lastOk && <span>· Terakhir berhasil {fmtDateTime(status.lastOk)}</span>}
          {status.lastError && <span className="err-text">· Error: {status.lastError}</span>}
          {status.fileError && <span className="err-text">· File: {status.fileError}</span>}
        </div>
      )}

      <h3 className="sub">Cara kirim</h3>
      <div className="seg three" role="radiogroup" aria-label="Cara kirim ke Wazuh">
        {[['api', 'Wazuh API', 'Langsung ke Wazuh manager (port 55000) lewat endpoint /events. Butuh Wazuh 4.6+.'],
          ['file', 'File + Wazuh agent', 'Ditulis ke file JSON di laptop ini, dibaca Wazuh agent yang terpasang di laptop ini.'],
          ['both', 'Keduanya', 'API dan file sekaligus.']].map(([k, t, d]) => (
          <button key={k} role="radio" aria-checked={f.transport === k} className={f.transport === k ? 'on' : ''} onClick={() => setF({ ...f, transport: k })}>
            <b>{t}</b><span>{d}</span>
          </button>
        ))}
      </div>

      {useApi && (
        <>
          <div className="form grid2">
            <label className="field">
              <span>URL Wazuh API</span>
              <input className="mono" value={f.url} onChange={set('url')} placeholder="https://wazuh-manager.kantor.local:55000" />
            </label>
            <div className="field">
              <span>Jenis login</span>
              <select value={f.authMode} onChange={set('authMode')} aria-label="Jenis login Wazuh">
                <option value="password">User API Wazuh (username + password → token otomatis)</option>
                <option value="token">API key / Bearer token tetap</option>
              </select>
            </div>
            {f.authMode === 'password' ? (
              <>
                <label className="field"><span>Username API</span><input value={f.username} onChange={set('username')} placeholder="ssl-monitoring" autoComplete="off" /></label>
                <label className="field">
                  <span>Password API</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={s.passwordSet ? 'Tersimpan · isi untuk mengganti' : ''} />
                </label>
              </>
            ) : (
              <label className="field">
                <span>API key / token</span>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" placeholder={s.apiKeySet ? `Tersimpan (${s.apiKeyHint}) · isi untuk mengganti` : 'dikirim sebagai Authorization: Bearer …'} />
                <small className="muted">Wazuh sendiri memakai token JWT yang habis dalam 15 menit. Pakai opsi ini kalau ada API gateway/proxy di depan Wazuh yang memberi API key tetap.</small>
              </label>
            )}
          </div>
          <label className="check"><input type="checkbox" checked={f.verifyTls} onChange={set('verifyTls')} /> Verifikasi sertifikat HTTPS Wazuh <span className="muted small">(matikan kalau Wazuh masih memakai sertifikat self-signed bawaan)</span></label>
        </>
      )}

      {useFile && (
        <div className="form">
          <label className="field">
            <span>File log untuk Wazuh agent</span>
            <input className="mono" value={f.filePath} onChange={set('filePath')} placeholder={status?.file || 'data/logs/ssl-monitoring-wazuh.json'} />
            <small className="muted">Kosong = <code>data/logs/ssl-monitoring-wazuh.json</code> di folder aplikasi. Tambahkan ke <code>ossec.conf</code> Wazuh agent di laptop ini:</small>
          </label>
          <pre className="code">{ossec}</pre>
        </div>
      )}

      <h3 className="sub">Yang dikirim</h3>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={f.sendSecurity} onChange={set('sendSecurity')} /> Log keamanan (login, akun terkunci, user, pengaturan, API key SOAR, export, restart)</label>
        <label className="check"><input type="checkbox" checked={f.sendApp} onChange={set('sendApp')} /> Log aplikasi (domain, upload Excel, job, scan, kiriman & perintah SOAR)</label>
        <label className="check"><input type="checkbox" checked={f.sendSsl} onChange={set('sendSsl')} /> Temuan sertifikat SSL setelah setiap scan</label>
      </div>
      {f.sendSsl && (
        <div>
          <span className="opt-label">Status SSL yang dikirim</span>
          <div className="nset-statuses">
            {SSL_STATUSES.map((k) => (
              <label key={k} className={`status-pick ${f.sslStatuses.includes(k) ? 'on' : ''}`} style={{ '--c': STATUS[k].color }}>
                <input type="checkbox" checked={f.sslStatuses.includes(k)} onChange={() => toggleStatus(k)} /> {STATUS[k].label}
              </label>
            ))}
          </div>
          <small className="muted">Sertifikat yang sudah lewat tanggal dikirim dengan <code>ssl_status: EXPIRED</code> (level rule paling tinggi).</small>
        </div>
      )}
      {f.sendSsl && (
        <div className="form grid3">
          <label className="field">
            <span>Kirim ulang selama masih bermasalah tiap (jam)</span>
            <input type="number" min="1" max="720" value={f.sslRepeatHours} onChange={set('sslRepeatHours')} />
            <small className="muted">Status berubah dan domain yang pulih selalu langsung dikirim.</small>
          </label>
        </div>
      )}

      <details className="guide">
        <summary>Menyiapkan di Wazuh (sekali saja)</summary>
        <ol className="small">
          <li><b>Buat user API khusus</b> dengan izin hanya <code>event:ingest</code>: di Wazuh dashboard → <i>Server management → Security</i>: buat <b>Policy</b> (action <code>event:ingest</code>, resource <code>*:*:*</code>, effect allow) → buat <b>Role</b> berisi policy itu → buat <b>User</b> dan beri role tersebut. Perintah curl ada di README.</li>
          <li><b>Pasang rules</b>: klik <i>Download rules Wazuh</i> di bawah, simpan di manager sebagai <code>/var/ossec/etc/rules/ssl_monitoring_rules.xml</code>, lalu restart <code>wazuh-manager</code>. Rule ID 100700–100749.</li>
          <li>Pastikan laptop ini bisa menjangkau port <b>55000</b> Wazuh manager (mode API), lalu klik <b>Tes koneksi</b>.</li>
          <li>Lihat hasilnya di Wazuh: <i>Threat Hunting</i>, filter <code>rule.groups: ssl_monitoring</code>.</li>
        </ol>
      </details>

      <div className="toolbar">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}><Save size={15} /> Simpan</button>
        <button className="btn ghost" disabled={!!busy} onClick={test}><PlugZap size={15} /> {busy === 'test' ? 'Mengetes…' : 'Tes koneksi'}</button>
        {status?.queued > 0 && useApi && <button className="btn ghost" disabled={!!busy || dirty} onClick={() => queue('flush')}><Send size={15} /> {busy === 'flush' ? 'Mengirim…' : 'Kirim antrean sekarang'}</button>}
        <a className="btn ghost" href="/api/wazuh/rules"><Download size={15} /> Download rules Wazuh</a>
        {status?.queued > 0 && (
          <button className="btn danger-ghost" disabled={!!busy} onClick={() => setConfirm({
            title: 'Kosongkan antrean Wazuh?', message: `${status.queued} event yang belum terkirim akan dibuang dan tidak bisa dikirim lagi.`, confirmLabel: 'Kosongkan', danger: true,
            run: () => queue('clear'),
          })}><Trash2 size={15} /> Kosongkan antrean</button>
        )}
        {dirty && <button className="link small" onClick={() => { setF(pick(s)); setPassword(''); setApiKey(''); }}>Batal</button>}
      </div>
      {confirm && (
        <ConfirmDialog title={confirm.title} message={<p>{confirm.message}</p>} confirmLabel={confirm.confirmLabel} danger={confirm.danger}
          onConfirm={async () => { await confirm.run(); }} onClose={() => setConfirm(null)} />
      )}
    </section>
  );
}
