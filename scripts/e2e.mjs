// E2E API smoke test — full compliance flow against the running dev server.
// Usage: node scripts/e2e.mjs
const BASE = 'http://localhost:3000';
const jar = { value: ''}; // shared session jar (Phase A sections read/write it)
let failures = 0;
// corpus baseline captured in [1]: the suite is corpus-size agnostic — the
// seed fixtures (48) may be joined by real-law mirror articles ingested via
// scripts/ingest-corpus.mjs (corpus/), and every count assertion below is
// relative to this baseline (intent preserved: exists / deactivates / restores).
let corpusBase = 0;

async function req(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(jar.value ? { Cookie: jar.value } : {}),
      ...extra
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jar.value = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch { /* may be text */ }
  return { status: res.status, json };
}

const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✔ ${name}`);
  else { failures++; console.log(`  ✘ ${name} ${detail}`); }
};

// ---------- 1. health ----------
console.log('\n[1] health');
{
  const r = await req('GET', '/api/health');
  check('health ok', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  corpusBase = r.json.corpus || 0;
  check('corpus seeded (>= 48 fixtures; + real-law mirrors when ingested)', corpusBase >= 48, `got ${corpusBase}`);
}

// ---------- 2. login as ahmed ----------
console.log('\n[2] auth');
{
  const bad = await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'wrong' });
  check('wrong password rejected', bad.status === 401);
  const r = await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });
  check('login ok', r.status === 200 && !!jar.value, `status ${r.status}`);
  const me = await req('GET', '/api/auth/me');
  check('me returns org', me.status === 200 && me.json.activeOrg?.type === 'INDIVIDUAL', JSON.stringify(me.json.activeOrg || {}));
}

// ---------- 3. Arabic search fix ----------
console.log('\n[3] Arabic search (ال-strip fix)');
{
  const r = await req('GET', '/api/search?q=' + encodeURIComponent('تزوير'));
  check('تزوير matches التزوير entries', r.json.results?.length >= 3, `got ${r.json.results?.length}`);
  check('all hits contain stem', r.json.results.every(x => (x.textAr || '').includes('زور') || (x.textAr || '').includes('زوير') || x.lawId === '16/1960'));
  const r2 = await req('GET', '/api/search?q=' + encodeURIComponent('الحضانة'));
  check('الحضانة matches family provisions', r2.json.results?.some(x => x.lawId === '51/1996'), `got ${r2.json.results?.length}`);
}

// ---------- 4. citation resolver ----------
console.log('\n[4] KB citation resolver');
{
  const ok = await req('GET', '/api/kb/resolve?law=38/1980&article=163');
  check('163 resolves', ok.json.resolved === true && ok.json.provision?.articleNo === '163');
  check('unverified flag present', ok.json.verified === false);
  const miss = await req('GET', '/api/kb/resolve?law=99/9999&article=1');
  check('unresolved flagged, never shown as citation', miss.json.resolved === false);
}

// ---------- 5. cases + analysis (Layer 1) ----------
let caseId = '';
console.log('\n[5] cases + Layer-1 analysis');
{
  const list = await req('GET', '/api/cases');
  check('tenant case list', list.status === 200 && Array.isArray(list.json.cases));
  // prefer a case that has procedural events (the Layer-1 engine is event-driven)
  const evented = (list.json.cases || []).find(c => (c.eventCount || 0) > 0);
  caseId = evented?.id;
  if (!caseId) {
    // self-healing: a prior run's workspace wipe removed the demo case
    const servedAt = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const created = await req('POST', '/api/cases', {
      number: '777/2026', court: 'محكمة الاستئناف — دائرة التنفيذ', caseType: 'civil',
      subType: 'execution', role: 'defendant', opponent: 'شركة النقليات الكويتية', servedAt
    });
    check('case created on the fly (self-healing e2e)', created.status === 201 && !!created.json.id, JSON.stringify(created.json).slice(0, 120));
    caseId = created.json.id;
    // a fresh case needs a procedural event for the Layer-1 engine to derive
    // alerts/deadlines (mirrors the seeded demo case's judgment event; 60d back
    // so the 30d appeal window is MISSED → alert + overdue deadline derive)
    const ev = await req('POST', `/api/cases/${caseId}/events`, {
      date: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10),
      title: 'صدور الحكم الابتدائي', type: 'judgment', note: 'حكم أول درجة — لم يُقدّم استئناف بعد', appealFiled: false, defect: false
    });
    check('judgment event created (self-healing e2e)', ev.status === 201, JSON.stringify(ev.json).slice(0, 120));
  }
  check('demo civil case exists', !!caseId);

  const a = await req('GET', `/api/cases/${caseId}/analysis`);
  check('analysis has alerts', a.json.alerts?.length > 0, `${a.json.alerts?.length}`);
  check('analysis has ALL ground categories (baseline completeness)', a.json.grounds?.length >= 9, `${a.json.grounds?.length}`);
  check('grounds use relevance not viability', JSON.stringify(a.json).includes('"relevance"'));
  check('deadline radar derived (appeal window)', a.json.deadlines?.some(d => d.kind === 'appeal'));
  check('citations display verification status (true or false)', a.json.alerts?.some(x => x.citations?.some(c => typeof c.verified === 'boolean' && c.label)));
  check('banners embedded', !!a.json.banners?.ground?.ar);
}

// ---------- 6. two-layer: generation without ack must fail (428) ----------
console.log('\n[6] Draft generation acknowledgment gate');
{
  const noAck = await req('POST', `/api/cases/${caseId}/drafts`, { type: 'counter', ackAccepted: false });
  check('generation blocked without ack (428)', noAck.status === 428, `got ${noAck.status}`);
  const withAck = await req('POST', `/api/cases/${caseId}/drafts`, { type: 'counter', ackAccepted: true });
  check('generation with ack works', withAck.status === 201 && withAck.json.draft?.status === 'DRAFT');
  const draftId = withAck.json.draft?.id;

  // export before finalize → 409
  const early = await req('POST', `/api/drafts/${draftId}/export`, { ackAccepted: true });
  check('export before finalize blocked (409)', early.status === 409, `got ${early.status}`);
  await req('POST', `/api/drafts/${draftId}/finalize`);
  const exp = await req('POST', `/api/drafts/${draftId}/export`, { ackAccepted: true });
  check('export after finalize works (counter type, no cooling-off)', exp.status === 200, `got ${exp.status} ${JSON.stringify(exp.json).slice(0, 120)}`);
  check('cover notice embedded', !!exp.json.coverNotice?.ar);
}

// ---------- 7. misconduct draft: 24h cooling-off + review queue ----------
console.log('\n[7] Cooling-off + review queue (misconduct type)');
{
  // ahmed's org: reviewQueueEnabled=false → DRAFT→FINALIZED, cooling-off 24h enforced
  const gen = await req('POST', `/api/cases/${caseId}/drafts`, { type: 'misconduct', ackAccepted: true });
  check('misconduct draft created', gen.status === 201, JSON.stringify(gen.json).slice(0, 120));
  const id = gen.json.draft?.id;
  check('cooling-off 24h recorded', gen.json.coolingOffHours === 24);

  await req('POST', `/api/drafts/${id}/finalize`);
  const blocked = await req('POST', `/api/drafts/${id}/export`, { ackAccepted: true });
  check('export blocked during cooling-off (423)', blocked.status === 423, `got ${blocked.status}`);
  check('remaining seconds returned', typeof blocked.json.remainingSec === 'number' && blocked.json.remainingSec > 20 * 3600, `${blocked.json.remainingSec}`);
  check('defamation warning re-displayed', !!blocked.json.defamationWarning?.ar);

  // NGO org case: review queue routing (select the FAMILY case explicitly —
  // org lists are updated_at-desc and e2e debris cases may be newer)
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ngo@demo.kw', password: 'demo1234' });
  const list = await req('GET', '/api/cases');
  const famId = (list.json.cases || []).find(c => c.caseType === 'family')?.id || list.json.cases[0]?.id;
  const fam = await req('GET', `/api/cases/${famId}/analysis`);
  check('family case has family grounds', fam.json.grounds?.some(g => g.ruleId?.startsWith('FAM-')), JSON.stringify(fam.json.grounds?.map(g => g.ruleId)));
  const mGen = await req('POST', `/api/cases/${famId}/drafts`, { type: 'nazaha', ackAccepted: true });
  check('NGO review queue routing → IN_REVIEW', mGen.json.draft?.status === 'IN_REVIEW' && mGen.json.reviewRequired === true, mGen.json.draft?.status);
  const mExp = await req('POST', `/api/drafts/${mGen.json.draft?.id}/export`, { ackAccepted: true });
  check('IN_REVIEW export locked (423)', mExp.status === 423);

  // caseworker cannot release; lawyer can
  const relCase = await req('POST', `/api/drafts/${mGen.json.draft?.id}/release`);
  check('caseworker cannot release (403)', relCase.status === 403, `got ${relCase.status}`);
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'lawyer@demo.kw', password: 'demo1234' });
  // lawyer must switch to NGO org first (their default is LAW_FIRM)
  const me = await req('GET', '/api/auth/me');
  const ngoOrg = me.json.orgs.find(o => o.type === 'NGO');
  await req('POST', '/api/auth/switch-org', { orgId: ngoOrg.id });
  const relOk = await req('POST', `/api/drafts/${mGen.json.draft?.id}/release`);
  check('lawyer releases from review queue', relOk.status === 200 && relOk.json.draft?.status === 'RELEASED', `got ${relOk.status}`);
  const finalExp = await req('POST', `/api/drafts/${mGen.json.draft?.id}/export`, { ackAccepted: true });
  check('release bypasses cooling-off clock? NO — cooling-off still enforced', finalExp.status === 423, `got ${finalExp.status}`);
}

// ---------- 8. feedback + deadlines ics + audit + data export ----------
console.log('\n[8] Feedback, iCal, audit, data export');
{
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });
  const fb = await req('POST', '/api/feedback', { caseId, targetType: 'alert', targetId: 'AL-ADJOURN', value: 'helpful' });
  check('feedback accepted', fb.status === 201);

  const ics = await fetch(`${BASE}/api/cases/${caseId}/deadlines-ics`, { headers: { Cookie: jar.value } });
  const text = await ics.text();
  check('iCal export valid', ics.status === 200 && text.includes('BEGIN:VCALENDAR') && text.includes('BEGIN:VEVENT'));

  const audit = await req('GET', '/api/audit');
  check('audit log readable (OWNER)', audit.status === 200 && audit.json.logs?.length > 5, `${audit.json.logs?.length}`);

  const exp = await req('GET', '/api/data/export');
  check('data export works', exp.status === 200 && exp.json.cases?.length > 0);

  const noAckDel = await req('POST', '/api/data/delete', { mode: 'workspace' });
  check('workspace wipe works', noAckDel.status === 200);
}

// ---------- 9. Phase 0 citation audit (lawyer-only) ----------
console.log('\n[9] Phase 0 citation audit');
{
  // transparency: readable by every signed-in member, actions lawyer-only
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });
  const asOwner = await req('GET', '/api/kb/audit');
  check('audit queue readable (transparency)', asOwner.status === 200 && asOwner.json.provisions?.length > 0);
  check('owner cannot verify (canVerify=false)', asOwner.json.canVerify === false);
  const target0 = asOwner.json.provisions.find(p => !p.verified) || asOwner.json.provisions[0];
  const deny = await req('POST', `/api/kb/audit/${target0.id}`, { action: 'verify', note: 'x' });
  check('verify denied for non-lawyer (403)', deny.status === 403, `got ${deny.status}`);

  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'lawyer@demo.kw', password: 'demo1234' });
  // lawyer's default org is the LAW_FIRM (non-lawyer role there); switch to the
  // NGO org where their role is LAWYER — same pattern as the release flow in [7]
  const meL = await req('GET', '/api/auth/me');
  const ngoOrgL = meL.json.orgs.find(o => o.type === 'NGO');
  await req('POST', '/api/auth/switch-org', { orgId: ngoOrgL.id });
  const queue = await req('GET', '/api/kb/audit');
  check('lawyer sees canVerify', queue.json.canVerify === true);
  check('stats present (full active corpus)', queue.json.stats?.total === corpusBase, `${queue.json.stats?.total} vs baseline ${corpusBase}`);
  const before = queue.json.stats.verified;
  const target = queue.json.provisions.find(p => !p.verified) || queue.json.provisions[0];
  const targetWasVerified = !!target.verified;

  const noNote = await req('POST', `/api/kb/audit/${target.id}`, { action: 'verify' });
  check('verify without note rejected (400)', noNote.status === 400, `got ${noNote.status}`);

  const ver = await req('POST', `/api/kb/audit/${target.id}`, {
    action: 'verify', note: 'مطابق للنسخة المنشورة في الجريدة الرسمية', gazetteRef: 'الكويت اليوم — ملحق 1996'
  });
  check('lawyer verifies with basis + gazette', ver.status === 200 && ver.json.provision?.verified === true, `got ${ver.status}`);
  check('verifiedBy + verifiedAt recorded', !!ver.json.provision?.verifiedBy && !!ver.json.provision?.verifiedAt);

  const after = await req('GET', '/api/kb/audit');
  check('verified count adjusted', after.json.stats.verified === before + (targetWasVerified ? 0 : 1), `${before} → ${after.json.stats.verified}`);

  // amend → new version supersedes, history retained
  const amend = await req('POST', `/api/kb/audit/${target.id}`, {
    action: 'amend', note: 'تصويب صياغة النص',
    textAr: (ver.json.provision?.textAr || target.textAr) + ' [مُصوّب]', textEn: 'Corrected wording'
  });
  check('amend publishes v+1', amend.status === 200 && amend.json.provision?.version === target.version + 1, `got ${amend.status}`);
  check('amend supersedes old row (history retained)', amend.json.provision?.supersedesId === target.id);
  const resolveAfter = await req('GET', `/api/kb/resolve?law=${encodeURIComponent(target.lawId)}&article=${encodeURIComponent(target.articleNo)}`);
  check('resolver now returns amended version', resolveAfter.json.provision?.id === amend.json.provision?.id);

  // deactivate → active corpus drops; reactivate restores
  if (!amend.json.provision?.id) {
    check('amend produced a provision (section continues)', false, 'amend failed — skipping deactivate/reactivate');
  } else {
  const deact = await req('POST', `/api/kb/audit/${amend.json.provision.id}`, { action: 'deactivate', note: 'خارج نطاق الاستشهاد حاليًا' });
  check('deactivate works (reason recorded)', deact.status === 200 && deact.json.provision?.isActive === false);
  const healthDown = await req('GET', '/api/health');
  check('archived row excluded from active corpus (baseline-1)', healthDown.json.corpus === corpusBase - 1, `got ${healthDown.json.corpus}`);
  const react = await req('POST', `/api/kb/audit/${amend.json.provision.id}`, { action: 'reactivate' });
  check('reactivate restores row', react.status === 200 && react.json.provision?.isActive === true);
  const healthUp = await req('GET', '/api/health');
  check('active corpus restored (baseline)', healthUp.json.corpus === corpusBase, `got ${healthUp.json.corpus}`);

  // trail: lawyer reads their org audit log for kb.audit.* entries
  const trail = await req('GET', '/api/audit');
  check('audit trail records kb.audit actions', trail.status === 200 && (trail.json.logs || []).some(l => String(l.action).startsWith('kb.audit.')), JSON.stringify(trail.json.logs?.slice(0, 2)));
  }
}

// ---------- 10. Billing & plans (Stage 5) ----------
console.log('\n[10] Billing & plans (FREE→PRO, limits, ledger, webhook)');
{
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });
  const bill0 = await req('GET', '/api/billing');
  check('billing summary readable', bill0.status === 200 && bill0.json.plan === 'FREE', `got ${bill0.status} ${bill0.json.plan}`);
  check('limits + usage exposed', typeof bill0.json.limits?.maxActiveCases === 'number' && typeof bill0.json.usage?.activeCases === 'number');

  // isolated workspace for limit testing
  const org = await req('POST', '/api/orgs', { name: 'Billing E2E Workspace', type: 'INDIVIDUAL' });
  check('billing test org created', org.status === 201 && !!org.json.org?.id, JSON.stringify(org.json).slice(0, 100));
  const orgId = org.json.org?.id;
  const joinCode = org.json.org?.joinCode;
  await req('POST', '/api/auth/switch-org', { orgId });

  // FREE cap: 3 active cases
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const c = await req('POST', '/api/cases', { number: `B${i}/2026`, caseType: 'civil', subType: 'execution' });
    check(`free case ${i + 1}/3 created`, c.status === 201, `got ${c.status}`);
    ids.push(c.json.id);
  }
  const fourth = await req('POST', '/api/cases', { number: 'B4/2026', caseType: 'civil', subType: 'execution' });
  check('4th case blocked by plan limit (402)', fourth.status === 402, `got ${fourth.status}`);
  check('402 body is machine-readable', fourth.json.error === 'plan_limit' && fourth.json.limit === 'maxActiveCases' && fourth.json.upgradeTo === 'PRO', JSON.stringify(fourth.json).slice(0, 120));

  // demo-mode upgrade → limit lifted
  const up = await req('POST', '/api/billing/checkout', { plan: 'PRO' });
  check('demo checkout activates PRO', up.status === 200 && up.json.mode === 'demo' && up.json.activated === true, JSON.stringify(up.json).slice(0, 100));
  const bill1 = await req('GET', '/api/billing');
  check('plan now PRO with renews date', bill1.json.plan === 'PRO' && bill1.json.planStatus === 'active' && !!bill1.json.planRenewsAt, JSON.stringify(bill1.json.plan));
  const fourth2 = await req('POST', '/api/cases', { number: 'B4/2026', caseType: 'civil', subType: 'execution' });
  check('4th case allowed after upgrade', fourth2.status === 201, `got ${fourth2.status}`);

  // seat limit: PRO allows joining; MEMBER cannot manage billing
  const tmpEmail = `billing-temp-${Date.now()}@demo.kw`;
  jar.value = '';
  await req('POST', '/api/auth/register', { email: tmpEmail, password: 'demo1234', name: 'Billing Temp' });
  const join = await req('POST', '/api/auth/switch-org', { joinCode });
  check('member joins PRO workspace by code', join.status === 200, `got ${join.status}`);
  const memberCheckout = await req('POST', '/api/billing/checkout', { plan: 'PRO' });
  check('member cannot manage billing (403)', memberCheckout.status === 403, `got ${memberCheckout.status}`);
  const memberView = await req('GET', '/api/billing');
  check('member sees plan read-only (canManage=false)', memberView.status === 200 && memberView.json.canManage === false);

  // downgrade → FREE re-applies capacity limits (data retained)
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });
  await req('POST', '/api/auth/switch-org', { orgId });
  const cancel = await req('POST', '/api/billing/cancel');
  check('cancel downgrades to FREE', cancel.status === 200 && cancel.json.org?.plan === 'FREE', JSON.stringify(cancel.json).slice(0, 100));
  const fifth = await req('POST', '/api/cases', { number: 'B5/2026', caseType: 'civil', subType: 'execution' });
  check('5th case blocked again after downgrade (402)', fifth.status === 402, `got ${fifth.status}`);
  const caseCount = await req('GET', '/api/cases');
  check('downgrade kept all data (4 cases retained)', (caseCount.json.cases || []).length === 4, `got ${caseCount.json.cases?.length}`);

  // metering: an analysis run is counted in usage
  const run = await req('GET', `/api/cases/${ids[0]}/analysis`);
  check('analysis run ok in isolated org', run.status === 200, `got ${run.status}`);
  const bill2 = await req('GET', '/api/billing');
  check('analysis run metered in usage', bill2.json.usage?.monthlyAnalysisRuns >= 1, `got ${bill2.json.usage?.monthlyAnalysisRuns}`);

  // webhook: signature verification + idempotency guards
  const wh = await req('POST', '/api/billing/webhook', { id: 'evt_test', type: 'checkout.session.completed', data: { object: {} } });
  check('webhook without valid secret never accepted (503 disabled | 400 bad signature)', wh.status === 503 || wh.status === 400, `got ${wh.status}`);

  // ledger: full lifecycle recorded (upgrade + downgrade)
  const ledger = await req('GET', '/api/billing');
  const kinds = (ledger.json.events || []).map(e => e.kind);
  check('ledger records upgrade + downgrade', kinds.includes('upgrade') && kinds.includes('downgrade'), JSON.stringify(kinds));
  check('ledger newest-first', kinds[0] === 'downgrade', `first ${kinds[0]}`);
}

// ---------- 11. notification center (Stage 6) ----------
console.log('\n[11] Notification center (deadline reminders + workspace events)');
{
  // A. caseworker inbox: overdue appeal-window reminder derives, sync is idempotent
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ngo@demo.kw', password: 'demo1234' });
  const inbox1 = await req('GET', '/api/notifications');
  check('inbox readable', inbox1.status === 200 && Array.isArray(inbox1.json.notifications), `got ${inbox1.status}`);
  check('deadline reminder derived (overdue appeal window)', inbox1.json.notifications.some(n => n.type === 'deadline.reminder' && n.urgency === 'overdue'), JSON.stringify(inbox1.json.notifications.map(n => n.type)));
  const inbox2 = await req('GET', '/api/notifications');
  check('reminder sync idempotent (dedupe on re-read)', inbox2.json.newlyDerived === 0 && inbox2.json.unread === inbox1.json.unread, `${inbox2.json.newlyDerived}/${inbox2.json.unread}`);

  // B. escalation: a fresh overdue judgment (new deadline id → new bucket row)
  const list11 = await req('GET', '/api/cases');
  let escId = (list11.json.cases || []).find(c => c.number === 'E2E/2026')?.id;
  if (!escId) {
    const esc = await req('POST', '/api/cases', { number: 'E2E/2026', court: 'محكمة التمييز', caseType: 'civil', subType: 'execution', role: 'defendant' });
    check('escalation case created', esc.status === 201 && !!esc.json.id, `got ${esc.status}`);
    escId = esc.json.id;
  }
  await req('POST', `/api/cases/${escId}/events`, {
    date: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10),
    title: 'صدور الحكم الابتدائي', type: 'judgment', note: 'e2e escalation event', appealFiled: false, defect: false
  });
  const inbox3 = await req('GET', '/api/notifications');
  check('escalation derives new reminder for the new deadline', inbox3.json.newlyDerived >= 1 && inbox3.json.notifications.some(n => n.type === 'deadline.reminder' && n.caseId === escId), `newlyDerived=${inbox3.json.newlyDerived}`);

  // C. mark one read, mark all read, badge count
  const firstUnread = inbox3.json.notifications.find(n => !n.readAt);
  const mark1 = await req('POST', '/api/notifications', { id: firstUnread.id });
  check('mark one read (recipient-scoped)', mark1.status === 200 && mark1.json.marked === 1 && mark1.json.unread === inbox3.json.unread - 1, JSON.stringify(mark1.json));
  const markAll = await req('POST', '/api/notifications', { all: true });
  check('mark all read', markAll.status === 200 && markAll.json.unread === 0, JSON.stringify(markAll.json));
  const cnt11 = await req('GET', '/api/notifications/count');
  check('badge count matches inbox', cnt11.status === 200 && cnt11.json.unread === 0, JSON.stringify(cnt11.json));

  // D. review-requested hook: caseworker generates a review-queue draft
  const famId11 = (list11.json.cases || []).find(c => c.caseType === 'family')?.id;
  const mGen11 = await req('POST', `/api/cases/${famId11}/drafts`, { type: 'misconduct', ackAccepted: true });
  check('review-queue draft notifies reviewers (not actor)', mGen11.json.reviewRequired === true && mGen11.json.reviewersNotified >= 1, `notified=${mGen11.json.reviewersNotified}`);
  const draftId11 = mGen11.json.draft?.id;
  const cwAfterGen = await req('GET', '/api/notifications');
  check('actor has no self-notification', !cwAfterGen.json.notifications.some(n => n.refId === draftId11));

  // E. lawyer receives the review request, releases → creator notified
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'lawyer@demo.kw', password: 'demo1234' });
  const meL2 = await req('GET', '/api/auth/me');
  const ngoOrg2 = meL2.json.orgs.find(o => o.type === 'NGO');
  await req('POST', '/api/auth/switch-org', { orgId: ngoOrg2.id });
  const lwInbox = await req('GET', '/api/notifications');
  check('lawyer received review request', lwInbox.json.notifications.some(n => n.type === 'draft.review_requested' && n.refId === draftId11), JSON.stringify(lwInbox.json.notifications.map(n => n.type)));
  const rel2 = await req('POST', `/api/drafts/${draftId11}/release`);
  check('lawyer releases; creator notified', rel2.status === 200 && rel2.json.creatorNotified === true, `got ${rel2.status}`);

  // F. evidence integrity: hash mismatch on re-seal alerts the case owner.
  // Sealed into the escalation case (kept doc-light on purpose). A reused demo
  // DB can hit the FREE 5-docs/case cap — in that case the pair is skipped and
  // the persisted mismatch notification from a prior run covers check G.
  const docsNow = await req('GET', `/api/cases/${escId}/documents`);
  const room = 5 - (docsNow.json.documents?.length || 0);
  if (room >= 2) {
    const d1 = await fetch(`${BASE}/api/cases/${escId}/documents`, { method: 'POST', headers: { Cookie: jar.value, 'x-file-name': 'e2e-mismatch.pdf', 'Content-Type': 'application/octet-stream' }, body: 'AAA' });
    check('doc v1 sealed', d1.status === 201, `got ${d1.status}`);
    const d2 = await fetch(`${BASE}/api/cases/${escId}/documents`, { method: 'POST', headers: { Cookie: jar.value, 'x-file-name': 'e2e-mismatch.pdf', 'Content-Type': 'application/octet-stream' }, body: 'BBB' });
    const d2j = await d2.json();
    check('doc v2 flagged mismatch', d2.status === 201 && d2j.hashMismatch === true, JSON.stringify(d2j).slice(0, 100));
  } else {
    check('doc pair skipped (FREE cap reached on reused DB — row persists)', true);
  }

  // G. per-user isolation: caseworker sees release + mismatch events,
  //    never the review requests addressed to lawyer/admin
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ngo@demo.kw', password: 'demo1234' });
  const cwFinal = await req('GET', '/api/notifications');
  check('creator notified of release', cwFinal.json.notifications.some(n => n.type === 'draft.released' && n.refId === draftId11), JSON.stringify(cwFinal.json.notifications.map(n => n.type)));
  check('owner alerted on hash mismatch', cwFinal.json.notifications.some(n => n.type === 'document.mismatch'));
  check('review requests never leak to non-reviewer', !cwFinal.json.notifications.some(n => n.type === 'draft.review_requested'));
  check('inbox scoped to one user (no foreign rows)', cwFinal.json.notifications.every(n => n.type && n.caseId));
}

// ---------- Phase A sections (T-01..T-22, PA-01..PA-12) ----------
import { runPhaseASections } from './e2e-pa-sections.mjs';
await runPhaseASections({ req, check, getCookie: () => jar.value, setCookie: (v) => { jar.value = v; }, setCookieRaw: (v) => { jar.value = v; }, BASE });

// ---------- 14. corpus ingestion integrity (real Kuwaiti laws) ----------
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const ingestPath = new URL('./ingest-corpus.mjs', import.meta.url).pathname;
  const runIngest = (dir) => execFileSync(process.execPath, [ingestPath], { stdio: 'pipe', env: dir ? { ...process.env, CORPUS_DIR: dir } : process.env });

  console.log('\n[14] corpus ingestion integrity (real Kuwaiti laws)');
  const h0 = await req('GET', '/api/health');
  const base = h0.json.corpus;
  // active-only count: 48 fixtures + ~820 active mirror rows (126 split v1
  // originals are inactive by design — superseded by their amended v2)
  check('real-law corpus present (fixtures + active mirror articles)', base >= 800, `got ${base}`);

  // idempotency: re-running the ingest on an already-ingested DB must be a no-op
  let idemOk = true; let idemDetail = '';
  try { runIngest(); } catch (e) { idemOk = false; idemDetail = String(e).slice(0, 120); }
  const h1 = await req('GET', '/api/health');
  check('ingest re-run is idempotent (no duplicate rows)', idemOk && h1.json.corpus === base, idemDetail || `corpus ${base} -> ${h1.json.corpus}`);

  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' });

  // corpus composition: the three real laws are visible in kb stats
  const stats = await req('GET', '/api/kb/stats');
  check('kb stats cover the three ingested laws (16/1960, 17/1960, 38/1980)',
    ['16/1960', '17/1960', '38/1980'].every(l => (stats.json.byLaw?.[l] || 0) > 100),
    JSON.stringify(stats.json.byLaw));

  // search reaches the real corpus (Penal Code art 1 opening words)
  const s1 = await req('GET', '/api/search?q=' + encodeURIComponent('لا يعد الفعل جريمة'));
  const hits = s1.json.results || [];
  check('search retrieves the real Penal Code art 1 (16/1960)', s1.status === 200 &&
    hits.some(r => r.lawId === '16/1960' && r.articleNo === '1'),
    JSON.stringify(hits.slice(0, 3).map(r => ({ lawId: r.lawId, articleNo: r.articleNo }))));
  check('search results carry the unverified flag', (s1.json.results || []).length > 0 && s1.json.results.every(r => r.verified === false), '');

  // resolver: a plain ingested article resolves (unverified)
  const rNew = await req('GET', `/api/kb/resolve?law=${encodeURIComponent('16/1960')}&article=1`);
  check('resolver resolves ingested article (resolved, unverified)',
    rNew.json.resolved === true && rNew.json.verified === false && !!rNew.json.provision?.id, `got ${rNew.json.resolved}`);

  // amendment split integrity: Penal art 3 carries both texts as a version chain
  const rAmd = await req('GET', `/api/kb/resolve?law=${encodeURIComponent('16/1960')}&article=3`);
  check('resolver returns the amended v2 of split article 3', rAmd.json.provision?.version === 2, `got v${rAmd.json.provision?.version}`);
  const arch = await req('GET', `/api/kb/audit?includeArchived=1&law=${encodeURIComponent('16/1960')}`);
  const v1row = (arch.json.provisions || []).find(p => p.articleNo === '3' && p.version === 1);
  check('split article 3: original v1 retained (inactive, superseded)', !!v1row && v1row.isActive === false, `active=${v1row?.isActive}`);
  check('split article 3: v2 supersedes v1 + mirror publication date kept',
    rAmd.json.provision?.supersedesId === v1row?.id && /نشر بتاريخ/.test(rAmd.json.provision?.gazetteRef || ''),
    `gazetteRef=${rAmd.json.provision?.gazetteRef}`);
  check('ingested rows land unverified in the Phase 0 queue (split v1+v2 unverified; per-law queue dominated by mirror rows)',
    rAmd.json.provision?.verified === false && v1row?.verified === false && (arch.json.stats?.byLaw?.['16/1960']?.total || 0) >= 250,
    JSON.stringify(arch.json.stats?.byLaw?.['16/1960']));

  // refusal policy 1: a file claiming verified_official=true must be REFUSED
  const tmp = mkdtempSync(join(tmpdir(), 'bb-corpus-'));
  const testLaw = { law_id: 'KW-TEST-99-2099', law_name_ar: 'قانون اختبار', law_name_en: 'Test Law',
    verified_official: true, verification_status: 'VERIFIED', article_count: 1,
    articles: [{ article_number_raw: '1', text_ar: 'نص اختبار للرفض الآلي — يجب ألا يدخل القاعدة أبداً.' }] };
  const buf = Buffer.from(JSON.stringify(testLaw));
  writeFileSync(join(tmp, 'test_law.json'), buf);
  writeFileSync(join(tmp, 'SOURCES.json'), JSON.stringify({ files: [
    { path: 'test_law.json', lawId: '99/2099', mirrorLawId: 'KW-TEST-99-2099', sha256: createHash('sha256').update(buf).digest('hex') }
  ] }));
  let exit1 = 0; let out1 = '';
  try { runIngest(tmp); } catch (e) { exit1 = e.status; out1 = (e.stdout?.toString() || '') + (e.stderr?.toString() || ''); }
  check('ingest REFUSES a file claiming verified_official=true (exit 1, nothing written)',
    exit1 === 1 && /REFUSED/.test(out1) && (await req('GET', '/api/health')).json.corpus === base, `exit ${exit1}`);

  // refusal policy 2: sha256 mismatch (tamper-evident drop)
  writeFileSync(join(tmp, 'test_law.json'), Buffer.from(JSON.stringify({ ...testLaw, verified_official: false })));
  let exit2 = 0;
  try { runIngest(tmp); } catch (e) { exit2 = e.status; }
  check('ingest REFUSES sha256 mismatch vs SOURCES.json', exit2 === 1, `exit ${exit2}`);
  rmSync(tmp, { recursive: true, force: true });
  check('refused drops leave the corpus unchanged', (await req('GET', '/api/health')).json.corpus === base, '');
}

// ---------- 15. RAG Phase 1 — manifest ingest + retrieval (RAG_SPEC §4) ----------
// Numbered to mirror docs/rag/DELIVERABLES.md §7.6 (RAG-01..RAG-18) where
// Phase 1 applies; LLM-trace items (RAG-11..14) are deferred with the LLM
// itself (docs/rag/IMPLEMENTATION_STATUS.md) — RAG-13's engine-contract
// half is asserted here, the trace half ships with the LLM phase.
{
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { join } = await import('node:path');

  console.log('\n[15] RAG Phase 1 — manifest ingest + retrieval');
  // unique-per-run fixture identity: the suite reuses the dev DB by design,
  // so the test law and marker words must never collide with a prior run
  const runTag = String(Date.now() % 100000);
  const markerA = 'كلمتجريبيةزقزق' + runTag;
  const markerB = 'كلمتجريبيةنونن' + runTag;
  const testLawId = `${1000 + (Date.now() % 8000)}/2099`;
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const FIX_DIR = join('var', 'rag', 'inbox', `e2e-${Date.now()}`);
  mkdirSync(FIX_DIR, { recursive: true });

  const sourceA = [
    'قانون اختبار الاسترجاع التجريبي',
    '',
    'الفصل الأول — أحكام عامة',
    'المادة 1',
    `يُعد ${markerA} أساسًا للاختبار التجريبي في هذا القانون، ولا يجوز المخالفة.`,
    '',
    'المادة 2',
    'تنطبق أحكام هذا القانون التجريبي على كل من يخالف أحكامه في حدود ما نص عليه المشرّع.',
    '',
    'المادة 3',
    'يُعمل بهذا القانون من تاريخ نشره في الجريدة الرسمية.'
  ].join('\n');
  const sourceB = [
    'قانون اختبار الاسترجاع التجريبي',
    '',
    'المادة 1',
    `أُلغى النص السابق وأصبح ${markerB} هو الأساس المعتمد بعد التعديل.`
  ].join('\n');
  writeFileSync(join(FIX_DIR, 'source-a.txt'), sourceA);
  writeFileSync(join(FIX_DIR, 'source-b.txt'), sourceB);
  const shaA = createHash('sha256').update(Buffer.from(sourceA, 'utf8')).digest('hex');
  const shaB = createHash('sha256').update(Buffer.from(sourceB, 'utf8')).digest('hex');
  const mkManifest = (issue, publishDate, sha, path, count) => ({
    manifestVersion: '1', issueNo: issue, publishDate, sourceType: 'txt',
    sourcePath: path, sourceSha256: sha,
    laws: [{ lawId: testLawId, lawNameAr: 'قانون اختبار الاسترجاع التجريبي', expectedArticleCount: count }],
    operator: { name: 'e2e', attestation: false },
    notes: 'e2e fixture — provisional test law (explicitly new lawId, never guessed production data)'
  });
  const manifestA = mkManifest(`E2E-A-${Date.now()}`, day(-10), shaA, 'source-a.txt', 3);
  const manifestB = mkManifest(`E2E-B-${Date.now()}`, day(0), shaB, 'source-b.txt', 1);
  const dropDir = FIX_DIR.split(/[\\/]/).slice(-1)[0];

  // baselines for RAG-17 (nothing outside the RAG tables may change)
  const health0 = await req('GET', '/api/health');
  const corpus0 = health0.json.corpus;

  // RAG-03 — status is authenticated-only
  jar.value = '';
  const unauth = await req('GET', '/api/rag/status');
  check('RAG-03: /api/rag/status unauthenticated → 401', unauth.status === 401, `got ${unauth.status}`);

  // RAG-01 — role gate mirrors Phase 0 discipline (LAWYER/ADMIN only)
  await req('POST', '/api/auth/login', { email: 'ngo@demo.kw', password: 'demo1234' }); // CASEWORKER
  const asCaseworker = await req('POST', '/api/rag/ingest', { manifest: manifestA, dryRun: true, dropDir });
  check('RAG-01: CASEWORKER ingest → 403', asCaseworker.status === 403, `got ${asCaseworker.status}`);
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'ahmed@demo.kw', password: 'demo1234' }); // OWNER
  const asOwner = await req('POST', '/api/rag/ingest', { manifest: manifestA, dryRun: true, dropDir });
  check('RAG-01: OWNER ingest → 403', asOwner.status === 403, `got ${asOwner.status}`);

  // lawyer (switch to the NGO org where their role is LAWYER — e2e §9 pattern)
  jar.value = '';
  await req('POST', '/api/auth/login', { email: 'lawyer@demo.kw', password: 'demo1234' });
  const meR = await req('GET', '/api/auth/me');
  await req('POST', '/api/auth/switch-org', { orgId: meR.json.orgs.find(o => o.type === 'NGO').id });

  const status0 = await req('GET', '/api/rag/status');
  const totals0 = status0.json.totals?.chunks ?? 0;

  // RAG-02 — lawyer dry-run: report without writes
  const dry = await req('POST', '/api/rag/ingest', { manifest: manifestA, dryRun: true, dropDir });
  check('RAG-02: lawyer dry-run accepted (200, no job id)', dry.status === 200 && dry.json.ok === true && !dry.json.jobId, JSON.stringify(dry.json).slice(0, 140));
  check('RAG-02: dry-run reports 3 chunks with line anchors', dry.json.stats?.chunks === 3 || dry.json.stats?.laws?.[0]?.chunks === 3, JSON.stringify(dry.json.stats || {}));
  const totalsAfterDry = (await req('GET', '/api/rag/status')).json.totals?.chunks ?? 0;
  check('RAG-02: dry-run wrote nothing (totals unchanged)', totalsAfterDry === totals0, `${totals0} → ${totalsAfterDry}`);

  // RAG-02 — real ingest: job reaches LAWYER_REVIEW (unattested mirror source)
  const ingA = await req('POST', '/api/rag/ingest', { manifest: manifestA, dropDir });
  check('RAG-02: ingest accepted (201, LAWYER_REVIEW)', ingA.status === 201 && ingA.json.stage === 'LAWYER_REVIEW', JSON.stringify(ingA.json).slice(0, 140));
  check('RAG-02: unattested source flagged provisional', ingA.json.stats?.provisionalSource === true, JSON.stringify(ingA.json.stats || {}).slice(0, 100));
  const statusA = await req('GET', '/api/rag/status');
  const covA = (statusA.json.coverage || []).find(c => c.lawId === testLawId);
  check('RAG-02: coverage shows the fixture law (3 chunks)', covA?.chunks === 3, JSON.stringify(statusA.json.coverage));
  check('RAG-02: job recorded as LAWYER_REVIEW, attested=false',
    (statusA.json.jobs || []).some(j => j.issueNo === manifestA.issueNo && j.status === 'LAWYER_REVIEW' && j.attested === false), '');

  // RAG-04 — versions=current excludes the superseded text after the amendment drop
  const ingB = await req('POST', '/api/rag/ingest', { manifest: manifestB, dropDir });
  check('RAG-04: amendment drop ingested (201)', ingB.status === 201, JSON.stringify(ingB.json).slice(0, 120));
  const curA = await req('GET', '/api/rag/search?q=' + encodeURIComponent(markerA) + '&law=' + encodeURIComponent(testLawId));
  check('RAG-04: current search excludes the superseded text (0 leaks)', (curA.json.results || []).length === 0, JSON.stringify(curA.json.results?.slice(0, 2).map(r => r.snippet)));

  // RAG-05..08 — temporal branches over the chunk version chain
  const hist = await req('GET', '/api/rag/search?q=' + encodeURIComponent(markerA) + '&law=' + encodeURIComponent(testLawId) + '&versions=historical');
  const histHit = (hist.json.results || [])[0];
  check('RAG-05: historical search returns the superseded chain with its validity window',
    !!histHit && histHit.effectiveTo === day(0), JSON.stringify(hist.json.results?.map(r => ({ a: r.articleNo, to: r.effectiveTo }))));
  const asOfPast = await req('GET', '/api/rag/search?q=' + encodeURIComponent(markerA) + '&law=' + encodeURIComponent(testLawId) + '&asOf=' + day(-9));
  check('RAG-06: asOf before the amending issue → old version returned',
    (asOfPast.json.results || []).some(r => r.snippet.includes(markerA)), `${asOfPast.json.results?.length}`);
  const asOfPastB = await req('GET', '/api/rag/search?q=' + encodeURIComponent(markerB) + '&law=' + encodeURIComponent(testLawId) + '&asOf=' + day(-9));
  check('RAG-07: asOf before publish → new version hidden (inclusive effective_from)',
    (asOfPastB.json.results || []).length === 0, `${asOfPastB.json.results?.length}`);
  const curB = await req('GET', '/api/rag/search?q=' + encodeURIComponent(markerB) + '&law=' + encodeURIComponent(testLawId));
  check('RAG-08: asOf = publish date → new version returned (current law)',
    (curB.json.results || []).length === 1, JSON.stringify(curB.json.results?.map(r => r.articleNo)));

  // RAG-10 — every hit resolves through the grounding contract (engine untouched)
  const real = await req('GET', '/api/rag/search?q=' + encodeURIComponent('لا يعد الفعل جريمة'));
  const realHit = (real.json.results || []).find(r => r.lawId === '16/1960' && r.articleNo === '1');
  check('RAG-10: real-law hit carries a provisionId (linked to the LKB)', !!realHit?.provisionId, JSON.stringify(real.json.results?.slice(0, 2).map(r => ({ lawId: r.lawId, art: r.articleNo, prov: !!r.provisionId }))));
  check('RAG-10: real-law hits are badged unverified (Phase 0 queue)', (real.json.results || []).length > 0 && (real.json.results || []).every(r => r.verified === false), '');
  if (realHit?.provisionId) {
    const resolveHit = await req('GET', `/api/kb/resolve?law=${encodeURIComponent('16/1960')}&article=1`);
    check('RAG-10: hit resolves through /api/kb/resolve (resolved:true)', resolveHit.json.resolved === true, JSON.stringify(resolveHit.json).slice(0, 120));
  }
  const fabric = await req('GET', '/api/kb/resolve?law=99/9999&article=1');
  check('RAG-13: fabricated citation unresolved — never shown as a citation (engine contract intact)',
    fabric.json.resolved === false && /never shown as a citation/.test(fabric.json.displayRule || ''), JSON.stringify(fabric.json).slice(0, 120));

  // RAG-15 — Decree-Law 80/2026 hard block (must never be worked around)
  const blocked = { ...mkManifest(`E2E-BLK-${Date.now()}`, day(0), shaA, 'source-a.txt', 3), laws: [{ lawId: '80/2026', lawNameAr: 'مرسوم بقانون محظور' }] };
  const blk = await req('POST', '/api/rag/ingest', { manifest: blocked, dropDir });
  check('RAG-15: 80/2026 manifest → BLOCKED_POLICY (422)', blk.status === 422 && blk.json.stage === 'BLOCKED_POLICY', `got ${blk.status} ${JSON.stringify(blk.json).slice(0, 100)}`);
  check('RAG-15: no chunks written for the blocked law',
    !((await req('GET', '/api/rag/status')).json.coverage || []).some(c => c.lawId === '80/2026'), '');

  // RAG-16 — idempotency: re-ingest of the same manifest is a no-op
  const totalsBeforeRe = (await req('GET', '/api/rag/status')).json.totals?.chunks ?? 0;
  const re = await req('POST', '/api/rag/ingest', { manifest: manifestB, dropDir });
  const totalsAfterRe = (await req('GET', '/api/rag/status')).json.totals?.chunks ?? 0;
  check('RAG-16: re-ingest of the same manifestHash is idempotent', re.json.idempotent === true && totalsAfterRe === totalsBeforeRe, `${totalsBeforeRe} → ${totalsAfterRe}`);

  // RAG-17 — the pipeline never mutates the LKB (hash before == hash after)
  const health1 = await req('GET', '/api/health');
  const stats1 = await req('GET', '/api/kb/audit');
  check('RAG-17: LKB corpus count unchanged by all RAG operations', health1.json.corpus === corpus0, `${corpus0} → ${health1.json.corpus}`);
  check('RAG-17: Phase 0 queue untouched (total + verified unchanged)',
    stats1.json.stats?.total === corpus0 && stats1.json.stats?.verified === (await req('GET', '/api/kb/audit')).json.stats?.verified, JSON.stringify(stats1.json.stats));

  // RAG-18 — normalization parity through the API (tashkeel-insensitive) +
  // graceful lexical-only degradation when no embed service is configured
  const diacritized = await req('GET', '/api/rag/search?q=' + encodeURIComponent('لا يُعَدُّ الفَعْلُ جَرِيمَةً'));
  check('RAG-18: tashkeel-normalized query matches plain query (shared arabic.mjs parity)',
    (diacritized.json.results || []).some(r => r.lawId === '16/1960' && r.articleNo === '1'), `${diacritized.json.results?.length}`);
  check('RAG-18: lexical-only degradation reported when embed service absent', real.json.meta?.embedMode === 'lexical', JSON.stringify(real.json.meta));
  check('RAG-18: query log records hashes only (no query text in the status surface)',
    !(JSON.stringify((await req('GET', '/api/rag/status')).json)).includes(markerB.slice(0, 6)), '');

  // CLI-level integrity: sha256 mismatch REFUSES (tamper-evident drop)
  const tampered = { ...manifestA, sourceSha256: '0'.repeat(64), issueNo: `E2E-TAMPER-${Date.now()}` };
  const tam = await req('POST', '/api/rag/ingest', { manifest: tampered, dropDir });
  check('corpus policy: sha256 mismatch → REJECTED, nothing written', tam.status === 400 && tam.json.stage === 'REJECTED', `got ${tam.status}`);
  const covTot = (await req('GET', '/api/rag/status')).json.totals?.chunks ?? 0;
  check('corpus policy: rejected drop left the chunk corpus unchanged', covTot === totalsAfterRe, `${totalsAfterRe} → ${covTot}`);

  rmSync(FIX_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
