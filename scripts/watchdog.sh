#!/bin/bash
# watchdog.sh — ERP Sync dev-server canary + resurrector (Task ID 17)
# - Heartbeat log every ~20s: /tmp/watchdog.log (uptime evidence, RSS trend)
# - If port 3000 is down AND no dev process exists: spawn via the keeper's exact
#   command (setsid nohup bun run dev), never kills anything.
# - If a dev process exists but is not answering (compiling), it waits.
# - Doubles as a forensic canary: if this log shows gaps, the silent killer
#   takes the watchdog too => platform-level sweep, not a targeted kill.

LOG=/tmp/watchdog.log
APP=/home/z/my-project

# single-instance guard via pidfile (pgrep-based guard false-positives on the
# launching shell whose cmdline contains this script path)
PIDFILE=/tmp/erp-watchdog-v2.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "$(date '+%F %T') another watchdog alive (pid $(cat "$PIDFILE")) — exiting" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"

echo "$(date '+%F %T') watchdog started (pid $$, ppid $(ps -o ppid= -p $$ 2>/dev/null | tr -d ' '))" >> "$LOG"

probe() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null
}

while true; do
  code=$(probe)
  if [ "$code" = "200" ]; then
    rss=$(ps -eo rss,comm --sort=-rss 2>/dev/null | awk '/next-server/{print $1; exit}')
    echo "$(date '+%F %T') up rss=${rss:-0}kB" >> "$LOG"
  else
    if pgrep -f "next dev" >/dev/null 2>&1 || pgrep -f "bun run dev" >/dev/null 2>&1; then
      echo "$(date '+%F %T') code=$code but dev process exists (compiling?) — waiting" >> "$LOG"
      sleep 30
    else
      echo "$(date '+%F %T') code=$code, no dev process -> SPAWN" >> "$LOG"
      cd "$APP" && setsid nohup bun run dev </dev/null >>/tmp/devsrv.log 2>&1 &
      c=000
      for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        sleep 8
        c=$(probe)
        [ "$c" = "200" ] && break
      done
      echo "$(date '+%F %T') spawn result code=$c" >> "$LOG"
    fi
  fi
  # keep log bounded (~2MB)
  if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 2097152 ]; then
    tail -n 3000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
  sleep 20
done
