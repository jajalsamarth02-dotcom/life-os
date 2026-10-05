#!/bin/sh
# ensure-dev.sh — make sure the Next.js dev server is serving on :3000.
# The sandbox reaps spawned process trees between tool calls, so every call
# that needs the server must run this first. Warm Turbopack cache → ~10s.
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000/ 2>/dev/null)
if [ "$code" = "200" ]; then
  echo "[ensure-dev] already up"
  exit 0
fi
cd /home/z/my-project
setsid nohup bun run dev >>/tmp/devsrv.log 2>&1 &
i=0
while [ $i -lt 30 ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "[ensure-dev] up (waited ~$((i*3))s)"
    exit 0
  fi
  sleep 3
  i=$((i+1))
done
echo "[ensure-dev] FAILED to come up within 90s" >&2
exit 1
