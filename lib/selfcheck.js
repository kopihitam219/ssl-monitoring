// Pemeriksaan kesehatan yang menyoroti kegagalan diam — kondisi di mana aplikasi terlihat
// normal padahal sudah tidak bekerja: scan berhenti tapi dasbor tetap menampilkan angka lama,
// sertifikat aplikasi ini sendiri kedaluwarsa, atau kredensial integrasi habis masa berlakunya.
import { pg } from './pg.js';
import { getSettings } from './settings.js';
import { fmtDate, fmtDateTime } from './time.js';

const JAM = 3_600_000;
const HARI = 86_400_000;

const umur = (iso) => (iso ? Date.now() - new Date(iso).getTime() : null);

/** "3 jam", "2 hari" — jarak waktu dalam bahasa sehari-hari. */
function jarak(ms) {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const menit = Math.round(ms / 60_000);
  if (menit < 60) return `${Math.max(menit, 1)} menit`;
  const jam = Math.round(ms / JAM);
  if (jam < 48) return `${jam} jam`;
  return `${Math.round(ms / HARI)} hari`;
}

/**
 * Kesegaran data scan. Scan yang berhenti diam-diam adalah kegagalan paling berbahaya:
 * tidak ada yang merah, tapi angka di dasbor sudah basi.
 */
export async function dataFreshness() {
  const s = getSettings();
  const interval = Number(s.scanIntervalHours) || 6;
  const batasWarn = interval * 2 * JAM;   // dua kali interval → mulai curiga
  const batasError = interval * 4 * JAM;  // empat kali interval → hampir pasti berhenti

  const db = await pg();
  const r = await db.get(`
    SELECT COUNT(*)                                        AS total,
           COUNT(*) FILTER (WHERE last_checked IS NULL)    AS belum,
           MIN(last_checked)                               AS tertua,
           MAX(last_checked)                               AS terbaru
    FROM domains
    WHERE active = 1 AND deleted = 0`);

  const total = Number(r?.total || 0);
  const belum = Number(r?.belum || 0);
  if (!total) {
    return { name: 'Kesegaran data scan', status: 'off', detail: 'Belum ada domain yang dipantau' };
  }
  if (belum === total) {
    return { name: 'Kesegaran data scan', status: 'warn',
      detail: `${total} domain belum pernah diperiksa sama sekali` };
  }

  const usia = umur(r.tertua);
  const bagian = [`Domain terlama diperiksa ${jarak(usia)} lalu`];
  if (belum) bagian.push(`${belum} domain belum pernah diperiksa`);

  // Scan otomatis dimatikan: tidak ada jadwal yang bisa dijadikan ambang, jadi sekadar diinformasikan.
  if (!Number(s.scanIntervalHours)) {
    bagian.push('scan otomatis dimatikan di Settings');
    return { name: 'Kesegaran data scan', status: belum ? 'warn' : 'off', detail: bagian.join(' · ') };
  }

  const status = usia >= batasError ? 'error' : usia >= batasWarn || belum ? 'warn' : 'ok';
  if (status !== 'ok') bagian.push(`jadwal scan tiap ${interval} jam`);
  else bagian.push(`scan terakhir ${fmtDateTime(r.terbaru)}`);

  return { name: 'Kesegaran data scan', status, detail: bagian.join(' · ') };
}

/**
 * Domain yang sejak ditambahkan belum pernah sekali pun berhasil dibaca — biasanya salah ketik
 * di berkas Excel atau domain sudah mati. Berbeda dari Check Failed biasa yang pernah berhasil.
 */
export async function neverReadable() {
  const db = await pg();
  const rows = await db.all(`
    SELECT domain
    FROM domains
    WHERE active = 1 AND deleted = 0
      AND last_checked IS NOT NULL
      AND expires_at IS NULL
    ORDER BY domain
    LIMIT 6`);
  if (!rows.length) return null;

  const r = await db.get(`
    SELECT COUNT(*) AS n
    FROM domains
    WHERE active = 1 AND deleted = 0 AND last_checked IS NOT NULL AND expires_at IS NULL`);
  const n = Number(r?.n || rows.length);
  const contoh = rows.map((x) => x.domain).join(', ');
  return {
    name: 'Domain belum pernah terbaca',
    status: 'warn',
    detail: `${n} domain tidak pernah berhasil dibaca sejak ditambahkan — ${contoh}${n > rows.length ? ', …' : ''}. Periksa ejaan di Source of Truth atau hapus bila domain sudah tidak dipakai.`,
  };
}

/** Alamat aplikasi ini sendiri, dari pengaturan atau dari lingkungan Vercel. */
export function appHost() {
  const s = getSettings();
  const dari = s.appUrl
    || process.env.APP_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || '';
  if (!dari) return null;
  try {
    return new URL(dari.startsWith('http') ? dari : `https://${dari}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Sertifikat aplikasi ini sendiri. Aplikasi pemantau SSL yang mati karena sertifikatnya sendiri
 * kedaluwarsa adalah kegagalan yang paling mudah dicegah sekaligus paling memalukan.
 */
export async function ownCertificate() {
  const host = appHost();
  if (!host) {
    return { name: 'Sertifikat aplikasi ini', status: 'off',
      detail: 'Alamat aplikasi belum diisi (Settings → Aturan status & scan)' };
  }
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return { name: 'Sertifikat aplikasi ini', status: 'off',
      detail: `${host} — alamat lokal, tidak memakai sertifikat publik` };
  }

  const s = getSettings();
  const { checkCertificate } = await import('./ssl-check.js');
  const r = await checkCertificate(host, 443, Number(s.scanTimeoutMs) || 10_000).catch((e) => ({ error: e.message }));
  if (r.error) {
    return { name: 'Sertifikat aplikasi ini', status: 'error', detail: `${host} — ${r.error}` };
  }

  const sisa = r.daysRemaining;
  const t = s.tiers || {};
  const status = sisa < 0 ? 'error'
    : sisa <= (t.urgent ?? 7) ? 'error'
    : sisa <= (t.needUpdate ?? 30) ? 'warn'
    : 'ok';
  const sisaTeks = sisa < 0 ? `kedaluwarsa ${-sisa} hari lalu` : `${sisa} hari lagi`;
  return {
    name: 'Sertifikat aplikasi ini',
    status,
    detail: `${host} — ${sisaTeks} (${fmtDate(r.validTo)})${r.issuer ? ` · ${r.issuer}` : ''}`,
  };
}

/**
 * Masa berlaku kredensial integrasi. Client secret Entra ID berumur 6–24 bulan dan habisnya
 * senyap: login SSO tiba-tiba gagal total tanpa pemberitahuan apa pun dari sisi aplikasi.
 */
export async function credentialExpiry() {
  const s = getSettings();
  const out = [];

  if (s.entra.enabled && s.entra.secretExpiresAt) {
    const sisaMs = new Date(s.entra.secretExpiresAt).getTime() - Date.now();
    const sisa = Math.floor(sisaMs / HARI);
    const status = sisa < 0 ? 'error' : sisa <= 14 ? 'error' : sisa <= 45 ? 'warn' : 'ok';
    out.push({
      name: 'Client secret Entra ID',
      status,
      detail: sisa < 0
        ? `Sudah kedaluwarsa ${-sisa} hari lalu (${fmtDate(s.entra.secretExpiresAt)}) — login Microsoft tidak akan berfungsi`
        : `Berlaku ${sisa} hari lagi (${fmtDate(s.entra.secretExpiresAt)})`,
    });
  } else if (s.entra.enabled) {
    out.push({
      name: 'Client secret Entra ID',
      status: 'warn',
      detail: 'Tanggal kedaluwarsa belum diisi — isi di Settings → Integrasi → Entra ID agar bisa diingatkan sebelum habis',
    });
  }

  if (s.soarIn.enabled && s.soarIn.tokenHash) {
    const usia = umur(s.soarIn.tokenCreatedAt);
    if (usia === null) {
      out.push({ name: 'API key SOAR', status: 'ok', detail: 'Tersimpan · umur tidak diketahui' });
    } else {
      const hari = Math.floor(usia / HARI);
      out.push({
        name: 'API key SOAR',
        status: hari >= 365 ? 'warn' : 'ok',
        detail: hari >= 365
          ? `Dibuat ${hari} hari lalu — sebaiknya dirotasi`
          : `Dibuat ${fmtDate(s.soarIn.tokenCreatedAt)} (${hari} hari lalu)`,
      });
    }
  }

  return out;
}

/**
 * Penggunaan penyimpanan database. Supabase paket gratis dibatasi 500 MB sementara
 * ssl_checks dan audit_log tumbuh tiap scan, jadi batasnya bisa terlampaui tanpa disadari.
 */
let cacheStorage = { at: 0, nilai: null };

/** Ukuran database terakhir yang sudah dihitung (tanpa query baru), untuk Health Check. */
export const ukuranTerakhir = () => cacheStorage.nilai?.bytes;

export async function storageUsage() {
  const { storageStats } = await import('./backup.js');
  const { fmtBytes } = await import('./health.js');

  // Halaman Health Check menyegarkan diri tiap 5 detik, sedangkan pg_total_relation_size
  // termasuk query mahal. Tanpa cache, query berat ini berjalan terus-menerus dan menahan
  // koneksi database. Ukuran penyimpanan berubah lambat, jadi lima menit sudah cukup segar.
  const SEGAR_MS = 5 * 60_000;
  let st = cacheStorage.nilai;
  if (!st || Date.now() - cacheStorage.at > SEGAR_MS) {
    st = await storageStats();
    cacheStorage = { at: Date.now(), nilai: st };
  }
  if (!Number.isFinite(st.bytes) || !st.bytes) {
    return { name: 'Penyimpanan database', status: 'off', detail: `${st.kind} — ukuran tidak tersedia` };
  }

  const s = getSettings();
  const batas = Number(s.storageLimitMb || 500) * 1024 * 1024; // paket gratis Supabase
  const persen = Math.round((st.bytes / batas) * 100);
  const status = persen >= 90 ? 'error' : persen >= 70 ? 'warn' : 'ok';
  const terbesar = st.tabel.filter((t) => t.baris > 0).slice(0, 3)
    .map((t) => `${t.nama} ${fmtBytes(t.bytes)}`).join(' · ');
  return {
    name: 'Penyimpanan database',
    status,
    detail: `${st.perkiraan ? '± ' : ''}${fmtBytes(st.bytes)} dari ${fmtBytes(batas)} (${persen}%)${st.perkiraan ? ' · perkiraan dari tabel aplikasi' : ''}${terbesar ? ` · terbesar: ${terbesar}` : ''}`,
  };
}

/** Jangan biarkan satu pemeriksaan menahan seluruh halaman Health Check. */
function sebatas(janji, ms, nama) {
  let t;
  return Promise.race([
    janji,
    new Promise((tuntas) => { t = setTimeout(() => tuntas({ name: nama, status: 'warn', detail: `Pemeriksaan tidak selesai dalam ${Math.round(ms / 1000)} detik` }), ms); }),
  ]).finally(() => clearTimeout(t));
}

/** Seluruh pemeriksaan di modul ini, aman dipanggil berbarengan. */
export async function selfChecks() {
  const hasil = await Promise.allSettled([
    sebatas(dataFreshness(), 8_000, 'Kesegaran data scan'),
    sebatas(neverReadable(), 8_000, 'Domain belum pernah terbaca'),
    sebatas(ownCertificate(), 12_000, 'Sertifikat aplikasi ini'),
    credentialExpiry(),
    sebatas(storageUsage(), 10_000, 'Penyimpanan database'),
  ]);
  const out = [];
  for (const h of hasil) {
    if (h.status !== 'fulfilled' || !h.value) continue;
    if (Array.isArray(h.value)) out.push(...h.value);
    else out.push(h.value);
  }
  return out;
}
