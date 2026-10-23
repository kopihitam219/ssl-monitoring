'use client';
// Settings → Integrasi: deretan ikon (WhatsApp, Telegram, Email, SOAR, Wazuh, Entra ID, Teams).
// Klik ikon → halaman integrasi itu untuk mengisi datanya.
import { ArrowLeft, ChevronRight, MessageCircle, Send, Mail, Workflow, KeyRound, MessageSquare, ShieldAlert, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { ChannelCard, CHANNEL_DEFS } from './NotifySettings';
import EntraSettings from './EntraSettings';
import WazuhSettings from './WazuhSettings';
import SoarInbound from './SoarInbound';

const TYPE_LABEL = { alert: 'Alert', report: 'Hasil scan', system: 'Info sistem' };

export const INTEGRATIONS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: '#25d366', kind: 'Notifikasi', desc: 'Kirim alert & laporan lewat Fonnte atau gateway WhatsApp kantor.' },
  { key: 'telegram', label: 'Telegram', icon: Send, color: '#229ed9', kind: 'Notifikasi', desc: 'Kirim pesan ke grup / chat Telegram lewat bot.' },
  { key: 'email', label: 'Email', icon: Mail, color: '#f59e0b', kind: 'Notifikasi', desc: 'Kirim email lewat SMTP kantor, Office 365, atau Gmail.' },
  { key: 'soar', label: 'SOAR', icon: Workflow, color: '#ef4444', kind: 'Dua arah', desc: 'Aplikasi → SOAR: kirim alert & laporan. SOAR → aplikasi: kirim domain, cek status, jalankan scan.' },
  { key: 'wazuh', label: 'Wazuh', icon: ShieldAlert, color: '#3d82c4', kind: 'SIEM', desc: 'Kirim log aplikasi, log keamanan, dan temuan SSL ke Wazuh.' },
  { key: 'entra', label: 'Entra ID', icon: KeyRound, color: '#0078d4', kind: 'Login & user', desc: 'Login dengan akun Microsoft kantor, peran & user dari grup Entra ID.' },
  { key: 'teams', label: 'Microsoft Teams', icon: MessageSquare, color: '#6264a7', kind: 'Notifikasi', desc: 'Kirim kartu ringkasan ke channel Teams lewat Workflows webhook.' },
];

function configured(key, s) {
  if (key === 'wazuh') { const w = s.wazuh; return w.transport === 'file' || !!(w.url && (w.authMode === 'token' ? w.apiKeySet : w.username && w.passwordSet)); }
  if (key === 'soar' && s.soarIn.tokenSet) return true;
  if (key === 'entra') { const e = s.entra; return !!(e.tenantId && e.clientId && e.secretSet); }
  const c = s.notify[key];
  if (key === 'teams') return !!c.webhookUrlSet;
  if (key === 'telegram') return !!(c.botTokenSet && c.chatId);
  if (key === 'whatsapp') return c.provider === 'webhook' ? !!c.url : !!(c.tokenSet && c.target);
  if (key === 'email') return !!(c.host && c.from && c.to);
  if (key === 'soar') return !!c.url;
  return false;
}

function state(key, s) {
  const on = key === 'entra' ? s.entra.enabled : key === 'wazuh' ? s.wazuh.enabled : key === 'soar' ? s.notify.soar.enabled || s.soarIn.enabled : s.notify[key].enabled;
  if (on) return { cls: 'ok', text: 'Aktif' };
  if (configured(key, s)) return { cls: 'off', text: 'Mati' };
  return { cls: 'none', text: 'Belum diatur' };
}

function detail(key, s) {
  if (key === 'entra') return s.entra.enabled ? `Login Microsoft${s.entra.autoSync ? ' · sync otomatis' : ''}` : '';
  if (key === 'wazuh') {
    const w = s.wazuh;
    if (!w.enabled) return '';
    return [w.transport === 'file' ? 'File + agent' : w.transport === 'both' ? 'API + file' : 'API', w.sendSecurity && 'Keamanan', w.sendApp && 'Aplikasi', w.sendSsl && 'SSL'].filter(Boolean).join(' · ');
  }
  if (key === 'soar') return [s.notify.soar.enabled && 'Keluar ↑', s.soarIn.enabled && 'Masuk ↓'].filter(Boolean).join(' · ');
  const c = s.notify[key];
  if (!c.enabled) return '';
  const t = Object.keys(TYPE_LABEL).filter((k) => c[k]).map((k) => TYPE_LABEL[k]);
  return t.length ? t.join(' · ') : 'tidak menerima pesan apa pun';
}

export function IntegrationGrid({ settings, onOpen }) {
  return (
    <section className="panel">
      <h2>Integrasi</h2>
      <p className="muted small">Klik ikon untuk mengatur integrasinya.</p>
      <div className="intg-grid">
        {INTEGRATIONS.map((it) => {
          const st = state(it.key, settings);
          const Icon = it.icon;
          const d = detail(it.key, settings);
          return (
            <button key={it.key} className={`intg-tile ${st.cls}`} style={{ '--ic': it.color }} onClick={() => onOpen(it.key)} aria-label={`Atur ${it.label}`}>
              <span className="intg-icon"><Icon size={26} strokeWidth={2} /></span>
              <b>{it.label}</b>
              <span className={`intg-state ${st.cls}`}><i />{st.text}</span>
              {d && <small className="muted">{d}</small>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function IntegrationPage({ id, settings, put, saving, setMsg, onBack }) {
  const it = INTEGRATIONS.find((x) => x.key === id);
  if (!it) return null;
  const Icon = it.icon;
  const st = state(id, settings);
  const def = CHANNEL_DEFS.find((d) => d.key === id);
  return (
    <>
      <button className="link intg-back" onClick={onBack}><ArrowLeft size={15} /> Settings <ChevronRight size={13} className="muted" /> Integrasi</button>
      <section className="panel intg-page" style={{ '--ic': it.color }}>
        <div className="intg-page-head">
          <span className="intg-icon big"><Icon size={30} /></span>
          <div>
            <h2>{it.label} <span className={`intg-state ${st.cls}`}><i />{st.text}</span></h2>
            <p className="muted small">{it.kind} · {it.desc}</p>
          </div>
        </div>
        {id === 'soar' ? (
          <>
            <div className="intg-dir">
              <h3><ArrowUpRight size={16} /> Aplikasi → SOAR <span className={`intg-state ${settings.notify.soar.enabled ? 'ok' : 'none'}`}><i />{settings.notify.soar.enabled ? 'Aktif' : 'Mati'}</span></h3>
              <p className="muted small intg-help">{def.help}</p>
              <ChannelCard def={def} cur={settings.notify.soar} put={put} saving={saving} setMsg={setMsg} page />
            </div>
            <div className="intg-dir">
              <h3><ArrowDownLeft size={16} /> SOAR → Aplikasi <span className={`intg-state ${settings.soarIn.enabled ? 'ok' : 'none'}`}><i />{settings.soarIn.enabled ? 'Aktif' : 'Mati'}</span></h3>
              <SoarInbound settings={settings} put={put} saving={saving} setMsg={setMsg} />
            </div>
          </>
        ) : id === 'entra' ? <EntraSettings settings={settings} put={put} saving={saving} setMsg={setMsg} page />
          : id === 'wazuh' ? <WazuhSettings settings={settings} put={put} saving={saving} setMsg={setMsg} page />
          : (
            <>
              {def && <p className="muted small intg-help">{def.help}</p>}
              <ChannelCard def={def} cur={settings.notify[id]} put={put} saving={saving} setMsg={setMsg} page />
            </>
          )}
        {!['entra', 'wazuh'].includes(id) && <p className="muted small">Komputer ini perlu akses internet ke layanan tujuan. Di jaringan kantor dengan proxy, lihat README bagian "Notifikasi". Isi pesan (status yang di-alert, kirim ulang tiap N jam) diatur di Settings → Isi notifikasi.</p>}
      </section>
    </>
  );
}
