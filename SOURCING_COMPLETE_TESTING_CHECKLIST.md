# Product Sourcing System - Complete Testing Checklist
## Temporal Pricing & Pending Prices - All Phases

This document provides a comprehensive testing checklist for the entire Product Sourcing System, covering all phases of the temporal pricing implementation.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1: Core Temporal Pricing Foundation](#phase-1-core-temporal-pricing-foundation)
3. [Phase 2: CSV Import & Conflict Resolution](#phase-2-csv-import--conflict-resolution)
4. [Phase 3: Automated Price Propagation & Sync](#phase-3-automated-price-propagation--sync)
5. [Cross-Phase Integration Tests](#cross-phase-integration-tests)
6. [API Endpoint Reference](#api-endpoint-reference)
7. [Database Schema Verification](#database-schema-verification)
8. [Test Data Setup](#test-data-setup)

---

## Prerequisites

- [ ] PostgreSQL database is running and accessible
- [ ] Backend server started (`python app.py` from backend directory)
- [ ] Frontend accessible at localhost
- [ ] User is logged in with appropriate permissions
- [ ] Test suppliers exist in the system
- [ ] Test products/SKUs exist in the system
- [ ] Magento data is synced (for sell price lookups)

---

# Phase 1: Core Temporal Pricing Foundation

## 1.1 Supplier Management

### 1.1.1 Create Supplier
- [ ] Navigate to Sourcing page → Suppliers tab
- [ ] Click "Add Supplier" button
- [ ] Fill in required fields:
  - [ ] Supplier name
  - [ ] Contact email
  - [ ] Currency (GBP, EUR, USD)
  - [ ] Lead time (days)
- [ ] Click Save
- [ ] Verify supplier appears in list
- [ ] Verify toast notification shows success

### 1.1.2 Edit Supplier
- [ ] Click Edit on an existing supplier
- [ ] Modify supplier details
- [ ] Save changes
- [ ] Verify changes are persisted

### 1.1.3 Deactivate Supplier
- [ ] Click Deactivate on a supplier
- [ ] Confirm deactivation
- [ ] Verify supplier is hidden from active list
- [ ] Verify "Show Inactive" toggle reveals deactivated suppliers

### 1.1.4 Reactivate Supplier
- [ ] Enable "Show Inactive" toggle
- [ ] Click Reactivate on inactive supplier
- [ ] Verify supplier returns to active list

---

## 1.2 Product Mapping (Supplier Products)

### 1.2.1 Create New Mapping
- [ ] Click "Add Mapping" or "New Product" button
- [ ] Select supplier from dropdown
- [ ] Enter supplier SKU
- [ ] Search and select internal SKU
- [ ] Enter buy price
- [ ] Select currency
- [ ] Enter MOQ (Minimum Order Quantity)
- [ ] Enter lead time override (optional)
- [ ] Click Save
- [ ] Verify mapping appears in list
- [ ] Verify initial price entry is created

### 1.2.2 Edit Mapping
- [ ] Click Edit on existing mapping
- [ ] Modify mapping fields (supplier SKU, MOQ, lead time)
- [ ] Save changes
- [ ] Verify changes persisted

### 1.2.3 Mapping Validation
- [ ] Try to create duplicate mapping (same supplier + internal SKU)
- [ ] Verify error/warning is shown
- [ ] Try to save with missing required fields
- [ ] Verify validation errors appear

---

## 1.3 Price Entry System

### 1.3.1 Add Price with Today's Date
- [ ] Open Edit Mapping modal
- [ ] Enter new buy price
- [ ] Leave effective date as today (default)
- [ ] Save
- [ ] Verify price is immediately "active"
- [ ] Verify price appears in price history

### 1.3.2 Add Price with Future Date (Pending)
- [ ] Open Edit Mapping modal
- [ ] Click "Schedule Price" or "Add Future Price"
- [ ] Enter buy price
- [ ] Set effective date to future date
- [ ] Save
- [ ] Verify price shows as "pending" in history
- [ ] Verify current active price is unchanged

### 1.3.3 Price Currency Handling
- [ ] Create price in GBP
- [ ] Create price in EUR
- [ ] Create price in USD
- [ ] Verify currency symbol displays correctly
- [ ] Verify currency is stored correctly in database

### 1.3.4 Price Validation
- [ ] Try to enter negative price → Error expected
- [ ] Try to enter zero price → Warning or error
- [ ] Try to enter non-numeric value → Validation error
- [ ] Try to set past effective date → Warning/error

---

## 1.4 Price History

### 1.4.1 View Price History
- [ ] Open Edit Mapping modal
- [ ] Scroll to Price History section
- [ ] Verify all price entries are displayed
- [ ] Verify entries sorted by effective date (newest first)

### 1.4.2 Status Badges
Verify correct status badges:
- [ ] **Active** (green) - Current effective price
- [ ] **Pending** (orange/yellow) - Future effective date
- [ ] **Superseded** (gray) - Previously active, now replaced
- [ ] **Cancelled** (red) - Manually cancelled price

### 1.4.3 Computed Status
- [ ] Create price with effective_date = yesterday → Should be "active" or "superseded"
- [ ] Create price with effective_date = today → Should be "active"
- [ ] Create price with effective_date = tomorrow → Should be "pending"
- [ ] Verify statuses update when page is refreshed on different days

### 1.4.4 History Display Information
Each history entry should show:
- [ ] Buy price with currency
- [ ] Effective date
- [ ] Status badge
- [ ] Created by (user)
- [ ] Created at timestamp

---

## 1.5 Cancel Pending Price

### 1.5.1 Cancel from Price History
- [ ] Open mapping with pending price
- [ ] Find pending price in history
- [ ] Click Cancel/X button on pending price
- [ ] Confirm cancellation
- [ ] Verify status changes to "cancelled"
- [ ] Verify active price remains unchanged

### 1.5.2 Cancel Restrictions
- [ ] Try to cancel an already active price → Should not be allowed
- [ ] Try to cancel already cancelled price → Button should be hidden/disabled
- [ ] Try to cancel superseded price → Button should be hidden/disabled

---

## 1.6 Active Price Resolution

### 1.6.1 Single Price
- [ ] Product with only one price entry
- [ ] Verify that price is marked as "active"

### 1.6.2 Multiple Prices - Same Effective Date
- [ ] Create two prices with same effective date
- [ ] Verify latest created one is "active"
- [ ] Verify earlier one is "superseded"

### 1.6.3 Price Transition
- [ ] Create active price with past date
- [ ] Create pending price with tomorrow's date
- [ ] Wait until tomorrow (or adjust system date)
- [ ] Verify pending price becomes active
- [ ] Verify old active becomes superseded

---

## 1.7 Supplier Comparison View

### 1.7.1 Basic Display
- [ ] Navigate to Supplier Comparison tab
- [ ] Verify products with multiple suppliers are listed
- [ ] Verify buy prices are displayed for each supplier

### 1.7.2 Best Supplier Highlighting
- [ ] Product with multiple suppliers at different prices
- [ ] Verify cheapest supplier is highlighted as "Best"
- [ ] Verify margin calculations are displayed

### 1.7.3 Active Price Only
- [ ] Product has both active and pending prices
- [ ] Verify comparison shows ONLY active price
- [ ] Verify "Best" calculation uses active prices only

### 1.7.4 Search and Filter
- [ ] Search by internal SKU
- [ ] Search by supplier name
- [ ] Filter by supplier
- [ ] Verify results update correctly

---

## 1.8 Add Price Modal

### 1.8.1 Open Add Price Modal
- [ ] From mapping list, click "Add Price" button
- [ ] Verify modal opens with correct product info
- [ ] Verify current active price is displayed as reference

### 1.8.2 Add Price Form
- [ ] Enter buy price
- [ ] Select effective date (date picker)
- [ ] Verify currency matches supplier default
- [ ] Submit form
- [ ] Verify success toast
- [ ] Verify price history updated

### 1.8.3 Effective Date Picker
- [ ] Click date picker
- [ ] Verify past dates are disabled/warned
- [ ] Select future date
- [ ] Verify pending status preview

---

# Phase 2: CSV Import & Conflict Resolution

## 2.1 CSV Import - Basic Flow

### 2.1.1 Access Import
- [ ] Navigate to Sourcing page
- [ ] Click "Import" or "Import CSV" button
- [ ] Verify import modal opens

### 2.1.2 File Selection
- [ ] Click "Choose File" or drag-and-drop
- [ ] Select valid CSV file
- [ ] Verify file name is displayed
- [ ] Verify file is accepted (no immediate error)

### 2.1.3 CSV Format Validation
Test with various formats:
- [ ] Valid CSV with all required columns → Accepted
- [ ] CSV missing required columns → Error shown with missing columns listed
- [ ] Empty CSV → Error: "No data found"
- [ ] Non-CSV file (e.g., .xlsx) → Error: "Invalid file format"
- [ ] Malformed CSV (bad encoding) → Appropriate error

### 2.1.4 Required Columns
Verify validation for required columns:
- [ ] `supplier_sku` or `supplier_code`
- [ ] `internal_sku` or `sku`
- [ ] `buy_price` or `price`
- [ ] `currency` (or default assumed)
- [ ] `effective_date` (or default to today)

---

## 2.2 CSV Validation Preview

### 2.2.1 Preview Display
- [ ] After file upload, preview table is shown
- [ ] First N rows are displayed
- [ ] Column headers are identified
- [ ] Row count is shown

### 2.2.2 Validation Errors
For each row, check for:
- [ ] Invalid SKU (not found) → Row highlighted red
- [ ] Invalid price format → Error message
- [ ] Invalid date format → Error message
- [ ] Missing required field → Error indicator

### 2.2.3 Skip Invalid Rows
- [ ] Option to skip rows with errors
- [ ] Count of valid vs invalid rows shown
- [ ] User can proceed with valid rows only

---

## 2.3 Conflict Detection

### 2.3.1 No Conflicts
- [ ] Import CSV with all new mappings
- [ ] Verify direct import (no conflict modal)
- [ ] Success message shows count imported

### 2.3.2 Conflict Types Detection
Verify each conflict type is detected:

#### Duplicate Entry
- [ ] CSV contains duplicate rows (same supplier + internal SKU twice)
- [ ] Conflict type: `duplicate`
- [ ] Shows which rows conflict

#### Existing Mapping
- [ ] CSV contains entry for existing mapping
- [ ] Conflict type: `existing_mapping`
- [ ] Shows existing vs new data

#### Pending Change
- [ ] CSV updates mapping that has pending price scheduled
- [ ] Conflict type: `pending_change`
- [ ] Shows pending price info and new price

#### Price Decrease
- [ ] New price is lower than current active price
- [ ] Conflict type: `price_decrease`
- [ ] Shows old price, new price, percentage change

#### Price Increase (Large)
- [ ] New price is significantly higher (e.g., >20%)
- [ ] Conflict type: `large_price_increase`
- [ ] Shows old price, new price, percentage change

#### Currency Mismatch
- [ ] CSV currency differs from supplier's default currency
- [ ] Conflict type: `currency_mismatch`
- [ ] Shows expected vs provided currency

---

## 2.4 Conflict Resolution Modal

### 2.4.1 Modal Display
- [ ] Modal opens when conflicts detected
- [ ] Shows count of conflicts: "X conflicts found"
- [ ] Lists each conflict with details

### 2.4.2 Conflict Information Display
For each conflict:
- [ ] Conflict type badge (color-coded)
- [ ] Affected row data
- [ ] Existing data vs new data comparison
- [ ] Clear description of the conflict

### 2.4.3 Resolution Options

#### Skip
- [ ] Click "Skip" on a conflict
- [ ] Verify row is marked as skipped
- [ ] Verify row will not be imported

#### Update Anyway
- [ ] Click "Update Anyway" on a conflict
- [ ] Verify row is marked for update
- [ ] Verify existing data will be overwritten

#### Skip All
- [ ] Click "Skip All" button
- [ ] Verify all conflicts marked as skipped

#### Update All
- [ ] Click "Update All" button
- [ ] Verify all conflicts marked for update

### 2.4.4 Pending Change Conflict Specific
- [ ] Conflict modal shows disclaimer for pending_change type
- [ ] Disclaimer explains: "Note: 'Update Anyway' adds your new price, but the scheduled price will still activate on its date."
- [ ] User understands both prices will coexist

---

## 2.5 Batch Import Execution

### 2.5.1 Execute Import
- [ ] After resolving all conflicts, click "Import" or "Proceed"
- [ ] Progress indicator shows import status
- [ ] Import completes successfully

### 2.5.2 Import Results
- [ ] Success count: X rows imported
- [ ] Skipped count: Y rows skipped
- [ ] Error count: Z rows failed
- [ ] Detailed log available

### 2.5.3 Verify Imported Data
- [ ] Check supplier products list for new mappings
- [ ] Check price history for new prices
- [ ] Verify effective dates are correct
- [ ] Verify currencies are correct

---

## 2.6 Import Batch Tracking

### 2.6.1 Batch Record
- [ ] Each import creates a batch record
- [ ] Batch includes: timestamp, user, file name, row count

### 2.6.2 Batch History
- [ ] View import history/logs
- [ ] See past import batches
- [ ] View details of each batch

---

## 2.7 CSV Template

### 2.7.1 Download Template
- [ ] Click "Download Template" button
- [ ] CSV file downloads
- [ ] Template has correct column headers

### 2.7.2 Template Format
Verify template includes:
- [ ] supplier_sku
- [ ] internal_sku
- [ ] buy_price
- [ ] currency
- [ ] effective_date
- [ ] moq (optional)
- [ ] lead_time (optional)

---

# Phase 3: Automated Price Propagation & Sync

## 3.1 Daily Price Activation Scheduler

### 3.1.1 Scheduler Configuration
- [ ] Verify scheduler job `daily_price_activation` is registered on server startup
- [ ] Confirm cron trigger is set to `hour=0, minute=1` (00:01 daily)
- [ ] Check server logs for scheduler initialization message

### 3.1.2 Manual Trigger Test
- [ ] Call `POST /v1/inventory/sourcing/sync-logs/trigger-daily-activation`
- [ ] Verify response includes `prices_activated` count
- [ ] Verify response includes `log_id` of created sync log
- [ ] Verify response includes `status: "completed"`

### 3.1.3 Price Activation Logic
- [ ] Create a price with `effective_date` = today's date
- [ ] Verify it starts as "pending" if created before midnight
- [ ] Trigger daily activation
- [ ] Verify the price status changes from "pending" to "active"
- [ ] Verify previous active price becomes "superseded"

### 3.1.4 Multiple Prices Activation
- [ ] Create pending prices for multiple products
- [ ] Trigger daily activation
- [ ] Verify all applicable prices activated
- [ ] Verify count in response matches

### 3.1.5 No Prices to Activate
- [ ] Ensure no pending prices have today's effective date
- [ ] Trigger daily activation
- [ ] Verify `prices_activated: 0`
- [ ] Verify job completes without error

---

## 3.2 Sync Logs

### 3.2.1 View Sync Logs
- [ ] `GET /v1/inventory/sourcing/sync-logs` returns list of sync logs
- [ ] Logs are sorted by date descending (newest first)
- [ ] Pagination works correctly

### 3.2.2 Log Entry Fields
Each log contains:
- [ ] `id` - Unique identifier
- [ ] `run_date` - Date of the sync run
- [ ] `prices_activated` - Count of prices activated
- [ ] `status` - completed/failed/partial
- [ ] `created_at` - Timestamp
- [ ] `error_message` - If failed

### 3.2.3 Log Creation
- [ ] After manual trigger, new log entry appears
- [ ] Log shows correct `prices_activated` count
- [ ] Log shows `status` as "completed" on success
- [ ] Failed runs show "failed" status with error message

---

## 3.3 Margin Reports Tab

### 3.3.1 Tab Access
- [ ] Navigate to Sourcing page
- [ ] Click "Margin Reports" tab
- [ ] Tab content loads without error

### 3.3.2 Report Type Dropdown
- [ ] Dropdown populates with options
- [ ] Options include:
  - [ ] All Products
  - [ ] High Margin (>50%)
  - [ ] Low Margin (<20%)
  - [ ] Negative Margin
  - [ ] No Margin Data

### 3.3.3 Report Loading
- [ ] Select each report type
- [ ] Verify data loads for each type
- [ ] Verify correct filtering applied

### 3.3.4 Margin Calculation
- [ ] Margin = `(sell_price - buy_price) / sell_price * 100`
- [ ] Verify calculations are accurate
- [ ] Only "active" prices are used (effective_date <= today)
- [ ] Sell prices are pulled from Magento data

### 3.3.5 Report Display
Each row shows:
- [ ] Internal SKU
- [ ] Product name
- [ ] Buy price (active)
- [ ] Sell price (from Magento)
- [ ] Margin percentage
- [ ] Margin indicator (color)

### 3.3.6 Visual Indicators
- [ ] High margins (>50%) show green indicator
- [ ] Medium margins (20-50%) show default/blue
- [ ] Low margins (<20%) show yellow/orange indicator
- [ ] Negative margins show red indicator

### 3.3.7 Empty States
- [ ] Select filter with no matching data
- [ ] Verify empty state message displayed
- [ ] Message is helpful (e.g., "No products with negative margin")

---

## 3.4 Supplier Comparison - Pending Price Indicators

### 3.4.1 Pending Price Detection
- [ ] Navigate to Supplier Comparison tab
- [ ] Product has pending price scheduled
- [ ] Orange "Pending" badge/indicator appears

### 3.4.2 Pending Indicator Tooltip
- [ ] Hover over pending indicator
- [ ] Tooltip shows:
  - [ ] Pending price amount
  - [ ] Pending effective date
  - [ ] Days until effective

### 3.4.3 Cheaper Pending Price
- [ ] Pending price is lower than current active
- [ ] Indicator shows "Pending ↓" or down arrow
- [ ] Indicator has green highlight/tint
- [ ] Tooltip: "Cheaper price pending: £X.XX effective YYYY-MM-DD"

### 3.4.4 Higher Pending Price
- [ ] Pending price is higher than current active
- [ ] Indicator shows "Pending ↑" or up arrow
- [ ] Indicator has red/orange highlight
- [ ] Tooltip shows price increase

### 3.4.5 Active Price Display
- [ ] Main price column shows ONLY active price
- [ ] Best supplier calculation uses active prices only
- [ ] Pending prices don't affect "Best" determination

---

## 3.5 Edit Mapping Modal - Pending Price Check

### 3.5.1 Opening Modal - No Pending Price
- [ ] Edit mapping without pending price
- [ ] Change price and save
- [ ] Save proceeds normally (no confirmation dialog)

### 3.5.2 Opening Modal - With Pending Price
- [ ] Edit mapping that has pending price
- [ ] Price history shows pending price entry
- [ ] Pending price has correct status badge

### 3.5.3 Saving New Price When Pending Exists
- [ ] Change buy price to different value
- [ ] Click Save
- [ ] **Confirmation dialog appears** with:
  - [ ] Warning icon/header
  - [ ] Current scheduled price amount
  - [ ] Scheduled effective date
  - [ ] Your new price amount
  - [ ] Three action buttons

### 3.5.4 Confirmation Dialog Options

#### Don't Save
- [ ] Click "Don't Save"
- [ ] Dialog closes
- [ ] Modal remains open
- [ ] No changes made
- [ ] Price history unchanged

#### Add Both Prices
- [ ] Click "Add Both Prices"
- [ ] Dialog closes
- [ ] Both prices are saved:
  - [ ] Original pending price (unchanged)
  - [ ] New price (becomes active if today's date)
- [ ] Price history shows both entries
- [ ] Toast: "Price added successfully"

#### Replace Scheduled
- [ ] Click "Replace Scheduled"
- [ ] Dialog closes
- [ ] Pending price is cancelled
- [ ] New price is saved and active
- [ ] Price history shows:
  - [ ] Old pending → "cancelled"
  - [ ] New price → "active"
- [ ] Toast: "Scheduled price replaced"

### 3.5.5 Multiple Pending Prices
- [ ] Product has multiple pending prices
- [ ] Warning shows the soonest pending price
- [ ] User is informed about earliest scheduled change

---

## 3.6 CSV Import - Pending Change Disclaimer

### 3.6.1 Pending Change Conflict Display
- [ ] Import CSV with price for product that has pending price
- [ ] Conflict modal shows `pending_change` type
- [ ] Conflict is highlighted/badged appropriately

### 3.6.2 Disclaimer Visibility
- [ ] Disclaimer element is visible in modal
- [ ] Disclaimer styled with info/warning appearance
- [ ] Icon indicates important information

### 3.6.3 Disclaimer Text
- [ ] Text reads: "Note: 'Update Anyway' adds your new price, but the scheduled price will still activate on its date."
- [ ] Text is readable in both light and dark mode

### 3.6.4 Disclaimer Behavior
- [ ] Disclaimer only shows for `pending_change` conflicts
- [ ] Disclaimer hidden for other conflict types
- [ ] Disclaimer doesn't appear when no pending_change conflicts

### 3.6.5 Update Anyway with Pending
- [ ] Click "Update Anyway" on pending_change conflict
- [ ] Verify new price is added
- [ ] Verify pending price still exists
- [ ] Verify pending price still has future effective date
- [ ] Both prices coexist in price history

---

## 3.7 Price History Display (Updated)

### 3.7.1 Computed Status
- [ ] Status is computed from `effective_date` vs `CURRENT_DATE`
- [ ] Not stored static in database
- [ ] Refreshing page updates status if date changed

### 3.7.2 Status Computation Logic
```
IF cancelled_at IS NOT NULL → "cancelled"
ELSE IF effective_date > CURRENT_DATE → "pending"
ELSE IF this is the most recent effective_date <= CURRENT_DATE → "active"
ELSE → "superseded"
```
- [ ] Verify logic matches above

### 3.7.3 History Entry Actions
- [ ] Active price: No cancel button
- [ ] Pending price: Cancel button available
- [ ] Superseded price: No actions
- [ ] Cancelled price: No actions

---

# Cross-Phase Integration Tests

## 4.1 End-to-End: New Supplier to Active Price

- [ ] Create new supplier
- [ ] Create product mapping for supplier
- [ ] Add initial price (today's date)
- [ ] Verify price is active
- [ ] Verify appears in Supplier Comparison
- [ ] Verify margin report shows product

## 4.2 End-to-End: Schedule Price Change

- [ ] Edit existing mapping
- [ ] Add future-dated price
- [ ] Verify pending status in history
- [ ] Verify active price unchanged
- [ ] Wait for effective date (or trigger scheduler)
- [ ] Verify pending becomes active
- [ ] Verify old active becomes superseded

## 4.3 End-to-End: CSV Import with Conflicts

- [ ] Prepare CSV with:
  - [ ] New mapping rows
  - [ ] Existing mapping updates
  - [ ] Pending change conflicts
  - [ ] Duplicate rows
- [ ] Upload and process
- [ ] Resolve each conflict type
- [ ] Verify final data matches expectations

## 4.4 End-to-End: Best Supplier Change

- [ ] Product with 2 suppliers
- [ ] Supplier A is cheaper (Best)
- [ ] Add pending price for Supplier B (cheaper than A)
- [ ] Verify current Best is still Supplier A
- [ ] Trigger price activation
- [ ] Verify Best changes to Supplier B

## 4.5 Multi-User Scenario

- [ ] User A opens edit modal for product
- [ ] User B schedules pending price for same product
- [ ] User A tries to save price change
- [ ] Verify User A sees pending price warning
- [ ] Verify User A can choose appropriate action

---

# API Endpoint Reference

## Suppliers

| Endpoint | Method | Purpose | Test Status |
|----------|--------|---------|-------------|
| `/v1/inventory/sourcing/suppliers` | GET | List all suppliers | ☐ |
| `/v1/inventory/sourcing/suppliers` | POST | Create supplier | ☐ |
| `/v1/inventory/sourcing/suppliers/{id}` | GET | Get supplier details | ☐ |
| `/v1/inventory/sourcing/suppliers/{id}` | PUT | Update supplier | ☐ |
| `/v1/inventory/sourcing/suppliers/{id}/deactivate` | POST | Deactivate supplier | ☐ |
| `/v1/inventory/sourcing/suppliers/{id}/reactivate` | POST | Reactivate supplier | ☐ |

## Supplier Products (Mappings)

| Endpoint | Method | Purpose | Test Status |
|----------|--------|---------|-------------|
| `/v1/inventory/sourcing/products` | GET | List all mappings | ☐ |
| `/v1/inventory/sourcing/products` | POST | Create mapping | ☐ |
| `/v1/inventory/sourcing/products/{id}` | GET | Get mapping details | ☐ |
| `/v1/inventory/sourcing/products/{id}` | PUT | Update mapping | ☐ |

## Prices

| Endpoint | Method | Purpose | Test Status |
|----------|--------|---------|-------------|
| `/v1/inventory/sourcing/prices` | POST | Create new price | ☐ |
| `/v1/inventory/sourcing/prices/{id}` | GET | Get price with computed status | ☐ |
| `/v1/inventory/sourcing/prices/history` | GET | Get price history for product | ☐ |
| `/v1/inventory/sourcing/prices/pending` | GET | Get pending prices | ☐ |
| `/v1/inventory/sourcing/prices/{id}/cancel` | POST | Cancel pending price | ☐ |

## Comparison & Reports

| Endpoint | Method | Purpose | Test Status |
|----------|--------|---------|-------------|
| `/v1/inventory/sourcing/comparison` | GET | Supplier comparison | ☐ |
| `/v1/inventory/sourcing/comparison-with-pending` | GET | Comparison with pending info | ☐ |
| `/v1/inventory/sourcing/margin-reports` | GET | Margin reports | ☐ |

## Import

| Endpoint | Method | Purpose | Test Status |
|----------|--------|---------|-------------|
| `/v1/inventory/sourcing/import/validate` | POST | Validate CSV | ☐ |
| `/v1/inventory/sourcing/import` | POST | Execute import | ☐ |
| `/v1/inventory/sourcing/import/batches` | GET | Get import history | ☐ |

## Sync

| Endpoint | Method | Purpose | Test Status |
|----------|--------|---------|-------------|
| `/v1/inventory/sourcing/sync-logs` | GET | Get sync logs | ☐ |
| `/v1/inventory/sourcing/sync-logs/trigger-daily-activation` | POST | Trigger activation | ☐ |

---

# Database Schema Verification

## Tables to Verify

### sourcing_suppliers
- [ ] Table exists
- [ ] Columns: id, name, contact_email, currency, lead_time, is_active, created_at, updated_at

### sourcing_supplier_products
- [ ] Table exists
- [ ] Columns: id, supplier_id, supplier_sku, internal_sku, moq, lead_time, is_active, created_at, updated_at
- [ ] Foreign key to suppliers

### sourcing_supplier_product_prices
- [ ] Table exists
- [ ] Columns: id, supplier_product_id, buy_price, currency, effective_date, status, cancelled_at, cancelled_by, created_by, created_at
- [ ] Foreign key to supplier_products
- [ ] Index on (supplier_product_id, effective_date)

### sourcing_import_batches
- [ ] Table exists
- [ ] Columns: id, file_name, total_rows, success_count, error_count, status, created_by, created_at

### sourcing_price_sync_log
- [ ] Table exists
- [ ] Columns: id, run_date, prices_activated, status, error_message, created_at

---

# Test Data Setup

## SQL for Test Data

```sql
-- 1. Create Test Suppliers
INSERT INTO sourcing_suppliers (name, contact_email, currency, lead_time, is_active) VALUES
  ('Test Supplier A', 'supplier.a@test.com', 'GBP', 5, true),
  ('Test Supplier B', 'supplier.b@test.com', 'GBP', 7, true),
  ('Test Supplier C', 'supplier.c@test.com', 'EUR', 10, true),
  ('Inactive Supplier', 'inactive@test.com', 'GBP', 3, false);

-- 2. Create Test Mappings
INSERT INTO sourcing_supplier_products (supplier_id, supplier_sku, internal_sku, moq, is_active) VALUES
  (1, 'SUP-A-001', 'SKU001', 10, true),
  (1, 'SUP-A-002', 'SKU002', 5, true),
  (2, 'SUP-B-001', 'SKU001', 15, true),  -- Same SKU, different supplier
  (3, 'SUP-C-001', 'SKU003', 20, true);

-- 3. Create Test Prices (Various Statuses)
-- Active price
INSERT INTO sourcing_supplier_product_prices 
  (supplier_product_id, buy_price, currency, effective_date, created_by) VALUES
  (1, 10.00, 'GBP', '2025-01-01', 'test_user');

-- Current active (later date)
INSERT INTO sourcing_supplier_product_prices 
  (supplier_product_id, buy_price, currency, effective_date, created_by) VALUES
  (1, 12.50, 'GBP', '2026-01-10', 'test_user');

-- Pending (future date)
INSERT INTO sourcing_supplier_product_prices 
  (supplier_product_id, buy_price, currency, effective_date, created_by) VALUES
  (1, 11.00, 'GBP', '2026-02-01', 'test_user');

-- Cancelled price
INSERT INTO sourcing_supplier_product_prices 
  (supplier_product_id, buy_price, currency, effective_date, cancelled_at, cancelled_by, created_by) VALUES
  (1, 15.00, 'GBP', '2026-03-01', NOW(), 'test_user', 'test_user');

-- 4. Create Test Sync Logs
INSERT INTO sourcing_price_sync_log (run_date, prices_activated, status) VALUES
  ('2026-01-14', 5, 'completed'),
  ('2026-01-13', 3, 'completed'),
  ('2026-01-12', 0, 'completed');
```

## Test CSV Files

### valid_import.csv
```csv
supplier_sku,internal_sku,buy_price,currency,effective_date,moq
NEW-001,NEWSKU001,25.00,GBP,2026-01-15,10
NEW-002,NEWSKU002,30.00,GBP,2026-01-15,5
```

### conflict_import.csv
```csv
supplier_sku,internal_sku,buy_price,currency,effective_date,moq
SUP-A-001,SKU001,8.00,GBP,2026-01-15,10
SUP-A-002,SKU002,50.00,GBP,2026-01-15,5
```

### pending_conflict_import.csv
```csv
supplier_sku,internal_sku,buy_price,currency,effective_date,moq
SUP-A-001,SKU001,9.50,GBP,2026-01-20,10
```

---

# UI/UX Verification

## Light Mode
- [ ] All components visible
- [ ] Colors meet contrast requirements
- [ ] Status badges readable
- [ ] Buttons have proper hover states

## Dark Mode
- [ ] All components visible
- [ ] Pending indicators visible
- [ ] Confirmation dialogs readable
- [ ] Disclaimer text readable
- [ ] Status badges have proper contrast

## Responsive Design
- [ ] Tables scroll horizontally on small screens
- [ ] Modals fit on mobile screens
- [ ] Buttons are tap-friendly

## Accessibility
- [ ] Form labels are associated with inputs
- [ ] Focus states visible
- [ ] Error messages announced to screen readers
- [ ] Dialogs trap focus appropriately

---

# Error Handling

## Frontend Errors
- [ ] API timeout → Loading state, then error message
- [ ] API 4xx → Specific error message shown
- [ ] API 5xx → Generic error with retry option
- [ ] Network offline → Offline indicator

## Backend Errors
- [ ] Database connection failed → Graceful degradation
- [ ] Invalid request → 400 with validation details
- [ ] Unauthorized → 401 with redirect to login
- [ ] Server error → 500 with error logged

## Scheduler Errors
- [ ] Database unavailable → Error logged, job retries
- [ ] Partial failure → Status "partial", count accurate
- [ ] Complete failure → Status "failed", error message stored

---

# Performance

- [ ] Supplier list loads in <1 second
- [ ] Comparison view loads in <2 seconds
- [ ] Margin reports load in <2 seconds
- [ ] CSV with 1000 rows processes in <30 seconds
- [ ] Daily activation handles 1000+ prices

---

# Sign-Off

## Phase 1 Sign-Off

| Tester | Date | Result | Notes |
|--------|------|--------|-------|
| | | ☐ Pass / ☐ Fail | |

## Phase 2 Sign-Off

| Tester | Date | Result | Notes |
|--------|------|--------|-------|
| | | ☐ Pass / ☐ Fail | |

## Phase 3 Sign-Off

| Tester | Date | Result | Notes |
|--------|------|--------|-------|
| | | ☐ Pass / ☐ Fail | |

## Complete System Sign-Off

| Tester | Date | Result | Notes |
|--------|------|--------|-------|
| | | ☐ Pass / ☐ Fail | |

---

### Issues Log

| Issue # | Description | Phase | Severity | Status |
|---------|-------------|-------|----------|--------|
| | | | | |

---

**Last Updated:** January 15, 2026  
**Document Version:** 2.0
