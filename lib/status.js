// Aturan status sertifikat (7 tingkat). Ambang hari diatur di Settings → Aturan status & scan.
//   CHECK_FAILED  : sertifikat / tanggal expired tidak bisa dibaca (tidak terhubung, DNS, timeout, ditolak, dll.)
//   URGENT        : ≤ urgent hari lagi, atau sudah expired          (default ≤ 7)
//   REMINDER      : ≤ reminder hari lagi                             (default 8–14)
//   NEED_UPDATE   : ≤ needUpdate hari lagi                           (default 15–30)
//   WARNING       : ≤ warning hari lagi                              (default 31–60)
//   INFORMATIONAL : ≤ info hari lagi                                 (default 61–90)
//   OK            : lebih dari itu                                    (default > 90)
// Masalah kepercayaan sertifikat (nama tidak cocok, self-signed, root CA tidak dipercaya) tetap dicatat
// sebagai catatan, tapi statusnya mengikuti sisa hari karena tanggal expired-nya terbaca.
import { getSettings } from './settings.js';

export const STATUS_KEYS = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL', 'OK'];

export const thresholds = () => getSettings().tiers;

/** Status dari sisa hari. */
export function tierOf(days, t = thresholds()) {
  if (days <= t.urgent) return 'URGENT'; // termasuk yang sudah expired (hari negatif)
  if (days <= t.reminder) return 'REMINDER';
  if (days <= t.needUpdate) return 'NEED_UPDATE';
  if (days <= t.warning) return 'WARNING';
  if (days <= t.info) return 'INFORMATIONAL';
  return 'OK';
}

/** Status sertifikat dari hasil scan TLS. */
export function classifySsl(result) {
  if (!result || result.error || !result.validTo) return 'CHECK_FAILED';
  return tierOf(result.daysRemaining);
}

/** Status yang ditampilkan = status sertifikat; PENDING kalau belum pernah dicek. */
export function displayStatus(d) {
  if (d.ssl_status === 'EXPIRED') return 'URGENT'; // data versi lama
  return d.ssl_status || 'PENDING';
}

/** Kartu ringkasan: PENDING tidak dihitung. */
export function cardKey(status) {
  return status === 'EXPIRED' ? 'URGENT' : status;
}
