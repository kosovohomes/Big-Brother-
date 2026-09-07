-- =====================================================================
-- Phase A (A4.3) 004_rls_policies.sql — P1..P15 (PHASE_A_SPEC A2.1).
-- Missing-GUC semantics: every policy uses current_setting('app.org_id',
-- true) (no-throw) — an unset GUC yields a NULL comparison → zero rows,
-- i.e. FAIL-CLOSED (verified by e2e PA-04).
-- Execution order note: run as bb_migrator BEFORE granting bb_app its DML
-- (006); FORCE makes even the table owner constrained — bb_migrator keeps
-- access only via its BYPASSRLS attribute (DDL/migration windows).
-- =====================================================================

-- P1 organizations: visible if it is the active org OR I hold any membership
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_read ON organizations FOR SELECT USING (
  id = current_setting('app.org_id', true)
  OR EXISTS (SELECT 1 FROM memberships m
             WHERE m.org_id = organizations.id
               AND m.user_id = current_setting('app.user_id', true)));
CREATE POLICY org_update ON organizations FOR UPDATE USING (
  id = current_setting('app.org_id', true)
  AND current_setting('app.role', true) IN ('OWNER','ADMIN'));

-- P2 memberships: my memberships across orgs (switch-org) + all memberships
-- of the active org (reviewer fan-out)
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memb_read ON memberships FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  OR user_id = current_setting('app.user_id', true));

-- P3 users: my own row + people I share an org with (review queues)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY user_read ON users FOR SELECT USING (
  id = current_setting('app.user_id', true)
  OR EXISTS (SELECT 1 FROM memberships a JOIN memberships b
             ON a.org_id = b.org_id
             WHERE a.user_id = current_setting('app.user_id', true)
               AND b.user_id = users.id));
-- no INSERT/UPDATE/DELETE policy for bb_app → writes go through bb_system
-- (registration, logout revocation, deletion scheduling) — audited.

-- P4 cases: direct org equality (anchor table; app-layer re-checks remain — C-A4)
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;
CREATE POLICY case_all ON cases FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P5-P7 case children WITHOUT org_id column: EXISTS-through-parent
ALTER TABLE case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ev_all ON case_events FOR ALL USING (
  EXISTS (SELECT 1 FROM cases c WHERE c.id = case_events.case_id
          AND c.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM cases c WHERE c.id = case_events.case_id
          AND c.org_id = current_setting('app.org_id', true)));

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_all ON documents FOR ALL USING (
  EXISTS (SELECT 1 FROM cases c WHERE c.id = documents.case_id
          AND c.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM cases c WHERE c.id = documents.case_id
          AND c.org_id = current_setting('app.org_id', true)));

ALTER TABLE deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE deadlines FORCE ROW LEVEL SECURITY;
CREATE POLICY dl_all ON deadlines FOR ALL USING (
  EXISTS (SELECT 1 FROM cases c WHERE c.id = deadlines.case_id
          AND c.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM cases c WHERE c.id = deadlines.case_id
          AND c.org_id = current_setting('app.org_id', true)));

-- P8 feedbacks: EXISTS-through-parent
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedbacks FORCE ROW LEVEL SECURITY;
CREATE POLICY fb_all ON feedbacks FOR ALL USING (
  EXISTS (SELECT 1 FROM cases c WHERE c.id = feedbacks.case_id
          AND c.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM cases c WHERE c.id = feedbacks.case_id
          AND c.org_id = current_setting('app.org_id', true)));

-- P9 pack_drafts: carries its own org_id → direct equality
ALTER TABLE pack_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY draft_all ON pack_drafts FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P10 notifications: doubly scoped — org AND recipient (per-user inbox)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notif_all ON notifications FOR ALL USING (
  org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true));

-- P11 billing_events: direct org equality
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY bill_all ON billing_events FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P12 audit_logs: org rows only for tenant GUCs; NULL-org system rows are
-- invisible to tenants (C-A3). No UPDATE/DELETE policy → append-only.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT
  USING (org_id = current_setting('app.org_id', true));
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P13 legal_provisions: GLOBAL corpus (C-A9) — authenticated read only
ALTER TABLE legal_provisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prov_read ON legal_provisions FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL);

-- P14 acknowledgments / consents: personal evidence — user-scoped
ALTER TABLE acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE acknowledgments FORCE ROW LEVEL SECURITY;
CREATE POLICY ack_all ON acknowledgments FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_all ON consents FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

-- P15 org_encryption_keys: NEVER readable by bb_app at all (006 revokes);
-- crypto.ts touches it only under bb_system.
ALTER TABLE org_encryption_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_encryption_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY oek_system_only ON org_encryption_keys FOR SELECT
  USING (current_setting('app.role', true) = '__system_never__'); -- effectively deny-all for GUC paths
