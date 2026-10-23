// GET /api/health → CPU, RAM, Disk, memori aplikasi, status service
import { healthReport } from '@/lib/health';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json(await healthReport()), { access: 'health' });
