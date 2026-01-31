# Order Fulfillment System - Complete Logic Documentation

## Overview

The Order Fulfillment system manages warehouse picking and checking operations. It operates **read-only** against Magento (never writes back) and maintains all operational state in a local PostgreSQL database.

### Key Principles
- **Magento is read-only**: Orders are fetched but never updated in Magento
- **Inventory is tracked locally**: Stock levels are managed in `inventory_metadata` table
- **Sessions track progress**: Each order picking attempt is a "session" with full audit history
- **Inventory accounting**: Items are deducted when scanned, returned when cancelled/reset

---

## Session Statuses

| Status | Description | Inventory State |
|--------|-------------|-----------------|
| `approved` | Order approved for picking, not yet started | No inventory held |
| `in_progress` | Actively being picked by a user | Scanned items deducted from inventory |
| `draft` | Paused picking session (picker left but can resume) | Scanned items remain deducted (held) |
| `ready_to_check` | Picking complete, waiting for checker verification | Scanned items remain deducted (held) |
| `completed` | Order verified and done | Items permanently deducted (shipped) |
| `cancelled` | Session cancelled | Scanned items returned to inventory |
| `archived` | End-of-day archive | Scanned items returned to inventory (if incomplete) |

---

## Complete Workflow

```
┌─────────────┐     ┌─────────────┐     ┌───────────────┐     ┌───────────┐
│   Magento   │────▶│  Approved   │────▶│  In Progress  │────▶│  Ready to │
│ (processing)│     │             │     │   (picking)   │     │   Check   │
└─────────────┘     └─────────────┘     └───────────────┘     └───────────┘
                           │                    │                    │
                           │                    ▼                    ▼
                           │              ┌───────────┐        ┌───────────┐
                           │              │   Draft   │◀───────│ Send Back │
                           │              │  (paused) │        │(with count)│
                           │              └───────────┘        └───────────┘
                           │                    │                    │
                           ▼                    ▼                    ▼
                    ┌───────────┐        ┌───────────┐        ┌───────────┐
                    │ Cancelled │        │ Cancelled │        │ Completed │
                    └───────────┘        └───────────┘        └───────────┘
```

---

## Phase 1: Order Approval

### What Happens When an Order is Approved

**Trigger**: Supervisor clicks "Approve" on an order in the Order Approval page

**Actions**:
1. System fetches invoice details from Magento (items, quantities, prices)
2. Creates a new session record with:
   - `status = 'approved'`
   - `session_type = 'pick'`
   - `items_expected` = list of items from invoice
   - `items_scanned = []` (empty)
3. Order appears in "Ready to Pick" queue

**Inventory Impact**: ❌ None - no inventory changes until scanning begins

**Database Changes**:
```sql
INSERT INTO order_fulfillment_sessions 
  (session_id, invoice_id, order_number, status, session_type, items_expected, items_scanned)
VALUES 
  ('uuid', 'INV-123', '100012345', 'approved', 'pick', '[...]', '[]')
```

---

## Phase 2: Picking (Start Session)

### What Happens When a Picker Starts a Session

**Trigger**: Picker selects an order and clicks "Start Picking"

**Actions**:
1. Session status changes: `approved` → `in_progress`
2. Session is assigned to the picker (`user_id` set)
3. Session is now "locked" to this picker (others cannot take it)

**Inventory Impact**: ❌ None yet - scanning will trigger deductions

**Database Changes**:
```sql
UPDATE order_fulfillment_sessions 
SET status = 'in_progress', 
    user_id = 'picker_username',
    started_at = NOW()
WHERE session_id = 'uuid'
```

---

## Phase 2A: Scanning Items

### What Happens When an Item is Scanned

**Trigger**: Picker scans a barcode (SKU or 18-digit item_id)

**Pre-Scan Validation**:
1. ✅ Session exists and is `in_progress`
2. ✅ SKU is on the invoice (`items_expected`)
3. ✅ Quantity won't exceed expected (overpicking blocked)
4. ✅ Inventory has sufficient stock

**Actions**:
1. Inventory is **immediately deducted** from `inventory_metadata`
2. Deduction is tracked with source location (shelf_lt1, shelf_gt1, or top_floor)
3. `items_scanned` is updated with:
   - `sku`, `qty_scanned`, `scanned_at`
   - `deduction_sources`: tracks where items came from

**Inventory Impact**: ✅ **DEDUCTED** from specified location

**Example Deduction Source**:
```json
{
  "sku": "ME071",
  "qty_scanned": 5,
  "deduction_sources": [
    {"field": "shelf_lt1_qty", "quantity": 3, "remaining": 3},
    {"field": "shelf_gt1_qty", "quantity": 2, "remaining": 2}
  ]
}
```

The `remaining` field tracks how many items from each source are still "held" (not yet completed or returned).

---

## Phase 2B: Draft Session (Pause Picking)

### What Happens When a Picker Saves as Draft

**Trigger**: Picker clicks "Save as Draft" or session times out

**Actions**:
1. Session status changes: `in_progress` → `draft`
2. User assignment is cleared (`user_id = NULL`)
3. All scanned progress is preserved
4. Session appears in "Drafts" queue for anyone to resume

**Inventory Impact**: ❌ **NO RETURN** - Items remain deducted (held for this order)

**Why**: The picker may return later or someone else will continue. The items are "reserved" for this order.

**Database Changes**:
```sql
UPDATE order_fulfillment_sessions 
SET status = 'draft', 
    user_id = NULL
WHERE session_id = 'uuid'
```

---

## Phase 2C: Cancel Picking Session

### What Happens When a Picking Session is Cancelled

**Trigger**: Picker or supervisor clicks "Cancel" on a draft or in_progress session

**Actions**:
1. Session status changes: → `cancelled`
2. All `items_scanned` are processed for returns
3. For each scanned item, inventory is **returned** to original locations
4. Returns use `deduction_sources.remaining` to know how much to return where

**Inventory Impact**: ✅ **RETURNED** to original locations

**Return Logic**:
```python
for scanned_item in session.items_scanned:
    for source in scanned_item['deduction_sources']:
        if source['remaining'] > 0:
            return_to_inventory(source['field'], source['remaining'])
```

**Database Changes**:
```sql
-- Update inventory
UPDATE inventory_metadata 
SET shelf_lt1_qty = shelf_lt1_qty + 3,
    shelf_gt1_qty = shelf_gt1_qty + 2
WHERE sku = 'ME071'

-- Update session
UPDATE order_fulfillment_sessions 
SET status = 'cancelled', 
    completed_at = NOW()
WHERE session_id = 'uuid'
```

---

## Phase 3: Ready to Check

### What Happens When Picking is Marked Complete

**Trigger**: Picker finishes scanning all items and clicks "Mark Ready to Check"

**Actions**:
1. Session status changes: `in_progress` → `ready_to_check`
2. Session type remains `pick`
3. Order appears in "Ready to Check" queue for checkers

**Inventory Impact**: ❌ **NO CHANGE** - Items remain deducted (held)

**Database Changes**:
```sql
UPDATE order_fulfillment_sessions 
SET status = 'ready_to_check'
WHERE session_id = 'uuid'
```

---

## Phase 4: Checking

### What Happens When a Checker Starts Checking

**Trigger**: Checker selects an order from "Ready to Check" queue

**Actions**:
1. Session is assigned to the checker
2. Checker verifies quantities against what was scanned
3. Checker can mark quantities they actually counted

**Inventory Impact**: ❌ None - just verification

---

## Phase 4A: Send Back for Picking (with Count)

### What Happens When Checker Sends Back for Picking

**Trigger**: Checker finds a discrepancy and clicks "Send Back for Picking"

**Actions**:
1. Session status changes: `ready_to_check` → `draft`
2. Session type changes: → `pick` (so it appears in picker queue)
3. `items_counted` is saved with the checker's count
4. User assignment is cleared

**Inventory Impact**: ❌ **NO RETURN** - Items remain deducted

**items_counted Structure**:
```json
[
  {"sku": "ME071", "qty_counted": 2},
  {"sku": "ME072", "qty_counted": 5}
]
```

**How Picker Sees the Count**:
When the picker resumes this session, they see:
- **Expected**: What was on the original invoice
- **Scanned**: What was recorded during picking
- **Counted**: What the checker actually found (highlighted in orange)

This helps the picker understand what went wrong and fix it.

**Database Changes**:
```sql
UPDATE order_fulfillment_sessions 
SET status = 'draft', 
    session_type = 'pick',
    items_counted = '[{"sku": "ME071", "qty_counted": 2}]',
    user_id = NULL
WHERE session_id = 'uuid'
```

---

## Phase 4B: Cancel from Ready to Check

### What Happens When a Checker Cancels the Session

**Trigger**: Checker clicks "Cancel" on an order in `ready_to_check` status

**Actions**:
1. `items_counted` is cleared (resets any counting the checker did)
2. Session **stays in `ready_to_check`** status
3. Order remains visible in the "Ready to Check" queue
4. A different checker (or the same one) can start fresh

**Inventory Impact**: ❌ **NO RETURN** - Items remain deducted

**Why**: The picking was already done and verified to some extent. If the order truly needs to be cancelled and inventory returned, the checker must:
1. Send the order back for picking (→ `draft` status)
2. Cancel from the picking side (→ inventory returns)

Or: Leave it until the daily scheduler runs, which will return inventory and archive the session.

**Database Changes**:
```sql
UPDATE order_fulfillment_sessions 
SET items_counted = '[]'::jsonb,
    last_modified_at = NOW()
WHERE session_id = 'uuid'
-- Status remains 'ready_to_check'
```

---

## Phase 4C: How to Actually Return Inventory from Ready to Check

If an order needs to be fully cancelled with inventory return:

**Step 1**: Send back for picking
```
ready_to_check → draft (session_type='pick')
```

**Step 2**: Cancel from draft
```
draft → cancelled (inventory returned)
```

**Example Flow**:
```python
# Step 1: Send back for picking
service.send_back_for_picking(session_id, user_id)
# Session is now 'draft' with session_type='pick'

# Step 2: Cancel from draft
result = service.cancel_session(session_id, user_id)
# result['items_returned'] == 4 (inventory returned!)
```

---

## Phase 4C: Complete Session

### What Happens When an Order is Completed

**Trigger**: Checker verifies everything is correct and clicks "Complete"

**Actions**:
1. Session status changes: `ready_to_check` → `completed`
2. `completed_at` timestamp is set
3. Order is considered shipped/fulfilled

**Inventory Impact**: ❌ **NO RETURN** - Items permanently leave inventory

The items were already deducted during scanning. Completing the order means those items are shipped and won't return.

**Database Changes**:
```sql
UPDATE order_fulfillment_sessions 
SET status = 'completed', 
    completed_at = NOW()
WHERE session_id = 'uuid'
```

---

## Inventory Summary by Action

| Action | Status Transition | Inventory Effect |
|--------|-------------------|------------------|
| Approve Order | → `approved` | No change |
| Start Picking | → `in_progress` | No change |
| Scan Item | (in `in_progress`) | **DEDUCTED** |
| Save as Draft | → `draft` | No change (items held) |
| Resume Draft | → `in_progress` | No change |
| Mark Ready to Check | → `ready_to_check` | No change (items held) |
| Send Back for Picking | → `draft` | No change (items held) |
| Complete Order | → `completed` | No change (items shipped) |
| Cancel (draft/in_progress) | → `cancelled` | **RETURNED** |
| Cancel (ready_to_check) | stays `ready_to_check` | No change (clears count only) |
| Cancel (completed) | ❌ Blocked | N/A |
| Daily Reset (incomplete) | → `archived` | **RETURNED** |
| Daily Reset (completed) | → `archived` | No change |

---

## Daily Reset / Scheduler

### When It Runs
The daily reset runs at a configured time (typically end of day) via a scheduled task.

### What Happens During Daily Reset

**Step 1: Return Inventory for Incomplete Sessions**
```
For each session with status in ('draft', 'in_progress', 'ready_to_check', 'approved'):
  For each item in items_scanned:
    For each deduction_source:
      Return remaining quantity to original inventory location
```

**Step 2: Archive All Sessions**
- ALL sessions are archived (including completed and cancelled)
- Original status is preserved in audit log
- Sessions won't appear in queues the next day

**Step 3: Clear Takeover Requests**
- Any pending "take over session" requests are cleared

### What This Means for the Next Day

| Session Status Before Reset | What Happens |
|-----------------------------|--------------|
| `completed` | Archived. Done. Won't reappear. |
| `cancelled` | Inventory already returned. Archived. Will reappear if still `processing` in Magento. |
| `draft` | Inventory returned. Archived. Will reappear if still `processing` in Magento. |
| `in_progress` | Inventory returned. Archived. Will reappear if still `processing` in Magento. |
| `ready_to_check` | Inventory returned. Archived. Will reappear if still `processing` in Magento. |
| `approved` | Archived. Will reappear if still `processing` in Magento. |

**Key Point**: The only sessions that truly "disappear" are `completed` ones - because those orders are no longer `processing` in Magento (they've been shipped/invoiced). All other statuses will reappear in pending approvals if Magento still shows the order as `processing`.

### Reset Result
```json
{
  "success": true,
  "sessions_archived": 45,
  "sessions_before": {
    "completed": 30,
    "cancelled": 5,
    "draft": 3,
    "in_progress": 2,
    "ready_to_check": 4,
    "approved": 1
  },
  "items_returned_to_inventory": 47,
  "sessions_with_inventory_returns": 9,
  "takeover_requests_cleared": 0
}
```

---

## Multi-Source Inventory Tracking

When scanning, items can come from multiple locations:

| Location | Field | Priority |
|----------|-------|----------|
| Shelf (<1 year old) | `shelf_lt1_qty` | 1st (preferred) |
| Shelf (>1 year old) | `shelf_gt1_qty` | 2nd |
| Top Floor | `top_floor_total` | 3rd (last resort) |

### Deduction Order
When scanning without specifying a location (`field='auto'`), the system deducts in priority order:
1. Take from `shelf_lt1_qty` first
2. If not enough, take from `shelf_gt1_qty`
3. If still not enough, take from `top_floor_total`

### Return Order
When returning (cancel/reset), items are returned to their **original locations** based on `deduction_sources`:
```json
{
  "deduction_sources": [
    {"field": "shelf_lt1_qty", "quantity": 3, "remaining": 3},
    {"field": "shelf_gt1_qty", "quantity": 2, "remaining": 2}
  ]
}
```
This ensures that if 3 items came from shelf_lt1 and 2 from shelf_gt1, they return to those exact locations.

---

## Overpicking Prevention

The system **prevents** scanning more items than expected:

```
Invoice says: 3 units of SKU "ME071"
Already scanned: 0
Attempt to scan: 5

Result: ❌ BLOCKED
Message: "Cannot scan: Would exceed expected quantity. Expected 3, already scanned 0."
```

This prevents inventory discrepancies from overpicking.

---

## Key Database Tables

### order_fulfillment_sessions
Main table storing all session data:
```sql
- session_id (UUID, primary key)
- invoice_id
- order_number
- status ('approved', 'in_progress', 'draft', 'ready_to_check', 'completed', 'cancelled', 'archived')
- session_type ('pick', 'check')
- items_expected (JSONB)
- items_scanned (JSONB)
- items_counted (JSONB) -- Checker's count when sending back
- user_id
- started_at, completed_at, last_modified_at
```

### inventory_metadata
Inventory levels per SKU:
```sql
- item_id (primary key)
- sku
- shelf_lt1_qty (Shelf stock under 1 year)
- shelf_gt1_qty (Shelf stock over 1 year)
- top_floor_total (Top floor reserve)
```

### order_fulfillment_audit_log
Full audit trail of all actions:
```sql
- session_id
- action ('created', 'started', 'scanned', 'completed', 'cancelled', 'sent_back', etc.)
- user_id
- timestamp
- details
```

---

## API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/orders/fulfillment/start-session` | POST | Start picking an approved order |
| `/orders/fulfillment/scan` | POST | Scan an item (deducts inventory) |
| `/orders/fulfillment/complete` | POST | Complete a session |
| `/orders/fulfillment/cancel` | POST | Cancel a session (returns inventory) |
| `/orders/fulfillment/tracking/mark-ready-to-check` | POST | Mark as ready for checking |
| `/orders/fulfillment/tracking/send-back-for-picking` | POST | Send back with count |
| `/orders/fulfillment/reset-daily-sessions` | POST | Run daily reset (admin) |

---

## Testing

The system is covered by `tests/test_extreme_workflow.py` which tests:

1. **Inventory Setup**: SKU exists, save/restore inventory
2. **Pick Session Lifecycle**: Create, scan, complete
3. **Draft/Cancel Inventory Returns**: Draft holds, cancel returns
4. **Ready to Check Workflow**: Transition and cancel returns
5. **Send Back for Picking**: items_counted storage and display
6. **Multi-Source Inventory**: Scan from multiple locations, return to correct locations
7. **Daily Reset/Scheduler**: Archive all, return incomplete inventory
8. **Edge Cases**: Overpicking prevention, zero-scan cancel

Run tests with:
```bash
python3 tests/test_extreme_workflow.py
```
