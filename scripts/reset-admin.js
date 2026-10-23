// Darurat: lupa password admin. Jalankan di laptop tempat aplikasi berada:
//   npm run reset-admin -- <username> <password-baru>
// User yang ada → password di-reset, akun diaktifkan, peran dijadikan admin.
// User belum ada → dibuat sebagai admin baru.
import { appDb } from '../lib/appdb.js';
import { createUser, setPassword, logoutAll, validatePassword } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Pemakaian: npm run reset-admin -- <username> <password-baru>');
  process.exit(1);
}
try {
  validatePassword(password);
  const u = appDb().prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (u) {
    setPassword(u.id, password);
    appDb().prepare("UPDATE users SET role = 'admin', active = 1 WHERE id = ?").run(u.id);
    logoutAll(u.id);
    audit({ category: 'auth', action: 'user.reset-password', source: 'Terminal', target: u.username, summary: `Reset password admin ${u.username} lewat terminal (npm run reset-admin)` });
    console.log(`✔ Password ${u.username} di-reset, akun aktif dengan peran Admin.`);
  } else {
    const n = createUser({ username, role: 'admin', password }, 'terminal');
    audit({ category: 'auth', action: 'user.add', source: 'Terminal', target: n.username, summary: `Admin ${n.username} dibuat lewat terminal (npm run reset-admin)` });
    console.log(`✔ Admin baru ${n.username} dibuat.`);
  }
} catch (e) {
  console.error(`✘ ${e.message}`);
  process.exit(1);
}
