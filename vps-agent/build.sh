#!/bin/bash
set -e
echo "Building VPS agent..."
cd "$(dirname "$0")"
npm run build
echo "Build complete. dist/ ready for Docker."
