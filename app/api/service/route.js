import { serviceStatus } from '@/lib/service';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json(serviceStatus()), { access: 'admin' });
