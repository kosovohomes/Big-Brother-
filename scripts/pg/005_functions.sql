-- =====================================================================
-- Phase A (A4.3) 005_functions.sql — SECURITY DEFINER functions
-- (owned by bb_migrator/BYPASSRLS). Preferred pg-native pattern for
-- system operations; the application's withSystemCtx() paths are the
-- operational equivalent. app_execute_delete is used by the reaper
-- (scripts/reaper.mjs) for an atomic shred+redact+purge transaction.
-- =====================================================================

CREATE OR REPLACE FUNCTION app_execute_delete(p_org_id TEXT, p_user_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shredded INT := 0;
BEGIN
  -- A2.4 unified deletion (org-level when p_user_id IS NULL, else user-level):
  -- 1. revoke access: every session issued before now dies (C-A7)
  IF p_user_id IS NOT NULL THEN
    UPDATE users SET sessions_invalid_before = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    WHERE id = p_user_id;
  END IF;

  -- 2. crypto-shred: destroy every org DEK → all GCM ciphertext (and SSE-C
  --    object bytes sealed under DEK-derived keys) becomes unrecoverable
  UPDATE org_encryption_keys
     SET state = 'destroyed',
         wrapped_dek = encode(gen_random_bytes(64), 'base64'),
         destroyed_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   WHERE org_id = p_org_id AND state <> 'destroyed';
  GET DIAGNOSTICS v_shredded = ROW_COUNT;

  -- 3. purge workspace rows (mirrors the existing workspace purge, org-wide)
  DELETE FROM cases      WHERE org_id = p_org_id;
  DELETE FROM pack_drafts WHERE org_id = p_org_id;

  -- 4. redact user PII for account deletion (skeleton: ids + timestamps)
  IF p_user_id IS NOT NULL THEN
    UPDATE users SET name = 'deleted', password_hash = 'deleted', email = 'deleted-' || id || '@invalid'
    WHERE id = p_user_id;
  END IF;

  -- 5. append-only audit trail survives (P12) — details carry ids only (C-A3 redaction)
  INSERT INTO audit_logs (id, org_id, user_id, at, action, detail)
  VALUES (gen_random_uuid()::text, p_org_id, p_user_id,
          to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'data.delete.completed',
          'org=' || p_org_id || ' user=' || COALESCE(p_user_id, 'all') || ' shreddedKeys=' || v_shredded);

  RETURN 'ok shreddedKeys=' || v_shredded;
END;
$$;

CREATE OR REPLACE FUNCTION app_notify(p_user_id TEXT, p_org_id TEXT, p_type TEXT, p_dedupe_key TEXT,
                                      p_title_ar TEXT, p_title_en TEXT, p_urgency TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notifications (id, org_id, user_id, type, dedupe_key, title_ar, title_en, urgency, created_at)
  SELECT gen_random_uuid()::text, p_org_id, p_user_id, p_type, p_dedupe_key, p_title_ar, p_title_en, p_urgency,
         to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  WHERE NOT EXISTS (SELECT 1 FROM notifications n
                    WHERE n.user_id = p_user_id AND n.dedupe_key = p_dedupe_key)
  RETURNING id;
$$;
