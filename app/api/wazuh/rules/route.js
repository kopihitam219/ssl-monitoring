// GET /api/wazuh/rules → download file rules Wazuh untuk SSL Monitoring
import { handle } from '@/lib/api';
import { RULES_XML } from '@/lib/wazuh-rules';

export const dynamic = 'force-dynamic';
export const GET = handle(async () => new Response(RULES_XML, {
  headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="ssl_monitoring_rules.xml"' },
}), { access: 'admin' });
