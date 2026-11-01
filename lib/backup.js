// Backup dan retensi data. Database Supabase paket gratis dibatasi 500 MB, sedangkan
// ssl_checks dan audit_log tumbuh terus setiap scan. Modul ini menyalin data keluar
// (backup) dan memangkas riwayat lama (retensi) agar penyimpanan tidak habis.
//
// Tren harian tidak ikut terpangkas: rekapitulasi per hari sudah disimpan terpisah di
// daily_stats, jadi grafik tren tetap utuh walau riwayat pemeriksaan detailnya dihapus.
import { pg, dbLabel } from './pg.js';
import { getSettings } from './settings.js';
import { isoDate } from './time.js';

/** Tabel yang ikut dibackup, berurutan sesuai ketergantungan supaya bisa dipulihkan. */
export const TABEL_BACKUP = [
  'dashboard_groups', 'sot_files', 'domains', 'ssl_checks',
  'daily_stats', 'data_sources', 'activity_log', 'job_runs',
  'users', 'audit_log', 'app_settings',
  'notify_alert_state', 'notify_system_state', 'wazuh_ssl_state',
];

/** Kolom yang tidak pernah ikut dibackup: rahasia yang tidak boleh keluar dari server. */
const KOLOM_RAHASIA = { users: ['password_hash'] };

/** Tabel yang riwayatnya boleh dipangkas, beserta kolom waktunya. */
export const TABEL_RETENSI = {
  ssl_checks: { kolom: 'checked_at', label: 'Riwayat pemeriksaan sertifikat' },
  job_runs: { kolom: 'started_at', label: 'Riwayat eksekusi job' },
  activity_log: { kolom: 'created_at', label: 'Aktivitas' },
  audit_log: { kolom: 'at', label: 'Audit log' },
};

const aman = (t) => /^[a-z_]+$/.test(t);

async function adaTabel(db, nama) {
  const r = await db.get(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?',
    nama,
  );
  return Number(r?.n || 0) > 0;
}

/**
 * Isi seluruh database sebagai satu objek JSON. Dipakai tombol "Unduh backup".
 * Kolom rahasia (hash kata sandi) sengaja dikosongkan.
 */
export async function exportAll() {
  const db = await pg();
  const l = dbLabel();
  const data = {};
  const jumlah = {};
  for (const t of TABEL_BACKUP) {
    if (!aman(t) || !(await adaTabel(db, t))) continue;
    const rows = await db.all(`SELECT * FROM ${t}`);
    const buang = KOLOM_RAHASIA[t];
    data[t] = buang ? rows.map((r) => { const x = { ...r }; for (const k of buang) delete x[k]; return x; }) : rows;
    jumlah[t] = data[t].length;
  }
  return {
    aplikasi: 'SSL Monitoring',
    dibuat: new Date().toISOString(),
    database: `${l.kind} · ${l.where}`,
    catatan: 'Hash kata sandi tidak ikut disalin. Setelah dipulihkan, atur ulang kata sandi dengan npm run reset-admin.',
    jumlah,
    data,
  };
}

/** Nama berkas backup: ssl-monitoring-backup-2026-10-25.json */
export const namaBerkasBackup = () => `ssl-monitoring-backup-${isoDate()}.json`;

/**
 * Hapus riwayat yang lebih tua dari batas retensi masing-masing tabel.
 * Nilai 0 berarti tanpa batas (tidak ada yang dihapus).
 * dryRun = hanya menghitung, tidak menghapus.
 */
export async function pruneOld({ dryRun = false } = {}) {
  const s = getSettings();
  const r = s.retention || {};
  const db = await pg();
  const hasil = [];
  let total = 0;

  for (const [tabel, { kolom, label }] of Object.entries(TABEL_RETENSI)) {
    const hari = Number(r[tabel] || 0);
    if (!hari || !aman(tabel) || !aman(kolom)) continue;
    if (!(await adaTabel(db, tabel))) continue;

    const batas = new Date(Date.now() - hari * 86_400_000).toISOString();
    const c = await db.get(`SELECT COUNT(*) AS n FROM ${tabel} WHERE ${kolom} < ?`, batas);
    const n = Number(c?.n || 0);
    if (n && !dryRun) await db.run(`DELETE FROM ${tabel} WHERE ${kolom} < ?`, batas);
    if (n) hasil.push({ tabel, label, hari, baris: n });
    total += n;
  }
  return { total, hasil, dryRun };
}

/** Ukuran database dan tabel paling besar — untuk Health Check dan halaman Data. */
export async function storageStats() {
  const db = await pg();
  const l = dbLabel();
  const out = { kind: l.kind, where: l.where, bytes: NaN, tabel: [] };

  // Query ukuran bisa sangat lambat di Supabase (pg_database_size menelusuri seluruh berkas database,
  // termasuk skema bawaan Supabase). Tanpa batas, query ini menahan koneksi database sampai 20 detik dan
  // membuat request lain di Vercel antre lalu gagal. Batasi 4 detik per query; gagal → pakai cadangan.
  const cepat = async (q) => (db.kind === 'postgres'
    ? db.tx(async (t) => { await t.run("SET LOCAL statement_timeout = '4000'"); return t.all(q); })
    : db.all(q));

  try {
    out.tabel = (await cepat(`
      SELECT c.relname AS nama,
             pg_total_relation_size(c.oid) AS bytes,
             COALESCE(s.n_live_tup, 0)     AS baris
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r' AND n.nspname = current_schema()
      ORDER BY pg_total_relation_size(c.oid) DESC`)).map((x) => ({ nama: x.nama, bytes: Number(x.bytes), baris: Number(x.baris) }));
  } catch { /* abaikan: ukuran per tabel hanya pelengkap */ }

  try {
    const r = (await cepat('SELECT pg_database_size(current_database()) AS n'))[0];
    out.bytes = Number(r?.n || 0);
  } catch { /* lambat / tidak didukung → pakai jumlah ukuran tabel aplikasi */ }
  if (!Number.isFinite(out.bytes) || !out.bytes) {
    const jumlah = out.tabel.reduce((a, t) => a + (t.bytes || 0), 0);
    if (jumlah) { out.bytes = jumlah; out.perkiraan = true; }
  }
  out.tabel = out.tabel.slice(0, 8);

  return out;
}
