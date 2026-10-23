// Kosongkan database domain (struktur tabel tetap). User, audit log & pengaturan tidak ikut terhapus.
import { resetAll, dbPath } from '../lib/db.js';
import { audit } from '../lib/audit.js';
resetAll();
audit({ category: 'data', action: 'data.clear', source: 'Terminal', target: 'Database domain', summary: 'Kosongkan data (npm run reset)' });
console.log(`✔ Data dikosongkan (${dbPath()}).`);
