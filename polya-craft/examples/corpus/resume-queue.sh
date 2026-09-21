#!/bin/sh
# Resumes the runs run-corpus.sh left stopped, one at a time, in the order they stopped, from this checkout with
# whatever fixes have landed since. Reads .runs/corpus/resume-queue.txt (name, agent id, a note), same budget rule.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT" || exit 1
export PATH="/opt/homebrew/bin:$PATH"
export WORK_ROOT="${WORK_ROOT:-$HOME/.cache/cloud-agents-work}"
export TMPDIR="$WORK_ROOT/tmp"; mkdir -p "$TMPDIR"
export POLYA_ORACLE=1
SUMMARY=.runs/corpus/summary.tsv
QUEUE=.runs/corpus/resume-queue.txt
[ -f "$QUEUE" ] || { echo "no queue"; exit 0; }
while read -r name agent note; do
  [ -n "$name" ] || continue
  if grep -q "^$name-resume$(printf '\t')" "$SUMMARY"; then echo "skip $name (resumed already)"; continue; fi
  util=$(python3 -c 'import json;print(json.load(open(".runs/max-usage.json")).get("utilization",0))' 2>/dev/null || echo 0)
  if python3 -c "import sys; sys.exit(0 if float('$util') >= 0.75 else 1)"; then
    echo "stop: Max at $util, above the 75 % rule; not resuming $name"; break
  fi
  LOG=.runs/corpus/$name-resume.log
  echo "== resume $name ($agent)  (Max $util)  $(date -u +%FT%TZ) =="
  npm run build-app -- --resume "$agent" > "$LOG" 2>&1
  code=$?
  result=$(grep -m1 '^RESULT:' "$LOG" | sed 's/^RESULT: //')
  cost=$(grep -A1 '^COST$' "$LOG" | tail -1 | sed 's/^ *this run: *//')
  printf '%s-resume\t%s\t%s\t%s\t%s\n' "$name" "$(date -u +%FT%TZ)" "${result:-exit $code}" "$agent" "$cost" >> "$SUMMARY"
  echo "== $name resume: ${result:-exit $code}  $cost"
done < "$QUEUE"
echo "resume driver done $(date -u +%FT%TZ)"
