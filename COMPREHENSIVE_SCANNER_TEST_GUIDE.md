# 🧪 Comprehensive Scanner Workflow End-to-End Test Guide

## 📋 Overview
This guide provides step-by-step instructions for testing the complete scanner workflow across all three branches (Birmingham, London, France) to ensure:
- ✅ Full functionality of scanning, adding, and removing products
- ✅ Complete branch isolation (no cross-contamination)
- ✅ Proper validation and error handling
- ✅ Correct logging in branch-specific tables

## 🎯 Test Objectives
1. Verify scanner workflow works end-to-end for each branch
2. Confirm submissions create correct logs in branch-specific tables
3. Ensure inventory updates are isolated per branch
4. Validate stock deduction logic prevents over-deduction
5. Test that submissions to one branch do NOT affect other branches

## 📦 Test Data Setup

### Products to Test
- **TEST-SCAN-001** - Test Scanner Product (Initial: 100 units)
- **TEST-SCAN-002** - Another Test Product (Initial: 75 units)

### Initial Stock Distribution (per branch)
- Shelf <1: 50 units
- Shelf >1: 33 units  
- Top Floor: 17 units

---

## 🧪 Test Execution

### Phase 1: Birmingham Branch Testing

#### Step 1.1: Navigate to Birmingham Scanner
1. Open http://localhost:8000
2. Click on "Birmingham Orders" in sidebar
3. Click on "Scanner" (barcode icon)
4. Verify page loads with scanner interface

#### Step 1.2: Test Adding Products
1. In scanner input, type: `TEST-SCAN-001`
2. Press Enter or click "Add"
3. Verify product appears in scanned items list
4. Set quantity to `+10` (add 10 units)
5. Select "Shelf <1" from dropdown
6. Click "Add Another Product"
7. Scan `TEST-SCAN-002`
8. Set quantity to `+5`
9. Select "Shelf >1" from dropdown

#### Step 1.3: Test Removing Products  
1. Click "Add Another Product"
2. Scan `TEST-SCAN-001`
3. Set quantity to `-8` (remove 8 units)
4. Select "Auto" (automatic allocation)

#### Step 1.4: Submit Birmingham Scan
1. Enter reason: "Birmingham E2E Test - Adding and Removing"
2. Click "Submit Scan"
3. Verify success message appears
4. Verify items list clears after submission

#### Step 1.5: Verify Birmingham Submission
1. Navigate to "Birmingham Orders" → "Scanning Logs"
2. Verify new submission appears at top of list
3. Click on the submission to view details
4. Verify:
   - Reason matches what you entered
   - Total items: 3
   - Total added: 15 (10 + 5)
   - Total removed: 8
   - All item details are correct

### Phase 2: Verify Branch Isolation (Birmingham)

#### Step 2.1: Check France and London Were NOT Affected
1. Navigate to "France Orders" → "Scanning Logs"
2. Verify NO new submissions appeared (or note the count)
3. Navigate to "London Orders" → "Scanning Logs"  
4. Verify NO new submissions appeared (or note the count)

#### Step 2.2: Database Verification (Run Command)
```bash
python3 tests/manual_test_script.py
# Choose option 6: Count logs for ALL branches
# Birmingham should have 1 log, others should have 0
```

---

### Phase 3: France Branch Testing

#### Step 3.1: Navigate to France Scanner
1. Click on "France Orders" in sidebar
2. Click on "Scanner"

#### Step 3.2: Test France Workflow
1. Scan `TEST-SCAN-002`
2. Set quantity to `+20`
3. Select "Top Floor"
4. Add another product: `TEST-SCAN-001`
5. Set quantity to `-15`
6. Select "Auto"
7. Enter reason: "France E2E Test - Different Products"
8. Click "Submit Scan"
9. Verify success message

#### Step 3.3: Verify France Submission
1. Navigate to "France Orders" → "Scanning Logs"
2. Verify new submission appears
3. Check details match your inputs
4. Total added: 20, Total removed: 15

### Phase 4: Verify Branch Isolation (France)

#### Step 4.1: Check Other Branches NOT Affected
1. Navigate to "Birmingham Orders" → "Scanning Logs"
2. Verify still only has 1 submission (from Phase 1)
3. Navigate to "London Orders" → "Scanning Logs"
4. Verify still has 0 submissions

#### Step 4.2: Database Verification
```bash
python3 -c "
from tests.manual_test_script import count_scanning_logs
for branch in ['birmingham', 'london', 'france']:
    count_scanning_logs(branch)
"
# Expected: Birmingham=1, France=1, London=0
```

---

### Phase 5: London Branch Testing

#### Step 5.1: Navigate to London Scanner
1. Click on "London Orders" in sidebar
2. Click on "Scanner"

#### Step 5.2: Test London Workflow
1. Scan `TEST-SCAN-001`
2. Set quantity to `+30`
3. Select "Shelf >1"
4. Enter reason: "London E2E Test - Large Addition"
5. Submit scan
6. Verify success

#### Step 5.3: Verify London Submission
1. Navigate to "London Orders" → "Scanning Logs"
2. Verify submission appears with correct details

### Phase 6: Final Branch Isolation Check

#### Step 6.1: Verify All Branches Independent
1. Check each branch's scanning logs:
   - Birmingham: 1 submission
   - France: 1 submission
   - London: 1 submission
2. Each submission should show DIFFERENT data
3. No submission should appear in multiple branches

---

### Phase 7: Validation Testing

#### Step 7.1: Test Insufficient Stock Error (Birmingham)
1. Navigate to Birmingham Scanner
2. Scan `TEST-SCAN-001`
3. Try to remove quantity larger than available (e.g., `-200`)
4. Select "Shelf <1"
5. Verify:
   - ❌ Error beep plays
   - ❌ Error message shows insufficient stock
   - ❌ Cannot submit the scan

#### Step 7.2: Test Product Not Found
1. In scanner input, type: `NONEXISTENT-SKU`
2. Verify:
   - ❌ Error message appears
   - ❌ Product not added to list

---

## 📊 Database Verification Commands

### Check All Logs
```bash
cd /Users/ianhjweng/Documents/github/rm365-tools-testing
python3 tests/manual_test_script.py
# Select option 6: Count logs for ALL branches
```

### Check Specific Branch Details
```bash
python3 tests/manual_test_script.py
# Select option 4: Get submission details
# Enter branch and submission ID
```

### Verify Product Stock Levels
```bash
python3 tests/manual_test_script.py
# Select option 5: Check product in ALL branches
# Enter SKU: TEST-SCAN-001
```

---

## ✅ Success Criteria

### Functionality Tests
- [ ] Scanner input accepts SKU and adds products
- [ ] Can add products with positive quantities
- [ ] Can remove products with negative quantities
- [ ] Shelf selection dropdown works correctly
- [ ] Submit button creates submission successfully
- [ ] Success message appears after submission
- [ ] Items list clears after successful submission

### Branch Isolation Tests
- [ ] Birmingham submissions appear ONLY in Birmingham logs
- [ ] France submissions appear ONLY in France logs
- [ ] London submissions appear ONLY in London logs
- [ ] Database shows correct table separation:
  - `uk_birmingham_scanner_submissions`
  - `uk_london_scanner_submissions`
  - `fr_paris_scanner_submissions`

### Validation Tests
- [ ] Cannot remove more stock than available
- [ ] Error beep plays on validation errors
- [ ] Error messages display correctly
- [ ] Nonexistent products show error

### Data Integrity Tests
- [ ] Submission details match inputs exactly
- [ ] Total added/removed calculations correct
- [ ] Timestamps recorded correctly
- [ ] All items in submission saved correctly

---

## 🐛 Troubleshooting

### Scanner Not Loading
- Check backend is running: `lsof -i:8000`
- Check browser console for errors (F12)
- Verify route in sidebar.js includes scanner

### Submissions Not Appearing in Logs
- Check backend logs: `tail -f /tmp/backend.log`
- Verify database connection successful
- Check table exists: `\dt *scanner*` in psql

### Cross-Branch Contamination
- Verify branch parameter passed correctly in API calls
- Check repo.py uses correct table prefix
- Inspect database: logs should be in separate tables

---

## 📝 Test Results Template

```
=================================================================
COMPREHENSIVE SCANNER WORKFLOW TEST RESULTS
=================================================================
Test Date: [DATE]
Tester: [NAME]
Backend Version: [VERSION]

PHASE 1: BIRMINGHAM
✅/❌ Scanner loads correctly
✅/❌ Can add products
✅/❌ Can remove products
✅/❌ Submission successful
✅/❌ Appears in Birmingham logs only

PHASE 2: FRANCE
✅/❌ Scanner loads correctly
✅/❌ Can add products
✅/❌ Can remove products
✅/❌ Submission successful
✅/❌ Appears in France logs only

PHASE 3: LONDON
✅/❌ Scanner loads correctly
✅/❌ Can add products
✅/❌ Can remove products
✅/❌ Submission successful
✅/❌ Appears in London logs only

PHASE 4: VALIDATION
✅/❌ Insufficient stock prevented
✅/❌ Error beep on validation error
✅/❌ Nonexistent product handled

PHASE 5: ISOLATION
✅/❌ No Birmingham→France contamination
✅/❌ No Birmingham→London contamination
✅/❌ No France→Birmingham contamination
✅/❌ No France→London contamination
✅/❌ No London→Birmingham contamination
✅/❌ No London→France contamination

DATABASE VERIFICATION
Birmingham logs: [COUNT]
France logs: [COUNT]
London logs: [COUNT]
Table separation confirmed: ✅/❌

OVERALL: ✅ PASS / ❌ FAIL
Notes: [ADD ANY NOTES]
=================================================================
```

---

## 🚀 Quick Test Script

For rapid verification, run:
```bash
cd /Users/ianhjweng/Documents/github/rm365-tools-testing
python3 tests/test_scanner_e2e_comprehensive.py
```

This automated script verifies:
- All API endpoints accessible
- All frontend routes load
- Sidebar navigation configured
- Validation logic present in scanner files
- Basic branch isolation

---

## 📞 Support

If you encounter issues:
1. Check backend logs: `tail -f /tmp/backend.log`
2. Check browser console (F12 → Console tab)
3. Verify database connection in .env file
4. Ensure all tables initialized

**Happy Testing! 🎉**
