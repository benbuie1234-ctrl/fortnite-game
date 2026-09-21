#!/bin/sh
# Bundle each test with esbuild (so the @shared paths and TS types resolve the
# same way the app does) and run it on plain node.
set -e
TMP="${TMPDIR:-/tmp}/clutch-test.mjs"
status=0
for f in tests/*.test.ts; do
  npx esbuild "$f" --bundle --format=esm --platform=node --outfile="$TMP" --log-level=warning
  node "$TMP" || status=1
  echo ""
done
rm -f "$TMP"
exit $status
