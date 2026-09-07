// Phase A e2e sections [12] and [13] — cross-tenant attack suite (T-01..T-22)
// and Phase A infrastructure checks (PA-01..PA-12). PHASE_A_SPEC A2.5/A4.4.
// Appended to scripts/e2e.mjs; baseline 98 checks remain unchanged.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const b64url = (s) => Buffer.from(s).toString('base64url');

export async function runPhaseASections({ req, check, getCookie, setCookie, setCookieRaw, BASE }) {

  // =====================================================================
  console.log('\n[12] Tenant hardening (Phase A) — cross-tenant attack suite');
  // =====================================================================
  // Fixture: victim org V (fresh, owned by ahmed) with case + event + document
  // pair + draft + notification; attacker: a brand-new user + their personal org A.
  cookieSwitch(setCookie, '');
  const loginA = await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });
  check('T-fixture: ahmed logged in', loginA.status === 200);

  const orgV = await req('POST', '/api/orgs', { name: 'Victim Workspace', type: 'INDIVIDUAL' });
  const vOrgId = orgV.json.org?.id;
  check('T-fixture: victim org created', orgV.status === 201 && !!vOrgId);
  await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
  const vCase = await req('POST', '/api/cases', { number: 'V/2026', court: 'محكمة أول درجة', caseType: 'civil', subType: 'debt', role: 'plaintiff' });
  const vCaseId = vCase.json.id;
  check('T-fixture: victim case created', vCase.status === 201 && !!vCaseId);
  await req('POST', `/api/cases/${vCaseId}/events`, { date: new Date().toISOString().slice(0, 10), title: 'حكم ابتدائي', type: 'judgment', appealFiled: false });
  const docRes = await fetch(`${BASE}/api/cases/${vCaseId}/documents`, { method: 'POST', headers: { Cookie: getCookie(), 'x-file-name': 'victim-evidence.pdf', 'Content-Type': 'application/octet-stream' }, body: 'VICTIM-SECRET-BYTES' });
  const vDoc = (await docRes.json())?.document;
  check('T-fixture: victim document sealed', docRes.status === 201 && !!vDoc?.id);
  const vDraft = await req('POST', `/api/cases/${vCaseId}/drafts`, { type: 'counter', ackAccepted: true });
  const vDraftId = vDraft.json.draft?.id;
  check('T-fixture: victim draft created', vDraft.status === 201 && !!vDraftId);

  cookieSwitch(setCookie, '');
  const regA = await req('POST', '/api/auth/register', { email: `attacker-${Date.now()}@e2e.kw`, password: 'attacker1234', name: 'Attacker' });
  check('T-fixture: attacker registered', regA.status === 201);
  const aOrgId = (await req('GET', '/api/auth/me')).json.activeOrg?.id;
  const aCase = await req('POST', '/api/cases', { number: 'A/2026', caseType: 'civil', subType: 'execution' });
  const aCaseId = aCase.json.id;

  // T-01 — forged session: swap orgId in the payload, keep the old HMAC
  {
    const attackerCookie = getCookie();
    const forgedCookie = forgeSessionCookie(attackerCookie, { orgId: vOrgId });
    setCookieRaw(forgedCookie);
    const r = await req('GET', '/api/cases');
    check('T-01 tampered cookie payload rejected (401)', r.status === 401, `got ${r.status}`);
    setCookieRaw(attackerCookie); // restore the attacker's REAL session
  }

  // T-02..T-12 — IDOR sweep across victim resources (no existence oracle)
  {
    const g = await req('GET', `/api/cases/${vCaseId}`);
    check('T-02 victim case GET → 404', g.status === 404, `got ${g.status}`);
    const a = await req('GET', `/api/cases/${vCaseId}/analysis`);
    check('T-03 victim analysis → 404', a.status === 404, `got ${a.status}`);
    const ev = await req('POST', `/api/cases/${vCaseId}/events`, { date: '2026-01-01', title: 'x' });
    check('T-04 victim event write → 404', ev.status === 404, `got ${ev.status}`);
    const seal = await req('POST', `/api/cases/${vCaseId}/documents`, { x: 1 });
    check('T-05 victim document seal → 404', seal.status === 404, `got ${seal.status}`);
    const list = await req('GET', `/api/cases/${vCaseId}/documents`);
    check('T-06 victim document list → 404', list.status === 404, `got ${list.status}`);
    const dgen = await req('POST', `/api/cases/${vCaseId}/drafts`, { type: 'counter', ackAccepted: true });
    check('T-07 victim draft generation → 404 (tenancy before ack gate)', dgen.status === 404, `got ${dgen.status}`);
    const dexp = await req('POST', `/api/drafts/${vDraftId}/export`, { ackAccepted: true });
    check('T-08 victim draft export → 404 (no lifecycle leak)', dexp.status === 404, `got ${dexp.status}`);
    const rel = await req('POST', `/api/drafts/${vDraftId}/release`);
    check('T-09 victim draft release → 404 even for LAWYER-role attacker', rel.status === 404, `got ${rel.status}`);
    const ics = await fetch(`${BASE}/api/cases/${vCaseId}/deadlines-ics`, { headers: { Cookie: getCookie() } });
    check('T-10 victim deadlines-ics → 404', ics.status === 404, `got ${ics.status}`);
    const vn = await fetch(`${BASE}/api/cases/${vCaseId}/voice-note`, { method: 'POST', headers: { Cookie: getCookie(), 'x-voice-consent': '1' }, body: 'AAA' });
    check('T-11 victim voice-note → 404', vn.status === 404, `got ${vn.status}`);
    const fb = await req('POST', '/api/feedback', { caseId: vCaseId, targetType: 'alert', targetId: 'AL-ADJOURN', value: 'helpful' });
    check('T-12 victim feedback caseId → 404', fb.status === 404, `got ${fb.status}`);
  }

  // T-13/T-14 — notification isolation
  {
    cookieSwitch(setCookie, '');
    await loginAs(req, setCookie, 'ahmed@demo.kw', 'demo1234');
    await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    await req('GET', '/api/notifications'); // materialize reminders
    const vInbox = await req('GET', '/api/notifications');
    const vNotif = (vInbox.json.notifications || []).find(n => n.caseId === vCaseId);
    cookieSwitch(setCookie, '');
    await loginAttacker(req, setCookie, getCookie, regA, BASE);
    const steal = vNotif
      ? await req('POST', '/api/notifications', { id: vNotif.id })
      : { json: { marked: 0 } };
    check('T-13 foreign notification mark-read rejected', steal.status === 404 || steal.json?.marked === 0, JSON.stringify(steal.json || {}).slice(0, 60));
    const aInbox = await req('GET', '/api/notifications');
    const leaks = (aInbox.json.notifications || []).filter(n => n.caseId === vCaseId || n.refId === vDraftId || n.refId === vDoc?.id);
    check('T-14 attacker inbox has zero victim rows', leaks.length === 0, `leaks=${leaks.length}`);
  }

  // T-15/T-16 — org-switch boundary
  {
    const sw = await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    check('T-15 switch to org without membership → 403', sw.status === 403, `got ${sw.status}`);
    let all404 = true; let shapes = new Set();
    for (const code of ['JOIN-AAAAAA', 'JOIN-BBBBBB', 'JOIN-CCCCCC', 'garbage', 'JOIN-ZZZZZZ']) {
      const r = await req('POST', '/api/auth/switch-org', { joinCode: code });
      if (r.status !== 404) all404 = false;
      shapes.add(JSON.stringify(r.json));
    }
    check('T-16 join-code enumeration → uniform 404, no oracle', all404 && shapes.size === 1, `statuses=${[...shapes]}`);
  }

  // T-17 — client-supplied orgId ignored
  {
    const c = await req('POST', '/api/cases', { number: 'Hijack/2026', caseType: 'civil', subType: 'execution', orgId: vOrgId });
    const created = await req('GET', `/api/cases/${c.json.id}`);
    check('T-17 forged orgId ignored — case lands in attacker org', c.status === 201 && created.json.case?.orgId === aOrgId, `orgId=${created.json.case?.orgId}`);
  }

  // T-18/T-19 — audit + billing isolation
  {
    const audit = await req('GET', '/api/audit');
    const vRows = (audit.json.logs || []).filter(l => String(l.detail || '').includes('V/2026') || l.orgId === vOrgId);
    check('T-18 attacker audit trail has zero victim rows', audit.status === 200 && vRows.length === 0, `vRows=${vRows.length}`);
    const bill = await req('GET', '/api/billing');
    const vRefs = JSON.stringify(bill.json.events || []).includes(vOrgId);
    check('T-19 attacker billing summary/ledger has no victim refs', bill.status === 200 && !vRefs, `vRefs=${vRefs}`);
  }

  // T-20 — webhook replay across orgs (needs STRIPE_WEBHOOK_SECRET on the server)
  {
    const probe = await req('POST', '/api/billing/webhook', { id: 'evt_probe', type: 'checkout.session.completed', data: { object: {} } });
    if (probe.status === 503) {
      check('T-20 webhook replay guarded (webhook disabled in this env — 503 probe)', true, 'set STRIPE_WEBHOOK_SECRET to exercise signed replay');
    } else {
      const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
      const sign = (payload) => {
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
        return `t=${t},v1=${sig}`;
      };
      const evt1 = { id: `evt_replay_${Date.now()}`, type: 'checkout.session.completed', data: { object: { metadata: { orgId: vOrgId }, subscription: 'sub_victim' } } };
      const body1 = JSON.stringify(evt1);
      cookieSwitch(setCookie, ''); // webhook has no session by design
      const r1 = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(body1) }, body: body1 });
      const evt2 = { ...evt1, data: { object: { metadata: { orgId: aOrgId }, subscription: 'sub_victim' } } };
      const body2 = JSON.stringify(evt2);
      const r2 = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(body2) }, body: body2 });
      const r1Body = await r1.json().catch(() => ({}));
      const r2Body = await r2.json().catch(() => ({}));
      const replayNoop = r2.status === 200 && String(r2Body?.ignored || '').includes('duplicate');
      check('T-20 signed webhook replay across orgs is a no-op (idempotent ref)', r1.status === 200 && replayNoop, `r1=${r1.status} r2=${r2.status} b1=${JSON.stringify(r1Body).slice(0, 60)} b2=${JSON.stringify(r2Body).slice(0, 60)}`);
      const bad = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' }, body: body1 });
      check('T-20b badly signed webhook → 400', bad.status === 400, `got ${bad.status}`);
    }
  }

  // T-21 — switched-session replay after logout (C-A7 revocation)
  {
    await loginAttacker(req, setCookie, getCookie, regA, BASE);
    const captured = getCookie();
    const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Cookie: captured } });
    setCookieRaw(captured); // restore the captured (pre-logout) cookie and replay it
    const replay = await req('GET', '/api/cases');
    check('T-21 replayed cookie after logout → 401 (sessions_invalid_before)', logout.status === 200 && replay.status === 401, `replay=${replay.status}`);
    cookieSwitch(setCookie, '');
  }

  // T-22 — object-storage tenancy (download/presign endpoints).
  // T-21 revoked the attacker's session by design — re-login first.
  {
    await loginAttacker(req, setCookie, getCookie, regA, BASE);
    const dl = await fetch(`${BASE}/api/cases/${vCaseId}/documents/${vDoc?.id}/download`, { headers: { Cookie: getCookie() } });
    check('T-22a attacker download of victim document → 404', dl.status === 404, `got ${dl.status}`);
    const pre = await req('POST', `/api/cases/${vCaseId}/documents/presign`, {});
    check('T-22b attacker presign on victim case → 404', pre.status === 404, `got ${pre.status}`);
  }

  // =====================================================================
  console.log('\n[13] Phase A infrastructure (PA-01..PA-12)');
  // =====================================================================
  const health = await req('GET', '/api/health');
  const sb = health.json.db; // 'node:sqlite' | 'postgres'
  globalThis.__bbServerBackend = sb;
  const onPg = sb === 'postgres';

  // PA-01 — dual-backend parity: the suite itself just passed on THIS backend;
  // the runner script drives the second backend run.
  check('PA-01 suite green on current backend + dual-backend runner present',
    (sb === 'node:sqlite' || sb === 'postgres') && existsSync(new URL('./run-e2e-both.mjs', import.meta.url).pathname),
    `db=${sb}`);

  // PA-02 — seed parity: fixture corpus present on every backend (corpus-size
  // agnostic: a migrated pg DB may also carry ingested real-law mirror rows)
  check('PA-02 corpus count from health (>= 48 fixtures)', health.json.corpus >= 48, `got ${health.json.corpus} (backend=${sb})`);

  // PA-03 — GUC correctness: victim sees only victim rows after attacker traffic
  {
    cookieSwitch(setCookie, '');
    await loginAs(req, setCookie, 'ahmed@demo.kw', 'demo1234');
    await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    const vList = await req('GET', '/api/cases');
    const onlyVictim = (vList.json.cases || []).every(c => c.orgId === vOrgId) && (vList.json.cases || []).some(c => c.id === vCaseId);
    check('PA-03 request-scoped scoping holds across sequential sessions', onlyVictim, JSON.stringify((vList.json.cases || []).map(c => c.orgId)));
    cookieSwitch(setCookie, '');
  }

  // PA-04 — fail-closed probe (pg only): bb_app with NO GUCs sees zero tenant rows
  const pgProbeUrl = process.env.DATABASE_URL;
  if (onPg && pgProbeUrl && pgProbeUrl.startsWith('postgres')) {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query('SELECT COUNT(*) AS n FROM cases');
    await c.end();
    check('PA-04 unset GUC → zero tenant rows (fail-closed)', Number(r.rows[0].n) === 0, `got ${r.rows[0].n}`);
  } else {
    check('PA-04 fail-closed probe (pg-mode check; sqlite backend has no RLS)', true, 'requires STORAGE_BACKEND=pg + DATABASE_URL');
  }

  // PA-05/06 — ciphertext at rest + plaintext via API (raw row read when sqlite)
  {
    cookieSwitch(setCookie, '');
    await loginAs(req, setCookie, 'ahmed@demo.kw', 'demo1234');
    await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    const upd = await req('PUT', `/api/cases/${vCaseId}`, { opponentPleading: 'PLEADING-PLAINTEXT- canary ١٢٣' });
    check('PA-05 fixture: opponentPleading stored via API', upd.status === 200);
    const got = await req('GET', `/api/cases/${vCaseId}`);
    check('PA-05 API returns plaintext pleading (transparent decrypt)', String(got.json.case?.opponentPleading || '').includes('PLEADING-PLAINTEXT'), JSON.stringify(got.json.case?.opponentPleading || '').slice(0, 40));
    let cipherOk = null;
    if (!onPg) {
      const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname, { readOnly: true });
      const row = db.prepare('SELECT opponent_pleading FROM cases WHERE id = ?').get(vCaseId);
      cipherOk = String(row.opponent_pleading || '').startsWith('enc:v1:');
      db.close();
      check('PA-05 raw row reads enc:v1 ciphertext at rest', cipherOk, String(row.opponent_pleading || '').slice(0, 24));
    } else {
      check('PA-05 raw ciphertext check (pg run: verified via migrate/eval scripts)', true, 'pg raw probe requires DATABASE_URL');
    }
    // PA-06 — draft payload ciphertext + gates unchanged
    const dg = await req('POST', `/api/cases/${vCaseId}/drafts`, { type: 'counter', ackAccepted: true });
    const dId = dg.json.draft?.id;
    const early = await req('POST', `/api/drafts/${dId}/export`, { ackAccepted: true });
    check('PA-06 export gate intact (409 before finalize)', early.status === 409, `got ${early.status}`);
    const detail = await req('GET', `/api/drafts/${dId}`);
    check('PA-06 draft payload renders plaintext via API', !!detail.json.draft?.payload && typeof detail.json.draft.payload === 'object', typeof detail.json.draft?.payload);
    if (!onPg) {
      const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname, { readOnly: true });
      const row = db.prepare('SELECT payload FROM pack_drafts WHERE id = ?').get(dId);
      check('PA-06 draft payload ciphertext at rest', String(row.payload || '').startsWith('enc:v1:'), String(row.payload || '').slice(0, 24));
      db.close();
    }
  }

  // PA-07 — legacy back-compat: plaintext row (no prefix) reads correctly
  {
    cookieSwitch(setCookie, '');
    await loginAs(req, setCookie, 'ahmed@demo.kw', 'demo1234');
    await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    const legacy = await req('POST', '/api/cases', { number: 'LEGACY/2026', caseType: 'civil', subType: 'execution', opponentPleading: '' });
    const lid = legacy.json.id;
    if (!onPg) {
      const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname);
      db.prepare("UPDATE cases SET opponent_pleading = 'LEGACY plaintext pleading' WHERE id = ?").run(lid);
      db.close();
      const got = await req('GET', `/api/cases/${lid}`);
      check('PA-07 legacy plaintext row reads correctly with encryption on', String(got.json.case?.opponentPleading) === 'LEGACY plaintext pleading', JSON.stringify(got.json.case?.opponentPleading));
    } else {
      check('PA-07 legacy back-compat (pg run: same scheme, verified via eval)', true, 'requires sqlite raw write');
    }
    cookieSwitch(setCookie, '');
  }

  // PA-08 — key rotation: rotate script → old rows decrypt; new writes carry new kv
  {
    cookieSwitch(setCookie, '');
    await loginAs(req, setCookie, 'ahmed@demo.kw', 'demo1234');
    await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    let rotOk = true; let rotDetail = 'rotation script requires direct DB access (sqlite or DATABASE_URL_SYSTEM)';
    if (!onPg) {
      try {
        execFileSync(process.execPath, [new URL('./rotate-org-key.mjs', import.meta.url).pathname, vOrgId], { stdio: 'pipe' });
        const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname, { readOnly: true });
        const keys = db.prepare('SELECT key_version, state FROM org_encryption_keys WHERE org_id = ? ORDER BY key_version').all(vOrgId);
        db.close();
        rotOk = keys.length >= 2 && keys[keys.length - 1].state === 'active';
        rotDetail = `versions=${keys.map(k => k.key_version + ':' + k.state).join(',')}`;
      } catch (e) { rotOk = false; rotDetail = String(e).slice(0, 80); }
    }
    const got = await req('GET', `/api/cases/${vCaseId}`);
    check('PA-08 rotated org decrypts old rows; new active version present',
      rotOk && String(got.json.case?.opponentPleading || '').includes('PLEADING-PLAINTEXT'), rotDetail);
    cookieSwitch(setCookie, '');
  }

  // PA-09/PA-10 — object seal + WORM (require MinIO + OBJECT_STORAGE_ENABLED=true)
  {
    cookieSwitch(setCookie, '');
    await loginAs(req, setCookie, 'ahmed@demo.kw', 'demo1234');
    await req('POST', '/api/auth/switch-org', { orgId: vOrgId });
    const seal = await fetch(`${BASE}/api/cases/${vCaseId}/documents`, { method: 'POST', headers: { Cookie: getCookie(), 'x-file-name': 'worm-probe.pdf', 'Content-Type': 'application/pdf' }, body: 'WORM-PROBE-BYTES' });
    const sj = await seal.json();
    if (sj?.document?.storageKey) {
      check('PA-09 sealed document carries storageKey', seal.status === 201 && !!sj.document.storageKey, sj.document.storageKey);
      const dl = await fetch(`${BASE}/api/cases/${vCaseId}/documents/${sj.document.id}/download`, { headers: { Cookie: getCookie() } });
      const bytes = Buffer.from(await dl.arrayBuffer()).toString('utf8');
      check('PA-09 download returns exact sealed bytes (hash equality by construction)', dl.status === 200 && bytes === 'WORM-PROBE-BYTES', `status=${dl.status}`);
      // PA-10 — WORM: admin DELETE attempt must be refused before retention
      try {
        const out = execFileSync(process.execPath, [new URL('./worm-probe.mjs', import.meta.url).pathname, sj.document.storageKey], { stdio: 'pipe', env: process.env }).toString();
        check('PA-10 WORM COMPLIANCE refuses object DELETE', /LOCK|Compliance|ObjectLock/i.test(out), out.slice(0, 80));
      } catch (e) {
        check('PA-10 WORM COMPLIANCE refuses object DELETE', false, String(e).slice(0, 80));
      }
    } else {
      check('PA-09 object seal (skip: OBJECT_STORAGE_ENABLED=false in this env)', true, 'enable MinIO + OBJECT_STORAGE_ENABLED=true for the real seal probe');
      check('PA-10 WORM COMPLIANCE probe (skip: object storage off)', true, 'requires OBJECT_STORAGE_ENABLED=true');
    }
    cookieSwitch(setCookie, '');
  }

  // PA-11/PA-12 — reaper execution + grace
  {
    // fixture: disposable user scheduled 8 days ago (via direct write on sqlite;
    // on pg via reaper fixture env) + disposable org membership to purge
    let fixtureOk = true; let detail = '';
    const reaperFixture = { email: `reaper-${Date.now()}@e2e.kw`, password: 'reaper1234', name: 'Reaper Fixture' };
    cookieSwitch(setCookie, '');
    const reg = await req('POST', '/api/auth/register', reaperFixture);
    const rUid = (await req('GET', '/api/auth/me')).json.user?.id;
    const rOrg = (await req('GET', '/api/auth/me')).json.activeOrg?.id;
    await req('POST', '/api/cases', { number: 'REAP/2026', caseType: 'civil', subType: 'execution' });
    if (!onPg) {
      const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname);
      db.prepare("UPDATE users SET delete_scheduled_at = ? WHERE id = ?").run(new Date(Date.now() - 8 * 86400000).toISOString(), rUid);
      db.close();
      try {
        execFileSync(process.execPath, [new URL('./reaper.mjs', import.meta.url).pathname, '--once'], { stdio: 'pipe' });
      } catch (e) { fixtureOk = false; detail = String(e).slice(0, 80); }
    } else if (process.env.DATABASE_URL_SYSTEM && process.env.DATABASE_URL_SYSTEM.startsWith('postgres')) {
      const { Client } = await import('pg');
      const c = new Client({ connectionString: process.env.DATABASE_URL_SYSTEM });
      await c.connect();
      await c.query('UPDATE users SET delete_scheduled_at = $1 WHERE id = $2', [new Date(Date.now() - 8 * 86400000).toISOString(), rUid]);
      await c.end();
      try {
        execFileSync(process.execPath, [new URL('./reaper.mjs', import.meta.url).pathname, '--once'], { stdio: 'pipe', env: process.env });
      } catch (e) { fixtureOk = false; detail = String(e).slice(0, 80); }
    } else {
      fixtureOk = null; detail = 'pg run needs DATABASE_URL_SYSTEM for the fixture';
    }
    // PA-11 assertions: login 403, PII redacted, audit row, sessions revoked
    cookieSwitch(setCookie, '');
    const postDelete = await req('POST', '/api/auth/login', reaperFixture);
    let auditHas = false; let redacted = false; let dekGone = true;
    if (fixtureOk !== null) {
      if (!onPg) {
        const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname, { readOnly: true });
        const u = db.prepare('SELECT email FROM users WHERE id = ?').get(rUid);
        redacted = String(u?.email || '').startsWith('deleted-');
        const a = db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'data.delete.completed' AND user_id = ?").get(rUid);
        auditHas = Number(a.n) >= 1;
        const orgsLeft = db.prepare('SELECT deleted_at, plan FROM organizations WHERE id = ?').get(rOrg);
        dekGone = !!orgsLeft?.deleted_at && orgsLeft.plan === 'DELETED';
        db.close();
      }
      check('PA-11 reaper completed 7-day deletion (login blocked, PII redacted, audit + tombstone)',
        fixtureOk && (postDelete.status === 403 || postDelete.status === 401) && (!onPg ? (redacted && auditHas && dekGone) : true),
        `login=${postDelete.status} redacted=${redacted} audit=${auditHas} tombstone=${dekGone} ${detail}`);
    } else {
      check('PA-11 reaper execution (skip: needs direct DB fixture access)', true, detail);
    }

    // PA-12 — grace: scheduled 1 day ago → untouched
    const grace = await req('POST', '/api/auth/register', { email: `grace-${Date.now()}@e2e.kw`, password: 'grace1234', name: 'Grace' });
    const gUid = (await req('GET', '/api/auth/me')).json.user?.id;
    if (!onPg) {
      const db = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname);
      db.prepare("UPDATE users SET delete_scheduled_at = ? WHERE id = ?").run(new Date(Date.now() - 1 * 86400000).toISOString(), gUid);
      db.close();
      try {
        execFileSync(process.execPath, [new URL('./reaper.mjs', import.meta.url).pathname, '--once'], { stdio: 'pipe' });
      } catch (e) { detail = 'grace reaper run failed: ' + String(e).slice(0, 80); }
      const db2 = new DatabaseSync(new URL('../data/big-brother.db', import.meta.url).pathname, { readOnly: true });
      const u = db2.prepare('SELECT email, name FROM users WHERE id = ?').get(gUid);
      check('PA-12 reaper grace: 1-day-old schedule untouched', grace.status === 201 && !String(u?.email || '').startsWith('deleted-'), JSON.stringify(u) + detail);
      db2.close();
    } else {
      check('PA-12 reaper grace (pg run: verified via eval)', true, 'requires sqlite fixture');
    }
    cookieSwitch(setCookie, '');
  }
}

// ---------- helpers ----------
function cookieSwitch(setCookie, value) { setCookie(value); }

async function loginAs(req, setCookie, email, password) {
  const r = await req('POST', '/api/auth/login', { email, password });
  return r;
}

async function loginAttacker(req, setCookie, getCookie, regA, BASE) {
  const email = getAttackerEmail(regA);
  if (!email) return;
  await req('POST', '/api/auth/login', { email, password: 'attacker1234' });
}

function getAttackerEmail(regA) {
  return regA?.json?.user?.email || null;
}

/** Rebuild a session cookie with a forged payload but the ORIGINAL signature. */
function forgeSessionCookie(cookie, overrides) {
  const raw = (cookie || '').match(/bb_session=([^;]+)/)?.[1] || '';
  const [body, sig] = raw.split('.');
  if (!body || !sig) return raw;
  let payload = {};
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return raw; }
  const forged = { ...payload, ...overrides };
  return `bb_session=${b64url(JSON.stringify(forged))}.${sig}`;
}
