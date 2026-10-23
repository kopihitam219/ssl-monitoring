'use client';
// Settings → Integrasi notifikasi (Teams, Telegram, WhatsApp, Email, SOAR) + panel isi notifikasi.
import { useEffect, useState } from 'react';
import { Bell, Save, Send, MessageSquare, Mail, Workflow, Smartphone, Send as Tg } from 'lucide-react';
import { api, STATUS } from './ui';

const TYPES = [
  ['alert', 'Alert SSL', 'domain bermasalah setelah scan'],
  ['report', 'Hasil scan scheduler', 'ringkasan tiap scan otomatis'],
  ['system', 'Info sistem bermasalah', 'scan gagal/macet, database, CPU/RAM/Disk, saluran gagal'],
];
const ALERT_STATUSES = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL'];

export const CHANNEL_DEFS = [
  {
    key: 'teams', label: 'Microsoft Teams', icon: MessageSquare,
    help: <>Di Teams: buka channel → <b>⋯ → Workflows</b> → template <b>"Post to a channel when a webhook request is received"</b> → salin URL-nya.</>,
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', secret: true, placeholder: 'https://…', wide: true }],
  },
  {
    key: 'telegram', label: 'Telegram', icon: Tg,
    help: <>Buat bot lewat <b>@BotFather</b> (dapat <i>token</i>), tambahkan bot ke grup/chat tujuan, lalu isi <b>Chat ID</b> (mis. <code>-1001234567890</code> untuk grup).</>,
    fields: [{ key: 'botToken', label: 'Bot token', secret: true, placeholder: '123456:ABC-…' }, { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890' }],
  },
  {
    key: 'whatsapp', label: 'WhatsApp', icon: Smartphone,
    help: <><b>Fonnte</b>: isi token device dari fonnte.com dan nomor/ID grup tujuan (pisahkan koma). <b>Webhook</b>: gateway WhatsApp kantor — aplikasi mengirim POST JSON <code>{'{target, message, …}'}</code>.</>,
    fields: [
      { key: 'provider', label: 'Layanan', type: 'select', options: [['fonnte', 'Fonnte'], ['webhook', 'Webhook gateway']] },
      { key: 'token', label: 'Token', secret: true, placeholder: 'token device / API key' },
      { key: 'target', label: 'Nomor / ID grup tujuan', placeholder: '08123456789, 1203630xxx@g.us' },
      { key: 'url', label: 'URL webhook gateway', placeholder: 'https://wa-gateway.kantor/send', show: (f) => f.provider === 'webhook', wide: true },
    ],
  },
  {
    key: 'email', label: 'Email (SMTP)', icon: Mail,
    help: <>Server SMTP kantor / Office 365 (<code>smtp.office365.com</code> port 587) / Gmail (<code>smtp.gmail.com</code> 587, pakai App Password). Penerima boleh lebih dari satu (pisahkan koma).</>,
    fields: [
      { key: 'host', label: 'Server SMTP', placeholder: 'smtp.kantor.co.id' },
      { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
      { key: 'secure', label: 'SSL/TLS langsung (port 465)', type: 'check' },
      { key: 'user', label: 'Username', placeholder: 'ssl-monitoring@kantor.co.id' },
      { key: 'pass', label: 'Password', secret: true, type: 'password' },
      { key: 'from', label: 'Pengirim (From)', placeholder: 'SSL Monitoring <ssl-monitoring@kantor.co.id>' },
      { key: 'to', label: 'Penerima (To)', placeholder: 'tim-it@kantor.co.id, security@kantor.co.id', wide: true },
    ],
  },
  {
    key: 'soar', label: 'SOAR (webhook)', icon: Workflow,
    help: <>Kirim notifikasi sebagai JSON ke SOAR, mis. URL <b>API Trigger</b> workflow Rapid7 InsightConnect. Isi nama header & nilai API key bila diperlukan (mis. header <code>X-Api-Key</code>).</>,
    fields: [
      { key: 'url', label: 'URL webhook', placeholder: 'https://…/api/trigger/…', wide: true },
      { key: 'authHeader', label: 'Nama header API key', placeholder: 'Authorization' },
      { key: 'token', label: 'Nilai API key / token', secret: true, placeholder: 'Bearer … / API key' },
    ],
  },
];

export function ChannelCard({ def, cur, put, saving, setMsg, page = false }) {
  const [f, setF] = useState(() => ({ ...cur }));
  const [secrets, setSecrets] = useState({});
  const [testing, setTesting] = useState(false);
  useEffect(() => { setF({ ...cur }); setSecrets({}); }, [cur]);
  const Icon = def.icon;
  const plain = def.fields.filter((x) => !x.secret).map((x) => x.key);
  const dirty = ['enabled', 'alert', 'report', 'system', ...plain].some((k) => String(f[k] ?? '') !== String(cur[k] ?? '')) || Object.values(secrets).some(Boolean);

  async function save() {
    const patch = Object.fromEntries(['enabled', 'alert', 'report', 'system', ...plain].map((k) => [k, f[k]]));
    for (const [k, v] of Object.entries(secrets)) if (v) patch[k] = v;
    if (await put({ notify: { [def.key]: patch } }, `Pengaturan ${def.label} disimpan.`)) setSecrets({});
  }
  async function test() {
    setTesting(true); setMsg(null);
    try {
      await api('/api/notify/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: def.key }) });
      setMsg({ ok: true, text: `Pesan tes terkirim ke ${def.label}. Cek tujuannya.` });
    } catch (e) { setMsg({ ok: false, text: `${def.label}: ${e.message}` }); } finally { setTesting(false); }
  }
  const configured = def.fields.filter((x) => x.secret).every((x) => cur[`${x.key}Set`]) || def.fields.every((x) => !x.secret);

  return (
    <div className={page ? 'nch-page' : `nch ${cur.enabled ? 'on' : ''}`}>
      <div className="nch-head">
        {!page && <><span className="nch-icon"><Icon size={18} /></span><b>{def.label}</b>
          <span className={`pill ${cur.enabled ? 'ok' : ''}`}>{cur.enabled ? 'Aktif' : 'Mati'}</span></>}
        <label className="check toggle nch-toggle"><input type="checkbox" checked={!!f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Aktifkan</label>
      </div>
      {!page && <p className="muted small">{def.help}</p>}
      <div className="form grid2">
        {def.fields.filter((x) => !x.show || x.show(f)).map((x) => {
          if (x.type === 'check') return <label key={x.key} className="check"><input type="checkbox" checked={!!f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.checked })} /> {x.label}</label>;
          if (x.type === 'select') {
            return (
              <label key={x.key} className="field"><span>{x.label}</span>
                <select value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })}>{x.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
            );
          }
          if (x.secret) {
            return (
              <label key={x.key} className={`field ${x.wide ? 'wide' : ''}`}><span>{x.label}</span>
                <input type="password" autoComplete="new-password" value={secrets[x.key] || ''} onChange={(e) => setSecrets({ ...secrets, [x.key]: e.target.value })}
                  placeholder={cur[`${x.key}Set`] ? `Tersimpan ${cur[`${x.key}Hint`] || ''} · isi untuk mengganti` : x.placeholder || ''} />
              </label>
            );
          }
          return (
            <label key={x.key} className={`field ${x.wide ? 'wide' : ''}`}><span>{x.label}</span>
              <input type={x.type || 'text'} value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.placeholder || ''} />
            </label>
          );
        })}
      </div>
      <div className="nch-types">
        <span className="small muted">Terima:</span>
        {TYPES.map(([k, l, sub]) => (
          <label key={k} className="check" title={sub}><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {l}</label>
        ))}
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}><Save size={15} /> Simpan</button>
        <button className="btn ghost" disabled={testing || dirty || !configured} onClick={test} title={dirty ? 'Simpan dulu, lalu kirim tes' : ''}>
          <Send size={15} /> {testing ? 'Mengirim…' : 'Kirim tes'}
        </button>
        {dirty && <button className="link small" onClick={() => { setF({ ...cur }); setSecrets({}); }}>Batal</button>}
      </div>
    </div>
  );
}

export default function NotifySettings({ settings, put, saving, setMsg }) {
  const n = settings.notify;
  const [g, setG] = useState({ alertStatuses: n.alertStatuses, alertRepeatHours: n.alertRepeatHours, reportAllOk: n.reportAllOk, systemRepeatHours: n.systemRepeatHours });
  useEffect(() => setG({ alertStatuses: n.alertStatuses, alertRepeatHours: n.alertRepeatHours, reportAllOk: n.reportAllOk, systemRepeatHours: n.systemRepeatHours }), [n]);
  const dirty = JSON.stringify(g) !== JSON.stringify({ alertStatuses: n.alertStatuses, alertRepeatHours: n.alertRepeatHours, reportAllOk: n.reportAllOk, systemRepeatHours: n.systemRepeatHours });
  const toggle = (k) => setG({ ...g, alertStatuses: g.alertStatuses.includes(k) ? g.alertStatuses.filter((x) => x !== k) : [...g.alertStatuses, k] });

  return (
    <section className="panel">
      <h2><Bell size={16} className="h-icon" /> Isi notifikasi</h2>
      <p className="muted small">
        Kirim <b>alert SSL</b>, <b>hasil scan scheduler</b>, dan <b>informasi sistem bermasalah</b>. Saluran pengiriman diatur di <b>Integrasi</b> di atas; tiap saluran memilih sendiri jenis pesan yang diterima.
      </p>

      <div className="nset">
        <div>
          <span className="opt-label">Alert dikirim untuk status</span>
          <div className="nset-statuses">
            {ALERT_STATUSES.map((k) => (
              <label key={k} className={`status-pick ${g.alertStatuses.includes(k) ? 'on' : ''}`} style={{ '--c': STATUS[k].color }}>
                <input type="checkbox" checked={g.alertStatuses.includes(k)} onChange={() => toggle(k)} /> {STATUS[k].label}
              </label>
            ))}
          </div>
          <small className="muted">Domain yang sama dikirim lagi hanya kalau statusnya berubah, atau tiap N jam selama masih bermasalah. Domain yang pulih ikut dilaporkan.</small>
        </div>
        <div className="form grid3">
          <label className="field"><span>Kirim ulang alert tiap (jam)</span><input type="number" min="1" max="720" value={g.alertRepeatHours} onChange={(e) => setG({ ...g, alertRepeatHours: e.target.value })} /></label>
          <label className="field"><span>Ingatkan masalah sistem tiap (jam)</span><input type="number" min="1" max="720" value={g.systemRepeatHours} onChange={(e) => setG({ ...g, systemRepeatHours: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={g.reportAllOk} onChange={(e) => setG({ ...g, reportAllOk: e.target.checked })} /> Hasil scan scheduler tetap dikirim walau semua aman</label>
        </div>
        <div className="toolbar">
          <button className="btn primary" disabled={!dirty || saving || !g.alertStatuses.length} onClick={() => put({ notify: g }, 'Pengaturan isi notifikasi disimpan.')}><Save size={15} /> Simpan isi notifikasi</button>
          {dirty && <button className="link small" onClick={() => setG({ alertStatuses: n.alertStatuses, alertRepeatHours: n.alertRepeatHours, reportAllOk: n.reportAllOk, systemRepeatHours: n.systemRepeatHours })}>Batal</button>}
        </div>
      </div>

    </section>
  );
}
