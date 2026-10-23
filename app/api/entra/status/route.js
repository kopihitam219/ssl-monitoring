import { entraStatus } from '@/lib/entra';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json(entraStatus()), { access: 'admin' });
