'use client';
import { useCallback, useEffect, useState } from 'react';
import { Home, ShieldCheck, FileSpreadsheet, Settings, Menu, RefreshCw, ShieldHalf, PlayCircle, ScrollText, Users, LogOut, KeyRound, Loader2, Activity, LayoutDashboard, MonitorDot } from 'lucide-react';
import HealthView from '@/components/HealthView';
import JobsView from '@/components/JobsView';
import AuditView from '@/components/AuditView';
import UsersView from '@/components/UsersView';
import MonitoringDashboard, { groupColor } from '@/components/MonitoringDashboard';
import GroupDashboard from '@/components/GroupDashboard';
import { LoginView, SetupView, ChangePasswordDialog } from '@/components/AuthViews';
import { SessionContext, makeSession, ROLE_LABEL } from '@/components/session';
import PeriodPicker, { PRESETS, periodLabel } from '@/components/PeriodPicker';
import { KpiCards, SourcesPanel, ActivityPanel } from '@/components/Panels';
import { Donut, TrendChart, EnvBars } from '@/components/Charts';
import InventoryTable from '@/components/InventoryTable';
import { SourceOfTruthView, SettingsView } from '@/components/Views';
import { api } from '@/components/ui';

// need: izin yang dibutuhkan untuk melihat menu ('admin' = khusus admin, kosong = semua user)
const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: Home },
  { key: 'inventory', label: 'SSL Inventory', icon: ShieldCheck },
  { key: 'excel', label: 'Source of Truth', icon: FileSpreadsheet },
  { key: 'jobs', label: 'Jobs', icon: PlayCircle, need: 'jobs' },
  { key: 'audit', label: 'Audit Log', icon: ScrollText, need: 'audit' },
  { key: 'health', label: 'Health Check', icon: Activity, need: 'health' },
  { key: 'users', label: 'Users', icon: Users, need: 'admin' },
  { key: 'settings', label: 'Settings', icon: Settings, need: 'admin' },
];

const TITLES = {
  dashboard: ['Dashboard', 'Ringkasan monitoring sertifikat SSL dari Source of Truth (Excel), per group dashboard'],
  inventory: ['SSL Inventory', 'Semua domain aktif beserta status sertifikatnya'],
  excel: ['Source of Truth', 'Group dashboard & file Excel daftar domain resmi: upload, ubah isi, pilihan proxy, hapus'],
  jobs: ['Jobs', 'Jalankan job manual, restart service, dan riwayat job'],
  audit: ['Audit Log', 'Siapa melakukan apa, kapan, dan apa yang berubah'],
  users: ['Users', 'Kelola user dan hak akses peran Monitoring'],
  health: ['Health Check', 'CPU, RAM, Disk, memori aplikasi, dan status service'],
  settings: ['Settings', 'Konfigurasi aplikasi'],
};

/** Pintu masuk: cek status login → tampilkan Setup / Login / Aplikasi. */
export default function Root() {
  const [auth, setAuth] = useState({ loading: true });
  const [expired, setExpired] = useState(false);
  const [loginError, setLoginError] = useState('');
  useEffect(() => {
    // pesan error dari login Microsoft dikirim lewat ?login_error=…; tampilkan lalu bersihkan URL
    const p = new URLSearchParams(window.location.search);
    if (p.get('login_error')) { setLoginError(p.get('login_error')); window.history.replaceState(null, '', '/'); }
  }, []);

  const check = useCallback(() => fetch('/api/auth/status').then((r) => r.json())
    .then((d) => setAuth({ loading: false, needsSetup: d.needsSetup, user: d.user, microsoft: d.microsoft }))
    .catch(() => setAuth({ loading: false, error: true })), []);

  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const onExpired = () => { setExpired(true); setAuth((a) => ({ ...a, user: null })); };
    window.addEventListener('ssl-unauthorized', onExpired);
    return () => window.removeEventListener('ssl-unauthorized', onExpired);
  }, []);

  if (auth.loading) return <div className="auth-page"><Loader2 className="spin muted" size={28} /></div>;
  if (auth.error) return <div className="auth-page"><div className="alert error">Tidak bisa terhubung ke server. Pastikan "npm run dev" masih berjalan, lalu muat ulang halaman.</div></div>;
  if (auth.needsSetup) return <SetupView onDone={(user) => setAuth({ loading: false, user })} />;
  if (!auth.user) return <LoginView expired={expired} microsoft={auth.microsoft} loginError={loginError}
    onLogin={(user) => { setExpired(false); setAuth({ loading: false, user }); }} />;
  return (
    <SessionContext.Provider value={makeSession(auth.user)}>
      <App key={auth.user.id} user={auth.user} onSessionChange={check} onLoggedOut={() => setAuth({ loading: false, user: null })} />
    </SessionContext.Provider>
  );
}

function App({ user, onSessionChange, onLoggedOut }) {
  const session = makeSession(user);
  const { isAdmin, can } = session;
  const nav = NAV.filter((n) => !n.need || (n.need === 'admin' ? isAdmin : can(n.need)));
  const [pwOpen, setPwOpen] = useState(!!user.mustChange);
  async function doLogout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    onLoggedOut();
  }
  const [view, setView] = useState('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [preset, setPreset] = useState(null); // filter dari Dashboard Monitoring
  const [dashTab, setDashTab] = useState('main');
  useEffect(() => { try { const t = localStorage.getItem('ssl-dash-tab'); if (t) setDashTab(t); } catch {} }, []);
  const pickDash = (t) => { setDashTab(t); try { localStorage.setItem('ssl-dash-tab', t); } catch {} };
  const [settingsKey, setSettingsKey] = useState(0);
  const [period, setPeriod] = useState(() => ({ key: '7d', ...PRESETS[1].range() }));

  // ingat pilihan periode di browser ini (preset dihitung ulang setiap hari)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ssl-period') || 'null');
      if (saved?.key === 'custom') setPeriod(saved);
      else if (saved?.key) { const pr = PRESETS.find((x) => x.key === saved.key); if (pr) setPeriod({ key: pr.key, ...pr.range() }); }
    } catch {}
  }, []);
  function changePeriod(p) {
    setPeriod(p);
    try { localStorage.setItem('ssl-period', JSON.stringify(p)); } catch {}
  }

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
    const qs = new URLSearchParams({ from: period.from || '', to: period.to || '' });
    return api(`/api/dashboard?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [period.from, period.to]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!data?.scanning) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [data?.scanning, refresh]);

  async function sync() {
    setSyncing(true); setToast(null);
    try {
      const r = await api('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setToast({ ok: true, text: r.queued ? r.message : `Scan: ${r.scan.total} domain dalam ${r.scan.seconds} detik${r.scan.remaining ? ` · ${r.scan.remaining} domain dilanjutkan otomatis (batas waktu)` : ''}` });
    } catch (e) {
      setToast({ ok: false, text: e.message });
    } finally {
      setSyncing(false);
      refresh();
    }
  }

  function pickStatus(k) {
    setPreset(null);
    setStatusFilter(k);
    setView('inventory');
  }

  /** Klik kartu / baris di Dashboard Monitoring → SSL Inventory dengan filter itu. */
  function drill(f) {
    const { status = '', label, ...rest } = f;
    setStatusFilter(status);
    setPreset(Object.keys(rest).length ? { ...rest, label } : null);
    setView('inventory');
  }

  const [title, subtitle] = TITLES[view] || [view, ''];
  // tab dashboard per group: "group:<id>" (kalau group sudah dihapus → kembali ke Dashboard Utama)
  const groupIdx = data?.groups?.findIndex((g) => g.key === dashTab) ?? -1;
  const activeGroup = groupIdx >= 0 ? data.groups[groupIdx] : null;
  const empty = data && data.total === 0;
  const go = (v) => { setView(v); setNavOpen(false); };

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <ShieldHalf size={34} className="brand-icon" />
          <div>
            <div className="brand-name">SSL Monitoring</div>
            <div className="brand-tag">Safe Today, Secure Tomorrow</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => {
            const Icon = n.icon;
            return (
              <button key={n.key} className={view === n.key ? 'active' : ''} onClick={() => { setView(n.key); setNavOpen(false); if (n.key === 'inventory') { setStatusFilter(''); setPreset(null); } }}>
                <Icon size={18} /> {n.label}
              </button>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="user-box">
            <div className="avatar">{(user.name || user.username).slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <b>{user.name || user.username}</b>
              <span className={`role-badge ${user.role}`}>{ROLE_LABEL[user.role]}</span>
            </div>
            <button className="icon-btn" title="Ganti password" aria-label="Ganti password" onClick={() => setPwOpen(true)}><KeyRound size={15} /></button>
            <button className="icon-btn" title="Logout" aria-label="Logout" onClick={doLogout}><LogOut size={15} /></button>
          </div>
          <div><i className="dot" style={{ background: error ? 'var(--danger)' : 'var(--ok)' }} /> {error ? 'System Error' : 'System Online'}</div>
          <div className="muted">v2.1.0 · {data?.deploy || "…"}</div>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setNavOpen(false)} />

      <main>
        <header className="topbar">
          <button className="icon-btn menu" onClick={() => setNavOpen(true)} aria-label="Menu"><Menu size={20} /></button>
          <div className="page-title">
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </div>
          <div className="top-actions">
            <PeriodPicker value={period} onChange={changePeriod} />
            <button className="icon-btn" onClick={refresh} aria-label="Muat ulang"><RefreshCw size={16} /></button>
            {can('sync') && (
              <button className="btn primary" onClick={() => sync()} disabled={syncing || data?.scanning}>
                <RefreshCw size={15} className={syncing || data?.scanning ? 'spin' : ''} /> {syncing || data?.scanning ? 'Syncing…' : 'Sync Now'}
              </button>
            )}
          </div>
        </header>

        {error && <div className="alert error">Tidak bisa memuat data: {error}</div>}
        {toast && <div className={`alert ${toast.ok ? 'success' : 'error'}`} onClick={() => setToast(null)}>{toast.text}</div>}
        {empty && !['settings', 'excel', 'jobs', 'audit', 'users', 'health'].includes(view) && (
          <div className="alert info">
            {can('manage_domains')
              ? <>Belum ada domain. Upload Excel atau tambah domain di menu <button className="link inline" onClick={() => go('excel')}>Source of Truth</button>.</>
              : 'Belum ada domain yang dipantau.'}
          </div>
        )}

        {data && view === 'dashboard' && (
          <div className="dash-switch" role="tablist" aria-label="Pilih dashboard">
            <button role="tab" aria-selected={dashTab === 'main'} className={dashTab === 'main' ? 'on' : ''} onClick={() => pickDash('main')}><LayoutDashboard size={16} /> Dashboard Utama</button>
            <button role="tab" aria-selected={dashTab === 'monitoring'} className={dashTab === 'monitoring' ? 'on' : ''} onClick={() => pickDash('monitoring')}><MonitorDot size={16} /> Dashboard Monitoring</button>
            {data.groups?.length > 0 && <><span className="sep" aria-hidden="true" /><span className="grp">Group</span></>}
            {data.groups?.map((g, i) => (
              <button key={g.key} role="tab" aria-selected={dashTab === g.key} className={`flow ${dashTab === g.key ? 'on' : ''}`}
                style={{ '--fc': groupColor(i) }} onClick={() => pickDash(g.key)} title={`${g.files} file · ${g.domains} domain`}>
                <i aria-hidden="true" /> {g.name}
              </button>
            ))}
          </div>
        )}
        {data && view === 'dashboard' && dashTab === 'monitoring' && <MonitoringDashboard reloadKey={reloadKey} onDrill={drill} />}
        {data && view === 'dashboard' && activeGroup && <GroupDashboard key={activeGroup.key} groupId={activeGroup.id} color={groupColor(groupIdx)} reloadKey={reloadKey} onChanged={refresh} />}
        {data && view === 'dashboard' && dashTab !== 'monitoring' && !activeGroup && (
          <>
            <KpiCards cards={data.cards} total={data.total} onPick={pickStatus} config={data.config} />
            <div className="grid-main">
              <div className="col-left">
                <div className="charts">
                  <section className="panel"><h2>Status SSL Certificate</h2><Donut cards={data.cards} total={data.total} /></section>
                  <section className="panel"><h2>Tren Status Sertifikat</h2><p className="muted small panel-sub">{periodLabel(period)}</p><TrendChart trend={data.trend} /></section>
                  <section className="panel"><h2>Distribusi per Environment</h2><EnvBars environments={data.environments} /></section>
                </div>
                <InventoryTable reloadKey={reloadKey} onChanged={refresh} />
              </div>
              <div className="col-right">
                <SourcesPanel sources={data.sources} scanning={data.scanning} />
                <ActivityPanel activities={data.activities} total={data.activityTotal} period={period} />
              </div>
            </div>
          </>
        )}
        {data && view === 'inventory' && <InventoryTable initialStatus={statusFilter} pageSize={25} reloadKey={reloadKey} onChanged={refresh}
          editable={can('manage_domains')} subtitle="Semua domain di Source of Truth beserta status sertifikatnya. Admin bisa melengkapi Owner / Application / Environment dan menghapus domain yang tidak perlu dipantau."
          preset={preset} onClearPreset={() => { setPreset(null); setStatusFilter(''); }} />}
        {data && view === 'excel' && <SourceOfTruthView reloadKey={reloadKey} onChanged={refresh} />}
        {view === 'settings' && isAdmin && <SettingsView key={settingsKey} onChanged={refresh} />}
        {view === 'jobs' && can('jobs') && <JobsView onChanged={refresh} />}
        {view === 'audit' && can('audit') && <AuditView />}
        {view === 'users' && isAdmin && <UsersView />}
        {view === 'health' && can('health') && <HealthView />}
      </main>
      {pwOpen && <ChangePasswordDialog forced={!!user.mustChange} onClose={() => setPwOpen(false)}
        onDone={() => { setToast({ ok: true, text: 'Password berhasil diganti.' }); if (user.mustChange) onSessionChange(); }} />}
    </div>
  );
}
