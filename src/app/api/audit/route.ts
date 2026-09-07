import { NextRequest } from 'next/server';
import {json, requireOrg, forbidden, withOrg } from '@/lib/api-helpers';
import { getDriver } from '@/lib/db';

// GET /api/audit — full audit logs for data access and exports (PRD 6.7).
// Tenant-scoped; readable by OWNER/ADMIN/LAWYER. Append-only under RLS (P12).
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (!['OWNER', 'ADMIN', 'LAWYER'].includes(guard.role)) return forbidden();
  const d = await getDriver();
  const rows = await d.prepare(
    'SELECT id, org_id, user_id, at, action, detail FROM audit_logs WHERE org_id = ? ORDER BY at DESC LIMIT 200'
  ).all(guard.ctx.orgId) as { id: string; org_id: string; user_id: string; at: string; action: string; detail: string }[];
  return json({
    logs: rows.map(r => ({ id: r.id, orgId: r.org_id, userId: r.user_id, at: r.at, action: r.action, detail: r.detail }))
  });

});
