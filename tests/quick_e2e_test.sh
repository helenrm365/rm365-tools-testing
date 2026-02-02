#!/bin/bash
# Quick E2E Test for All 3 Regions

TOKEN=$(cat /tmp/token.txt)
BASE="http://localhost:8000/api"

echo "=============================================="
echo "   QUICK E2E TEST - ALL 3 REGIONS"
echo "=============================================="

test_region() {
    local region=$1
    local prefix=$2
    
    echo ""
    echo "--- $region ---"
    
    # Test 1: Tracking Board
    result=$(curl -s --max-time 30 "$BASE$prefix/tracking/board" -H "Authorization: Bearer $TOKEN")
    if echo "$result" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'✅ Tracking Board: rtp={len(d.get(\"ready_to_pick\",[]))}, rtc={len(d.get(\"ready_to_check\",[]))}, comp={len(d.get(\"completed\",[]))}')" 2>/dev/null; then
        :
    else
        echo "❌ Tracking Board FAILED"
    fi
    
    # Get first order number
    order=$(echo "$result" | python3 -c "import sys,json;d=json.load(sys.stdin);orders=d.get('ready_to_pick',[])+d.get('completed',[]);print(orders[0]['order_number'] if orders else '')" 2>/dev/null)
    
    if [ -n "$order" ]; then
        # Test 2: Invoice Lookup
        result=$(curl -s --max-time 30 "$BASE$prefix/invoice/lookup/$order" -H "Authorization: Bearer $TOKEN")
        if echo "$result" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'✅ Invoice Lookup: order={d.get(\"order_number\")}, invoice={d.get(\"invoice_number\")}')" 2>/dev/null; then
            :
        else
            echo "❌ Invoice Lookup FAILED"
        fi
        
        # Test 3: Session Check
        result=$(curl -s --max-time 30 "$BASE$prefix/session/check/$order" -H "Authorization: Bearer $TOKEN")
        if echo "$result" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'✅ Session Check: has_session={d.get(\"has_session\")}, status={d.get(\"status\")}')" 2>/dev/null; then
            :
        else
            echo "❌ Session Check FAILED"
        fi
    fi
    
    # Test 4: Active Sessions
    result=$(curl -s --max-time 30 "$BASE$prefix/sessions/active" -H "Authorization: Bearer $TOKEN")
    if echo "$result" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'✅ Active Sessions: count={len(d)}')" 2>/dev/null; then
        :
    else
        echo "❌ Active Sessions FAILED"
    fi
    
}

# Test all regions
test_region "BIRMINGHAM (UK)" "/v1/magento"
test_region "FRANCE (FR/NL)" "/v1/france-magento"
test_region "LONDON (UK)" "/v1/london-magento"

echo ""
echo "=============================================="
echo "   E2E TEST COMPLETE"
echo "=============================================="
