-- =====================================================================
-- Phase A (A4.3) 001_schemas_roles.sql
-- Role model (PHASE_A_SPEC A2.1):
--   bb_migrator — BYPASSRLS; owns tables + SECURITY DEFINER functions;
--                 runs scripts/pg/*.sql and the dump-restore migration.
--   bb_app      — NOBYPASSRLS; every HTTP tenant flow. Sees only rows the
--                 request GUCs (app.org_id / app.user_id / app.role) allow;
--                 unset GUCs = zero rows (fail-closed).
--   bb_system   — operational actor for named server-side code paths only
--                 (webhook C-A8, reaper, seed, auth registration/login lookup,
--                 cross-user notification fan-out). BYPASSRLS is the operational
--                 equivalent of the spec's SECURITY DEFINER layer; every use
--                 is a named call site wrapped in withSystemCtx() and audited.
--                 Tenant (bb_app) flows NEVER run under bb_system.
-- =====================================================================

-- idempotent role creation
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bb_migrator') THEN
    CREATE ROLE bb_migrator LOGIN BYPASSRLS PASSWORD NULL;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bb_app') THEN
    CREATE ROLE bb_app LOGIN NOBYPASSRLS PASSWORD NULL;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bb_system') THEN
    CREATE ROLE bb_system LOGIN BYPASSRLS PASSWORD NULL;
  END IF;
END
$$;

-- Database creation: docker-compose (POSTGRES_DB=bigbrother) or the setup
-- script (scripts/pg/setup-embedded.mjs) creates it — CREATE DATABASE cannot
-- run inside this file/transaction when applied via a driver.
-- NOTE: when applying via a driver (node-pg), connect to `bigbrother`
-- after this role block before running 002..006.
GRANT ALL ON SCHEMA public TO bb_migrator;
GRANT USAGE ON SCHEMA public TO bb_app, bb_system;
