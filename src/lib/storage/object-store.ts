// Phase A (A3): S3-compatible object storage client (MinIO self-host / AWS S3).
// Zero external deps: AWS SigV4 signing over fetch (node:crypto HMAC chain).
//
// Evidence-original guarantees (PHASE_A_SPEC A3.2/A3.3):
//  - SSE-C: object bodies are encrypted with a per-object key DERIVED from the
//    org DEK (sha256(dek|objectKey)) — the server never releases the key, and
//    crypto-shredding the org DEK (A2.4) renders every retained byte
//    permanently undecryptable, including WORM-locked objects.
//  - Object-lock COMPLIANCE mode with retain-until = retentionUntil: sealed
//    evidence cannot be altered, shortened, or deleted (even by root) before
//    the retention date — the storage-side twin of the append-only audit.
//  - Direct-upload presign cannot carry SSE-C customer keys without handing
//    the key to the client, so uploads/downloads are server-proxied; presign
//    exists per the A3.4 contract and returns 501 while SSE-C mode is on.

import { createHash, createHmac } from 'node:crypto';
import { flags } from '../config';

const amzDate = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const sha256hex = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');

interface S3Cfg { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }

function signRequest(opts: {
  method: string; bucket: string; key?: string; query?: Record<string, string>;
  extraHeaders?: Record<string, string>; body?: Buffer; payloadHash?: string;
}, cfg: S3Cfg): { url: string; headers: Record<string, string> } {
  const host = new URL(cfg.endpoint).host;
  const path = cfg.forcePathStyle ? `/${opts.bucket}${opts.key ? `/${opts.key}` : ''}` : `/${opts.key ?? ''}`;
  const query = opts.query ?? {};
  const sortedQuery = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const payloadHash = opts.payloadHash ?? (opts.body ? sha256hex(opts.body) : 'UNSIGNED-PAYLOAD');
  const date = amzDate();
  const dateShort = date.slice(0, 8);
  const baseHeaders: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date,
    ...(opts.extraHeaders ?? {})
  };
  const signedHeaderNames = Object.keys(baseHeaders).map(h => h.toLowerCase()).sort();
  const lh: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseHeaders)) lh[k.toLowerCase()] = v;
  const canonicalHeadersStr = signedHeaderNames.map(h => `${h}:${lh[h]}\n`).join('');

  const canonicalRequest = [
    opts.method,
    path,
    sortedQuery,
    canonicalHeadersStr,
    signedHeaderNames.join(';'),
    payloadHash
  ].join('\n');
  const scope = `${dateShort}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateShort);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;
  const url = `${cfg.endpoint}${path}${sortedQuery ? `?${sortedQuery}` : ''}`;
  return { url, headers: { ...baseHeaders, Authorization: authorization } };
}

/** Per-object SSE-C key derived from the org DEK (server-held, never sent to clients). */
export function ssecHeaders(objectKey: string, orgDek: Buffer): Record<string, string> {
  const key = createHash('sha256').update(Buffer.concat([orgDek, Buffer.from(objectKey)])).digest();
  return {
    'x-amz-server-side-encryption-customer-algorithm': 'AES256',
    'x-amz-server-side-encryption-customer-key': key.toString('base64'),
    'x-amz-server-side-encryption-customer-key-md5': createHash('md5').update(key).digest('base64')
  };
}

export async function ensureBucket(): Promise<{ ok: boolean; detail: string }> {
  const cfg = flags.s3();
  try {
    // Bucket must be created WITH object-lock enabled (S3 semantics: the
    // x-amz-bucket-object-lock-enabled header at creation time) so sealed
    // evidence objects can carry COMPLIANCE retain-until dates.
    const { url, headers } = signRequest({
      method: 'PUT',
      bucket: cfg.bucket,
      payloadHash: sha256hex(''),
      extraHeaders: { 'x-amz-bucket-object-lock-enabled': 'true' }
    }, cfg);
    const res = await fetch(url, { method: 'PUT', headers });
    if (res.ok || res.status === 409) return { ok: true, detail: `bucket ready (lock-enabled): ${res.status}` };
    return { ok: false, detail: `bucket create ${res.status}: ${await res.text().catch(() => '')}` };
  } catch (e) {
    return { ok: false, detail: `unreachable: ${String(e).slice(0, 120)}` };
  }
}

export async function putObject(objectKey: string, body: Buffer, opts: {
  orgDek: Buffer; retentionUntil: Date; contentType: string;
}): Promise<{ ok: boolean; versionId?: string; error?: string }> {
  const cfg = flags.s3();
  const { url, headers } = signRequest({
    method: 'PUT',
    bucket: cfg.bucket,
    key: objectKey,
    body,
    extraHeaders: {
      'content-type': opts.contentType,
      ...ssecHeaders(objectKey, opts.orgDek),
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': opts.retentionUntil.toISOString()
    }
  }, cfg);
  const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
  if (!res.ok) return { ok: false, error: `put ${res.status}: ${await res.text().catch(() => '')}` };
  return { ok: true, versionId: res.headers.get('x-amz-version-id') ?? undefined };
}

export async function getObject(objectKey: string, orgDek: Buffer): Promise<{ ok: true; body: Buffer } | { ok: false; status: number }> {
  const cfg = flags.s3();
  const { url, headers } = signRequest({
    method: 'GET', bucket: cfg.bucket, key: objectKey,
    payloadHash: 'UNSIGNED-PAYLOAD',
    extraHeaders: ssecHeaders(objectKey, orgDek)
  }, cfg);
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: Buffer.from(await res.arrayBuffer()) };
}

/** Admin-level delete (PA-10 proves WORM blocks this before retention). */
export async function deleteObject(objectKey: string, orgDek: Buffer): Promise<{ ok: boolean; status: number; error?: string }> {
  const cfg = flags.s3();
  const { url, headers } = signRequest({
    method: 'DELETE', bucket: cfg.bucket, key: objectKey,
    payloadHash: 'UNSIGNED-PAYLOAD',
    extraHeaders: ssecHeaders(objectKey, orgDek)
  }, cfg);
  const res = await fetch(url, { method: 'DELETE', headers });
  if (res.ok || res.status === 204) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: await res.text().catch(() => '') };
}

/** Direct-upload presign (A3.4). Returns 501-style error while SSE-C mode is
 *  active — the customer key must never reach the client. */
export async function presignUpload(_objectKey: string, _expiresSec = 300): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  return { ok: false, error: 'direct-upload presign unavailable while DEK/SSE-C evidence mode is on — use the sealed POST upload (server-held keys)' };
}

export async function presignDownload(_objectKey: string, _expiresSec = 300): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return { ok: false, error: 'presigned download unavailable while DEK/SSE-C evidence mode is on — use the authenticated download endpoint (proxied, audited)' };
}

export async function virusScan(buf: Buffer): Promise<'clean' | 'infected' | 'skipped'> {
  const provider = flags.virusScanProvider();
  if (provider === 'none') return 'skipped';
  if (provider === 'clamav') {
    // INSTREAM protocol: port z, send CHUNK with size prefix, ZPOX/0\n
    try {
      const net = await import('node:net');
      return await new Promise(resolve => {
        const sock = net.connect(flags.clamav().port, flags.clamav().host, () => {
          sock.write(`zINSTREAM\0`);
          const chunk = 8192;
          for (let i = 0; i < buf.length; i += chunk) {
            const part = buf.subarray(i, Math.min(i + chunk, buf.length));
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length);
            sock.write(len); sock.write(part);
          }
          sock.write(Buffer.from([0, 0, 0, 0]));
        });
        let out = '';
        sock.on('data', d => { out += d.toString('utf8'); });
        sock.on('close', () => resolve(out.includes('FOUND') ? 'infected' : 'clean'));
        sock.on('error', () => resolve('skipped'));
        setTimeout(() => { sock.destroy(); resolve('skipped'); }, 10_000).unref();
      });
    } catch {
      return 'skipped';
    }
  }
  return 'skipped';
}
