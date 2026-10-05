#!/bin/sh
# dev-keepalive.sh — respawn the Next.js dev server whenever it is killed.
# The sandbox reaps background processes between tool calls; this loop brings
# it back within ~2s so browser QA sessions stay usable.
cd /home/z/my-project
while true; do
  bun run dev >>/tmp/devsrv.log 2>&1
  code=$?
  echo "[keepalive] $(date '+%H:%M:%S') dev server exited (code=$code), respawning in 2s..." >>/tmp/devsrv.log
  sleep 2
done
