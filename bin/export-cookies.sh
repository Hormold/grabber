#!/bin/bash
# Export Twitter cookies from Chrome to .env format for docker deployment
# Run this locally before deploying to remote server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GRABBER_DIR="$(dirname "$SCRIPT_DIR")"
BIRD="$SCRIPT_DIR/bird"
OUTPUT_FILE="${1:-$GRABBER_DIR/docker-cookies.env}"

echo "Extracting Twitter cookies from Chrome..."

# Run bird check and capture full output
CHECK_OUTPUT=$("$BIRD" check --plain 2>&1) || true

# Extract full auth_token value (after "auth_token: ")
AUTH_TOKEN=$(echo "$CHECK_OUTPUT" | grep -o 'auth_token: [a-f0-9]*' | sed 's/auth_token: //')
CT0=$(echo "$CHECK_OUTPUT" | grep -o 'ct0: [a-f0-9]*' | sed 's/ct0: //')

if [ -z "$AUTH_TOKEN" ] || [ -z "$CT0" ]; then
    echo "ERROR: Could not extract cookies from browsers."
    echo ""
    echo "Debug output:"
    echo "$CHECK_OUTPUT"
    echo ""
    echo "Make sure you're logged into x.com in Chrome or Firefox."
    exit 1
fi

# Write to file
cat > "$OUTPUT_FILE" << EOF
# Twitter cookies exported on $(date)
# Use with: docker run --env-file docker-cookies.env grabber
TWITTER_AUTH_TOKEN=$AUTH_TOKEN
TWITTER_CT0=$CT0
EOF

echo "Cookies exported to: $OUTPUT_FILE"
echo ""
echo "Auth token length: ${#AUTH_TOKEN} chars"
echo "CT0 length: ${#CT0} chars"
echo ""
echo "To use with docker:"
echo "  docker run --env-file $OUTPUT_FILE grabber"
