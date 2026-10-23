// Pengecekan bersama untuk endpoint SOAR → aplikasi: aktif? API key benar? ukuran wajar?
import { NextResponse } from 'next/server';
import { getSettings } from './settings.js';
import { verifyKey, soarAudit } from './soar-in.js';
import { clientIp, runWithUser } from './context.js';
import { loadSettings } from './settings.js';

const MAX_BYTES = 5 * 1024 * 1024;
export const reply = (data, status = 200) => NextResponse.json(data, { status });

/** Bungkus handler SOAR. hec=true → balasan error meniru Splunk HEC ({text, code}). */
export function soarHandler(fn, { hec = false } = {}) {
  return async (req) => {
    const ip = clientIp(req) || 'unknown';
    const err = (msg, code, status) => reply(hec ? { text: msg, code } : { error: msg }, status);
    return runWithUser(null, async () => {
      try {
        await loadSettings();
        if (!getSettings().soarIn.enabled) return err(hec ? 'HEC is disabled' : 'SOAR → aplikasi belum diaktifkan (Settings → Integrasi → SOAR)', 1, 403);
        if (!verifyKey(req)) {
          soarAudit({ action: 'soar.auth', target: ip, ip, ok: false, summary: `Request SOAR ditolak: API key salah / tidak ada (${req.method} ${req.nextUrl.pathname})` });
          return err(hec ? 'Invalid token' : 'API key tidak valid', 4, 401);
        }
        if (Number(req.headers.get('content-length') || 0) > MAX_BYTES) return err(hec ? 'Content too large' : 'Data terlalu besar (maks 5 MB)', 27, 413);
        return await fn(req, { ip });
      } catch (e) {
        console.error('[soar]', e);
        if (e.code === 'NO_DATA') return err(hec ? 'No data' : e.message, 5, 400);
        return err(hec ? 'Invalid data format' : e.message, 6, 400);
      }
    }, req);
  };
}

export async function readBody(req) {
  const t = await req.text();
  if (t.length > MAX_BYTES) throw new Error('Data terlalu besar (maks 5 MB)');
  return t;
}
