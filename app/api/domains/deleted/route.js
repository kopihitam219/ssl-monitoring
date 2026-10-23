// GET /api/domains/deleted → domain yang dihapus admin (Settings → Domain yang dihapus)
import { getDeletedDomains } from '@/lib/db';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({ deleted: await getDeletedDomains() }), { access: 'manage_domains' });
