-- =====================================================================
-- Phase A (A4.3) 006_grants.sql — minimal DML privileges.
-- RLS policies and GRANTs are independent: BYPASSRLS bypasses POLICIES
-- but not PRIVILEGES. bb_system (operational role) therefore needs its
-- own DML grants; bb_app gets least-privilege access.
-- =====================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','users','memberships','legal_provisions','cases',
    'case_events','documents','deadlines','pack_drafts','acknowledgments',
    'feedbacks','consents','audit_logs','billing_events','notifications'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO bb_system', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO bb_migrator', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON org_encryption_keys TO bb_system;

-- identity sequences (billing_events.seq / notifications.seq)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bb_app, bb_system;

-- bb_app least-privilege tenant access
GRANT SELECT, INSERT, UPDATE, DELETE ON cases            TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON case_events      TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents        TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON deadlines        TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pack_drafts      TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedbacks        TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications    TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_events   TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON acknowledgments  TO bb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON consents         TO bb_app;
GRANT SELECT ON memberships TO bb_app;                       -- joins go through bb_system
GRANT SELECT, UPDATE ON organizations TO bb_app;             -- org_update policy limits to OWNER/ADMIN
GRANT SELECT ON users TO bb_app;                             -- user_read policy limits to own/shared rows
GRANT SELECT, INSERT ON audit_logs TO bb_app;                -- append-only: no UPDATE/DELETE
GRANT SELECT ON legal_provisions TO bb_app;                  -- global corpus (P13)

-- P15: encryption keys are invisible to the app role
REVOKE ALL ON org_encryption_keys FROM bb_app;

GRANT EXECUTE ON FUNCTION app_execute_delete(TEXT, TEXT) TO bb_system;
GRANT EXECUTE ON FUNCTION app_notify(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO bb_system, bb_app;
