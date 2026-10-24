// GET /api/health → CPU, RAM, Disk, memori aplikasi, status service
import { healthReport } from '@/lib/health';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
// Halaman Health Check menyegarkan diri tiap 5 detik. Batas pendek memastikan permintaan yang
// tersendat gagal cepat dan melepas koneksinya, bukan menahan sampai batas bawaan 300 detik.
export const maxDuration = 30;

export const GET = handle(async () => json(await healthReport()), { access: 'health' });
