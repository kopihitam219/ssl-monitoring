import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { getSettings } from './settings.js';
import { classifySsl } from './status.js';

const DAY = 86_400_000;

/**
 * Buka koneksi TLS ke host:port dan baca sertifikatnya.
 * rejectUnauthorized=false supaya sertifikat expired / self-signed tetap bisa dibaca,
 * lalu kepercayaannya kita nilai sendiri.
 */
export async function checkCertificate(host, port = 443, timeoutMs = 10_000, { proxy } = {}) {
  const started = Date.now();
  let tunnel = null;
  if (proxy?.url) {
    try {
      tunnel = await openTunnel(proxy, host, port, timeoutMs);
    } catch (e) {
      return { host, port, durationMs: Date.now() - started, viaProxy: true, error: `Proxy: ${e.message}` };
    }
  }
  return new Promise((resolve) => {
    let finished = false;
    const done = (r) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      tunnel?.destroy();
      resolve({ host, port, durationMs: Date.now() - started, ...(tunnel ? { viaProxy: true } : {}), ...r });
    };

    const socket = tls.connect({
      ...(tunnel ? { socket: tunnel } : { host, port }),
      servername: host, // SNI
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
    if (tunnel) socket.setTimeout(timeoutMs);

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(false);
      if (!cert || !cert.valid_to) return done({ error: 'Server tidak mengirim sertifikat' });

      const validTo = new Date(cert.valid_to);
      const validFrom = new Date(cert.valid_from);
      const hostnameError = tls.checkServerIdentity(host, cert);
      const chainError = socket.authorized ? null : String(socket.authorizationError || 'UNTRUSTED');
      const problem = hostnameError ? 'HOSTNAME_MISMATCH' : chainError;

      done({
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        daysRemaining: Math.floor((validTo.getTime() - Date.now()) / DAY),
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
        subject: cert.subject?.CN || null,
        issuerCn: cert.issuer?.CN || null,                                       // mis. "DigiCert Global G3 TLS ECC SHA384 2020 CA1"
        fingerprint: cert.fingerprint256 ? cert.fingerprint256.replace(/:/g, '').toLowerCase() : null, // sama dengan "SHA-256 Fingerprint" di browser
        san: cert.subjectaltname || null,
        protocol: socket.getProtocol(),
        trusted: !problem || problem === 'CERT_HAS_EXPIRED',
        trustError: problem,
      });
    });

    socket.once('timeout', () => done({ error: `Timeout setelah ${timeoutMs / 1000}s` }));
    socket.once('error', (e) => done({ error: e.code || e.message }));
  });
}

/**
 * Buka tunnel HTTP CONNECT lewat proxy (mis. proxy kantor) → socket mentah ke host:port.
 * proxy = { url: 'http://proxy:8080', username?, password? }
 */
export function openTunnel(proxy, host, port, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(proxy.url); } catch { return reject(new Error('alamat proxy tidak valid')); }
    const headers = { Host: `${host}:${port}` };
    if (proxy.username) headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}`;
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT', path: `${host}:${port}`, headers, timeout: timeoutMs,
      ...(u.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode === 200) return resolve(socket);
      socket.destroy();
      reject(new Error(res.statusCode === 407 ? 'butuh login (407) — cek username/password proxy' : `ditolak (HTTP ${res.statusCode})`));
    });
    req.once('timeout', () => { req.destroy(); reject(new Error(`timeout setelah ${timeoutMs / 1000}s`)); });
    req.once('error', (e) => reject(new Error(e.code || e.message)));
    req.end();
  });
}

/**
 * Cek sertifikat sebuah record domain dari database, mengikuti pilihan proxy file Source of Truth-nya:
 *   proxy_mode 'proxy'  → selalu lewat proxy (kalau proxy sudah diisi di Settings)
 *   proxy_mode 'direct' → tanpa proxy; kalau hasilnya Check Failed dan proxy sudah diisi,
 *                         otomatis dicoba ulang lewat proxy (via = 'fallback')
 * Hasil membawa result.via: 'direct' | 'proxy' | 'fallback'.
 */
export async function checkDomain(d, timeoutMs = getSettings().scanTimeoutMs) {
  const p = getSettings().scanProxy;
  const proxy = p?.url ? p : null;
  if (d?.proxy_mode === 'proxy' && proxy) {
    return { ...(await checkCertificate(d.domain, d.port, timeoutMs, { proxy })), via: 'proxy' };
  }
  const direct = await checkCertificate(d.domain, d.port, timeoutMs);
  if (classifySsl(direct) !== 'CHECK_FAILED' || !proxy) return { ...direct, via: 'direct' };
  const viaProxy = await checkCertificate(d.domain, d.port, timeoutMs, { proxy });
  if (classifySsl(viaProxy) !== 'CHECK_FAILED') {
    return { ...viaProxy, via: 'fallback', directError: direct.error || direct.trustError || null };
  }
  // dua-duanya gagal: tampilkan alasan cek langsung + alasan lewat proxy
  const why = viaProxy.error || viaProxy.trustError || 'gagal';
  return {
    ...direct, via: 'direct',
    error: direct.error ? `${direct.error} · lewat proxy juga gagal: ${why}` : direct.error,
    trustError: !direct.error && direct.trustError ? `${direct.trustError} · lewat proxy juga gagal: ${why}` : direct.trustError,
  };
}

/** Jalankan fungsi async untuk banyak item dengan batas paralel. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
