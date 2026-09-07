// Phase A (A4.5): environment/config matrix. Defaults reproduce today's
// sandbox behavior exactly — the 98 pre-Phase-A e2e checks never depend on
// new infrastructure.

export const flags = {
  storageBackend: (): 'sqlite' | 'pg' => (process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'sqlite'),
  rlsEnforced: (): boolean => process.env.RLS_ENFORCED !== 'false',
  encryptionEnabled: (): boolean => process.env.ENCRYPTION_ENABLED !== 'false',
  kmsProvider: (): 'dev' | 'vault' | 'aws' =>
    (process.env.KMS_PROVIDER as 'dev' | 'vault' | 'aws') || 'dev',
  kmsDevMasterKeyFile: (): string => process.env.KMS_DEV_MASTER_KEY_FILE || './data/dev-master.key',
  objectStorageEnabled: (): boolean => process.env.OBJECT_STORAGE_ENABLED === 'true',
  s3: () => ({
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || 'bb-docs',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false'
  }),
  docMaxUploadMb: (): number => Number(process.env.DOC_MAX_UPLOAD_MB || 25),
  docRetentionYears: (): number => Number(process.env.DOC_RETENTION_YEARS || 5),
  virusScanProvider: (): 'none' | 'clamav' => (process.env.VIRUS_SCAN_PROVIDER as 'none' | 'clamav') || 'none',
  clamav: () => ({ host: process.env.CLAMAV_HOST || 'localhost', port: Number(process.env.CLAMAV_PORT || 3310) }),

  // ---------- RAG Phase 1 (docs/RAG_SPEC.md, DELIVERABLES §7.1) ----------
  // Defaults keep the harness contract: retrieval degrades to lexical-only
  // (BM25 over the shared arabic tokenization) when no local embed service
  // is configured. No external embedding/LLM API exists in this matrix by
  // design (RAG_SPEC §3.1/§5.3 — all inference stays in the deployment).
  ragEnabled: (): boolean => process.env.RAG_ENABLED !== 'false', // flag = rollback switch
  ragInbox: (): string => process.env.RAG_INBOX || './var/rag/inbox',
  ragOllamaHost: (): string => process.env.RAG_OLLAMA_HOST || '',
  ragEmbedModel: (): string => process.env.RAG_EMBED_MODEL || 'bge-m3',
  ragEmbedDim: (): number => Number(process.env.RAG_EMBED_DIM || 1024),
  ragMaxChunkChars: (): number => Number(process.env.RAG_MAX_CHUNK_CHARS || 1200)
};
