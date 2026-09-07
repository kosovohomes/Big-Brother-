import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, forbidden, withOrg } from '@/lib/api-helpers';
import { setOrgPlan } from '@/lib/db';
import { PLANS, isPlanId, stripeConfigured, createStripeCheckout } from '@/lib/billing';

// POST /api/billing/checkout — start an upgrade to PRO for the ACTIVE workspace.
//  - Stripe configured (STRIPE_SECRET_KEY): creates a real Checkout Session
//    and returns { mode:'stripe', url } — the client redirects to Stripe.
//    The subscription is activated by the /api/billing/webhook handler.
//  - Demo mode (no keys): activates PRO immediately (30-day period) so the
//    full billing lifecycle is usable without external dependencies.
// OWNER/ADMIN only. Downgrades: POST /api/billing/cancel.
export const POST = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (guard.role !== 'OWNER' && guard.role !== 'ADMIN') return forbidden();

  const { plan } = await readJson<{ plan?: string }>(req);
  if (!isPlanId(plan) || plan === 'FREE') {
    return json({ error: 'plan must be "PRO" (downgrades use /api/billing/cancel)' }, 400);
  }

  const renewsAt = new Date(Date.now() + 30 * 86400000).toISOString();

  if (stripeConfigured()) {
    const origin = req.headers.get('origin') || new URL(req.url).origin;
    const session = await createStripeCheckout({
      orgId: guard.ctx.orgId,
      orgName: guard.ctx.name,
      email: guard.ctx.email,
      origin
    });
    if (!session.ok) return json({ error: session.error }, 502);
    return json({ mode: 'stripe' as const, url: session.url });
  }

  // Demo mode: instant activation + billing ledger entry + audit trail.
  const org = await setOrgPlan(guard.ctx.orgId, 'PRO', {
    status: 'active',
    renewsAt,
    kind: 'upgrade',
    detail: `demo checkout — ${PLANS.PRO.priceKwd} KWD/month, renews ${renewsAt.slice(0, 10)}`,
    actor: guard.ctx.uid
  });
  return json({ mode: 'demo' as const, activated: true, org });

});
