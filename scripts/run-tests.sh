#!/usr/bin/env bash
# r103 — ONE test runner for the whole pinned-suite family.
#
# History: rounds ran tests ad hoc via `npx tsx` or `bun`, and 4 scripts
# using top-level await failed under tsx's CJS transform (they pass under
# bun, which executes TS natively). VERIFIED r103: every test in this
# directory runs green under bun — so bun is the single sanctioned runner
# and `bun scripts/run-tests.sh` (or `bun run test`) is the one command.
#
# Usage: cd /home/z/my-project && bun scripts/run-tests.sh
# Exit 0 = all green; exit 1 = at least one failure (name + tail printed).

set -u
cd "$(dirname "$0")/.."

fail=0
ran=0
for f in scripts/test-*.ts; do
  ran=$((ran + 1))
  out=$(bun "$f" 2>&1)
  code=$?
  if [ $code -ne 0 ]; then
    fail=$((fail + 1))
    echo "FAIL  $(basename "$f")"
    echo "$out" | tail -5
  else
    echo "PASS  $(basename "$f"): $(echo "$out" | grep -Eo '[0-9]+ passed[^,)]*(, [0-9]+ failed)?' | tail -1 || echo ok)"
  fi
done
echo "----"
echo "$ran test files, $fail failed"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
