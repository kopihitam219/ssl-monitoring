'use client';
// Settings → Integrasi → SOAR, bagian "SOAR → Aplikasi": SOAR mengirim domain, menanyakan status, dan menjalankan job.
import { useEffect, useState } from 'react';
import { Save, KeyRound, Copy, Check, ArrowDownToLine } from 'lucide-react';
import { api, fmtDateTime } from './ui';
import { ConfirmDialog } from './Modal';

function CopyBtn({ text, label = 'Salin' }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="icon-btn" title={label} aria-label={label}
      onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

export default function SoarInbound({ settings, put, saving, setMsg }) {
  const s = settings.soarIn;
  const keys = ['enabled', 'fileName', 'groupId', 'proxyMode', 'scanOnReceive', 'allowRemove', 'allowCommands'];
  const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
  const [f, setF] = useState(pick(s));
  const [groups, setGroups] = useState([]);
  const [origin, setOrigin] = useState('');
  const [newKey, setNewKey] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [recent, setRecent] = useState([]);

  const loadRecent = () => api('/api/audit?category=soar&pageSize=6').then((r) => setRecent(r.rows || r.items || [])).catch(() => {});
  useEffect(() => {
    setOrigin(window.location.origin);
    api('/api/groups').then((r) => setGroups(r.groups || [])).catch(() => {});
    loadRecent();
  }, []);
  useEffect(() => { setF(pick(settings.soarIn)); }, [settings.soarIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const dirty = keys.some((k) => String(f[k] ?? '') !== String(s[k] ?? ''));

  async function save() {
    if (await put({ soarIn: { ...f, groupId: f.groupId ? Number(f.groupId) : null } }, 'Pengaturan SOAR → aplikasi disimpan.')) loadRecent();
  }
  async function makeKey() {
    setMsg(null);
    try {
      const r = await api('/api/soar/key', { method: 'POST' });
      setNewKey(r.key);
      await put({}, 'API key baru dibuat. Salin sekarang, key ini hanya ditampilkan sekali.');
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }

  const base = origin || 'http://127.0.0.1:3000';
  const key = newKey || '<API_KEY>';
  const exPost = `curl -X POST "${base}/api/soar/domains" \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -d '{"domains":[{"domain":"app.kantor.co.id","port":443,"environment":"Production","owner":"Tim Web"},"api.kantor.co.id"]}'`;
  const exGet = `curl "${base}/api/soar/domains?status=URGENT,CHECK_FAILED" -H "Authorization: Bearer ${key}"`;
  const exCmd = `curl -X POST "${base}/api/soar/command" -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" -d '{"action":"retry_failed","group":"Public","wait":true}'`;

  return (
    <div className="nch-page soar-in">
      <p className="muted small">
        SOAR bisa <b>mengirim domain</b> ke aplikasi (masuk ke file Source of Truth <b>{s.fileName}</b>, langsung dicek, dan hasilnya dibalas ke SOAR),
        <b> menanyakan status sertifikat</b>, dan <b>menjalankan Scan / Retry Check Failed / Tes koneksi</b>. Setiap request tercatat di Audit Log (kategori SOAR).
      </p>
      <label className="check toggle"><input type="checkbox" checked={!!f.enabled} onChange={set('enabled')} /> <b>Izinkan SOAR mengirim ke aplikasi</b></label>

      <div className="soar-key">
        <span className="opt-label"><KeyRound size={13} className="h-icon" /> API key</span>
        {newKey ? (
          <div className="copy-row"><input readOnly className="mono" value={newKey} onFocus={(e) => e.target.select()} /><CopyBtn text={newKey} label="Salin API key" /></div>
        ) : (
          <span className="small">{s.tokenSet ? <>Tersimpan <code>{s.tokenHint}</code> (key asli tidak bisa dilihat lagi)</> : <span className="muted">Belum ada</span>}</span>
        )}
        <button className="btn ghost" onClick={() => (s.tokenSet ? setConfirm(true) : makeKey())}><KeyRound size={15} /> {s.tokenSet ? 'Buat key baru' : 'Buat API key'}</button>
        {newKey && <small className="warn-text">Salin dan simpan di SOAR sekarang. Key ini hanya ditampilkan sekali.</small>}
      </div>

      <div className="form grid3">
        <label className="field"><span>File Source of Truth tujuan</span><input value={f.fileName ?? ''} onChange={set('fileName')} placeholder="SOAR" />
          <small className="muted">Dibuat otomatis saat kiriman pertama.</small></label>
        <label className="field"><span>Group dashboard</span>
          <select value={f.groupId ?? ''} onChange={set('groupId')}>
            <option value="">Tanpa group</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <small className="muted">Untuk file baru. File yang sudah ada diatur di Source of Truth.</small></label>
        <label className="field"><span>Cara cek</span>
          <select value={f.proxyMode} onChange={set('proxyMode')}>
            <option value="direct">Tanpa proxy (proxy kalau gagal)</option>
            <option value="proxy">Dengan proxy</option>
          </select></label>
      </div>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={!!f.scanOnReceive} onChange={set('scanOnReceive')} /> Domain yang dikirim langsung dicek, hasilnya dibalas ke SOAR</label>
        <label className="check"><input type="checkbox" checked={!!f.allowCommands} onChange={set('allowCommands')} /> SOAR boleh menjalankan Scan / Retry Check Failed / Tes koneksi / kirim laporan</label>
        <label className="check"><input type="checkbox" checked={!!f.allowRemove} onChange={set('allowRemove')} /> SOAR boleh menghapus domain (<code>"action":"remove"</code>, hanya di file {s.fileName})</label>
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}><Save size={15} /> Simpan</button>
        {dirty && <button className="link small" onClick={() => setF(pick(s))}>Batal</button>}
      </div>

      <details className="guide">
        <summary>Endpoint & contoh untuk SOAR</summary>
        <p className="small">Header: <code>Authorization: Bearer &lt;API key&gt;</code> (atau <code>X-Api-Key</code>). SOAR harus bisa menjangkau alamat aplikasi ini, mis. <code>{base}</code> — pakai IP / nama komputer ini. <code>npm start</code> dan shortcut Desktop hanya bisa diakses dari komputer ini; supaya SOAR di server lain bisa menjangkau, jalankan <code>npm run start:lan</code> dan buka port 3000 di Windows Firewall.</p>
        <table className="soar-ep small">
          <tbody>
            <tr><td><code>POST /api/soar/domains</code></td><td>Kirim domain. Format bebas: <code>{'{"domain":…}'}</code>, array, <code>{'{"domains":[…]}'}</code>, NDJSON, atau format Splunk HEC <code>{'{"event":{…}}'}</code>. Field: domain / fqdn / host / url, port, environment, application, owner, notes, action (add / remove). <code>?scan=0</code> = jangan langsung dicek.</td></tr>
            <tr><td><code>GET /api/soar/domains</code></td><td>Status sertifikat. Filter: <code>?domain=a.com,b.com</code>, <code>&amp;status=URGENT,CHECK_FAILED,EXPIRED</code>, <code>&amp;group=Public</code>, <code>&amp;file=SOAR</code>.</td></tr>
            <tr><td><code>POST /api/soar/command</code></td><td><code>{'{"action":"scan|retry_failed|conn_test|report","group":"Public","wait":true}'}</code>. Tanpa <code>wait</code> langsung dibalas 202 dan job jalan di belakang.</td></tr>
            <tr><td><code>POST /services/collector/event</code></td><td>Kompatibel Splunk HEC (header <code>Authorization: Splunk &lt;API key&gt;</code>) untuk flow SOAR lama.</td></tr>
          </tbody>
        </table>
        <span className="opt-label">Kirim domain</span><div className="copy-row top"><pre className="code">{exPost}</pre><CopyBtn text={exPost} /></div>
        <span className="opt-label">Tanya status</span><div className="copy-row top"><pre className="code">{exGet}</pre><CopyBtn text={exGet} /></div>
        <span className="opt-label">Jalankan Retry Check Failed</span><div className="copy-row top"><pre className="code">{exCmd}</pre><CopyBtn text={exCmd} /></div>
        <p className="small muted">Balasan kirim domain: <code>{'{ok, file, received, added, updated, removed, invalid:[…], results:[{domain, port, status, days_remaining, expires_at, error, result}]}'}</code></p>
      </details>

      <span className="opt-label"><ArrowDownToLine size={13} className="h-icon" /> Request terakhir dari SOAR</span>
      {recent.length ? (
        <ul className="soar-recent small">
          {recent.map((r) => <li key={r.id} className={r.ok ? '' : 'bad'}><span className="muted">{fmtDateTime(r.at)}</span> {r.summary}</li>)}
        </ul>
      ) : <p className="muted small">Belum ada.</p>}

      {confirm && (
        <ConfirmDialog title="Buat API key baru?" message={<p>Key lama langsung tidak berlaku. Flow SOAR yang masih memakai key lama akan ditolak sampai diganti.</p>}
          confirmLabel="Buat key baru" danger onConfirm={makeKey} onClose={() => setConfirm(false)} />
      )}
    </div>
  );
}
