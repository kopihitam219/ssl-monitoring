// Server production (dipanggil oleh scripts/serve.js). Sama dengan "next start", ditambah:
// alamat IP asli pengirim request (dari koneksi TCP) diteruskan ke aplikasi, supaya audit log
// tidak bisa ditipu header X-Forwarded-For palsu dari client.
//   TRUST_PROXY=1 → aplikasi berada di belakang reverse proxy (IIS/nginx): pakai IP terakhir di X-Forwarded-For.
import http from 'node:http';
import crypto from 'node:crypto';
import next from 'next';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

// kunci acak per proses: header IP hanya dipercaya kalau kuncinya cocok (client tidak bisa memalsukannya)
process.env.SSL_IP_KEY = crypto.randomBytes(24).toString('hex');

const app = next({ dev: false, hostname: HOST, port: PORT });
const handle = app.getRequestHandler();
await app.prepare();

http.createServer((req, res) => {
  let ip = req.socket.remoteAddress || '';
  if (TRUST_PROXY) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (hops.length) ip = hops[hops.length - 1];
  }
  req.headers['x-ssl-client-ip'] = ip.replace(/^::ffff:/, '');
  req.headers['x-ssl-client-sig'] = process.env.SSL_IP_KEY;
  handle(req, res);
}).listen(PORT, HOST, () => {
  console.log(`   ▲ SSL Monitoring siap di http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${TRUST_PROXY ? ' (TRUST_PROXY aktif)' : ''}`);
});
