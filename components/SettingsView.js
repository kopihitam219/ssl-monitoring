'use client';
import { useEffect, useState } from 'react';
import { Save, Trash2, Database, CheckCircle2 } from 'lucide-react';
import { api, STATUS } from './ui';
import { ConfirmDialog } from './Modal';
import ProxySettings from './ProxySettings';
import NotifySettings from './NotifySettings';
import DeletedDomains from './DeletedDomains';
import { IntegrationGrid, IntegrationPage } from './Integrations';

export default function SettingsView({ onChanged }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [integration, setIntegration] = useState(null);
  const openIntegration = (k) => { setMsg(null); setIntegration(k); window.scrollTo?.({ top: 0 }); };

  const load = () => api('/api/settings').then((r) => { setInfo(r); setForm(structuredClone(r.settings)); }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);

  async function put(patch, okText) {
    setSaving(true); setMsg(null);
    try {
      const r = await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      setInfo(r); setForm(structuredClone(r.settings));
      setMsg({ ok: true, text: okText });
      onChanged?.();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e.message });
      return false;
    } finally { setSaving(false); }
  }

  async function dataAction(body) {
    const r = await api('/api/settings/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await load();
    onChanged?.();
    return r;
  }

  if (!info || !form) return <section className="panel">{msg ? <div className="alert error">{msg.text}</div> : <p className="muted">Memuat…</p>}</section>;

  const s = info.settings;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const TIER_KEYS = ['urgent', 'reminder', 'needUpdate', 'warning', 'info'];
  const setTier = (k) => (e) => setForm({ ...form, tiers: { ...form.tiers, [k]: e.target.value } });
  const dirtyRules = ['scanIntervalHours', 'scanConcurrency', 'scanTimeoutMs'].some((k) => String(form[k]) !== String(s[k]))
    || TIER_KEYS.some((k) => String(form.tiers[k]) !== String(s.tiers[k]))
    || String(form.monitoring?.renewalDays) !== String(s.monitoring?.renewalDays);
  if (integration) {
    return (
      <>
        {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
        <IntegrationPage id={integration} settings={s} put={put} saving={saving} setMsg={setMsg} onBack={() => openIntegration(null)} />
      </>
    );
  }
  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}

      <IntegrationGrid settings={s} onOpen={openIntegration} />
      <NotifySettings settings={s} put={put} saving={saving} setMsg={setMsg} />

      {/* ---------- Data ---------- */}
      <section className="panel">
        <h2>Data</h2>
        <div className="db-info">
          <Database size={15} />
          <span>Database: <code>{info.db.file.split(/[\\/]/).slice(-2).join('/')}</code> · {info.db.domains} domain dipantau · {info.db.excel} di Source of Truth · {info.db.checks} riwayat cek</span>
        </div>
        <div className="toolbar">
          <button className="btn danger-ghost" onClick={() => setConfirm({
            title: 'Kosongkan data?',
            message: 'Semua domain, riwayat scan, dan aktivitas akan dihapus permanen. Pengaturan, user, dan audit log tidak ikut terhapus.',
            confirmLabel: 'Kosongkan', danger: true, requireText: 'HAPUS',
            run: async () => { await dataAction({ action: 'clear', confirm: 'HAPUS' }); setMsg({ ok: true, text: 'Data dikosongkan.' }); },
          })}><Trash2 size={15} /> Kosongkan data</button>
        </div>
      </section>

      <DeletedDomains setMsg={setMsg} />
      <ProxySettings settings={s} put={put} saving={saving} setMsg={setMsg} />

      {/* ---------- Aturan & scan ---------- */}
      <section className="panel">
        <h2>Aturan status &amp; scan</h2>
        <span className="opt-label">Status berdasarkan sisa hari sertifikat</span>
        <div className="tier-grid">
          <div className="tier" style={{ '--c': STATUS.CHECK_FAILED.color }}><b>{STATUS.CHECK_FAILED.label}</b><span>tanggal expired tidak terbaca</span></div>
          {[['urgent', 'URGENT'], ['reminder', 'REMINDER'], ['needUpdate', 'NEED_UPDATE'], ['warning', 'WARNING'], ['info', 'INFORMATIONAL']].map(([k, st]) => (
            <label key={k} className="tier" style={{ '--c': STATUS[st].color }}>
              <b>{STATUS[st].label}</b>
              <span>sisa ≤ <input type="number" min="0" max="3650" value={form.tiers[k]} onChange={setTier(k)} aria-label={`${STATUS[st].label} sampai hari`} /> hari</span>
            </label>
          ))}
          <div className="tier" style={{ '--c': STATUS.OK.color }}><b>OK</b><span>sisa &gt; {form.tiers.info} hari</span></div>
        </div>
        <div className="form grid3">
          <label className="field">
            <span>Scan otomatis tiap (jam)</span>
            <input type="number" min="0" max="168" value={form.scanIntervalHours} onChange={set('scanIntervalHours')} />
            <small className="muted">0 = mati. Berjalan selama aplikasi terbuka.</small>
          </label>
          <label className="field"><span>Domain dicek bersamaan</span><input type="number" min="1" max="50" value={form.scanConcurrency} onChange={set('scanConcurrency')} /></label>
          <label className="field"><span>Timeout per domain (ms)</span><input type="number" min="1000" max="60000" step="1000" value={form.scanTimeoutMs} onChange={set('scanTimeoutMs')} /></label>
          <label className="field">
            <span>Kartu "Renewal": diperbarui dalam (hari)</span>
            <input type="number" min="1" max="365" value={form.monitoring?.renewalDays ?? 30} onChange={(e) => setForm({ ...form, monitoring: { ...form.monitoring, renewalDays: e.target.value } })} />
            <small className="muted">Dashboard Monitoring.</small>
          </label>
        </div>
        <p className="muted small"><CheckCircle2 size={13} className="h-icon" /> Perubahan ambang langsung berlaku untuk semua domain tanpa perlu scan ulang. Masalah kepercayaan sertifikat (nama tidak cocok, self-signed, root CA) tetap dicatat, tapi statusnya mengikuti sisa hari.</p>
        <div className="toolbar">
          <button className="btn primary" disabled={!dirtyRules || saving} onClick={() => put({
            tiers: Object.fromEntries(TIER_KEYS.map((k) => [k, form.tiers[k]])), scanIntervalHours: form.scanIntervalHours,
            scanConcurrency: form.scanConcurrency, scanTimeoutMs: form.scanTimeoutMs, monitoring: { renewalDays: form.monitoring?.renewalDays },
          }, 'Aturan disimpan.')}><Save size={15} /> Simpan aturan</button>
          {dirtyRules && <button className="btn ghost" onClick={() => setForm(structuredClone(s))}>Batal</button>}
        </div>
      </section>

      {confirm && (
        <ConfirmDialog title={confirm.title} message={<p>{confirm.message}</p>} confirmLabel={confirm.confirmLabel}
          danger={confirm.danger} requireText={confirm.requireText}
          onConfirm={async () => { setMsg(null); await confirm.run(); }} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}
