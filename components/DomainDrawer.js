'use client';
import { useEffect, useState } from 'react';
import { X, RefreshCw, Activity } from 'lucide-react';
import { ConnResult } from './ConnTestTool';
import { StatusBadge, fmtDateTime, fmtDate, fmtExpiresIn, trustNote, api } from './ui';
import { useSession } from './session';

export default function DomainDrawer({ id, onClose, onChanged }) {
  const { can } = useSession();
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => api(`/api/domains/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function recheck() {
    setChecking(true);
    try {
      const r = await api(`/api/domains/${id}/check`, { method: 'POST' });
      if (r.queued) {
        setNotice(`${r.message}. Hasilnya muncul di sini setelah scanner selesai.`);
        // tunggu scanner kantor (cek tiap 5 detik, maksimal 1 menit)
        for (let i = 0; i < 12; i++) { await new Promise((ok) => setTimeout(ok, 5000)); await load(); }
      } else await load();
      onChanged?.();
    }
    catch (e) { setError(e.message); }
    finally { setChecking(false); }
  }

  async function connTest() {
    setChecking(true);
    try { await api('/api/tools/conntest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); await load(); onChanged?.(); }
    catch (e) { setError(e.message); }
    finally { setChecking(false); }
  }

  const d = data?.domain;
  let conn = null;
  try { conn = d?.conn_test ? JSON.parse(d.conn_test) : null; } catch {}
  const VIA = { direct: 'Langsung', proxy: 'Lewat proxy', fallback: 'Lewat proxy (otomatis, cek langsung gagal)' };
  const rows = d ? [
    ['Group', d.group_name || 'Tanpa group'],
    ['File', d.file_name],
    ['Pilihan proxy', d.proxy_mode === 'proxy' ? 'Dengan proxy' : 'Tanpa proxy (otomatis coba proxy kalau gagal)'],
    ['Port', d.port],
    ['Environment', d.environment],
    ['Application', d.application],
    ['Owner', d.owner],
    ['Notes', d.notes],
    ['Subject (CN)', d.subject],
    ['Issuer', d.issuer_cn && d.issuer_cn !== d.issuer ? `${d.issuer} — ${d.issuer_cn}` : d.issuer],
    ['SHA-256 fingerprint', d.fingerprint ? <code className="fp">{d.fingerprint}</code> : null],
    ['Berlaku dari', fmtDate(d.valid_from)],
    ['Berlaku sampai', fmtDate(d.expires_at)],
    ['Sisa hari', d.expires_at ? fmtExpiresIn(d.days_remaining) : '—'],
    ['Protokol', d.protocol],
    [d.status === 'CHECK_FAILED' ? 'Error' : 'Catatan sertifikat', d.status === 'CHECK_FAILED' ? d.last_error : trustNote(d.last_error, d)],
    ['Cek terakhir', VIA[d.checked_via] || '—'],
    ['Terakhir dicek', fmtDateTime(d.last_checked)],
  ] : [];

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detail domain">
        <div className="drawer-head">
          <div>
            <h3>{d?.domain || 'Memuat…'}</h3>
            {d && <StatusBadge status={d.status} />}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        </div>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert info" onClick={() => setNotice("")}>{notice}</div>}
        {d && (
          <>
            {can('sync') && (
              <div className="drawer-actions">
                <button className="btn primary" onClick={recheck} disabled={checking}>
                  <RefreshCw size={15} className={checking ? 'spin' : ''} /> {checking ? 'Mengecek…' : 'Cek ulang sekarang'}
                </button>
                <button className="btn ghost" onClick={connTest} disabled={checking} title="DNS, Ping, Telnet & Curl, langsung dan lewat proxy">
                  <Activity size={15} /> Tes koneksi
                </button>
              </div>
            )}
            <dl className="kv">
              {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v || v === 0 ? v : '—'}</dd></div>))}
            </dl>
            {d.san && (
              <details className="san">
                <summary>Subject Alternative Names</summary>
                <p>{d.san.replace(/DNS:/g, '').split(', ').join(' · ')}</p>
              </details>
            )}
            {conn && (
              <>
                <h4>Tes koneksi terakhir <span className="muted small">· {fmtDateTime(d.conn_tested_at)}</span></h4>
                <ConnResult r={conn} />
              </>
            )}
            <h4>Riwayat pengecekan</h4>
            <ul className="history">
              {data.checks.map((c) => (
                <li key={c.id}>
                  <StatusBadge status={c.ssl_status} />
                  <span>{c.days_remaining != null ? fmtExpiresIn(c.days_remaining) : '—'}{c.via === 'fallback' ? ' · proxy (otomatis)' : c.via === 'proxy' ? ' · proxy' : ''}</span>
                  <span className="muted small">{fmtDateTime(c.checked_at)}</span>
                </li>
              ))}
              {!data.checks.length && <li className="muted">Belum pernah dicek.</li>}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
