// Supervisor untuk mode production (npm start): menjalankan scripts/server.js (Next.js production) dan menyalakannya
// ulang otomatis saat tombol "Restart service" ditekan (server keluar dengan kode 75).
// Ctrl + C tetap menghentikan semuanya seperti biasa.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// --lan → bisa diakses dari komputer lain di jaringan. Default hanya laptop ini.
const LAN = process.argv.includes('--lan') || process.env.HOST === '0.0.0.0';
const HOST = LAN ? '0.0.0.0' : process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || '3000';

const RESTART_CODE = 75;
const serverJs = path.join(process.cwd(), 'scripts', 'server.js');
if (!fs.existsSync(path.join(process.cwd(), '.next', 'BUILD_ID'))) {
  console.error('Belum ada hasil build. Jalankan dulu: npm run build');
  process.exit(1);
}

let stopping = false;
function run() {
  const child = spawn(process.execPath, ['--no-warnings', serverJs], {
    stdio: 'inherit',
    env: { ...process.env, SSL_SUPERVISED: '1', HOST, PORT, NODE_ENV: 'production' },
  });
  child.on('exit', (code, signal) => {
    if (!stopping && code === RESTART_CODE) {
      console.log('\n[serve] Service di-restart…\n');
      setTimeout(run, 500);
      return;
    }
    process.exit(code ?? (signal ? 0 : 1));
  });
}

if (LAN) {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`[serve] Mode jaringan (LAN): aplikasi bisa diakses dari komputer lain.`);
  for (const ip of ips) console.log(`[serve]   http://${ip}:${PORT}`);
  console.log('[serve] Batasi akses lewat firewall (hanya user yang perlu).\n');
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; });
run();
