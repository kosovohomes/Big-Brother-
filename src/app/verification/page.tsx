'use client';

// /verification — Phase 0 citation-audit queue (Task 13-c).
// Lawyer-only actions; every signed-in member can view (transparency).
// Sessions/roles come from the same cookie as the main app (AppShell).

import { VerificationQueue } from '@/components/app/VerificationQueue';

export default function VerificationPage() {
  return <VerificationQueue />;
}
