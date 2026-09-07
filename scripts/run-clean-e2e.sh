#!/bin/bash
# Canonical clean verification cycle (harness step 1 verification flow):
#   stop server -> wipe sqlite DB -> boot -> seed -> ingest corpus ->
#   ingest RAG inbox -> full e2e. Prints verdict + counts.
set -u
export LKB_BACKEND="${LKB_BACKEND:-sqlite}" # hermetic e2e: keep LKB off the cloud deployment
cd /home/z/my-project

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
rm -f data/big-brother.db data/big-brother.db-shm data/big-brother.db-wal

setsid nohup npm run dev > /dev/null 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 2
  curl -s -m 2 "http://localhost:3000/api/health" >/dev/null 2>&1 && break
done
echo "--- health: $(curl -s -m 5 http://localhost:3000/api/health)"

echo "--- seed"
node scripts/seed.mjs 2>&1 | tail -2
echo "--- corpus ingest"
node scripts/ingest-corpus.mjs 2>&1 | tail -3
echo "--- rag inbox ingest"
node scripts/rag-ingest.mjs --scan var/rag/inbox 2>&1 | tail -4

node scripts/e2e.mjs > /tmp/e2e-out.txt 2>&1
STATUS=$?
echo "--- e2e exit: $STATUS"
grep -c "  ✔ " /tmp/e2e-out.txt | xargs echo "--- passed checks:"
grep -E "✘" /tmp/e2e-out.txt | cut -c1-160 || true
grep -E "ALL CHECKS PASSED|CHECK\(S\) FAILED" /tmp/e2e-out.txt
exit $STATUS
