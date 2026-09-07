// Billing & plans (Stage 5) — FREE vs PRO, capacity limits, Stripe-ready.
//
// Design principles:
//  - SAFETY FIRST: safety/compliance features (Phase 0 audit transparency,
//    acknowledgment gates, evidence sealing, data export/delete, UPL banners)
//    are NEVER gated. Plans only limit CAPACITY and COLLABORATION volume.
//  - ZERO-DEP STRIPE: when STRIPE_SECRET_KEY is set, checkout sessions are
//    created via the Stripe REST API with fetch and webhooks are verified
//    with HMAC-SHA256 (node:crypto) — no SDK dependency required.
//  - DEMO MODE: without Stripe keys, upgrading a workspace activates PRO
//    immediately and records a billing event, so the full billing lifecycle
//    is testable end-to-end (and swappable to real Stripe by adding keys).

import { createHmac, timingSafeEqual } from 'node:crypto';

export type PlanId = 'FREE' | 'PRO';
export type LimitKey = 'maxActiveCases' | 'maxDocsPerCase' | 'maxMembers' | 'monthlyAnalysisRuns';

export interface PlanDef {
  id: PlanId;
  nameAr: string; nameEn: string;
  priceKwd: number;
  limits: Record<LimitKey, number>;
  featuresAr: string[]; featuresEn: string[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  FREE: {
    id: 'FREE', nameAr: 'المجانية', nameEn: 'Free', priceKwd: 0,
    limits: { maxActiveCases: 3, maxDocsPerCase: 5, maxMembers: 1, monthlyAnalysisRuns: 30 },
    featuresAr: [
      'حتى 3 قضايا نشطة لكل مساحة عمل',
      'حتى 5 مستندات مختومة لكل قضية',
      'مساحة عمل فردية (عضو واحد)',
      'حتى 30 تحليلًا إجرائيًا شهريًا',
      'جميع ميزات السلامة والامتثال متاحة دائمًا'
    ],
    featuresEn: [
      'Up to 3 active cases per workspace',
      'Up to 5 sealed documents per case',
      'Solo workspace (1 member)',
      'Up to 30 procedural analyses per month',
      'All safety & compliance features always included'
    ]
  },
  PRO: {
    id: 'PRO', nameAr: 'الاحترافية', nameEn: 'Pro', priceKwd: 9,
    limits: { maxActiveCases: 50, maxDocsPerCase: 100, maxMembers: 25, monthlyAnalysisRuns: 2000 },
    featuresAr: [
      'حتى 50 قضية نشطة لكل مساحة عمل',
      'حتى 100 مستند مختوم لكل قضية',
      'فرق العمل: حتى 25 عضوًا (منظمات غير حكومية ومكاتب المحاماة)',
      'حتى 2000 تحليل إجرائي شهريًا',
      'طابور مراجعة المنظمات بسعة أعلى وأولوية الدعم'
    ],
    featuresEn: [
      'Up to 50 active cases per workspace',
      'Up to 100 sealed documents per case',
      'Teams: up to 25 members (NGOs & law firms)',
      'Up to 2,000 procedural analyses per month',
      'Higher-capacity NGO review queue & priority support'
    ]
  }
};

export const LIMITS_AR: Record<LimitKey, string> = {
  maxActiveCases: 'القضايا النشطة',
  maxDocsPerCase: 'المستندات لكل قضية',
  maxMembers: 'أعضاء مساحة العمل',
  monthlyAnalysisRuns: 'التحليلات الشهرية'
};
export const LIMITS_EN: Record<LimitKey, string> = {
  maxActiveCases: 'Active cases',
  maxDocsPerCase: 'Documents per case',
  maxMembers: 'Workspace members',
  monthlyAnalysisRuns: 'Monthly analyses'
};

export const isPlanId = (v: unknown): v is PlanId => v === 'FREE' || v === 'PRO';

// ---------- Stripe (REST, no SDK) ----------
export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

export interface CheckoutResult {
  mode: 'stripe' | 'demo';
  url?: string;      // stripe: redirect URL; demo: undefined
  activated?: boolean; // demo: PRO activated immediately
}

/**
 * Create a Stripe Checkout Session (subscription mode) via the REST API.
 * orgId travels in metadata so checkout.session.completed can be attributed
 * to the right workspace without relying on client state.
 */
export async function createStripeCheckout(opts: {
  orgId: string; orgName: string; email: string; origin: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = process.env.STRIPE_SECRET_KEY!;
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) return { ok: false, error: 'STRIPE_PRICE_ID is not configured' };
  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    customer_email: opts.email,
    success_url: `${opts.origin}/?billing=success`,
    cancel_url: `${opts.origin}/?billing=cancelled`,
    'metadata[orgId]': opts.orgId,
    'subscription_data[metadata][orgId]': opts.orgId,
    client_reference_id: opts.orgId
  });
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const data = await res.json() as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error?.message || `stripe_error_${res.status}` };
    }
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: `stripe_unreachable: ${String(e)}` };
  }
}

/**
 * Verify a Stripe webhook signature header (Stripe-Signature: t=...,v1=...).
 * Constant-time comparison; tolerance 5 minutes (Stripe default).
 */
export function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map(p => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
