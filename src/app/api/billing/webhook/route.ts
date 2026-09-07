import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { getOrgById, setOrgPlan, getOrgByStripeSubscription, audit } from '@/lib/db';
import { verifyStripeSignature } from '@/lib/billing';
import { withSystemCtx, getDriver } from '@/lib/storage';

// POST /api/billing/webhook — Stripe webhook receiver (subscription lifecycle).
// Signature-verified (Stripe-Signature header, HMAC-SHA256, 5-min tolerance)
// and idempotent: every handled event id is stored as the billing_events.ref,
// so Stripe retries never double-apply.
//
// Phase A (C-A8): the webhook is a legitimate cross-tenant SYSTEM actor — it
// has no session and writes to organizations chosen by signature-verified
// Stripe metadata. All its statements run in the system scope (bb_system on
// Postgres); cross-org replay is covered by e2e T-20.
//
// Handled events:
//  - checkout.session.completed        -> activate PRO for metadata.orgId
//  - customer.subscription.updated     -> sync status (active / past_due)
//  - customer.subscription.deleted     -> downgrade to FREE
//
// Requires STRIPE_WEBHOOK_SECRET; otherwise responds 503 (webhook disabled).
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'webhook not configured (set STRIPE_WEBHOOK_SECRET)' }, 503);

  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), secret)) {
    return json({ error: 'invalid signature' }, 400);
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'invalid payload' }, 400);
  }
  if (!event.id || !event.type) return json({ error: 'invalid event' }, 400);

  const obj = event.data?.object ?? {};

  const orgIdFrom = (o: Record<string, unknown>): string | null => {
    const md = (o.metadata ?? {}) as Record<string, string>;
    if (md.orgId) return md.orgId;
    if (typeof o.client_reference_id === 'string' && o.client_reference_id) return o.client_reference_id;
    return null;
  };

  const subscriptionStatus = (o: Record<string, unknown>): string | null =>
    typeof o.status === 'string' ? o.status : null;

  return withSystemCtx(async () => {
    // Idempotency gate (T-20): an event id that was already applied is a no-op
    // — replaying the same Stripe event with rewritten metadata must never
    // mutate another org (ledger row insert is guarded by the unique ref too).
    if (event.id) {
      const d = await getDriver();
      const seen = await d.prepare('SELECT id FROM billing_events WHERE ref = ?').get(event.id);
      if (seen) return json({ ok: true, ignored: 'duplicate event id (already applied — no-op)' });
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const orgId = orgIdFrom(obj);
        if (!orgId || !(await getOrgById(orgId))) return json({ ok: true, ignored: 'unknown org' });
        const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
        await setOrgPlan(orgId, 'PRO', {
          status: 'active',
          renewsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          stripeSubscriptionId: subId,
          kind: `webhook.${event.type}`,
          detail: 'stripe checkout completed — PRO activated',
          ref: event.id
        });
        break;
      }
      case 'customer.subscription.updated': {
        const orgId = orgIdFrom(obj) ||
          (typeof obj.id === 'string' ? (await getOrgByStripeSubscription(obj.id))?.id ?? null : null);
        if (!orgId) return json({ ok: true, ignored: 'unknown subscription' });
        const status = subscriptionStatus(obj) ?? 'active';
        if (status === 'active' || status === 'trialing') {
          await setOrgPlan(orgId, 'PRO', {
            status: 'active', kind: `webhook.${event.type}`,
            detail: `stripe subscription status: ${status}`, ref: event.id
          });
        } else {
          await setOrgPlan(orgId, 'FREE', {
            status: status === 'past_due' ? 'past_due' : 'canceled',
            kind: `webhook.${event.type}`,
            detail: `stripe subscription status: ${status}`, ref: event.id
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const orgId = orgIdFrom(obj) ||
          (typeof obj.id === 'string' ? (await getOrgByStripeSubscription(obj.id))?.id ?? null : null);
        if (!orgId) return json({ ok: true, ignored: 'unknown subscription' });
        await setOrgPlan(orgId, 'FREE', {
          status: 'canceled', renewsAt: null,
          kind: `webhook.${event.type}`,
          detail: 'stripe subscription canceled — downgraded to FREE, data retained',
          ref: event.id
        });
        break;
      }
      default:
        return json({ ok: true, ignored: event.type });
    }
    await audit('billing.webhook.handled', `${event.type} (${event.id})`, orgIdFrom(obj), null);
    return json({ ok: true });
  });
}
