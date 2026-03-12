#!/bin/bash
set -e

echo "=== Running TypeScript Compilation Check ==="
npx tsc --noEmit

echo ""
echo "=== Running Tests with Coverage ==="
npx vitest run --coverage

echo ""
echo "=== Cleaning up build artifacts ==="
rm -rf dist coverage .coverage

echo ""
echo "=== All tests passed! ==="
