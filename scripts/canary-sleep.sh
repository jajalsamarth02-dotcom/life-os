#!/bin/bash
# canary control: identical spawn method to watchdog.sh, different job
for i in $(seq 1 180); do
  echo "$(date '+%F %T') canary alive ($i)" >> /tmp/canary.log
  sleep 20
done
