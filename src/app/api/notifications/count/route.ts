import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { syncDeadlineReminders, unreadCount } from '@/lib/notifications';

// GET /api/notifications/count — lightweight badge poll for the header bell.
// Runs the same idempotent reminder sync so the badge stays accurate even
// between inbox opens.
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  await syncDeadlineReminders(guard.ctx.uid, guard.ctx.orgId);
  return json({ unread: await unreadCount(guard.ctx.uid, guard.ctx.orgId) });

});
