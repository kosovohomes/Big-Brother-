-- =====================================================================
-- Phase A (A4.3) 003_indexes.sql — supporting indexes for the RLS
-- EXISTS-through-parent probes (P5-P8) so tenant scoping is an index
-- scan, plus the join paths requireOrg uses.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_memb_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memb_org  ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_cases_org ON cases(org_id);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id);
CREATE INDEX IF NOT EXISTS idx_docs_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_case ON deadlines(case_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_case ON feedbacks(case_id);
CREATE INDEX IF NOT EXISTS idx_drafts_org ON pack_drafts(org_id);
CREATE INDEX IF NOT EXISTS idx_notif_org_user ON notifications(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_orgs_stripe_sub ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
