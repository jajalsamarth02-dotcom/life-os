#!/bin/bash
# Dev-server watchdog — tightens the keeper's 5-min restart cadence to ~10s.
# ONLY starts the server when nothing is serving AND no next-server exists.
# Never kills a running next-server. Single instance via pidfile.

PIDFILE="/tmp/erp-watchdog.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0
fi
echo $$ > "$PIDFILE"

while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null)
  if [ "$code" != "200" ]; then
    # double-check there is really no live next-server before spawning
    if ! pgrep -f "next-server" >/dev/null 2>&1; then
      cd /home/z/my-project || exit 1
      NODE_OPTIONS="--max-old-space-size=1024" setsid nohup bun run dev </dev/null >>/tmp/watchdog-devsrv.log 2>&1 &
    fi
  fi
  sleep 10
done
