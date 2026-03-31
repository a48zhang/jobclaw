#!/bin/bash
set -e

LOG_FILE="${JOBCLAW_TEST_LOG_FILE:-$(mktemp /tmp/jobclaw-test.XXXXXX.log)}"
VITEST_ARGS=()
RUN_ROOT="$(mktemp -d /tmp/jobclaw-test-run.XXXXXX)"
VITEST_CACHE_DIR="$RUN_ROOT/vitest-cache"
TEMP_WORKSPACE_ROOT="$RUN_ROOT/workspace-temp"

cleanup() {
  rm -rf "$RUN_ROOT"
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log-file)
      LOG_FILE="${2:-$LOG_FILE}"
      shift 2
      ;;
    --log-file=*)
      LOG_FILE="${1#*=}"
      shift
      ;;
    --runInBand)
      shift
      ;;
    *)
      VITEST_ARGS+=("$1")
      shift
      ;;
  esac
done

echo "=== Running tests, log: $LOG_FILE ===" >&2

{
  echo "=== Building Frontend ==="
  npm run frontend:build

  echo ""
  echo "=== Running TypeScript Compilation Check ==="
  npx tsc --noEmit

  echo ""
  echo "=== Running Frontend TypeScript Check ==="
  npx tsc -p tsconfig.frontend.json --noEmit

  echo ""
  echo "=== Running Tests with Coverage ==="
  export VITEST_CACHE="$VITEST_CACHE_DIR"
  export TMPDIR="$TEMP_WORKSPACE_ROOT"
  npx vitest run --coverage "${VITEST_ARGS[@]}"

  echo ""
  echo "=== Cleaning up build artifacts ==="
  rm -rf dist coverage .coverage
  rm -rf .vitest-cache

  echo ""
  echo "=== Cleaning up test temp files ==="
  find /tmp -maxdepth 1 -name 'jobclaw-*' ! -path "$LOG_FILE" -exec rm -rf {} +
  rm -rf temp_test_workspace_lock
  rm -rf workspace/.test_temp workspace/.test_pdf_temp workspace/.test_typst_temp
  rm -rf workspace/agents/test workspace/agents/test_exec workspace/agents/test_parallel \
         workspace/agents/test_compress workspace/agents/test_order workspace/agents/main-test

  echo ""
  echo "=== All tests passed! ==="
} > "$LOG_FILE" 2>&1

echo "=== Tests completed, see $LOG_FILE ===" >&2
