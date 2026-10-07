#!/usr/bin/env bash
set -euo pipefail

# Browser provisioning is shared by PR and nightly Electron walkthroughs.
# Keep each attempt bounded so a package mirror cannot consume the whole job.
for attempt in 1 2 3; do
  if timeout 300 pnpm exec playwright install --with-deps chromium; then
    exit 0
  fi
  echo "Chromium installation attempt ${attempt} failed; retrying..." >&2
done
echo 'Chromium installation failed after 3 attempts.' >&2
exit 1
