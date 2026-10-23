'use client';
import { useCallback, useEffect, useState } from 'react';
import { Play, RotateCw, Power, CheckCircle2, XCircle, Clock, Loader2, Server, Activity, FolderKanban } from 'lucide-react';
import ConnTestTool from './ConnTestTool';
import { api, fmtDateTime } from './ui';
import { ConfirmDialog } from './Modal';
import { useSession } from './session';

const TRIGGER = { manual: 'Manual', scheduler: 'Otomatis', cli: 'Terminal', soar: 'SOAR' };
const GROUP_JOBS = ['scan', 'retry_failed', 'conn_test'];

function uptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d} hari`, h && `${h} jam`, `${m} menit`].filter(Boolean).join(' ');
}

function duration(a, b) {
  if (!a || !b) return '';
  const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
  return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
}

function RunState({ run }) {
  if (!run) return <span className="muted small">Belum pernah dijalankan</span>;
  if (!run.finished_at) return <span className="run-state info"><Loader2 size={13} className="spin" /> Berjalan sejak {fmtDateTime(run.started_at)}</span>;
  return (
    <span className={`run-state ${run.ok ? 'ok' : 'bad'}`}>
      {run.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {fmtDateTime(run.finished_at)} · {TRIGGER[run.trigger] || run.trigger}
    </span>
  );
}

export default function JobsView({ onChanged }) {
  const { isAdmin } = useSession();
  const [svc, setSvc] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [running, setRunning] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [restarting, setRestarting] = useState(false);

  const [groups, setGroups] = useState([]);
  const [scope, setScope] = useState('');
  useEffect(() => { api('/api/groups').then((r) => setGroups(r.groups)).catch(() => {}); }, []);

  const load = useCallback(() => Promise.all([
    isAdmin ? api('/api/service').then(setSvc) : null,
    api('/api/jobs').then(setJobs),
  ]).catch((e) => setMsg({ ok: false, text: e.message })), [isAdmin]);

  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  async function run(job) {
    setRunning(job); setMsg(null);
    try {
      const r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job, groupId: GROUP_JOBS.includes(job) ? scope || null : null }) });
      setMsg({ ok: r.ok, text: r.message });
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setRunning(null);
      load();
    }
  }

  async function restart(full) {
    setMsg(null);
    const r = await api('/api/service/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full }) });
    if (!r.full) { setMsg({ ok: true, text: r.message }); load(); onChanged?.(); return; }

    // tunggu server mati lalu hidup lagi
    setRestarting(true);
    const before = svc?.startedAt;
    const deadline = Date.now() + 90_000;
    await new Promise((res) => setTimeout(res, 1500));
    while (Date.now() < deadline) {
      try {
        const s = await api('/api/service');
        if (s.startedAt !== before) {
          setRestarting(false);
          setMsg({ ok: true, text: 'Service berhasil di-restart.' });
          setSvc(s); load(); onChanged?.();
          return;
        }
      } catch {}
      await new Promise((res) => setTimeout(res, 1500));
    }
    setRestarting(false);
    setMsg({ ok: false, text: 'Service belum kembali setelah 90 detik. Cek terminal, lalu jalankan ulang "npm run dev" kalau perlu.' });
  }

  const sch = svc?.scheduler;
  const all = jobs?.jobs || [];
  const appJobs = all;
  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      {restarting && <div className="alert info"><Loader2 size={14} className="spin h-icon" /> Service sedang di-restart, halaman akan tersambung lagi otomatis…</div>}

      {/* ---------- Service (khusus admin) ---------- */}
      {isAdmin && <section className="panel">
        <div className="panel-head wrap">
          <div>
            <h2><Server size={16} className="h-icon" /> Service</h2>
            <p className="muted small">Server aplikasi yang berjalan di laptop ini.</p>
          </div>
          <div className="toolbar">
            <button className="btn ghost" disabled={!svc || restarting} onClick={() => setConfirm({
              title: 'Restart ringan?',
              message: 'Database dan pengaturan dimuat ulang, scheduler dijalankan ulang, dan scan yang macet lebih dari 15 menit direset. Server tetap menyala.',
              label: 'Restart ringan', run: () => { restart(false).catch((e) => setMsg({ ok: false, text: e.message })); },
            })}><RotateCw size={15} /> Restart ringan</button>
            <button className="btn primary" disabled={!svc || restarting || !svc.fullRestart} title={svc && !svc.fullRestart ? 'Jalankan aplikasi dengan npm run dev atau npm start' : ''}
              onClick={() => setConfirm({
                title: 'Restart service?',
                message: 'Server akan dimatikan lalu dinyalakan lagi otomatis (sekitar 5–20 detik). Dashboard tersambung lagi sendiri. Data tidak hilang.',
                label: 'Restart service', run: () => { restart(true).catch((e) => { setRestarting(false); setMsg({ ok: false, text: e.message }); }); },
              })}><Power size={15} /> Restart service</button>
          </div>
        </div>
        {svc ? (
          <dl className="svc-grid">
            <div><dt>Status</dt><dd><span className="run-state ok"><i className="dot" style={{ background: 'var(--ok)' }} />Online</span></dd></div>
            <div><dt>Berjalan sejak</dt><dd>{fmtDateTime(svc.startedAt)} <span className="muted">({uptime(svc.uptimeSec)})</span></dd></div>
            <div><dt>Dijalankan dengan</dt><dd>{svc.runMode}</dd></div>
            <div><dt>Scan otomatis</dt><dd>{sch?.active ? <>Tiap {sch.hours} jam · berikutnya {fmtDateTime(sch.nextRunAt)}</> : 'Mati'}</dd></div>
            <div><dt>Scan berjalan</dt><dd>{svc.scanning ? <span className="run-state info"><Loader2 size={13} className="spin" /> Ya, sejak {fmtDateTime(svc.scanStartedAt)}</span> : 'Tidak'}</dd></div>
            <div><dt>Node.js</dt><dd>{svc.node} · PID {svc.pid}</dd></div>
            <div><dt>Restart terakhir</dt><dd>{svc.lastRestart ? fmtDateTime(svc.lastRestart) : '—'}</dd></div>
          </dl>
        ) : <p className="muted">Memuat…</p>}
        {svc && !svc.fullRestart && (
          <p className="muted small">Restart penuh hanya tersedia kalau aplikasi dijalankan dengan <code>npm run dev</code> atau <code>npm start</code>.</p>
        )}
      </section>}

      {/* ---------- Jobs ---------- */}
      <section className="panel">
        <div className="panel-head wrap">
          <div>
            <h2>Jobs aplikasi</h2>
            <p className="muted small">Jalankan pekerjaan secara manual. Setiap run tercatat di riwayat di bawah.</p>
          </div>
          <label className="file-select" title="Berlaku untuk Scan SSL, Retry Check Failed, dan Tes koneksi">
            <FolderKanban size={15} />
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Group">
              <option value="">Semua group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        </div>
        <div className="jobs">
          {appJobs.map((j) => (
            <div key={j.key} className="job">
              <div className="job-text">
                <b>{j.label}</b>
                <span className="muted small">{j.description}</span>
                <RunState run={j.last} />
                {j.last?.message && <span className="small job-msg">{j.last.message}</span>}
              </div>
              <button className="btn primary" onClick={() => run(j.key)}
                disabled={!!running || restarting || !j.available || (['scan', 'retry_failed'].includes(j.key) && jobs.scanning)}
                title={!j.available ? (j.reason || 'Belum diatur (lihat Settings)') : ''}>
                {running === j.key ? <><Loader2 size={15} className="spin" /> Berjalan…</> : <><Play size={15} /> Run</>}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Tes koneksi manual ---------- */}
      <ConnTestTool />

      {/* ---------- Riwayat ---------- */}
      <section className="panel">
        <h2><Clock size={16} className="h-icon" /> Riwayat job</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Waktu</th><th>Job</th><th>Pemicu</th><th>Durasi</th><th>Hasil</th><th>Keterangan</th></tr></thead>
            <tbody>
              {jobs?.history.map((h) => (
                <tr key={h.id}>
                  <td className="small">{fmtDateTime(h.started_at)}</td>
                  <td>{jobs.jobs.find((x) => x.key === h.job)?.label || jobs.legacyLabels?.[h.job] || h.job.replace(/^soar:/, 'Flow SOAR: ')}</td>
                  <td className="small">{TRIGGER[h.trigger] || h.trigger}</td>
                  <td className="small">{duration(h.started_at, h.finished_at)}</td>
                  <td>{!h.finished_at ? <span className="run-state info">Berjalan</span> : h.ok ? <span className="run-state ok">Berhasil</span> : <span className="run-state bad">Gagal</span>}</td>
                  <td className="small wrap-cell">{h.message}</td>
                </tr>
              ))}
              {jobs && !jobs.history.length && <tr><td colSpan={6} className="empty">Belum ada job yang dijalankan.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {confirm && (
        <ConfirmDialog title={confirm.title} message={<p>{confirm.message}</p>} confirmLabel={confirm.label}
          onConfirm={confirm.run} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}
