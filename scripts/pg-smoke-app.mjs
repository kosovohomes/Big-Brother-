// Local/production smoke for the pg cutover: login -> list cases (decrypt
// proof) -> create a probe case (bb_app write path) -> delete it.
// Usage: BASE_URL=http://localhost:3111 node scripts/pg-smoke-app.mjs
const BASE = process.env.BASE_URL || 'http://localhost:3111';
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// 1 — health
const h = await fetch(`${BASE}/api/health`).then(r => r.json());
check('S1 health db=postgres', h.db === 'postgres', `db=${h.db} corpus=${h.corpus}`);
check('S1b health ok', h.ok === true);

// 2 — login (system lane: findUserByEmail + org fetch)
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lawyer@demo.kw', password: 'demo1234' })
});
const cookie = (login.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
check('S2 login 200', login.status === 200, `status=${login.status}`);
const loginBody = await login.json().catch(() => ({}));
check('S2b session cookie set', Boolean(cookie) && loginBody?.user?.id, cookie ? 'cookie ok' : 'NO COOKIE');

// 3 — case list (tenant lane: bb_app + GUCs via requireOrg; decrypt proof)
const cases = await fetch(`${BASE}/api/cases`, { headers: { cookie } });
check('S3 cases 200', cases.status === 200, `status=${cases.status}`);
const casesBody = await cases.json().catch(() => ({}));
const list = casesBody.cases || casesBody.items || casesBody || [];
check('S3b cases non-empty', Array.isArray(list) && list.length > 0, `n=${Array.isArray(list) ? list.length : '?'}`);
const withPleading = (Array.isArray(list) ? list : []).find(c => c.opponentPleading || c.opponent_pleading);
const pleading = withPleading?.opponentPleading || withPleading?.opponent_pleading || '';
check('S3c opponentPleading decrypted (arabic visible)', /[؀-ۿ]/.test(pleading), String(pleading).slice(0, 60));

// 4 — write path: create probe case with an OWNER-default user, then delete.
// (lawyer@demo.kw lands in the NGO org on pg row order, where LAWYER role is
//  correctly 403 for case creation — canManageCases excludes LAWYER.)
const login2 = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ahmed@demo.kw', password: 'demo1234' })
});
const cookie2 = (login2.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
check('S4-pre owner login 200', login2.status === 200, `status=${login2.status}`);

const probeNumber = `PG-SMOKE-${Date.now()}`;
const created = await fetch(`${BASE}/api/cases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: cookie2 },
  body: JSON.stringify({
    number: probeNumber,
    court: 'محكمة الجلسة الأولية',
    caseType: 'OTHER',
    role: 'CLAIMANT',
    opponent: 'pg smoke opponent',
    subjectName: 'pg smoke probe'
  })
});
check('S4 create case 200/201', created.status === 200 || created.status === 201, `status=${created.status}`);
const createdBody = await created.json().catch(() => ({}));
const probeId = createdBody.case?.id || createdBody.id;
check('S4b probe id returned', Boolean(probeId), probeId || 'MISSING');

if (probeId) {
  const del = await fetch(`${BASE}/api/cases/${probeId}`, { method: 'DELETE', headers: { cookie: cookie2 } });
  check('S5 delete probe case', del.status === 200 || del.status === 204 || del.status === 405, `status=${del.status}`);
  if (del.status === 405) console.log('  (DELETE not exposed — probe case left as evidence, number:', probeNumber + ')');
}

// 5 — notifications inbox (per-user RLS P10)
const notif = await fetch(`${BASE}/api/notifications`, { headers: { cookie } });
check('S6 notifications 200', notif.status === 200, `status=${notif.status}`);

const failed = results.filter(r => !r.pass);
console.log(`\nAPP SMOKE: ${results.length - failed.length}/${results.length} PASSED${failed.length ? ' — FAILED: ' + failed.map(f => f.name).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
