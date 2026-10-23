'use client';
// Alat tes koneksi manual: DNS → Ping → Telnet (port) → Curl (HTTPS), langsung & lewat proxy.
import { useState } from 'react';
import { Activity, Loader2, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { api } from './ui';

const Mark = ({ v }) => (v === true ? <CheckCircle2 size={15} className="txt-ok" /> : v === null || v === undefined ? <MinusCircle size={15} className="muted" /> : <XCircle size={15} className="txt-danger" />);
const LV = { ok: { icon: CheckCircle2, cls: 'success' }, warn: { icon: AlertTriangle, cls: 'warn' }, error: { icon: XCircle, cls: 'error' } };

/** Tabel hasil tes koneksi (dipakai alat manual & detail domain). */
export function ConnResult({ r }) {
  if (!r) return null;
  const rows = [
    ['DNS', r.dns.ok, r.dns.ok ? r.dns.addresses.join(', ') : r.dns.error, r.dns.ms],
    ['Ping (ICMP)', r.ping.skipped ? null : r.ping.ok, r.ping.ok ? `balasan ${r.ping.ms} ms` : r.ping.error, null],
    [`Telnet port ${r.port}`, r.tcp.skipped ? null : r.tcp.ok, r.tcp.ok ? 'port terbuka' : r.tcp.error, r.tcp.ms],
    ['Curl HTTPS', r.https.skipped ? null : r.https.ok, r.https.ok ? (r.https.status ? `HTTP ${r.https.status}${r.https.server ? ` · ${r.https.server}` : ''}` : r.https.note) : r.https.error, r.https.ms],
  ];
  if (r.proxy) {
    rows.push(['Proxy CONNECT', r.proxy.connect.ok, r.proxy.connect.ok ? r.proxy.url : r.proxy.connect.error, r.proxy.connect.ms]);
    if (r.proxy.https) rows.push(['Curl HTTPS lewat proxy', r.proxy.https.ok, r.proxy.https.ok ? (r.proxy.https.status ? `HTTP ${r.proxy.https.status}` : r.proxy.https.note) : r.proxy.https.error, r.proxy.https.ms]);
  }
  const lv = LV[r.conclusion?.level] || LV.ok;
  const Icon = lv.icon;
  return (
    <div className="conn-result">
      <table className="mini-table">
        <tbody>
          {rows.map(([k, ok, detail, ms]) => (
            <tr key={k}><td><Mark v={ok} /> {k}</td><td className="small">{detail || '—'}</td><td className="small muted">{ms != null ? `${ms} ms` : ''}</td></tr>
          ))}
        </tbody>
      </table>
      {r.conclusion && <div className={`alert ${lv.cls} small`}><Icon size={14} className="h-icon" /> {r.conclusion.text}</div>}
      {r.ping.ok === false && r.tcp.ok && <p className="muted small">Catatan: banyak server/firewall memblokir ping (ICMP). Kalau port & HTTPS berhasil, ping gagal bukan masalah.</p>}
    </div>
  );
}

export default function ConnTestTool() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(443);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  async function go(e) {
    e.preventDefault();
    setBusy(true); setError(''); setRes(null);
    try { setRes(await api('/api/tools/conntest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port }) })); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <section className="panel">
      <h2><Activity size={16} className="h-icon" /> Tes koneksi (Ping · Telnet · Curl)</h2>
      <p className="muted small">Cek kenapa sebuah domain Check Failed: DNS, ping, port (telnet), dan HTTPS (curl) dari komputer ini — langsung dan lewat proxy (kalau proxy diisi di Settings).</p>
      <form className="conn-form" onSubmit={go}>
        <input className="inline-input grow" value={host} onChange={(e) => setHost(e.target.value)} placeholder="domain atau IP, mis. app.perusahaan.co.id" required />
        <input className="inline-input port" type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} aria-label="Port" />
        <button className="btn primary" disabled={busy || !host.trim()}>{busy ? <><Loader2 size={15} className="spin" /> Mengetes…</> : <><Activity size={15} /> Tes</>}</button>
      </form>
      {error && <div className="alert error">{error}</div>}
      <ConnResult r={res} />
    </section>
  );
}
