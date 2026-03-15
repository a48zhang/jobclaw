#!/bin/bash
set -e

LOG_FILE="${1:-/tmp/jobclaw-test.log}"

echo "=== Running tests, log: $LOG_FILE ===" >&2

{
  echo "=== Running TypeScript Compilation Check ==="
  npx tsc --noEmit

  echo ""
  echo "=== Running Tests with Coverage ==="
  export VITEST_CACHE=/tmp/vitest_cache
  npx vitest run --coverage

  echo ""
  echo "=== Cleaning up build artifacts ==="
  rm -rf dist coverage .coverage

  echo ""
  echo "=== Cleaning up test temp files ==="
  rm -rf /tmp/vitest_cache
  rm -rf /tmp/jobclaw-*
  rm -rf temp_test_workspace_lock
  rm -rf workspace/.test_temp workspace/.test_pdf_temp workspace/.test_typst_temp
  rm -rf workspace/agents/test workspace/agents/test_exec workspace/agents/test_parallel \
         workspace/agents/test_compress workspace/agents/test_order workspace/agents/main-test

  echo ""
  echo "=== All tests passed! ==="
} > "$LOG_FILE" 2>&1

echo "=== Tests completed, see $LOG_FILE ===" >&2
