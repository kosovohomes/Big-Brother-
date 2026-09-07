-- =====================================================================
-- Phase A (A4.3) 901_rollback.sql — reverse order: grants/functions →
-- policies → tables → database objects. The storage flag
-- (STORAGE_BACKEND=sqlite) is the OPERATIONAL rollback; this file is the
-- DDL-level rollback for a clean teardown.
-- =====================================================================

\connect bigbrother

DROP FUNCTION IF EXISTS app_notify(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_execute_delete(TEXT, TEXT);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_encryption_keys','notifications','billing_events','audit_logs','consents',
    'feedbacks','acknowledgments','pack_drafts','deadlines','documents',
    'case_events','cases','legal_provisions','memberships','users','organizations'
  ] LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', t);
  END LOOP;
END $$;
