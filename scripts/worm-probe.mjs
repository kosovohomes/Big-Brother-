// Phase A (PA-10): WORM probe — proves object-lock COMPLIANCE enforcement.
// S3 semantics: DELETE on a versioned bucket only adds a DELETE MARKER (204);
// the locked object VERSION survives. The probe therefore:
//   1. DELETE the object (expects 204 — marker only)
//   2. lists versions — the sealed version MUST survive under the marker
//   3. DELETEs the SPECIFIC version (expects AccessDenied/ObjectLock refusal)
// Uses the official AWS SDK (devDependency, probe-only — the runtime seal path
// stays zero-dependency). Prints WORM/LOCK markers the e2e suite asserts on;
// exit 2 when WORM is NOT enforced.
// Usage: node scripts/worm-probe.mjs s3://<bucket>/<key>
// Env: S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY

import { S3Client, DeleteObjectCommand, ListObjectVersionsCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const s3Uri = process.argv[2] || '';
const objectKey = s3Uri.replace(/^s3:\/\/[^/]+\//, '');
const Bucket = process.env.S3_BUCKET || 'bb-docs';
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'https://localhost:9000',
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'bbroot',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'bbrootsecret'
  }
});
if (!objectKey) { console.error('usage: node scripts/worm-probe.mjs s3://<bucket>/<key>'); process.exit(1); }

// 0. retention metadata (best-effort: SSE-C objects hide HEAD metadata without
//    the per-object key, which is server-held by design)
try {
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key: objectKey }));
  console.log(`worm-probe: retention mode=${head.ObjectLockMode} until=${head.ObjectLockRetainUntilDate}`);
  if (head.ObjectLockMode && head.ObjectLockMode !== 'COMPLIANCE') {
    console.log('worm-probe: sealed object is NOT under COMPLIANCE retention!');
    process.exit(2);
  }
} catch (e) {
  console.log(`worm-probe: retention pre-check unavailable (${String(e?.message || e).slice(0, 60)}) — proceeding to the decisive version-delete proof`);
}

// 1. top-level DELETE (delete marker)
const del = await s3.send(new DeleteObjectCommand({ Bucket, Key: objectKey }));
console.log(`worm-probe: DELETE (marker) -> ${del.$metadata.httpStatusCode}`);

// 2. the sealed version must survive under the marker
const lv = await s3.send(new ListObjectVersionsCommand({ Bucket, Prefix: objectKey }));
const versions = (lv.Versions || []).filter(v => v.Key === objectKey).map(v => v.VersionId);
console.log(`worm-probe: surviving locked versions: ${versions.length}`);
if (!versions.length) {
  console.log('worm-probe: NO surviving version — the sealed object was destroyed (WORM NOT enforced!)');
  process.exit(2);
}

// 3. version-level DELETE must be refused (COMPLIANCE)
let enforced = false;
for (const VersionId of versions) {
  try {
    const r = await s3.send(new DeleteObjectCommand({ Bucket, Key: objectKey, VersionId }));
    console.log(`worm-probe: version DELETE ${String(VersionId).slice(0, 12)}… -> ${r.$metadata.httpStatusCode} (UNEXPECTED)`);
    enforced = false;
  } catch (e) {
    const msg = String(e?.message || e);
    console.log(`worm-probe: version DELETE ${String(VersionId).slice(0, 12)}… REFUSED: ${msg.slice(0, 120)}`);
    // any refusal naming the lock/WORM protection counts as enforcement
    if (/WORM|protected|AccessDenied|Compliance|ObjectLock/i.test(msg)) enforced = true;
  }
}

if (enforced) {
  console.log('worm-probe: storage REFUSED the version-level delete — WORM COMPLIANCE enforcement confirmed');
} else {
  console.log('worm-probe: version delete NOT refused — WORM COMPLIANCE NOT enforced!');
  process.exit(2);
}
