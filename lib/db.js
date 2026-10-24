// Data domain & Source of Truth (Postgres: Supabase atau PGlite lokal, lihat lib/pg.js).
// Semua fungsi async.
import { pg, dbLabel } from './pg.js';
import { isoDate } from './time.js';

export { dbLabel };
const now = () => new Date().toISOString();
const bool = (r) => r && { ...r, in_excel: !!r.in_excel, active: !!r.active, via_proxy: r.proxy_mode === 'proxy', deleted: !!r.deleted };
const SELECT_D = `SELECT d.*, f.name AS file_name, f.proxy_mode, f.group_id, g.name AS group_name
  FROM domains d LEFT JOIN sot_files f ON f.id = d.file_id LEFT JOIN dashboard_groups g ON g.id = f.group_id`;

const tx = async (fn) => (await pg()).tx(fn);
const refreshActive = (db) => db.run('UPDATE domains SET active = CASE WHEN deleted = 0 AND in_excel = 1 AND file_id IS NOT NULL THEN 1 ELSE 0 END');

/** "Aplikasi Internal.xlsx" → "Aplikasi Internal" */
export function fileBaseName(filename) {
  if (!filename) return '';
  return String(filename).split(/[\\/]/).pop().replace(/\.(xlsx|xls|csv)$/i, '').replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_/, '').trim().slice(0, 100);
}

// ---------- domains ----------
export async function getDomains({ activeOnly = true, fileId = null, groupId = null } = {}) {
  const w = [], p = [];
  if (activeOnly) w.push('d.active = 1');
  if (fileId) { w.push('d.file_id = ?'); p.push(Number(fileId)); }
  if (groupId === 'none') w.push('f.group_id IS NULL');
  else if (groupId) { w.push('f.group_id = ?'); p.push(Number(groupId)); }
  const sql = `${SELECT_D} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY d.domain, d.port`;
  return (await (await pg()).all(sql, ...p)).map(bool);
}

/** Simpan hasil tes koneksi (DNS / ping / port / HTTPS) satu domain. */
export async function saveConnTest(id, result) {
  await (await pg()).run('UPDATE domains SET conn_test = ?, conn_tested_at = ? WHERE id = ?', JSON.stringify(result), now(), id);
}

export async function getDomain(id) {
  return bool(await (await pg()).get(`${SELECT_D} WHERE d.id = ?`, Number(id)));
}

// ---------- group dashboard ----------
export async function listGroups() {
  return (await pg()).all(`SELECT g.*,
      (SELECT COUNT(*) FROM sot_files f WHERE f.group_id = g.id) AS files,
      (SELECT COUNT(*) FROM domains d JOIN sot_files f ON f.id = d.file_id WHERE f.group_id = g.id AND d.active = 1) AS domains
    FROM dashboard_groups g ORDER BY g.sort, lower(g.name)`);
}
export const getGroup = async (id) => (await (await pg()).get('SELECT * FROM dashboard_groups WHERE id = ?', Number(id))) || null;

export async function createGroup(name) {
  const db = await pg();
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw new Error('Nama group tidak boleh kosong');
  if (await db.get('SELECT 1 FROM dashboard_groups WHERE lower(name) = lower(?)', n)) throw new Error(`Group "${n}" sudah ada`);
  const sort = ((await db.get('SELECT MAX(sort) AS m FROM dashboard_groups')).m || 0) + 1;
  const r = await db.run('INSERT INTO dashboard_groups (name, sort, created_at) VALUES (?, ?, ?) RETURNING id', n, sort, now());
  return getGroup(r.rows[0].id);
}

export async function renameGroup(id, name) {
  const db = await pg();
  const cur = await getGroup(id);
  if (!cur) throw new Error('Group tidak ditemukan');
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw new Error('Nama group tidak boleh kosong');
  const clash = await db.get('SELECT id FROM dashboard_groups WHERE lower(name) = lower(?)', n);
  if (clash && clash.id !== id) throw new Error(`Group "${n}" sudah ada`);
  await db.run('UPDATE dashboard_groups SET name = ? WHERE id = ?', n, id);
  return { before: cur, after: await getGroup(id) };
}

/** Hapus group. File di dalamnya TIDAK dihapus, hanya jadi "Tanpa group". */
export async function deleteGroup(id) {
  const cur = await getGroup(id);
  if (!cur) throw new Error('Group tidak ditemukan');
  return tx(async (db) => {
    const files = (await db.get('SELECT COUNT(*) AS n FROM sot_files WHERE group_id = ?', id)).n;
    await db.run('UPDATE sot_files SET group_id = NULL WHERE group_id = ?', id);
    await db.run('DELETE FROM dashboard_groups WHERE id = ?', id);
    return { group: cur, files };
  });
}

// ---------- file Source of Truth ----------
export const PROXY_MODES = ['direct', 'proxy'];

export async function listFiles() {
  return (await pg()).all(`SELECT f.*, g.name AS group_name,
      (SELECT COUNT(*) FROM domains d WHERE d.file_id = f.id AND d.active = 1) AS domains,
      (SELECT COUNT(*) FROM domains d WHERE d.file_id = f.id AND d.active = 1 AND d.ssl_status IN ('URGENT', 'EXPIRED', 'CHECK_FAILED')) AS problems,
      (SELECT MAX(d.last_checked) FROM domains d WHERE d.file_id = f.id AND d.active = 1) AS last_checked
    FROM sot_files f LEFT JOIN dashboard_groups g ON g.id = f.group_id ORDER BY g.sort IS NULL, g.sort, lower(f.name)`);
}

export const getFile = async (id) => (await (await pg()).get('SELECT * FROM sot_files WHERE id = ?', Number(id))) || null;
export const getFileByName = async (name) => (await (await pg()).get('SELECT * FROM sot_files WHERE lower(name) = lower(?)', String(name))) || null;

export async function createFile({ name, proxyMode = 'direct', originalFile = null, storedFile = null, groupId = null }) {
  const n = String(name || '').trim().slice(0, 100);
  if (!n) throw new Error('Nama file tidak boleh kosong');
  if (!PROXY_MODES.includes(proxyMode)) throw new Error('Pilihan proxy tidak valid');
  if (await getFileByName(n)) throw new Error(`File "${n}" sudah ada`);
  if (groupId && !(await getGroup(groupId))) throw new Error('Group tidak ditemukan');
  const t = now();
  const r = await (await pg()).run(`INSERT INTO sot_files (name, original_file, stored_file, proxy_mode, group_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, n, originalFile, storedFile, proxyMode, groupId ? Number(groupId) : null, t, t);
  return getFile(r.rows[0].id);
}

export async function updateFile(id, { name, proxyMode, originalFile, storedFile, groupId } = {}) {
  const cur = await getFile(id);
  if (!cur) throw new Error('File tidak ditemukan');
  const next = { ...cur };
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 100);
    if (!n) throw new Error('Nama file tidak boleh kosong');
    const clash = await getFileByName(n);
    if (clash && clash.id !== id) throw new Error(`File "${n}" sudah ada`);
    next.name = n;
  }
  if (proxyMode !== undefined) {
    if (!PROXY_MODES.includes(proxyMode)) throw new Error('Pilihan proxy tidak valid');
    next.proxy_mode = proxyMode;
  }
  if (groupId !== undefined) {
    if (groupId && !(await getGroup(Number(groupId)))) throw new Error('Group tidak ditemukan');
    next.group_id = groupId ? Number(groupId) : null;
  }
  if (originalFile !== undefined) next.original_file = originalFile;
  if (storedFile !== undefined) next.stored_file = storedFile;
  await (await pg()).run('UPDATE sot_files SET name = ?, proxy_mode = ?, group_id = ?, original_file = ?, stored_file = ?, updated_at = ? WHERE id = ?',
    next.name, next.proxy_mode, next.group_id ?? null, next.original_file, next.stored_file, now(), id);
  return { before: cur, after: await getFile(id) };
}

export const touchFile = async (id) => (await pg()).run('UPDATE sot_files SET updated_at = ? WHERE id = ?', now(), id);

/** Hapus file beserta semua domain & riwayat scan-nya (permanen). */
export async function deleteFile(id) {
  return tx(async (db) => {
    const f = await db.get('SELECT * FROM sot_files WHERE id = ?', id);
    if (!f) throw new Error('File tidak ditemukan');
    const n = (await db.get('SELECT COUNT(*) AS n FROM domains WHERE file_id = ?', id)).n;
    await db.run('DELETE FROM domains WHERE file_id = ?', id); // ssl_checks ikut terhapus (ON DELETE CASCADE)
    await db.run('DELETE FROM sot_files WHERE id = ?', id);
    return { file: f, domains: n };
  });
}

/**
 * Sinkronkan satu file Source of Truth dari upload Excel.
 * merge=false → domain di file itu yang tidak ada di upload dikeluarkan (dinonaktifkan, riwayat tetap tersimpan).
 * merge=true  → hanya tambah / perbarui.
 */
export async function syncExcel(fileId, rows, { merge = false } = {}) {
  return tx(async (db) => {
    const before = new Set((await db.all("SELECT domain || ':' || port AS k FROM domains WHERE file_id = ? AND in_excel = 1 AND deleted = 0", fileId)).map((r) => r.k));
    const existedBefore = before.size;
    if (!merge) await db.run('UPDATE domains SET in_excel = 0 WHERE file_id = ?', fileId);
    let added = 0;
    const t = now();
    for (const r of rows) {
      const k = `${r.domain}:${r.port}`;
      if (!before.has(k)) added++;
      before.delete(k);
      await db.run(`INSERT INTO domains (file_id, domain, port, environment, application, owner, notes, in_excel)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT (file_id, domain, port) DO UPDATE SET environment = excluded.environment, application = excluded.application,
            owner = excluded.owner, notes = excluded.notes, in_excel = 1, deleted = 0, updated_at = ?`,
      fileId, r.domain, r.port, r.environment, r.application, r.owner, r.notes, t);
    }
    await db.run('UPDATE sot_files SET updated_at = ? WHERE id = ?', t, fileId);
    await refreshActive(db);
    return { total: rows.length, added, updated: rows.length - added, removed: merge ? 0 : before.size, existedBefore };
  });
}

// ---------- Source of Truth: tambah / ubah / hapus manual (per file) ----------
export async function addExcelDomain(fileId, r) {
  return tx(async (db) => {
    if (!(await db.get('SELECT 1 AS x FROM sot_files WHERE id = ?', fileId))) throw new Error('Pilih file Source of Truth dulu');
    const ex = await db.get('SELECT id, in_excel, deleted FROM domains WHERE file_id = ? AND domain = ? AND port = ?', fileId, r.domain, r.port);
    if (ex?.in_excel && !ex.deleted) throw new Error(`${r.domain}:${r.port} sudah ada di file ini`);
    let id;
    if (ex) {
      // pernah dihapus / dikeluarkan → ditambahkan lagi secara manual
      await db.run('UPDATE domains SET environment = ?, application = ?, owner = ?, notes = ?, in_excel = 1, deleted = 0, updated_at = ? WHERE id = ?',
        r.environment, r.application, r.owner, r.notes, now(), ex.id);
      id = ex.id;
    } else {
      id = (await db.run('INSERT INTO domains (file_id, domain, port, environment, application, owner, notes, in_excel) VALUES (?, ?, ?, ?, ?, ?, ?, 1) RETURNING id',
        fileId, r.domain, r.port, r.environment, r.application, r.owner, r.notes)).rows[0].id;
    }
    await db.run('UPDATE sot_files SET updated_at = ? WHERE id = ?', now(), fileId);
    await refreshActive(db);
    return { id, existed: !!ex };
  });
}

export async function updateExcelDomain(id, r) {
  return tx(async (db) => {
    const cur = await db.get('SELECT * FROM domains WHERE id = ? AND deleted = 0', id);
    if (!cur || !cur.in_excel) throw new Error('Domain tidak ditemukan di Source of Truth');
    const renamed = cur.domain !== r.domain || cur.port !== r.port;
    // pindah ke file lain
    const targetFile = r.file_id ? Number(r.file_id) : cur.file_id;
    const moved = targetFile !== cur.file_id;
    if (moved && !(await db.get('SELECT 1 AS x FROM sot_files WHERE id = ?', targetFile))) throw new Error('File tujuan tidak ditemukan');
    if (renamed || moved) {
      const clash = await db.get('SELECT id, deleted FROM domains WHERE file_id IS NOT DISTINCT FROM ?::int AND domain = ? AND port = ? AND id <> ?', targetFile, r.domain, r.port, id);
      if (clash && !clash.deleted) throw new Error(`${r.domain}:${r.port} sudah ada di file tujuan`);
      if (clash) await db.run('DELETE FROM domains WHERE id = ?', clash.id); // sisa domain yang pernah dihapus di file tujuan
    }
    if (moved) {
      await db.run('UPDATE domains SET file_id = ? WHERE id = ?', targetFile, id);
      await db.run('UPDATE sot_files SET updated_at = ? WHERE id = ?', now(), targetFile);
    }
    if (renamed) {
      // domain/port berubah → hasil scan lama tidak berlaku lagi
      await db.run(`UPDATE domains SET domain = ?, port = ?, ssl_status = NULL, days_remaining = NULL, valid_from = NULL, expires_at = NULL,
          issuer = NULL, subject = NULL, san = NULL, protocol = NULL, last_error = NULL, last_checked = NULL, checked_via = NULL WHERE id = ?`, r.domain, r.port, id);
      await db.run('DELETE FROM ssl_checks WHERE domain_id = ?', id);
    }
    await db.run('UPDATE domains SET environment = ?, application = ?, owner = ?, notes = ?, updated_at = ? WHERE id = ?',
      r.environment, r.application, r.owner, r.notes, now(), id);
    if (cur.file_id) await db.run('UPDATE sot_files SET updated_at = ? WHERE id = ?', now(), cur.file_id);
    return { id, renamed, moved };
  });
}

/**
 * Hapus domain oleh admin: hilang dari SSL Inventory & dashboard. Riwayat scan tetap tersimpan.
 * Bisa dikembalikan dari Settings → Domain yang dihapus, atau dengan menambahkannya lagi (manual / upload Excel).
 */
export async function deleteDomains(ids) {
  return tx(async (db) => {
    const rows = [];
    for (const id of ids) {
      const r = await db.get('SELECT id, domain, port FROM domains WHERE id = ? AND deleted = 0', id);
      if (r) rows.push(r);
    }
    const t = now();
    for (const r of rows) await db.run('UPDATE domains SET deleted = 1, updated_at = ? WHERE id = ?', t, r.id);
    await refreshActive(db);
    return { removed: rows.length, domains: rows.map((r) => r.domain) };
  });
}

/** Domain yang dihapus admin. */
export async function getDeletedDomains() {
  return (await pg()).all(`SELECT d.id, d.domain, d.port, d.updated_at AS deleted_at, f.name AS file_name
      FROM domains d LEFT JOIN sot_files f ON f.id = d.file_id WHERE d.deleted = 1 AND d.file_id IS NOT NULL ORDER BY d.updated_at DESC`);
}

/** Kembalikan domain yang dihapus ke Source of Truth. */
export async function restoreDomain(id) {
  return tx(async (db) => {
    const cur = await db.get('SELECT * FROM domains WHERE id = ? AND deleted = 1', id);
    if (!cur) throw new Error('Domain tidak ada di daftar yang dihapus');
    await db.run('UPDATE domains SET deleted = 0, in_excel = 1, updated_at = ? WHERE id = ?', now(), id);
    await refreshActive(db);
    return bool(cur);
  });
}

export async function getExcelDomains(fileId) {
  return (await (await pg()).all(`${SELECT_D} WHERE d.file_id = ? AND d.in_excel = 1 AND d.deleted = 0 ORDER BY d.domain, d.port`, Number(fileId))).map(bool);
}

export async function dbStats() {
  const db = await pg();
  const r = await db.get(`SELECT
      (SELECT COUNT(*) FROM domains WHERE active = 1) AS domains,
      (SELECT COUNT(*) FROM sot_files) AS files,
      (SELECT COUNT(*) FROM ssl_checks) AS checks`);
  const l = dbLabel();
  return { file: `${l.kind} · ${l.where}`, kind: l.kind, domains: r.domains, excel: r.domains, files: r.files, checks: r.checks };
}

export async function saveCheckResult(id, result, status) {
  const t = now();
  await tx(async (db) => {
    await db.run(`UPDATE domains SET ssl_status = ?, days_remaining = ?, valid_from = ?, expires_at = ?, issuer = ?, subject = ?,
        san = ?, protocol = ?, last_error = ?, last_checked = ?, updated_at = ?, issuer_cn = ?, fingerprint = ?, checked_via = ? WHERE id = ?`,
    status, result.daysRemaining ?? null, result.validFrom ?? null, result.validTo ?? null, result.issuer ?? null,
    result.subject ?? null, result.san ?? null, result.protocol ?? null, result.error || result.trustError || null, t, t,
    result.issuerCn ?? null, result.fingerprint ?? null, result.via || 'direct', id);
    await db.run(`INSERT INTO ssl_checks (domain_id, checked_at, ssl_status, days_remaining, expires_at, issuer, error, duration_ms, via)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, t, status, result.daysRemaining ?? null, result.validTo ?? null, result.issuer ?? null,
    result.error || result.trustError || null, result.durationMs ?? null, result.via || 'direct');
  });
}

export async function getChecks(domainId, limit = 30) {
  return (await pg()).all('SELECT * FROM ssl_checks WHERE domain_id = ? ORDER BY checked_at DESC LIMIT ?', Number(domainId), limit);
}

// ---------- data sources ----------
export async function setSource(name, status, detail = {}, touchSync = true) {
  const db = await pg();
  const prev = await db.get('SELECT * FROM data_sources WHERE name = ?', name);
  const merged = { ...(prev ? JSON.parse(prev.detail) : {}), ...detail };
  await db.run(`INSERT INTO data_sources (name, status, last_sync, detail) VALUES (?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET status = excluded.status, last_sync = excluded.last_sync, detail = excluded.detail`,
  name, status, touchSync ? now() : prev?.last_sync ?? null, JSON.stringify(merged));
}

export async function getSources() {
  return Object.fromEntries((await (await pg()).all('SELECT * FROM data_sources')).map((r) => [r.name, { ...r, detail: JSON.parse(r.detail) }]));
}

// ---------- activity ----------
export async function addActivity(type, title, detail = null) {
  await (await pg()).run('INSERT INTO activity_log (type, title, detail, created_at) VALUES (?, ?, ?, ?)', type, title, detail, now());
}

export async function getActivities(limit = 10) {
  return (await pg()).all('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?', limit);
}

// ---------- trend ----------
export async function saveDailyStats(counts) {
  const date = isoDate(); // YYYY-MM-DD menurut zona waktu aplikasi (WIB)
  await (await pg()).run(`INSERT INTO daily_stats (date, counts, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (date) DO UPDATE SET counts = excluded.counts, updated_at = excluded.updated_at`, date, JSON.stringify(counts), now());
}

/** Tren harian dalam rentang tanggal (YYYY-MM-DD, inklusif). Tanpa rentang = 7 hari terakhir yang ada datanya. */
export async function getTrend(from, to) {
  const db = await pg();
  const rows = from || to
    ? await db.all('SELECT * FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date', from || '0000-00-00', to || '9999-12-31')
    : (await db.all('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7')).reverse();
  return rows.map((r) => ({ date: r.date, ...JSON.parse(r.counts) }));
}

/** Aktivitas dalam rentang waktu (ISO timestamp). */
export async function getActivitiesInRange(fromIso, toIso, limit = 50) {
  return (await pg()).all('SELECT * FROM activity_log WHERE created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT ?', fromIso || '0000', toIso || '9999', limit);
}

export async function countActivitiesInRange(fromIso, toIso) {
  return (await (await pg()).get('SELECT COUNT(*) AS n FROM activity_log WHERE created_at >= ? AND created_at <= ?', fromIso || '0000', toIso || '9999')).n;
}

export async function resetAll() {
  await (await pg()).exec('DELETE FROM ssl_checks; DELETE FROM domains; DELETE FROM sot_files; DELETE FROM data_sources; DELETE FROM activity_log; DELETE FROM daily_stats; DELETE FROM job_runs; DELETE FROM notify_alert_state; DELETE FROM wazuh_ssl_state;');
}

// ---------- riwayat job ----------
export async function startJobRun(job, trigger, runner = null) {
  return (await (await pg()).run('INSERT INTO job_runs (job, trigger, started_at, runner) VALUES (?, ?, ?, ?) RETURNING id', job, trigger, now(), runner)).rows[0].id;
}

export async function finishJobRun(id, ok, message) {
  await (await pg()).run('UPDATE job_runs SET finished_at = ?, ok = ?, message = ? WHERE id = ?', now(), ok ? 1 : 0, message ?? null, id);
}

export async function getJobRuns(limit = 20) {
  return (await pg()).all('SELECT * FROM job_runs ORDER BY id DESC LIMIT ?', limit);
}

export async function getLastJobRuns() {
  return (await pg()).all('SELECT j.* FROM job_runs j JOIN (SELECT job, MAX(id) AS id FROM job_runs GROUP BY job) m ON m.id = j.id');
}

/** Job yang tercatat mulai tapi tidak pernah selesai (mis. server mati di tengah jalan). runner = hanya milik proses itu. */
export async function closeDanglingJobRuns(message, { olderThanMs = 0 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  await (await pg()).run('UPDATE job_runs SET finished_at = ?, ok = 0, message = ? WHERE finished_at IS NULL AND started_at <= ?', now(), message, cutoff);
}
