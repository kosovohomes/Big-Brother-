import type { NextConfig } from "next";

// Security-headers baseline (Task 17 audit). Declarative next.config headers
// (no middleware → prerendered pages stay cacheable). CSP is source-restricted
// but ships 'unsafe-inline' for scripts/styles because Next.js App Router
// hydration + React inline styles need it on statically prerendered routes
// (nonce-based CSP would force dynamic rendering; documented as the upgrade
// path in worklog task 17).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://z-cdn.chatglm.cn", // favicon CDN (layout.tsx metadata.icons)
  "font-src 'self' data:",
  // Convex real-time client: fetch + WebSocket to the deployment + site origin
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site wss://*.convex.site",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests"
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // belt-and-suspenders for legacy UAs; modern browsers use frame-ancestors
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" }
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Ship the seeded SQLite corpus inside serverless bundles (Vercel):
  // src/lib/sqlite.mjs resolves data/big-brother.db at runtime and mirrors it
  // into /tmp on read-only platforms (see resolveDbPath()).
  outputFileTracingIncludes: {
    "/**": ["./data/big-brother.db"],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS
      },
      {
        // API responses must never be cached by browsers or intermediaries —
        // they carry tenant-scoped data (and error bodies). Applied after the
        // general block so it wins on overlap.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }]
      }
    ];
  }
};

export default nextConfig;
