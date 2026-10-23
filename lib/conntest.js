// Tes koneksi ke satu host: DNS → Ping (ICMP) → Telnet (TCP port) → Curl (HTTPS), langsung dan lewat proxy.
// Dipakai Jobs → "Tes koneksi Check Failed" dan alat tes manual, untuk tahu kenapa sebuah domain Check Failed.
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { openTunnel } from './ssl-check.js';
import { getSettings } from './settings.js';

const since = (t) => Date.now() - t;

async function testDns(host) {
  const t = Date.now();
  if (net.isIP(host)) return { ok: true, addresses: [host], ms: 0 };
  try {
    const r = await dns.lookup(host, { all: true });
    return { ok: true, addresses: r.map((x) => x.address).slice(0, 4), ms: since(t) };
  } catch (e) {
    return { ok: false, error: e.code || e.message, ms: since(t) };
  }
}

function testPing(host, timeoutMs) {
  const sec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const plat = os.platform();
  const args = plat === 'win32' ? ['-n', '1', '-w', String(timeoutMs), host] : plat === 'darwin' ? ['-c', '1', '-t', String(sec), host] : ['-c', '1', '-W', String(sec), host];
  return new Promise((resolve) => {
    const t = Date.now();
    execFile('ping', args, { timeout: timeoutMs + 2000, windowsHide: true }, (err, stdout = '', stderr = '') => {
      const out = `${stdout}\n${stderr}`;
      if (err?.code === 'ENOENT') return resolve({ ok: null, skipped: true, error: 'perintah ping tidak tersedia' });
      const m = out.match(/(?:time|waktu|zeit|temps|tiempo)[=<]\s*([\d.,]+)\s*ms/i);
      const replied = /ttl[=:]/i.test(out) && !!m;
      if (replied) return resolve({ ok: true, ms: Number(m[1].replace(',', '.')) });
      const line = out.split(/\r?\n/).map((l) => l.trim()).find((l) => /unreachable|timed out|request timeout|tidak dapat|100% packet loss|could not find|unknown host|not known/i.test(l));
      resolve({ ok: false, error: line || (err?.killed ? 'timeout' : 'tidak ada balasan'), ms: since(t) });
    });
  });
}

function testTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t = Date.now();
    const s = net.connect({ host, port });
    const done = (r) => { s.destroy(); resolve({ ...r, ms: since(t) }); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done({ ok: true }));
    s.once('timeout', () => done({ ok: false, error: 'TIMEOUT' }));
    s.once('error', (e) => done({ ok: false, error: e.code || e.message }));
  });
}

/** Seperti "curl -kI https://host:port/": TLS handshake lalu HEAD /. socket = tunnel proxy (opsional). */
function testHttps(host, port, timeoutMs, socket = null) {
  return new Promise((resolve) => {
    const t = Date.now();
    let finished = false, tlsOk = false, buf = '';
    const s = tls.connect({ ...(socket ? { socket } : { host, port }), servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false });
    const done = (r) => { if (finished) return; finished = true; clearTimeout(timer); s.destroy(); resolve({ ...r, ms: since(t) }); };
    const timer = setTimeout(() => done(tlsOk ? { ok: true, status: null, note: 'TLS OK, tidak ada balasan HTTP' } : { ok: false, error: 'TIMEOUT' }), timeoutMs);
    s.once('secureConnect', () => {
      tlsOk = true;
      s.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ssl-monitoring/connection-test\r\nConnection: close\r\n\r\n`);
    });
    s.on('data', (c) => {
      buf += c.toString('latin1');
      const line = buf.split('\r\n')[0];
      if (buf.includes('\r\n')) {
        const m = line.match(/^HTTP\/[\d.]+\s+(\d{3})/);
        const server = (buf.match(/^server:\s*(.+)$/im) || [])[1]?.trim() || null;
        done({ ok: true, status: m ? Number(m[1]) : null, server });
      }
    });
    s.once('end', () => done(tlsOk ? { ok: true, status: null, note: 'TLS OK, tidak ada balasan HTTP' } : { ok: false, error: 'koneksi ditutup' }));
    s.once('error', (e) => done(tlsOk ? { ok: true, status: null, note: `TLS OK, ${e.code || e.message}` } : { ok: false, error: e.code || e.message }));
  });
}

async function viaProxy(proxy, host, port, timeoutMs) {
  const t = Date.now();
  let tunnel;
  try {
    tunnel = await openTunnel(proxy, host, port, timeoutMs);
  } catch (e) {
    return { connect: { ok: false, error: e.message, ms: since(t) }, https: null };
  }
  const connect = { ok: true, ms: since(t) };
  const h = await testHttps(host, port, timeoutMs, tunnel);
  tunnel.destroy();
  return { connect, https: h };
}

function conclude(r) {
  const p = r.port;
  const viaOk = r.proxy?.https?.ok;
  const tail = viaOk ? ' Lewat proxy bisa → set file ini ke "Dengan proxy", atau biarkan "Tanpa proxy" (otomatis pakai proxy kalau gagal).' : '';
  if (!r.dns.ok) return { level: viaOk ? 'warn' : 'error', text: `DNS tidak bisa di-resolve dari komputer ini (${r.dns.error}).${tail || ' Cek nama domain atau DNS internal kantor.'}` };
  if (!r.tcp.ok) {
    const why = r.tcp.error === 'ECONNREFUSED' ? `Port ${p} ditolak (tidak ada layanan di port ini)` : r.tcp.error === 'TIMEOUT' ? `Port ${p} tidak bisa dijangkau (timeout) — kemungkinan diblokir firewall` : `Port ${p} gagal (${r.tcp.error})`;
    return { level: viaOk ? 'warn' : 'error', text: `${why}.${r.ping.ok ? ' Host merespons ping.' : ''}${tail}` };
  }
  if (!r.https.ok) return { level: 'error', text: `Port ${p} terbuka tapi HTTPS/TLS gagal (${r.https.error}).${tail}` };
  return { level: 'ok', text: `Koneksi normal (${r.https.status ? `HTTPS ${r.https.status}` : 'TLS OK'}). Coba "Retry Check Failed".` };
}

/** Tes satu host. proxy=true → juga dicoba lewat proxy Settings (kalau sudah diisi). */
export async function testConnection(host, port = 443, { timeoutMs = 5000, proxy = true } = {}) {
  const h = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/[/:].*$/, '');
  if (!h) throw new Error('Host kosong');
  const pt = Number(port) || 443;
  const px = getSettings().scanProxy;
  const [dnsR, ping] = await Promise.all([testDns(h), testPing(h, timeoutMs)]);
  const tcp = dnsR.ok ? await testTcp(h, pt, timeoutMs) : { ok: false, error: 'DNS gagal', skipped: true };
  const httpsR = tcp.ok ? await testHttps(h, pt, timeoutMs) : { ok: false, error: tcp.skipped ? 'DNS gagal' : `port ${tcp.error}`, skipped: true };
  const r = { host: h, port: pt, at: new Date().toISOString(), from: process.env.VERCEL ? 'Vercel (cloud)' : os.hostname(), dns: dnsR, ping, tcp, https: httpsR, proxy: null };
  if (proxy && px?.url) r.proxy = { url: px.url, ...(await viaProxy(px, h, pt, timeoutMs)) };
  r.conclusion = conclude(r);
  return r;
}
