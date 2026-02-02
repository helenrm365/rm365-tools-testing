#!/bin/bash

# Mobile Mode Auto-Toggle - Manual Test Script
# This script guides you through testing the mobile mode auto-toggle feature

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Mobile Mode Auto-Toggle Test - Order Fulfillment             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Test URL:${NC} http://localhost:8000/orders/order-fulfillment"
echo ""

echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}                    AUTOMATED CHECKS                           ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check 1: Verify file exists and has our changes
echo -e "${BLUE}Check 1:${NC} Verifying implementation in source file..."
if grep -q "checkMobileSize" /Users/ianhjweng/Documents/github/rm365-tools-testing/frontend/js/modules/birmingham-orders/order-fulfillment.js; then
    echo -e "${GREEN}✓${NC} checkMobileSize function found"
else
    echo -e "${RED}✗${NC} checkMobileSize function NOT found"
    exit 1
fi

if grep -q "window.addEventListener('resize', this.resizeHandler)" /Users/ianhjweng/Documents/github/rm365-tools-testing/frontend/js/modules/birmingham-orders/order-fulfillment.js; then
    echo -e "${GREEN}✓${NC} Resize event listener found"
else
    echo -e "${RED}✗${NC} Resize event listener NOT found"
    exit 1
fi

if grep -q "window.removeEventListener('resize', this.resizeHandler)" /Users/ianhjweng/Documents/github/rm365-tools-testing/frontend/js/modules/birmingham-orders/order-fulfillment.js; then
    echo -e "${GREEN}✓${NC} Resize handler cleanup found"
else
    echo -e "${RED}✗${NC} Resize handler cleanup NOT found"
    exit 1
fi

echo ""

# Check 2: Verify breakpoint value
echo -e "${BLUE}Check 2:${NC} Verifying mobile mode breakpoint..."
if grep -q "window.innerWidth <= 768" /Users/ianhjweng/Documents/github/rm365-tools-testing/frontend/js/modules/birmingham-orders/order-fulfillment.js; then
    echo -e "${GREEN}✓${NC} Breakpoint is 768px (≤768 = mobile mode)"
else
    echo -e "${RED}✗${NC} Breakpoint is NOT 768px"
    exit 1
fi

echo ""

# Check 3: Verify debounce
echo -e "${BLUE}Check 3:${NC} Verifying debounce implementation..."
if grep -q "setTimeout" /Users/ianhjweng/Documents/github/rm365-tools-testing/frontend/js/modules/birmingham-orders/order-fulfillment.js | head -1; then
    echo -e "${GREEN}✓${NC} Debounce implementation found"
else
    echo -e "${YELLOW}⚠${NC} Debounce might not be implemented"
fi

echo ""

# Check 4: Verify backend serves test files
echo -e "${BLUE}Check 4:${NC} Verifying backend configuration..."
if grep -q "TESTS_DIR" /Users/ianhjweng/Documents/github/rm365-tools-testing/backend/app.py; then
    echo -e "${GREEN}✓${NC} Backend configured to serve tests directory"
else
    echo -e "${YELLOW}⚠${NC} Backend might not serve tests directory"
fi

echo ""
echo -e "${GREEN}All automated checks passed!${NC}"
echo ""

echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}                    MANUAL TEST STEPS                          ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}TEST 1: Desktop Size (>768px)${NC}"
echo "  1. Open: http://localhost:8000/orders/order-fulfillment"
echo "  2. Make browser window WIDE (>768px)"
echo "  3. Verify:"
echo "     • Mobile Mode toggle is OFF (unchecked)"
echo "     • All three columns visible side-by-side"
echo "     • No mobile tabs at top"
echo ""
read -p "Press Enter after completing Test 1..."
echo ""

echo -e "${BLUE}TEST 2: Mobile Size (≤768px)${NC}"
echo "  1. Keep the same tab open"
echo "  2. Make browser window NARROW (≤768px)"
echo "  3. Verify:"
echo "     • Mobile Mode toggle is ON (checked)"
echo "     • Mobile tabs visible at top"
echo "     • Only one column visible at a time"
echo ""
read -p "Press Enter after completing Test 2..."
echo ""

echo -e "${BLUE}TEST 3: Back to Desktop${NC}"
echo "  1. Keep the same tab open"
echo "  2. Make browser window WIDE again (>768px)"
echo "  3. Verify:"
echo "     • Mobile Mode automatically turns OFF"
echo "     • All columns visible again"
echo "     • Mobile tabs hidden"
echo ""
read -p "Press Enter after completing Test 3..."
echo ""

echo -e "${BLUE}TEST 4: Edge Case - Exactly 768px${NC}"
echo "  1. Keep the same tab open"
echo "  2. Use browser DevTools to set width to exactly 768px"
echo "     • Press F12 to open DevTools"
echo "     • Press Cmd+Shift+M (Mac) or Ctrl+Shift+M (Windows/Linux)"
echo "     • Set width to 768px"
echo "  3. Verify:"
echo "     • Mobile Mode is ON (breakpoint is ≤768px)"
echo ""
read -p "Press Enter after completing Test 4..."
echo ""

echo -e "${BLUE}TEST 5: Manual Toggle${NC}"
echo "  1. Keep the same tab open"
echo "  2. Manually click the Mobile Mode toggle"
echo "  3. Verify:"
echo "     • Toggle works and changes the view"
echo "  4. Resize the window"
echo "  5. Verify:"
echo "     • Auto-detection overrides manual setting"
echo ""
read -p "Press Enter after completing Test 5..."
echo ""

echo -e "${BLUE}TEST 6: Rapid Resize (Performance)${NC}"
echo "  1. Keep the same tab open"
echo "  2. Rapidly resize window multiple times"
echo "  3. Verify:"
echo "     • No lag or performance issues"
echo "     • Final state is correct"
echo "     • No console errors"
echo ""
read -p "Press Enter after completing Test 6..."
echo ""

echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}                    CONSOLE TEST                               ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

echo "Optional: Run this in the browser console to monitor resize events:"
echo ""
echo -e "${GREEN}window.addEventListener('resize', () => {"
echo "  const t = document.getElementById('mobileModeToggle');"
echo "  console.log(\`Width: \${window.innerWidth}px, Mode: \${t.checked ? 'ON' : 'OFF'}\`);"
echo "});${NC}"
echo ""

echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}                    TEST COMPLETE                              ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

echo "Did all tests pass? (y/n)"
read -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    ✓ ALL TESTS PASSED                      ║${NC}"
    echo -e "${GREEN}║  Mobile Mode Auto-Toggle is working correctly!            ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 0
else
    echo ""
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                    ✗ TESTS FAILED                          ║${NC}"
    echo -e "${RED}║  Please review the implementation and try again           ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
