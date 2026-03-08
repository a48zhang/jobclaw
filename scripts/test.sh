#!/bin/bash
set -e

echo "=== Running TypeScript Compilation Check ==="
bunx tsc --noEmit

echo ""
echo "=== Running Tests with Coverage ==="
bun test --coverage

echo ""
echo "=== Cleaning up build artifacts ==="
rm -rf dist coverage .coverage

echo ""
echo "=== All tests passed! ==="
