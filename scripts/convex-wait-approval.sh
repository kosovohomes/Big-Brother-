#!/bin/bash
# Big Brother -> Convex vivid-hare-882: wait for device-approval, back up token
cd /home/z/my-project
TOKEN=/home/z/.convex/config.json
for i in $(seq 1 84); do
  if [ -s "$TOKEN" ]; then
    echo "APPROVED after ~$((i*5))s"
    cp "$TOKEN" scripts/convex-token-backup.json && echo "token backed up to scripts/convex-token-backup.json"
    exit 0
  fi
  sleep 5
done
echo "TIMEOUT: not approved within window"
tail -5 scripts/convex-login.log
exit 2
