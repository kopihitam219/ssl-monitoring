// Kosongkan data domain (struktur tabel tetap). User, audit log & pengaturan tidak ikut terhapus.
import './env.js';
import { resetAll } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { closePg, dbLabel } from '../lib/pg.js';
await resetAll();
await audit({ category: 'data', action: 'data.clear', source: 'Terminal', target: 'Database domain', summary: 'Kosongkan data (npm run reset)' });
const l = dbLabel();
console.log(`✔ Data dikosongkan (${l.kind} · ${l.where}).`);
await closePg();
