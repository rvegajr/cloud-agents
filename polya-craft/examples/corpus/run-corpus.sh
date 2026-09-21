#!/bin/sh
# Runs the corpus in order, one at a time, from this checkout, and stops starting runs at 75 % of the Max
# weekly window (NEXT-SESSION.md's rule; the engine itself diverts at 85 %). A run that stops is left for
# `--resume`; the driver moves on and records the RESULT line. Logs live under .runs/corpus/, not a temp dir.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p .runs/corpus
export PATH="/opt/homebrew/bin:$PATH"
export WORK_ROOT="${WORK_ROOT:-$HOME/.cache/cloud-agents-work}"
# Colima shares only $HOME with containers: a check that mounts a mktemp file needs mktemp to land under it too.
export TMPDIR="$WORK_ROOT/tmp"; mkdir -p "$TMPDIR"
export POLYA_ORACLE=1
SUMMARY=.runs/corpus/summary.tsv
[ -f "$SUMMARY" ] || printf 'name\tstarted\tresult\tagent\tcost\n' > "$SUMMARY"
python3 -c 'import json;[print(e["name"], e["file"], e.get("create","-"), e.get("repo","-"), e.get("ref","-")) for e in json.load(open("polya-craft/examples/corpus/manifest.json"))]' |
name= file= create= repo= ref=
while read -r name file create repo ref; do
  if grep -q "^$name$(printf '\t')" "$SUMMARY"; then echo "skip $name (already in summary)"; continue; fi
  util=$(python3 -c 'import json;print(json.load(open(".runs/max-usage.json")).get("utilization",0))' 2>/dev/null || echo 0)
  if python3 -c "import sys; sys.exit(0 if float('$util') >= 0.75 else 1)"; then
    echo "stop: Max at $util, above the 75 % rule; not starting $name"; printf '%s\t%s\tnot-started (Max %s)\t\t\n' "$name" "$(date -u +%FT%TZ)" "$util" >> "$SUMMARY"; break
  fi
  LOG=.runs/corpus/$name.log
  echo "== $name  (Max $util)  $(date -u +%FT%TZ) =="
  if [ "$create" != "-" ]; then
    npm run build-app -- --loop polya --engine hybrid --idea-file "polya-craft/examples/corpus/$file" --create-repo "$create" > "$LOG" 2>&1
  else
    npm run build-app -- --loop polya --engine hybrid --idea-file "polya-craft/examples/corpus/$file" --repo "$repo" --ref "$ref" > "$LOG" 2>&1
  fi
  code=$?
  result=$(grep -m1 '^RESULT:' "$LOG" | sed 's/^RESULT: //')
  agent=$(grep -m1 -o 'cc-[0-9a-f-]\{36\}' "$LOG")
  cost=$(grep -A1 '^COST$' "$LOG" | tail -1 | sed 's/^ *this run: *//')
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$(date -u +%FT%TZ)" "${result:-exit $code}" "$agent" "$cost" >> "$SUMMARY"
  echo "== $name: ${result:-exit $code}  $cost"
done
echo "corpus driver done $(date -u +%FT%TZ)"
