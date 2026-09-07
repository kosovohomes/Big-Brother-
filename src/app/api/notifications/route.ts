import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, withOrg } from '@/lib/api-helpers';
import { syncDeadlineReminders, listNotifications, unreadCount, markRead } from '@/lib/notifications';

// GET /api/notifications — the signed-in member's inbox for the active org.
// Reading the inbox is itself the refresh trigger: deadline reminders are
// materialized here (idempotent via dedupe_key), so no cron is needed.
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const created = await syncDeadlineReminders(guard.ctx.uid, guard.ctx.orgId);
  return json({
    notifications: await listNotifications(guard.ctx.uid, guard.ctx.orgId),
    unread: await unreadCount(guard.ctx.uid, guard.ctx.orgId),
    newlyDerived: created
  });

});

// POST /api/notifications — mark one ({ id }) or all ({ all: true }) as read.
// Recipient-scoped: a member can only ever touch their own rows.
export const POST = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const body = await readJson<{ id?: string; all?: boolean }>(req);
  const changed = await markRead(guard.ctx.uid, guard.ctx.orgId, body.all ? undefined : body.id);
  return json({ ok: true, marked: changed, unread: await unreadCount(guard.ctx.uid, guard.ctx.orgId) });

});
