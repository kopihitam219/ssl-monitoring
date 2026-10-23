// Buat file Excel contoh Source of Truth berisi domain global yang bisa dites siapa saja.
// Jalankan: npm run sample:excel  → data/sample/ssl_source_of_truth.xlsx
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

const rows = [
  // Domain, Environment, Application, Owner, Port, Notes
  ['google.com', 'Production', 'Google', 'IT Team', 443, ''],
  ['github.com', 'Production', 'GitHub', 'Dev Team', 443, ''],
  ['cloudflare.com', 'Production', 'Cloudflare', 'IT Team', 443, ''],
  ['microsoft.com', 'Production', 'Office 365', 'IT Team', 443, ''],
  ['amazon.com', 'Production', 'AWS', 'Cloud Team', 443, ''],
  ['facebook.com', 'Production', 'Facebook', 'IT Team', 443, ''],
  ['apple.com', 'Production', 'Apple', 'IT Team', 443, ''],
  ['netflix.com', 'Production', 'Netflix', 'Media Team', 443, ''],
  ['linkedin.com', 'Production', 'LinkedIn', 'HR Team', 443, ''],
  ['youtube.com', 'Production', 'YouTube', 'Media Team', 443, ''],
  ['stackoverflow.com', 'Production', 'Stack Overflow', 'Dev Team', 443, ''],
  ['mozilla.org', 'Production', 'Mozilla', 'IT Team', 443, ''],
  ['wikipedia.org', 'UAT', 'Wiki App', 'IT Team', 443, ''],
  ['letsencrypt.org', 'UAT', "Let's Encrypt", 'Security Team', 443, ''],
  ['example.com', 'Development', 'Example App', 'Dev Team', 443, ''],
  ['badssl.com', 'Development', 'Test App', 'QA Team', 443, 'Sertifikat normal'],
  ['expired.badssl.com', 'Development', 'Test App', 'QA Team', 443, 'Sengaja expired'],
  ['self-signed.badssl.com', 'Development', 'Test App', 'QA Team', 443, 'Sengaja self-signed'],
  ['wrong.host.badssl.com', 'Development', 'Test App', 'QA Team', 443, 'Sengaja hostname salah'],
  ['untrusted-root.badssl.com', 'Development', 'Test App', 'QA Team', 443, 'Sengaja root CA tidak dipercaya'],
  ['tls-v1-2.badssl.com', 'Development', 'Test App', 'QA Team', 1012, 'Contoh port non-443'],
  ['sha256.badssl.com', 'Staging', 'Test App', 'QA Team', 443, ''],
  ['digicert.com', 'Staging', 'DigiCert', 'Security Team', 443, ''],
  ['internal.test.local', 'Others', 'Internal App', 'IT Team', 443, 'Sengaja tidak bisa di-resolve'],
  ['ubuntu.com', 'Others', 'Ubuntu', 'Infra Team', 443, ''],
  ['python.org', 'Others', 'Python', 'Dev Team', 443, ''],
];

const sheet = XLSX.utils.aoa_to_sheet([['Domain', 'Environment', 'Application', 'Owner', 'Port', 'Notes'], ...rows]);
sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 6 }, { wch: 32 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet, 'Domains');

const out = path.join(process.cwd(), 'data', 'sample', 'ssl_source_of_truth.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`✔ Dibuat: ${path.relative(process.cwd(), out)} (${rows.length} domain)`);
