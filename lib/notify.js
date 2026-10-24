// Notifikasi ke banyak saluran: Microsoft Teams, Telegram, WhatsApp (Fonnte / webhook gateway), Email (SMTP), SOAR (webhook).
//
// Jenis pesan (tiap saluran memilih sendiri mana yang diterima, di Settings → Notifikasi):
//   alert  : domain dengan status yang dipilih (default Check Failed & Urgent) setelah scan. Domain yang sama
//            hanya dikirim lagi kalau statusnya berubah atau tiap N jam selama masih bermasalah; yang pulih ikut dilaporkan.
//   report : hasil scan scheduler (ringkasan tiap scan otomatis) — juga tombol Jobs → "Kirim notifikasi sekarang".
//   system : informasi sistem bermasalah (scan gagal / macet, database, CPU/RAM/Disk penuh, saluran notifikasi gagal) dan saat pulih.
import os from 'node:os';
import nodemailer from 'nodemailer';
import { getSettings, CHANNELS } from './settings.js';
import { getDomains, addActivity } from './db.js';
import { buildSummary } from './jobs.js';
import { pg } from './pg.js';
import { audit } from './audit.js';
import { fmtDateTime, fmtDate } from './time.js';

const STATUS_LABEL = {
  CHECK_FAILED: 'Check Failed', URGENT: 'Urgent Renewal', REMINDER: 'Reminder Exp.', NEED_UPDATE: 'Need Update',
  WARNING: 'Warning Update', INFORMATIONAL: 'Informational', OK: 'OK', PENDING: 'Belum dicek',
};
const STATUS_ORDER = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL', 'OK'];
const MAX_ITEMS = 20;
const TIMEOUT = 15_000;

const fmtTime = fmtDateTime;  // jam di notifikasi selalu WIB, walaupun server di zona lain
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = () => (process.env.VERCEL ? `Vercel (${process.env.VERCEL_URL || 'cloud'})` : os.hostname());

const lastNotify = async (c) => { try { return await (await pg()).get('SELECT at, ok, summary FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1', `notify.${c}`); } catch { return null; } };

// ---------- model pesan → format tiap saluran ----------
// msg = { type, level: 'danger'|'warn'|'ok'|'info', title, subtitle, facts: [[k, v]], items: [{ title, status, detail }], sections: [{ title, items }], footer, data }

function itemLine(it) {
  return `${it.title}${it.status ? ` — ${STATUS_LABEL[it.status] || it.status}` : ''}${it.detail ? ` · ${it.detail}` : ''}`;
}

function toText(msg, { bold = (s) => s } = {}) {
  const out = [bold(msg.title)];
  if (msg.subtitle) out.push(msg.subtitle);
  if (msg.facts?.length) out.push('', ...msg.facts.map(([k, v]) => `• ${k}: ${v}`));
  for (const sec of msg.sections || []) {
    if (!sec.items?.length) continue;
    out.push('', bold(sec.title));
    out.push(...sec.items.slice(0, MAX_ITEMS).map((it) => `- ${itemLine(it)}`));
    if (sec.items.length > MAX_ITEMS) out.push(`  +${sec.items.length - MAX_ITEMS} lainnya`);
  }
  out.push('', msg.footer || `SSL Monitoring · ${host()} · ${fmtTime()}`);
  return out.join('\n');
}

function toTelegram(msg) {
  const out = [`<b>${esc(msg.title)}</b>`];
  if (msg.subtitle) out.push(esc(msg.subtitle));
  if (msg.facts?.length) out.push('', ...msg.facts.map(([k, v]) => `• ${esc(k)}: <b>${esc(v)}</b>`));
  for (const sec of msg.sections || []) {
    if (!sec.items?.length) continue;
    out.push('', `<b>${esc(sec.title)}</b>`);
    out.push(...sec.items.slice(0, MAX_ITEMS).map((it) => `- <code>${esc(it.title)}</code>${it.status ? ` — ${esc(STATUS_LABEL[it.status] || it.status)}` : ''}${it.detail ? ` · ${esc(it.detail)}` : ''}`));
    if (sec.items.length > MAX_ITEMS) out.push(`  +${sec.items.length - MAX_ITEMS} lainnya`);
  }
  out.push('', `<i>${esc(msg.footer || `SSL Monitoring · ${host()} · ${fmtTime()}`)}</i>`);
  const text = out.join('\n');
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

const LEVEL_COLOR = { danger: '#dc2626', warn: '#d97706', ok: '#16a34a', info: '#2563eb' };
function toHtml(msg) {
  const c = LEVEL_COLOR[msg.level] || LEVEL_COLOR.info;
  const facts = msg.facts?.length
    ? `<table style="border-collapse:collapse;margin:12px 0">${msg.facts.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#555">${esc(k)}</td><td style="padding:3px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>` : '';
  const secs = (msg.sections || []).filter((s) => s.items?.length).map((sec) => `
    <h3 style="font-size:14px;margin:16px 0 6px">${esc(sec.title)}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      ${sec.items.slice(0, 100).map((it) => `<tr style="border-top:1px solid #eee"><td style="padding:5px 8px 5px 0;font-family:Consolas,monospace">${esc(it.title)}</td><td style="padding:5px 8px;white-space:nowrap">${esc(STATUS_LABEL[it.status] || it.status || '')}</td><td style="padding:5px 0;color:#555">${esc(it.detail || '')}</td></tr>`).join('')}
    </table>${sec.items.length > 100 ? `<p style="color:#777">+${sec.items.length - 100} lainnya</p>` : ''}`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#111;max-width:760px">
    <div style="border-left:4px solid ${c};padding:4px 0 4px 12px">
      <div style="font-size:12px;color:#777">SSL Monitoring</div>
      <div style="font-size:18px;font-weight:700;color:${c}">${esc(msg.title)}</div>
      ${msg.subtitle ? `<div style="color:#555;margin-top:2px">${esc(msg.subtitle)}</div>` : ''}
    </div>${facts}${secs}
    <p style="font-size:12px;color:#888;margin-top:18px">${esc(msg.footer || `Dikirim dari ${host()} · ${fmtTime()}`)}</p></div>`;
}

const CARD_COLOR = { danger: 'Attention', warn: 'Warning', ok: 'Good', info: 'Accent' };
function toTeams(msg) {
  const body = [
    { type: 'TextBlock', text: 'SSL Monitoring', weight: 'Bolder', size: 'Small', isSubtle: true, spacing: 'None' },
    { type: 'TextBlock', text: msg.title, weight: 'Bolder', size: 'Large', wrap: true, color: CARD_COLOR[msg.level] || 'Default', spacing: 'Small' },
  ];
  if (msg.subtitle) body.push({ type: 'TextBlock', text: msg.subtitle, isSubtle: true, wrap: true, spacing: 'Small' });
  if (msg.facts?.length) body.push({ type: 'FactSet', spacing: 'Medium', facts: msg.facts.map(([title, value]) => ({ title, value: String(value) })) });
  for (const sec of msg.sections || []) {
    if (!sec.items?.length) continue;
    body.push({ type: 'TextBlock', text: sec.title, weight: 'Bolder', spacing: 'Medium', wrap: true });
    body.push({ type: 'FactSet', facts: sec.items.slice(0, MAX_ITEMS).map((it) => ({ title: it.title, value: [STATUS_LABEL[it.status] || it.status, it.detail].filter(Boolean).join(' · ') || '-' })) });
    if (sec.items.length > MAX_ITEMS) body.push({ type: 'TextBlock', text: `+${sec.items.length - MAX_ITEMS} lainnya. Lihat dashboard.`, isSubtle: true, wrap: true });
  }
  body.push({ type: 'TextBlock', text: msg.footer || `${host()} · ${fmtTime()}`, isSubtle: true, size: 'Small', wrap: true, spacing: 'Medium' });
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null,
      content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', msteams: { width: 'Full' }, body } }],
  };
}

function toJson(msg) {
  return {
    source: 'ssl-monitoring', host: host(), type: msg.type, level: msg.level, title: msg.title, subtitle: msg.subtitle || null,
    generated_at: new Date().toISOString(),
    summary: Object.fromEntries((msg.facts || []).map(([k, v]) => [k, v])),
    sections: (msg.sections || []).map((s) => ({ title: s.title, items: s.items })),
    data: msg.data || null,
  };
}

// ---------- HTTP ----------
async function http(url, { method = 'POST', headers = {}, body, name }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`${name} menolak (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout: ${name} tidak merespons dalam ${TIMEOUT / 1000} detik`);
    const code = e.cause?.code || e.cause?.errors?.[0]?.code || (e.message === 'fetch failed' ? e.cause?.message || 'gagal terhubung' : null);
    if (code) throw new Error(`Tidak bisa terhubung ke ${name} (${code}). Cek alamat, koneksi internet, atau proxy kantor.`);
    throw e;
  } finally { clearTimeout(t); }
}

const SENDERS = {
  async teams(ch, msg) {
    await http(ch.webhookUrl, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toTeams(msg)), name: 'Teams' });
  },
  async telegram(ch, msg) {
    const text = await http(`https://api.telegram.org/bot${encodeURIComponent(ch.botToken)}/sendMessage`, {
      headers: { 'Content-Type': 'application/json' }, name: 'Telegram',
      body: JSON.stringify({ chat_id: ch.chatId, text: toTelegram(msg), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const r = JSON.parse(text || '{}');
    if (r.ok === false) throw new Error(`Telegram: ${r.description || 'gagal'}`);
  },
  async whatsapp(ch, msg) {
    const message = toText(msg, { bold: (s) => `*${s}*` });
    if (ch.provider === 'fonnte') {
      const text = await http('https://api.fonnte.com/send', {
        headers: { Authorization: ch.token, 'Content-Type': 'application/x-www-form-urlencoded' }, name: 'Fonnte',
        body: new URLSearchParams({ target: ch.target, message, countryCode: '62' }).toString(),
      });
      let r = {};
      try { r = JSON.parse(text || '{}'); } catch {}
      if (r.status === false) throw new Error(`Fonnte: ${r.reason || r.detail || 'gagal'}`);
      return;
    }
    await http(ch.url, {
      headers: { 'Content-Type': 'application/json', ...(ch.token ? { Authorization: ch.token } : {}) }, name: 'Gateway WhatsApp',
      body: JSON.stringify({ target: ch.target, message, ...toJson(msg) }),
    });
  },
  async email(ch, msg) {
    const transport = nodemailer.createTransport({
      host: ch.host, port: Number(ch.port) || 587, secure: !!ch.secure,
      auth: ch.user ? { user: ch.user, pass: ch.pass } : undefined,
      connectionTimeout: TIMEOUT, greetingTimeout: TIMEOUT, socketTimeout: TIMEOUT,
    });
    const prefix = { alert: '[ALERT]', report: '[Laporan scan]', system: '[Sistem]', test: '[Tes]' }[msg.type] || '';
    await transport.sendMail({
      from: ch.from, to: ch.to.split(/[;,\s]+/).filter(Boolean).join(', '),
      subject: `${prefix} SSL Monitoring: ${msg.title}`, text: toText(msg), html: toHtml(msg),
    });
  },
  async soar(ch, msg) {
    await http(ch.url, {
      headers: { 'Content-Type': 'application/json', ...(ch.token ? { [ch.authHeader || 'Authorization']: ch.token } : {}) }, name: 'SOAR',
      body: JSON.stringify(toJson(msg)),
    });
  },
};

/**
 * Kirim pesan ke semua saluran aktif yang menerima jenis pesan ini.
 * only = nama saluran tertentu (tes), skip = saluran yang dilewati (mis. saluran yang sedang bermasalah).
 */
export async function dispatch(msg, { only = null, skip = [], force = false } = {}) {
  const s = getSettings().notify;
  const targets = Object.keys(CHANNELS).filter((c) => (only ? c === only : true) && !skip.includes(c))
    .filter((c) => only || (s[c].enabled && (force || s[c][msg.type])));
  const results = [];
  for (const c of targets) {
    try {
      await SENDERS[c](s[c], msg);
      results.push({ channel: c, ok: true });
    } catch (e) {
      results.push({ channel: c, ok: false, error: e.message });
    }
  }
  for (const r of results) {
    audit({ category: 'notify', action: `notify.${r.channel}`, target: CHANNELS[r.channel].label, ok: r.ok, source: 'System', type: 'system', actor: 'system',
      summary: `${r.ok ? 'Terkirim' : 'Gagal kirim'} ${msg.type === 'alert' ? 'alert' : msg.type === 'report' ? 'hasil scan' : msg.type === 'system' ? 'info sistem' : 'pesan tes'} ke ${CHANNELS[r.channel].label}: ${msg.title}${r.ok ? '' : ` — ${r.error}`}` });
  }
  const failed = results.filter((r) => !r.ok);
  if (results.length) await addActivity(failed.length ? 'failed' : 'sync', `Notifikasi ${failed.length ? 'sebagian gagal' : 'terkirim'}: ${msg.title}`,
    `${results.map((r) => `${CHANNELS[r.channel].label} ${r.ok ? '✓' : '✗'}`).join(' · ')}${failed.length ? ' (detail di Audit Log)' : ''}`);
  return results;
}

// ---------- isi pesan ----------
function domainItem(d) {
  const name = `${d.domain}${d.port !== 443 ? `:${d.port}` : ''}`;
  const parts = [];
  if (d.expires_at) parts.push(d.days_remaining < 0 ? `expired ${-d.days_remaining} hari lalu (${fmtDate(d.expires_at)})` : `${d.days_remaining} hari lagi (${fmtDate(d.expires_at)})`);
  else if (d.last_error) parts.push(d.last_error);
  if (d.group_name || d.file_name) parts.push(d.group_name || d.file_name);
  if (d.owner) parts.push(d.owner);
  return { title: name, status: d.status, detail: parts.join(' · '), domain: d.domain, port: d.port, days_remaining: d.days_remaining ?? null, expires_at: d.expires_at ?? null, group: d.group_name ?? null, file: d.file_name ?? null };
}

const countFacts = (counts) => STATUS_ORDER.map((k) => [STATUS_LABEL[k], counts[k] || 0]);
const byPriority = (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.days_remaining ?? 1e9) - (b.days_remaining ?? 1e9);

export async function buildReport({ scan } = {}) {
  const { rows, counts, total } = buildSummary(await getDomains());
  const wanted = new Set(getSettings().notify.alertStatuses);
  const problems = rows.filter((d) => wanted.has(d.status)).sort(byPriority);
  const facts = [['Domain dipantau', total], ...countFacts(counts)];
  if (scan) facts.unshift(['Scan', `${scan.total} domain · ${scan.seconds} detik${scan.fallback ? ` · ${scan.fallback} lewat proxy (otomatis)` : ''}`]);
  return {
    type: 'report', level: problems.length ? 'warn' : 'ok',
    title: problems.length ? `Hasil scan: ${problems.length} domain perlu perhatian` : 'Hasil scan: semua aman',
    subtitle: `${scan?.scope ? `${scan.scope} · ` : ''}${fmtTime()}`,
    facts, sections: [{ title: `Domain bermasalah (${[...wanted].map((k) => STATUS_LABEL[k]).join(', ')})`, items: problems.map(domainItem) }],
    data: { counts, total, scan: scan || null },
  };
}

/** Alert setelah scan: domain baru bermasalah / status berubah / waktunya diingatkan lagi, plus yang sudah pulih. */
export async function buildAlert() {
  const s = getSettings().notify;
  const wanted = new Set(s.alertStatuses);
  const { rows, counts } = buildSummary(await getDomains());
  const db = await pg();
  const state = new Map((await db.all('SELECT * FROM notify_alert_state')).map((r) => [r.domain_id, r]));
  const now = Date.now();
  const due = [];
  for (const d of rows.filter((x) => wanted.has(x.status))) {
    const st = state.get(d.id);
    if (!st || st.status !== d.status || now - new Date(st.sent_at).getTime() >= s.alertRepeatHours * 3_600_000) due.push(d);
  }
  const active = new Set(rows.map((d) => d.id));
  const recovered = [...state.values()].filter((st) => {
    const d = rows.find((x) => x.id === st.domain_id);
    return d ? !wanted.has(d.status) : !active.has(st.domain_id);
  }).map((st) => {
    const d = rows.find((x) => x.id === st.domain_id);
    return d ? { ...domainItem(d), id: d.id } : { title: st.domain || `#${st.domain_id}`, status: null, detail: 'tidak dipantau lagi', id: st.domain_id };
  });
  if (!due.length && !recovered.length) return null;
  due.sort(byPriority);
  const msg = {
    type: 'alert', level: due.some((d) => ['CHECK_FAILED', 'URGENT'].includes(d.status)) ? 'danger' : due.length ? 'warn' : 'ok',
    title: due.length ? `${due.length} domain perlu tindakan` : `${recovered.length} domain sudah pulih`,
    subtitle: fmtTime(),
    facts: countFacts(counts).filter(([, v]) => v > 0),
    sections: [
      { title: 'Perlu tindakan', items: due.map(domainItem) },
      { title: 'Sudah pulih', items: recovered },
    ],
    data: { counts },
  };
  const commit = async () => {
    const t = new Date().toISOString();
    for (const d of due) {
      await db.run(`INSERT INTO notify_alert_state (domain_id, domain, status, sent_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (domain_id) DO UPDATE SET status = excluded.status, sent_at = excluded.sent_at, domain = excluded.domain`, d.id, d.domain, d.status, t);
    }
    for (const r of recovered) await db.run('DELETE FROM notify_alert_state WHERE domain_id = ?', r.id);
  };
  return { msg, commit };
}

/** Dipanggil setelah setiap scan. trigger = 'scheduler' | 'manual' | 'cli' */
export async function notifyAfterScan({ trigger, scan }) {
  const s = getSettings().notify;
  const any = Object.keys(CHANNELS).some((c) => s[c].enabled);
  if (!any) return { sent: false, skipped: 'Tidak ada saluran notifikasi aktif' };
  const out = [];
  const alert = await buildAlert();
  if (alert) {
    const r = await dispatch(alert.msg);
    if (r.some((x) => x.ok) || !r.length) await alert.commit();
    out.push(...r);
  }
  if (['scheduler', 'cron'].includes(trigger)) {
    const rep = await buildReport({ scan });
    if (s.reportAllOk || rep.sections[0].items.length) out.push(...(await dispatch(rep)));
  }
  return { sent: out.some((r) => r.ok), results: out };
}

/** Jobs → "Kirim notifikasi sekarang": ringkasan saat ini ke semua saluran yang menerima hasil scan. */
export async function sendReportNow() {
  const s = getSettings().notify;
  const targets = Object.keys(CHANNELS).filter((c) => s[c].enabled && s[c].report);
  if (!targets.length) return { sent: false, skipped: 'Belum ada saluran aktif yang menerima "Hasil scan" (Settings → Notifikasi)' };
  const r = await dispatch(await buildReport());
  const ok = r.filter((x) => x.ok);
  if (!ok.length) throw new Error(r.map((x) => `${CHANNELS[x.channel].label}: ${x.error}`).join(' · '));
  return { sent: true, results: r, channels: ok.length };
}

/** Pesan tes ke satu saluran (memakai pengaturan yang sudah disimpan). */
export async function sendTest(channel) {
  if (!CHANNELS[channel]) throw new Error('Saluran tidak dikenal');
  const msg = {
    type: 'test', level: 'ok', title: 'Tes notifikasi berhasil',
    subtitle: `${CHANNELS[channel].label} sudah terhubung dengan SSL Monitoring.`,
    facts: [['Komputer', host()], ['Waktu', fmtTime()]],
  };
  const [r] = await dispatch(msg, { only: channel });
  if (!r.ok) throw new Error(r.error);
  return r;
}

// ---------- informasi sistem bermasalah ----------
/**
 * Cek kondisi sistem dan kirim info kalau ada masalah baru, masih bermasalah (diingatkan tiap N jam), atau sudah pulih.
 * Dipanggil scheduler tiap 5 menit. CPU/RAM harus tinggi di dua pengecekan berturut-turut supaya lonjakan sesaat tidak dikirim.
 */
export async function checkSystem() {
  const s = getSettings().notify;
  if (!Object.keys(CHANNELS).some((c) => s[c].enabled && s[c].system)) return null;
  const { healthReport } = await import('./health.js');
  const h = await healthReport();
  const issues = new Map();
  const add = (key, title, detail, sticky = true) => issues.set(key, { title, detail, sticky });
  if (h.cpu.status === 'error') add('cpu', 'CPU hampir penuh', `${h.cpu.pct.toFixed(0)}%`, false);
  if (h.memory.status === 'error') add('ram', 'RAM hampir penuh', `${h.memory.pct.toFixed(0)}%`, false);
  if (h.disk.status === 'error') add('disk', 'Disk hampir penuh', `${h.disk.pct?.toFixed?.(0) ?? '?'}% terpakai`);
  for (const sv of h.services) if (sv.status === 'error') add(`svc:${sv.name}`, sv.name, sv.detail);
  // saluran notifikasi yang kiriman terakhirnya gagal (dibaca dari audit log supaya tetap benar setelah restart)
  for (const c of Object.keys(CHANNELS).filter((x) => s[x].enabled)) {
    const last = await lastNotify(c);
    if (last && !last.ok) add(`notify:${c}`, `Notifikasi ${CHANNELS[c].label} gagal`, last.summary.replace(/^.*? — /, ''));
  }

  const db = await pg();
  const state = new Map((await db.all('SELECT * FROM notify_system_state')).map((r) => [r.key, r]));
  const now = new Date();
  const toSend = [];
  for (const [key, it] of issues) {
    const st = state.get(key);
    if (!st) {
      await db.run('INSERT INTO notify_system_state (key, title, detail, first_at, sent_at, seen) VALUES (?, ?, ?, ?, NULL, 1) ON CONFLICT (key) DO NOTHING', key, it.title, it.detail, now.toISOString());
      if (it.sticky) toSend.push({ key, ...it });
      continue;
    }
    await db.run('UPDATE notify_system_state SET detail = ?, seen = seen + 1 WHERE key = ?', it.detail, key);
    const repeat = st.sent_at && now - new Date(st.sent_at) >= s.systemRepeatHours * 3_600_000;
    if (!st.sent_at || repeat) toSend.push({ key, ...it, since: st.first_at });
  }
  const resolved = [...state.values()].filter((st) => !issues.has(st.key));
  const resolvedSent = resolved.filter((st) => st.sent_at);
  for (const st of resolved) await db.run('DELETE FROM notify_system_state WHERE key = ?', st.key);
  if (!toSend.length && !resolvedSent.length) return null;

  const msg = {
    type: 'system', level: toSend.length ? 'danger' : 'ok',
    title: toSend.length ? `Sistem bermasalah: ${toSend.map((x) => x.title).join(', ')}` : 'Sistem kembali normal',
    subtitle: `${host()} · ${fmtTime()}`,
    sections: [
      { title: 'Masalah', items: toSend.map((x) => ({ title: x.title, detail: `${x.detail || ''}${x.since ? ` (sejak ${fmtTime(x.since)})` : ''}` })) },
      { title: 'Sudah pulih', items: resolvedSent.map((x) => ({ title: x.title, detail: `sejak ${fmtTime(x.first_at)}` })) },
    ],
  };
  // saluran yang sedang gagal tidak dipakai untuk melaporkan dirinya sendiri
  const skip = toSend.filter((x) => x.key.startsWith('notify:')).map((x) => x.key.slice(7));
  const r = await dispatch(msg, { skip });
  const t = new Date().toISOString();
  if (r.some((x) => x.ok)) for (const x of toSend) await db.run('UPDATE notify_system_state SET sent_at = ? WHERE key = ?', t, x.key);
  return r;
}

/** Kirim info sistem satu kali (mis. job scan gagal), tanpa menunggu pengecekan berkala. */
export async function notifySystemEvent(title, detail) {
  const s = getSettings().notify;
  if (!Object.keys(CHANNELS).some((c) => s[c].enabled && s[c].system)) return null;
  return dispatch({ type: 'system', level: 'danger', title, subtitle: `${host()} · ${fmtTime()}`, sections: [{ title: 'Detail', items: [{ title, detail }] }] });
}

/** Status tiap saluran untuk Health Check. */
export async function channelStatus() {
  const s = getSettings().notify;
  return Promise.all(Object.entries(CHANNELS).map(async ([c, meta]) => {
    const ch = s[c];
    const types = ['alert', 'report', 'system'].filter((t) => ch[t]).map((t) => ({ alert: 'alert', report: 'hasil scan', system: 'sistem' }[t]));
    if (!ch.enabled) return { name: `Notifikasi ${meta.label}`, status: 'off', detail: 'Tidak dipakai' };
    const last = await lastNotify(c);
    return {
      name: `Notifikasi ${meta.label}`,
      status: last && !last.ok ? 'error' : 'ok',
      detail: last ? `${last.ok ? 'Terakhir' : 'Gagal'} ${fmtTime(last.at)}: ${last.summary.slice(0, 120)}` : `Aktif (${types.join(', ') || 'tidak ada jenis pesan dipilih'}), belum ada kiriman`,
    };
  }));
}
