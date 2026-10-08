#!/usr/bin/env bash
# Runs every browser test. Requires python3 + playwright (chromium).
cd "$(dirname "$0")/.."
fail=0
for t in test_core test_team test_edit_demo test_edit_api test_template_typing; do
  out=$(python3 "tests/$t.py" 2>&1); rc=$?
  echo "$out" | grep -E "^FAIL|FAILURES"
  [ $rc -ne 0 ] && fail=1
done
exit $fail
