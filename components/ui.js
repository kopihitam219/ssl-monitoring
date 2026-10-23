'use client';
import { Check, AlertTriangle, X, Loader2, Siren, AlarmClock, RefreshCw, Info } from 'lucide-react';

// Status 7 tingkat (urutan & warna mengikuti tampilan monitoring). sub(t) = keterangan rentang hari dari ambang Settings.
export const STATUS = {
  CHECK_FAILED: { label: 'Check Failed', color: '#a855f7', icon: X, sub: () => 'tanggal expired tidak terbaca' },
  URGENT: { label: 'Urgent Renewal', color: '#ef4444', icon: Siren, sub: (t) => `≤ ${t.urgent} hari lagi / sudah expired` },
  REMINDER: { label: 'Reminder Exp.', color: '#f43f5e', icon: AlarmClock, sub: (t) => `${t.urgent + 1}–${t.reminder} hari lagi` },
  NEED_UPDATE: { label: 'Need Update', color: '#f97316', icon: RefreshCw, sub: (t) => `${t.reminder + 1}–${t.needUpdate} hari lagi` },
  WARNING: { label: 'Warning Update', color: '#f59e0b', icon: AlertTriangle, sub: (t) => `${t.needUpdate + 1}–${t.warning} hari lagi` },
  INFORMATIONAL: { label: 'Informational', color: '#3b82f6', icon: Info, sub: (t) => `${t.warning + 1}–${t.info} hari lagi` },
  OK: { label: 'OK', color: '#22c55e', icon: Check, sub: (t) => `> ${t.info} hari lagi` },
  PENDING: { label: 'Belum dicek', color: '#64748b', icon: Loader2, sub: () => 'belum pernah di-scan' },
  EXPIRED: { label: 'Urgent Renewal', color: '#ef4444', icon: Siren, sub: () => 'sudah expired' }, // riwayat versi lama
};

export const CARD_KEYS = ['CHECK_FAILED', 'URGENT', 'REMINDER', 'NEED_UPDATE', 'WARNING', 'INFORMATIONAL', 'OK'];
export const DEFAULT_TIERS = { urgent: 7, reminder: 14, needUpdate: 30, warning: 60, info: 90 };
export const statusSub = (k, tiers) => STATUS[k]?.sub?.(tiers || DEFAULT_TIERS) || '';

/** Kode masalah kepercayaan sertifikat → kalimat. */
export function trustNote(code, d = {}) {
  if (!code) return '';
  const san = (d.san || '').replace(/DNS:/g, '').split(',').map((x) => x.trim()).filter(Boolean);
  if (/HOSTNAME_MISMATCH/.test(code)) return `Nama tidak cocok · sertifikat hanya untuk ${d.subject || san[0] || '?'}${san.length > 1 ? ` +${san.length - 1}` : ''}`;
  if (/CERT_HAS_EXPIRED/.test(code)) return `Sertifikat expired (${code})`;
  if (/SELF_SIGNED/.test(code)) return `Sertifikat self-signed (${code})`;
  if (/UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|UNTRUSTED/.test(code)) return `Root CA tidak dipercaya (${code})`;
  return code;
}

/** "35 hari lagi" / "expired 12 hari lalu" */
export function fmtExpiresIn(n) {
  if (n === null || n === undefined) return '—';
  return n < 0 ? `expired ${-n} hari lalu` : `${n} hari lagi`;
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.PENDING;
  const Icon = s.icon;
  return (
    <span className="badge" style={{ '--c': s.color }}>
      <Icon size={12} strokeWidth={2.5} /> {s.label}
    </span>
  );
}

const DT = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const D = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

export const fmtDateTime = (iso) => (iso ? DT.format(new Date(iso)) : '—');
export const fmtDate = (iso) => (iso ? D.format(new Date(iso)) : '—');

export function fmtDays(n) {
  if (n === null || n === undefined) return '—';
  return `${n} hari`;
}

export const pct = (n, total) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

export async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('ssl-unauthorized'));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
