// Pindahkan data versi lama (data/real.db, data/app.db, data/settings.json) ke database yang dipakai sekarang
// (Supabase kalau DATABASE_URL diisi di .env.local, selain itu database lokal data/pg).
// Hanya berjalan kalau database tujuan masih kosong (belum ada user, file Source of Truth, maupun pengaturan).
//   npm run import-local
import './env.js';
import { importLegacy, hasLegacy } from '../lib/legacy.js';
import { closePg, dbLabel } from '../lib/pg.js';

const l = dbLabel();
console.log(`Tujuan: ${l.kind} · ${l.where}`);
if (!hasLegacy()) {
  console.log('Tidak ada data versi lama (data/real.db, data/app.db, data/settings.json).');
} else {
  try {
    const r = await importLegacy({ force: true, log: console.log });
    console.log(r ? '✔ Selesai.' : '✘ Database tujuan sudah berisi data. Impor dibatalkan supaya tidak tercampur.');
  } catch (e) {
    console.error(`✘ ${e.message}`);
    process.exitCode = 1;
  }
}
await closePg();
