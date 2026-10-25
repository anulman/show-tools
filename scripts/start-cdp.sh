#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/chart-env.sh"

exec node --import tsx "$(dirname "$0")/start-cdp.ts"
