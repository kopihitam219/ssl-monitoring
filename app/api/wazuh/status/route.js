// GET /api/wazuh/status → antrean, kiriman terakhir, error terakhir
import { wazuhStatus } from '@/lib/wazuh';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = handle(async () => json(wazuhStatus()), { access: 'admin' });
