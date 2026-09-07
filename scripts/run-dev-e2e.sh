#!/bin/bash
# Boot the dev server (fully detached via a self-exiting spawner so it is
# reparented to PID 1 and survives the tool-call boundary), wait for Ready,
# run the e2e suite, print verdict + counts.
# Usage: [ENV=... ] bash scripts/run-dev-e2e.sh
set -u
export LKB_BACKEND="${LKB_BACKEND:-sqlite}" # hermetic e2e: keep LKB off the cloud deployment
cd /home/z/my-project

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2

node -e "const {spawn}=require('child_process'); const c=spawn('npm',['run','dev'],{detached:true,stdio:'ignore',cwd:process.cwd(),env:process.env}); c.unref();"
for i in $(seq 1 40); do
  sleep 2
  curl -s -m 2 "http://localhost:3000/api/health" >/dev/null 2>&1 && break
done
echo "--- health: $(curl -s -m 5 http://localhost:3000/api/health)"

node scripts/e2e.mjs > /tmp/e2e-out.txt 2>&1
STATUS=$?
echo "--- e2e exit: $STATUS"
grep -c "  ✔ " /tmp/e2e-out.txt | xargs echo "--- passed checks:"
grep -E "✘" /tmp/e2e-out.txt | cut -c1-160 || true
grep -E "ALL CHECKS PASSED|CHECK\(S\) FAILED" /tmp/e2e-out.txt
exit $STATUS
