// GET /api/wazuh/rules → download file rules Wazuh untuk SSL Monitoring
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = handle(async () => new Response(fs.readFileSync(path.join(process.cwd(), 'wazuh', 'ssl_monitoring_rules.xml')), {
  headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="ssl_monitoring_rules.xml"' },
}), { access: 'admin' });
