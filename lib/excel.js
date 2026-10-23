import * as XLSX from 'xlsx';

const ALIASES = {
  domain: ['domain', 'hostname', 'host', 'fqdn', 'url', 'nama domain'],
  environment: ['environment', 'env', 'lingkungan'],
  application: ['application', 'app', 'aplikasi'],
  owner: ['owner', 'pic', 'team', 'pemilik'],
  port: ['port'],
  notes: ['notes', 'note', 'keterangan', 'catatan'],
  proxy: ['proxy', 'via proxy', 'via_proxy', 'lewat proxy'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Bersihkan "https://www.Example.com:8443/path" → { domain: "www.example.com", port: 8443 } */
export function normalizeDomain(raw, defaultPort = 443) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0];
  let port = defaultPort;
  const m = s.match(/^(.+):(\d+)$/);
  if (m) { s = m[1]; port = Number(m[2]); }
  s = s.replace(/\.$/, '');
  if (!/^[a-z0-9*]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return { domain: s, port };
}

/**
 * Baca file Excel/CSV (Buffer) → daftar domain.
 * Kolom wajib: Domain. Kolom opsional: Environment, Application, Owner, Port, Notes, Proxy (Ya/Tidak).
 */
export function parseSourceOfTruth(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('File kosong atau sheet pertama tidak berisi data');

  const headers = Object.keys(rows[0]);
  const col = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    col[field] = headers.find((h) => names.includes(norm(h)));
  }
  if (!col.domain) throw new Error(`Kolom "Domain" tidak ditemukan. Header yang terbaca: ${headers.join(', ')}`);

  const domains = new Map();
  const skipped = [];
  rows.forEach((r, i) => {
    const portCell = col.port ? Number(r[col.port]) : NaN;
    const parsed = normalizeDomain(r[col.domain], Number.isFinite(portCell) && portCell > 0 ? portCell : 443);
    if (!parsed) {
      if (String(r[col.domain]).trim()) skipped.push({ row: i + 2, value: r[col.domain] });
      return;
    }
    if (parsed.domain.startsWith('*.')) parsed.domain = parsed.domain.slice(2); // wildcard → cek domain induknya
    domains.set(`${parsed.domain}:${parsed.port}`, {
      ...parsed,
      environment: String(r[col.environment] ?? '').trim() || null,
      application: String(r[col.application] ?? '').trim() || null,
      owner: String(r[col.owner] ?? '').trim() || null,
      notes: String(r[col.notes] ?? '').trim() || null,
      ...(col.proxy ? { via_proxy: /^(1|y|ya|yes|true|proxy|via proxy)$/i.test(String(r[col.proxy] ?? '').trim()) } : {}),
    });
  });
  return { domains: [...domains.values()], skipped, totalRows: rows.length };
}
