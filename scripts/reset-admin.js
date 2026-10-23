// Darurat: lupa password admin. Jalankan di laptop tempat aplikasi berada (memakai DATABASE_URL di .env.local kalau ada):
//   npm run reset-admin -- <username> <password-baru>
// User yang ada → password di-reset, akun diaktifkan, peran dijadikan admin.
// User belum ada → dibuat sebagai admin baru.
import './env.js';
import { pg, closePg } from '../lib/pg.js';
import { createUser, setPassword, logoutAll, validatePassword } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Pemakaian: npm run reset-admin -- <username> <password-baru>');
  process.exit(1);
}
try {
  validatePassword(password);
  const db = await pg();
  const u = await db.get('SELECT * FROM users WHERE lower(username) = ?', username.toLowerCase());
  if (u) {
    if (u.auth_source === 'entra') await db.run("UPDATE users SET auth_source = 'local', external_id = NULL WHERE id = ?", u.id);
    await setPassword(u.id, password);
    await db.run("UPDATE users SET role = 'admin', active = 1, disabled_by = NULL WHERE id = ?", u.id);
    await logoutAll(u.id);
    await audit({ category: 'auth', action: 'user.reset-password', source: 'Terminal', target: u.username, summary: `Reset password admin ${u.username} lewat terminal (npm run reset-admin)` });
    console.log(`✔ Password ${u.username} di-reset, akun aktif dengan peran Admin.`);
  } else {
    const n = await createUser({ username, role: 'admin', password }, 'terminal');
    await audit({ category: 'auth', action: 'user.add', source: 'Terminal', target: n.username, summary: `Admin ${n.username} dibuat lewat terminal (npm run reset-admin)` });
    console.log(`✔ Admin baru ${n.username} dibuat.`);
  }
} catch (e) {
  console.error(`✘ ${e.message}`);
  process.exitCode = 1;
}
await closePg();
