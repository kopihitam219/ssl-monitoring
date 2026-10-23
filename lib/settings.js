// Pengaturan aplikasi, disimpan di database (tabel app_settings, satu baris JSON) — sama untuk Vercel dan laptop.
// Nilai awal diambil dari environment (.env.local / Vercel) kalau ada, lalu bisa diubah dari menu Settings.
// getSettings() sinkron dan membaca cache; cache diisi ulang oleh loadSettings() di awal setiap request / tugas.
import { pg } from './pg.js';

// Pengaturan dari versi lama yang fiturnya sudah dihapus (diabaikan saat dibaca, hilang saat disimpan).
const REMOVED = ['soar', 'route53', 'splunk', 'warningDays', 'urgentDays', 'teams'];

/** Saluran notifikasi. Setiap saluran memilih sendiri jenis pesan yang diterima: alert, report, system. */
export const CHANNELS = {
  teams: { label: 'Microsoft Teams', secrets: ['webhookUrl'] },
  telegram: { label: 'Telegram', secrets: ['botToken'] },
  whatsapp: { label: 'WhatsApp', secrets: ['token'] },
  email: { label: 'Email', secrets: ['pass'] },
  soar: { label: 'SOAR (webhook)', secrets: ['token'] },
};
export const NOTIFY_TYPES = ['alert', 'report', 'system'];

const types = (alert = true, report = true, system = true) => ({ alert, report, system });

function defaults() {
  return {
    mode: 'real', // aplikasi selalu memakai data asli (data/real.db)
    // ambang status (sisa hari): Urgent ≤ urgent, Reminder ≤ reminder, Need Update ≤ needUpdate, Warning ≤ warning, Informational ≤ info, OK > info
    tiers: {
      urgent: Number(process.env.URGENT_DAYS || 7),
      reminder: 14,
      needUpdate: 30,
      warning: Number(process.env.WARNING_DAYS || 60),
      info: 90,
    },
    scanIntervalHours: Number(process.env.SCAN_INTERVAL_HOURS ?? 6),
    // siapa yang menjalankan scan kalau database dipakai bersama (Supabase): cloud = Vercel Cron, local = scanner kantor
    scanRunner: process.env.SCAN_RUNNER === 'local' ? 'local' : 'cloud',
    scanConcurrency: Number(process.env.SCAN_CONCURRENCY || 10),
    scanTimeoutMs: Number(process.env.SCAN_TIMEOUT_MS || 10000),
    scanProxy: { url: '', username: '', password: '' }, // proxy untuk cek SSL (lihat pilihan proxy per file)
    roles: {
      monitoring: ['export'], // izin default peran Monitoring (lihat lib/auth.js PERMISSIONS)
    },
    monitoring: {
      renewalDays: 30,         // kartu "Renewal": sertifikat yang diperbarui dalam N hari terakhir
    },
    wazuh: {
      enabled: false,          // kirim log aplikasi, keamanan & temuan SSL ke Wazuh
      transport: 'api',        // api (Wazuh server API /events) | file (dibaca Wazuh agent) | both
      url: '',                 // https://wazuh-manager:55000
      authMode: 'password',    // password (user API Wazuh → JWT) | token (API key / Bearer token tetap)
      username: '',
      password: '',
      apiKey: '',
      verifyTls: false,        // Wazuh API bawaan memakai sertifikat self-signed
      filePath: '',            // kosong = data/logs/ssl-monitoring-wazuh.json
      sendApp: true,           // log aplikasi (ubah domain, upload, job, scan, …)
      sendSecurity: true,      // log keamanan (login, user, pengaturan, token, export, …)
      sendSsl: true,           // temuan SSL setelah scan
      sslStatuses: ['CHECK_FAILED', 'URGENT', 'REMINDER'],
      sslRepeatHours: 24,      // domain yang masih bermasalah dikirim ulang tiap N jam
    },
    // SOAR → aplikasi: SOAR mengirim domain / perintah ke aplikasi ini (Settings → Integrasi → SOAR)
    soarIn: {
      enabled: false,
      tokenHash: '',           // API key disimpan sebagai hash SHA-256
      tokenHint: '',
      fileName: 'SOAR',        // domain kiriman SOAR masuk ke file Source of Truth ini (dibuat otomatis)
      groupId: null,           // group dashboard untuk file itu
      proxyMode: 'direct',     // direct (tanpa proxy → proxy kalau gagal) | proxy
      scanOnReceive: true,     // domain yang dikirim langsung dicek & hasilnya dibalas ke SOAR
      allowRemove: false,      // SOAR boleh menghapus domain (action: "remove")
      allowCommands: true,     // SOAR boleh menjalankan Scan / Retry / Tes koneksi
    },
    entra: {
      enabled: false,        // login dengan Microsoft 365 + sync user dari grup
      tenantId: '',
      clientId: '',
      clientSecret: '',
      adminGroupId: '',      // Object ID grup Entra → peran Admin
      monitoringGroupId: '', // Object ID grup Entra → peran Monitoring
      autoSync: true,        // sync anggota grup setiap scan terjadwal
      redirectUri: '',       // kosong = otomatis dari alamat yang dipakai di browser
    },
    notify: {
      // isi notifikasi
      alertStatuses: ['CHECK_FAILED', 'URGENT'], // alert dikirim untuk domain dengan status ini
      alertRepeatHours: 24,    // domain yang masih bermasalah dikirim ulang tiap N jam (status berubah → langsung dikirim)
      reportAllOk: true,       // hasil scan scheduler tetap dikirim walau semua aman
      systemRepeatHours: 6,    // masalah sistem yang belum pulih diingatkan lagi tiap N jam
      teams: { enabled: false, webhookUrl: '', ...types() },
      telegram: { enabled: false, botToken: '', chatId: '', ...types() },
      whatsapp: { enabled: false, provider: 'fonnte', token: '', target: '', url: '', ...types(true, false, true) },
      email: { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '', ...types() },
      soar: { enabled: false, url: '', authHeader: 'Authorization', token: '', ...types(true, true, false) },
    },
  };
}

/** Pengaturan Teams versi lama (settings.teams) → notify.teams */
function migrateTeams(saved, notify) {
  const t = saved.teams;
  if (!t || saved.notify?.teams) return notify;
  return {
    ...notify,
    teams: { ...notify.teams, enabled: !!t.enabled, webhookUrl: t.webhookUrl || '', alert: t.autoAfterScan !== false, report: !!t.sendWhenAllOk },
  };
}

function merge(input) {
  const base = defaults();
  try {
    const saved = { ...(input || {}) };
    const n = saved.notify || {};
    let notify = { ...base.notify, ...n };
    for (const c of Object.keys(CHANNELS)) notify[c] = { ...base.notify[c], ...(n[c] || {}) };
    notify = migrateTeams(saved, notify);
    for (const k of REMOVED) delete saved[k];
    delete saved.mode;
    return { ...base, ...saved, mode: 'real', tiers: { ...base.tiers, ...(saved.tiers || {}) }, roles: { ...base.roles, ...(saved.roles || {}) },
      scanProxy: { ...base.scanProxy, ...(saved.scanProxy || {}) }, entra: { ...base.entra, ...(saved.entra || {}) },
      wazuh: (({ sslMinStatus, sslInDemo, ...w }) => ({ ...base.wazuh, ...w }))(saved.wazuh || {}), soarIn: { ...base.soarIn, ...(saved.soarIn || {}) }, monitoring: { ...base.monitoring, ...(saved.monitoring || {}) }, notify };
  } catch {
    return base;
  }
}

/** Baca pengaturan terbaru dari database ke cache. */
export async function loadSettings() {
  const db = await pg();
  const r = await db.get("SELECT value FROM app_settings WHERE key = 'main'");
  let saved = {};
  try { saved = r ? JSON.parse(r.value) : {}; } catch {}
  globalThis.__sslSettings = { value: merge(saved), raw: saved, at: Date.now() };
  return globalThis.__sslSettings.value;
}

/** Pengaturan saat ini (dari cache). Panggil loadSettings() dulu di awal request / tugas latar belakang. */
export function getSettings() {
  return globalThis.__sslSettings?.value || merge({});
}

/** Simpan seluruh objek pengaturan apa adanya (dipakai saat impor data lama). */
export async function writeRawSettings(obj) {
  const db = await pg();
  await db.run(`INSERT INTO app_settings (key, value, updated_at) VALUES ('main', ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, JSON.stringify(obj), new Date().toISOString());
  globalThis.__sslSettings = { value: merge(obj), raw: obj, at: Date.now() };
}

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function saveNotify(cur, p) {
  const next = { ...cur };
  if (p.alertStatuses !== undefined) {
    const ok = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL'];
    if (!Array.isArray(p.alertStatuses)) throw new Error('Status alert tidak valid');
    next.alertStatuses = ok.filter((s) => p.alertStatuses.includes(s));
    if (!next.alertStatuses.length) throw new Error('Pilih minimal satu status untuk alert');
  }
  if (p.alertRepeatHours !== undefined) next.alertRepeatHours = clampInt(p.alertRepeatHours, 1, 720, cur.alertRepeatHours);
  if (p.systemRepeatHours !== undefined) next.systemRepeatHours = clampInt(p.systemRepeatHours, 1, 720, cur.systemRepeatHours);
  if (p.reportAllOk !== undefined) next.reportAllOk = !!p.reportAllOk;

  for (const c of Object.keys(CHANNELS)) {
    const x = p[c];
    if (!x) continue;
    const ch = { ...cur[c] };
    for (const k of ['enabled', ...NOTIFY_TYPES]) if (x[k] !== undefined) ch[k] = !!x[k];
    if (c === 'teams' && x.webhookUrl !== undefined) {
      const u = str(x.webhookUrl, 2000);
      if (u && !/^https:\/\/\S+$/i.test(u)) throw new Error('Webhook Teams harus diawali https://');
      ch.webhookUrl = u;
    }
    if (c === 'telegram') {
      if (x.botToken !== undefined) ch.botToken = str(x.botToken, 200);
      if (x.chatId !== undefined) ch.chatId = str(x.chatId, 100);
    }
    if (c === 'whatsapp') {
      if (x.provider !== undefined) { if (!['fonnte', 'webhook'].includes(x.provider)) throw new Error('Layanan WhatsApp tidak valid'); ch.provider = x.provider; }
      if (x.token !== undefined) ch.token = str(x.token, 500);
      if (x.target !== undefined) ch.target = str(x.target, 500);
      if (x.url !== undefined) {
        const u = str(x.url, 1000);
        if (u && !/^https?:\/\/\S+$/i.test(u)) throw new Error('URL gateway WhatsApp harus diawali http:// atau https://');
        ch.url = u;
      }
    }
    if (c === 'email') {
      if (x.host !== undefined) ch.host = str(x.host, 200);
      if (x.port !== undefined) ch.port = clampInt(x.port, 1, 65535, cur.email.port);
      if (x.secure !== undefined) ch.secure = !!x.secure;
      if (x.user !== undefined) ch.user = str(x.user, 200);
      if (x.pass !== undefined) ch.pass = String(x.pass ?? '').slice(0, 500);
      if (x.from !== undefined) ch.from = str(x.from, 200);
      if (x.to !== undefined) ch.to = str(x.to, 1000);
    }
    if (c === 'soar') {
      if (x.url !== undefined) {
        const u = str(x.url, 1000);
        if (u && !/^https?:\/\/\S+$/i.test(u)) throw new Error('URL webhook SOAR harus diawali http:// atau https://');
        ch.url = u;
      }
      if (x.authHeader !== undefined) ch.authHeader = str(x.authHeader, 100) || 'Authorization';
      if (x.token !== undefined) ch.token = str(x.token, 1000);
    }
    if (ch.enabled) {
      const need = { teams: ['webhookUrl'], telegram: ['botToken', 'chatId'], whatsapp: ch.provider === 'fonnte' ? ['token', 'target'] : ['url'],
        email: ['host', 'from', 'to'], soar: ['url'] }[c];
      const miss = need.filter((k) => !ch[k]);
      if (miss.length) throw new Error(`${CHANNELS[c].label}: isi dulu ${miss.join(', ')} sebelum mengaktifkan`);
    }
    next[c] = ch;
  }
  return next;
}

const SSL_STATUS_KEYS = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL'];

function saveWazuh(cur, z) {
  const next = { ...cur };
  for (const k of ['enabled', 'verifyTls', 'sendApp', 'sendSecurity', 'sendSsl']) if (z[k] !== undefined) next[k] = !!z[k];
  if (z.transport !== undefined) { if (!['api', 'file', 'both'].includes(z.transport)) throw new Error('Cara kirim Wazuh tidak valid'); next.transport = z.transport; }
  if (z.authMode !== undefined) { if (!['password', 'token'].includes(z.authMode)) throw new Error('Jenis login Wazuh tidak valid'); next.authMode = z.authMode; }
  if (z.url !== undefined) {
    const u = str(z.url, 500).replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(u)) throw new Error('URL Wazuh harus seperti https://wazuh-manager:55000');
    next.url = u;
  }
  if (z.username !== undefined) next.username = str(z.username, 200);
  if (z.password !== undefined) next.password = String(z.password ?? '').slice(0, 500);
  if (z.apiKey !== undefined) next.apiKey = str(z.apiKey, 4000);
  if (z.filePath !== undefined) {
    const f = str(z.filePath, 500);
    if (f && !/\.(json|log|txt)$/i.test(f)) throw new Error('File log Wazuh harus berakhiran .json, .log, atau .txt');
    next.filePath = f;
  }
  if (z.sslStatuses !== undefined) {
    if (!Array.isArray(z.sslStatuses)) throw new Error('Status SSL Wazuh tidak valid');
    next.sslStatuses = SSL_STATUS_KEYS.filter((s) => z.sslStatuses.includes(s));
  }
  if (z.sslRepeatHours !== undefined) next.sslRepeatHours = clampInt(z.sslRepeatHours, 1, 720, cur.sslRepeatHours);
  if (process.env.VERCEL && next.transport !== 'api' && z.transport !== undefined) throw new Error('Di Vercel hanya bisa "Wazuh API" (tidak ada file lokal / Wazuh agent)');
  if (next.enabled && next.transport !== 'file') {
    if (!next.url) throw new Error('Isi URL Wazuh API dulu sebelum mengaktifkan');
    if (next.authMode === 'password' && (!next.username || !next.password)) throw new Error('Isi username & password API Wazuh dulu');
    if (next.authMode === 'token' && !next.apiKey) throw new Error('Isi API key / token Wazuh dulu');
  }
  return next;
}

function saveSoarIn(cur, x) {
  const next = { ...cur };
  for (const k of ['enabled', 'scanOnReceive', 'allowRemove', 'allowCommands']) if (x[k] !== undefined) next[k] = !!x[k];
  if (x.fileName !== undefined) {
    const n = str(x.fileName, 100);
    if (!n) throw new Error('Nama file Source of Truth untuk SOAR tidak boleh kosong');
    next.fileName = n;
  }
  if (x.groupId !== undefined) next.groupId = x.groupId ? Number(x.groupId) : null;
  if (x.proxyMode !== undefined) { if (!['direct', 'proxy'].includes(x.proxyMode)) throw new Error('Pilihan proxy tidak valid'); next.proxyMode = x.proxyMode; }
  // tokenHash / tokenHint hanya diubah oleh lib/soar-in.js (buat API key baru)
  if (x.tokenHash !== undefined) next.tokenHash = String(x.tokenHash);
  if (x.tokenHint !== undefined) next.tokenHint = String(x.tokenHint);
  if (next.enabled && !next.tokenHash) throw new Error('Buat API key dulu sebelum mengaktifkan SOAR → aplikasi');
  return next;
}

function saveEntra(cur, e) {
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const next = { ...cur };
  for (const k of ['tenantId', 'clientId', 'adminGroupId', 'monitoringGroupId']) {
    if (e[k] === undefined) continue;
    const v = str(e[k], 100);
    if (v && !GUID.test(v)) throw new Error(`${k} harus berformat GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)`);
    next[k] = v.toLowerCase();
  }
  if (e.clientSecret !== undefined) next.clientSecret = str(e.clientSecret, 500);
  if (e.redirectUri !== undefined) {
    const r = str(e.redirectUri, 1000);
    if (r && !/^https?:\/\/[^\s]+\/api\/auth\/microsoft\/callback$/.test(r)) throw new Error('Redirect URI harus diakhiri /api/auth/microsoft/callback');
    next.redirectUri = r;
  }
  for (const k of ['enabled', 'autoSync']) if (e[k] !== undefined) next[k] = !!e[k];
  if (next.enabled) {
    if (!next.tenantId || !next.clientId || !next.clientSecret) throw new Error('Isi Tenant ID, Client ID, dan Client Secret dulu sebelum mengaktifkan Entra ID');
    if (!next.adminGroupId && !next.monitoringGroupId) throw new Error('Isi minimal satu Object ID grup (Admin atau Monitoring)');
  }
  return next;
}

/** Simpan sebagian pengaturan (divalidasi). Mengembalikan pengaturan baru. */
export async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = { ...cur };
  if (patch.tiers) {
    const t = { ...cur.tiers };
    for (const k of ['urgent', 'reminder', 'needUpdate', 'warning', 'info']) if (patch.tiers[k] !== undefined) t[k] = clampInt(patch.tiers[k], 0, 3650, cur.tiers[k]);
    if (!(t.urgent < t.reminder && t.reminder < t.needUpdate && t.needUpdate < t.warning && t.warning < t.info)) {
      throw new Error('Ambang harus naik berurutan: Urgent < Reminder < Need Update < Warning < Informational');
    }
    next.tiers = t;
  }
  if (patch.scanRunner !== undefined) {
    if (!['cloud', 'local'].includes(patch.scanRunner)) throw new Error('Pilihan "Scan dijalankan oleh" tidak valid');
    next.scanRunner = patch.scanRunner;
  }
  if (patch.scanIntervalHours !== undefined) next.scanIntervalHours = clampInt(patch.scanIntervalHours, 0, 168, cur.scanIntervalHours);
  if (patch.scanConcurrency !== undefined) next.scanConcurrency = clampInt(patch.scanConcurrency, 1, 50, cur.scanConcurrency);
  if (patch.scanTimeoutMs !== undefined) next.scanTimeoutMs = clampInt(patch.scanTimeoutMs, 1000, 60000, cur.scanTimeoutMs);
  if (patch.roles?.monitoring) {
    const allowed = ['export', 'sync', 'manage_domains', 'jobs', 'audit', 'health'];
    if (!Array.isArray(patch.roles.monitoring)) throw new Error('Format izin tidak valid');
    next.roles = { ...cur.roles, monitoring: allowed.filter((p) => patch.roles.monitoring.includes(p)) };
  }
  if (patch.scanProxy) {
    const sp = patch.scanProxy;
    next.scanProxy = { ...cur.scanProxy };
    if (sp.url !== undefined) {
      const u = String(sp.url).trim();
      if (u && !/^https?:\/\/[^\s/:]+(:\d+)?\/?$/.test(u)) throw new Error('Proxy harus seperti http://proxy.kantor:8080');
      next.scanProxy.url = u.replace(/\/$/, '');
    }
    if (sp.username !== undefined) next.scanProxy.username = String(sp.username).slice(0, 200);
    if (sp.password !== undefined) next.scanProxy.password = String(sp.password).slice(0, 500);
  }
  if (patch.monitoring) {
    next.monitoring = { ...cur.monitoring };
    if (patch.monitoring.renewalDays !== undefined) next.monitoring.renewalDays = clampInt(patch.monitoring.renewalDays, 1, 365, cur.monitoring.renewalDays);
  }
  if (patch.notify) next.notify = saveNotify(cur.notify, patch.notify);
  if (patch.entra) next.entra = saveEntra(cur.entra, patch.entra);
  if (patch.wazuh) next.wazuh = saveWazuh(cur.wazuh, patch.wazuh);
  if (patch.soarIn) next.soarIn = saveSoarIn(cur.soarIn, patch.soarIn);
  await writeRawSettings(next);
  return getSettings();
}

const hint = (v, n = 4) => (v ? `…${String(v).slice(-n)}` : '');

/** Versi aman untuk dikirim ke browser: token, password, dan webhook URL tidak pernah dikirim utuh. */
export function publicSettings() {
  const s = getSettings();
  const notify = { ...s.notify };
  for (const [c, meta] of Object.entries(CHANNELS)) {
    const ch = { ...s.notify[c] };
    for (const k of meta.secrets) {
      ch[`${k}Set`] = !!ch[k];
      ch[`${k}Hint`] = k === 'webhookUrl' ? (() => { try { return ch[k] ? `${new URL(ch[k]).host} ${hint(ch[k], 6)}` : ''; } catch { return hint(ch[k]); } })() : hint(ch[k]);
      delete ch[k];
    }
    notify[c] = ch;
  }
  return {
    ...s,
    notify,
    scanProxy: { ...s.scanProxy, password: undefined, passwordSet: !!s.scanProxy.password },
    wazuh: { ...s.wazuh, password: undefined, passwordSet: !!s.wazuh.password, apiKey: undefined, apiKeySet: !!s.wazuh.apiKey, apiKeyHint: hint(s.wazuh.apiKey) },
    soarIn: { ...s.soarIn, tokenHash: undefined, tokenSet: !!s.soarIn.tokenHash },
    entra: { ...s.entra, clientSecret: undefined, secretSet: !!s.entra.clientSecret, secretHint: hint(s.entra.clientSecret) },
  };
}
