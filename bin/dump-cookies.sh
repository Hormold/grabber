#!/bin/bash
# Dump Twitter cookies from browsers to cookies.txt
# Uses bird's check command to show available credentials

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GRABBER_DIR="$(dirname "$SCRIPT_DIR")"
BIRD="$SCRIPT_DIR/bird"

echo "Checking available Twitter credentials..."
echo ""

# Run bird check to see what's available
"$BIRD" check --plain 2>&1 || true

echo ""
echo "---"
echo ""

# Try to get current user to verify auth works
echo "Testing authentication..."
USER_INFO=$("$BIRD" whoami --plain 2>&1) || true

if echo "$USER_INFO" | grep -q "^@"; then
    echo "Authenticated as: $USER_INFO"
    echo ""
    echo "Bird can access Twitter via browser cookies."
    echo "No manual cookie export needed - bird reads directly from browsers."
else
    echo "Could not authenticate. Possible issues:"
    echo "  1. Not logged into x.com in any browser"
    echo "  2. Browser cookies not accessible (permissions)"
    echo ""
    echo "To manually set credentials, add to .env:"
    echo "  TWITTER_AUTH_TOKEN=your_auth_token"
    echo "  TWITTER_CT0=your_ct0"
    echo ""
    echo "You can get these from browser DevTools:"
    echo "  1. Go to x.com in Chrome"
    echo "  2. Open DevTools (F12) -> Application -> Cookies -> https://x.com"
    echo "  3. Copy 'auth_token' and 'ct0' values"
fi
