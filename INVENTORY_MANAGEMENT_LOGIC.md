# Inventory Management Logic Documentation

## Overview
The Inventory Management system tracks product inventory data, including stock levels, locations, and sales data. It uses a **direct connection to the UK Magento database** for product catalog, eliminating the need for manual CSV imports.

**Important:** The system shows **ALL products** from Magento (regardless of enabled/disabled status), except products with "AW365" in their name. Filtering is done via the `variant_statuses` array (which aggregates `discontinued_status` values from all product variants), not Magento's system status field.

---

## Key Terminology

| Term | Location | Description |
|------|----------|-------------|
| `discontinued_status` | Magento EAV attribute | The raw status value on each individual product variant in Magento (e.g., "Active", "Pre Order") |
| `variant_statuses` | `inventory_metadata` JSONB | An array that collects ALL `discontinued_status` values from ALL variants of a base SKU |
| `status` | `inventory_metadata` column | Calculated stock status (Overstock/Low Stock) - unrelated to product filtering |

**Example:**
- Magento has: `PROD123` (Active), `PROD123-MD` (Pre Order), `PROD123-SD` (Special Offer)
- After sync: `inventory_metadata.variant_statuses = ["Active", "Pre Order", "Special Offer"]`
- Filtering by "Pre Order" finds PROD123 because that status exists in the array

---

## Table Architecture

### Primary Tables

#### 1. UK Magento Database (External)
**Source:** `catalog_product_entity` table in UK Magento database

**Purpose:** Complete product catalog (read-only access)

**Data Fetched:**
- `sku` - Product SKU from catalog
- `name` - Product name from EAV (Entity-Attribute-Value) attribute tables
- `discontinued_status` - Custom attribute (stored in EAV attribute tables) with values like:
  - `Active` - Currently available
  - `Temporarily OOS` - Out of stock temporarily
  - `Pre Order` - Available for pre-order
  - `Samples` - Sample products
  - `Discontinued (Supplier)` - Discontinued by supplier
  - `Discontinued (RM)` - Discontinued by RM
  - `Special Offer` - On special offer
  - `Special Item` - Special items
- `categories` - Used for filtering (not displayed directly)

**Query Details:**
- Queries Magento's catalog tables (`catalog_product_entity`)
- Joins with EAV (Entity-Attribute-Value) attribute tables for product names and custom attributes (including `discontinued_status`)
- Returns **ALL products** (does NOT filter by Magento's enabled/disabled status)
- Filters by custom `discontinued_status` attribute when requested
- Always filters out products with category containing "AW365"
- Filters out products with no categories assigned
- Filters out products with no website assignment

**Fallback for Deleted Products (Orphaned Logic):**
When a product exists in `inventory_metadata` (the warehouse) but is no longer found in the live Magento catalog (e.g., deleted):
1.  **Check Live Catalog:** Primary source. If found, use live data.
2.  **Check Order History:** If not found in Live, checks historical `orders_cache` tables to find the product name from past sales.
3.  **Check Magento Catalog Directly:** If still not found, searches Magento catalog for variants that might match.
4.  **Orphaned:** If not found after all fallbacks, it is marked as "Orphaned" (product exists in warehouse but has no name/details).

**Key Points:**
- **All products visible** regardless of Magento enabled/disabled status
- Filtering is done via `discontinued_status` custom attribute, not system status
- The `status` field in `inventory_metadata` is for overstock/low stock calculation, not filtering
- When `status_filters` parameter is provided (e.g., "Active,Temporarily OOS"), only those discontinued_status values are returned
- `inventory_metadata` persists regardless of product status
- Read-only access to entire Magento database
- Always uses UK Magento as the canonical source
- **Deleted products are recoverable:** If a product is deleted from Magento but has sales history, it remains visible in Inventory Management (not orphaned).

#### 2. `inventory_metadata`
**Purpose:** Warehouse data and sales metadata (persistent across syncs)

**Columns:**
- `sku` (PRIMARY KEY) - Product SKU (always normalized to base SKU)
- `item_id` (UNIQUE) - Generated 18-digit ID (format: 772578000000491823)
- `location` - Warehouse location
- `date` - Last inventory date
- `qty_ordered_jason` - Quantity ordered by Jason
- `uk_6m_data` - UK 6-month sales quantity (populated by magento sync)
- `fr_6m_data` - FR+NL combined 6-month sales quantity (populated by magento sync)
- `shelf_lt1` - Quantity of products with their corresponding less than 1 year expiry date
- `shelf_lt1_qty` - Total quantity of products with less than 1 year expiry date
- `shelf_gt1` - Quantity of products with their corresponding more than 1 year expiry date
- `shelf_gt1_qty` - Total quantity of products with more than 1 year expiry date
- `top_floor_expiry` - Quantity of products with corresponding expiry dates in top floor
- `top_floor_total` - Total quantity of products in top floor
- `status` - Product status (Overstock/Low Stock)
- `uk_fr_preorder` - Pre-order information
- `variant_statuses` (JSONB) - Array aggregating all `discontinued_status` values from ALL variants of this base SKU (e.g., ["Active", "Pre Order", "Special Offer"])
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

**Key Points:**
- This table **persists** warehouse data across catalog re-imports
- SKU is primary key (item_id is derived from SKU)
- **All SKUs are normalized to base form** (no -MD, -SD, -DP, -NP, -MV suffixes)
- `variant_statuses` aggregates all `discontinued_status` values from all variants (populated by `update_variant_statuses()` function)
- **Dynamic Status Updates:** If a variant is deleted from Magento, its status is automatically removed from the base SKU's `variant_statuses` list during the next sync.
- 6M data fields are **only** updated by magento sync process
- Manual inventory updates don't touch 6M data fields

---

## Product Loading Flow

### Step-by-Step Process (when page loads)

1. **AUTO-SYNC MAGENTO DATA** (Optional/Background)
   ↓ Frontend can call `syncMagentoData()` to update sales data
   ├─→ Syncs UK Magento orders (Live → Cache → Aggregated)
   ├─→ Syncs FR Magento orders (Live → Cache → Aggregated)
   ├─→ Syncs NL Magento orders (Live → Cache → Aggregated)
   └─→ Syncs Aggregated Data → Inventory Metadata (updates 6M sales columns)
   
2. **SYNC MAGENTO PRODUCTS → METADATA**
   ↓ Fetch ALL products from UK Magento catalog_product_entity
   ├─→ Only inserts NEW SKUs into inventory_metadata
   ├─→ Existing products are PRESERVED (no overwrites)
   ├─→ Filters out products with no categories assigned
   ├─→ Filters out products with "AW365" in any category
   └─→ Filters out products with no website assignment (blank product_websites)

3. **MERGE IDENTIFIER PRODUCTS IN METADATA**
   ↓ Normalize all products to base SKU form in inventory_metadata
   ├─→ Identifies products with suffixes (-MD, -SD, -DP, -NP, -MV)
   ├─→ If base SKU exists: Deletes variant (merges into base)
   └─→ If base SKU missing: Renames variant to base SKU

4. **ENSURE ITEM IDS**
   ↓ Generate item IDs for any products missing them
   └─→ Uses hash of SKU to generate consistent 18-digit ID

5. **UPDATE VARIANT STATUSES**
   ↓ Aggregate all `discontinued_status` values from variants into `variant_statuses` array
   ├─→ Fetches all products from Magento (base + all variants)
   ├─→ Groups by base SKU and collects all unique `discontinued_status` values
   └─→ Updates `inventory_metadata.variant_statuses` JSONB column
   
6. **FETCH PRODUCTS FROM MAGENTO**
   ↓ Get ALL products from UK Magento database (live query)
   └─→ Includes base SKUs and all variants with their discontinued_status
   
7. **BUILD BASE SKU LOOKUP (In-Memory)**
   ↓ Group Magento products by base SKU for display name matching
   ├─→ Uses same regex pattern as Step 3: `-(?:MD|SD|DP|NP|MV)(?:-.*)?$`
   ├─→ Creates lookup dict: base_sku → first matching product details (name, categories)
   └─→ **Note:** This is in-memory only; Magento still has all variants

8. **FILTER BY VARIANT STATUSES** (if provided)
   ↓ Check if ANY status in `variant_statuses` array matches filter
   └─→ Filter "Active,Pre Order" → finds PROD123 if it has either status
   
9. **FETCH METADATA**
   ↓ Get all inventory_metadata records
   └─→ Contains item_id, locations, quantities, 6M data, variant_statuses
   
10. **POPULATE 6M DATA**
    ↓ Fetch aggregated sales from uk/fr/nl_aggregated_orders tables
    └─→ Merge into items as custom_fields
   
11. **RETURN TO FRONTEND**
    └─→ Items with merged Magento product + metadata + sales data + variant_statuses
```

---

## SKU Variant Normalization

### All Products Use Base SKU

Inventory Management normalizes **all products to use their base SKU** - no identifier suffixes remain in the system:

| Suffix Pattern | Meaning | Action |
|---------------|---------|---------|
| `-MD`, `-MD-xxxx` | Manager Decision | ✅ Normalized to base |
| `-SD`, `-SD-xxxx` | Short Date | ✅ Normalized to base |
| `-DP`, `-DP-xxxx` | Damaged Packaging | ✅ Normalized to base |
| `-NP`, `-NP-xxxx` | No Packaging | ✅ Normalized to base |
| `-MV`, `-MV-xxxx` | Missing Vials | ✅ Normalized to base |

**Regex Pattern:**
```regex
-(?:MD|SD|DP|NP|MV)(?:-.*)?$
```

### Normalization Logic

**Process (happens BEFORE item ID generation):**

1. **Find all identifier variant SKUs** in `inventory_metadata`
2. **Extract base SKU** by stripping identifier suffix
3. **Normalize to base SKU:**

   **If base SKU EXISTS:**
   - **DELETE** the variant record (merge into base)
   - All data consolidates under base SKU
   - Example: `PROD123-MD` deleted, data goes to `PROD123`
   
   **If base SKU DOES NOT EXIST:**
   - **RENAME** variant to base SKU
   - Variant becomes the base product
   - Example: `PROD123-MD` renamed to `PROD123`

**Result:** Every product in `inventory_metadata` uses its base SKU form. No suffixes remain.

### Variant Status Tracking

Each base SKU tracks **all `discontinued_status` values** from its variants in the `variant_statuses` field (JSONB array). This allows filtering by ANY variant's status.

**How It Works:**
1. Each product variant in Magento has a `discontinued_status` attribute (e.g., "Active", "Pre Order")
2. When `update_variant_statuses()` runs, it groups all variants by base SKU
3. All unique `discontinued_status` values are collected into the `variant_statuses` array
4. Filtering checks if ANY requested status exists in the array (OR logic)

**Example Scenario:**

Magento Catalog (each has its own `discontinued_status` attribute):
```
PROD123         → discontinued_status: "Active"
PROD123-MD      → discontinued_status: "Pre Order"
PROD123-SD-1234 → discontinued_status: "Special Offer"
PROD123-MV      → discontinued_status: "Discontinued (RM)"
```

Result in `inventory_metadata` (all statuses aggregated):
```json
{
  "sku": "PROD123",
  "variant_statuses": ["Active", "Discontinued (RM)", "Pre Order", "Special Offer"]
}
```

**Filtering Behavior:**

The system filters by checking if **ANY** variant status matches:

| Filter Query | Finds PROD123? | Reason |
|-------------|----------------|--------|
| `Active` | ✅ Yes | Has "Active" status |
| `Pre Order` | ✅ Yes | Has "Pre Order" status |
| `Special Offer` | ✅ Yes | Has "Special Offer" status |
| `Discontinued (RM)` | ✅ Yes | Has "Discontinued (RM)" status |
| `Active,Pre Order` | ✅ Yes | Has at least one matching status |
| `Temporarily OOS` | ❌ No | Does not have this status |

**Dynamic Updates:**

The `variant_statuses` array is updated when `update_variant_statuses()` is called:

1. System fetches all products from Magento (base + variants)
2. Groups them by base SKU
3. Collects all discontinued_status values
4. Updates `inventory_metadata.variant_statuses`

**When Updates Occur:**
- Labels module: Calls `update_variant_statuses()` before label generation
- Inventory Management page load: Does NOT automatically refresh (reads existing values)
- Manual sync operations: Can trigger updates

**Example Update Scenario:**

Initial state:
```
Magento: PROD123-SD → "Special Offer"
Database: variant_statuses = ["Active", "Special Offer"]
```

After removing PROD123-SD from Magento (and running `update_variant_statuses()`):
```
Magento: Only PROD123 → "Active"
Database: variant_statuses = ["Active"]  (Special Offer removed)
Filter "Special Offer" → No longer finds PROD123 ✅
```

**Key Points:**
- Statuses are refreshed when `update_variant_statuses()` is called
- Labels module automatically refreshes before label generation
- Automatically removes statuses when variants are deleted
- Automatically adds statuses when new variants are added
- Enables multi-status filtering (OR logic)
- Products can be found by any of their variant statuses

**Display Filtering:**
- All variant SKUs from Magento are normalized to base SKU for display
- Only base SKUs are shown in the inventory table
- As long as ANY variant exists in Magento, the base SKU displays
- This matches the normalized form in `inventory_metadata`

### Edge Cases & Data Persistence

**Case 1: Only Variants Exist (No Base SKU)**

Initial State:
```
Magento: PROD123-SD-1625, PROD123-SD-1927 (no PROD123 base)
```

Process:
1. Both variants synced to `inventory_metadata`
2. Normalization runs (alphabetical order):
   - `PROD123-SD-1625` → base doesn't exist → **renamed to PROD123**
   - `PROD123-SD-1927` → base exists now → **deleted** (merged into PROD123)
3. Display: Shows `PROD123` (because variants exist in Magento)

After deleting `PROD123-SD-1625`:
```
Magento: PROD123-SD-1927 (only one variant left)
Database: PROD123 (persists with data)
Display: Still shows PROD123 ✅ (because variant still exists)
```

After deleting both variants:
```
Magento: Neither variant exists
Database: PROD123 (persists with data but orphaned)
Display: PROD123 disappears ❌ (no variants in Magento)
```

**Case 2: Base SKU Removed from Magento**

Initial State:
```
Magento: PROD123, PROD123-MD
Database: PROD123 (MD variant merged)
```

After removing base PROD123 from Magento:
```
Magento: PROD123-MD (only variant left)
Database: PROD123 (persists with all data)
Display: Still shows PROD123 ✅ (because -MD variant exists)
```

**Case 3: Base SKU Renamed in Magento**

```
Old: PROD123 → renamed to → New: PROD456

Result:
- PROD123 stays in inventory_metadata (orphaned with data)
- PROD456 added as new record
- No data transfer between old and new
- Manual intervention needed to migrate data
```

**Case 4: Variant Added to Existing Product**

```
Before: Magento has PROD123 (Active)
Database: PROD123 with variant_statuses = ["Active"]

After: Add PROD123-MD (Pre Order) to Magento
When update_variant_statuses() is called (e.g., by Labels module):
- Syncs PROD123-MD to database
- Normalization deletes PROD123-MD (merged into PROD123)
- Updates variant_statuses = ["Active", "Pre Order"] ✅
- Product now findable by both statuses
```

**Important Notes:**
- This operates on `inventory_metadata` (NOT Magento catalog)
- All identifier variants (MD, SD, DP, NP, MV) are normalized to base SKU
- Sales data aggregation happens separately via magento sync
- System ensures consistent SKU format across all inventory records
- Variant statuses are tracked dynamically based on current Magento data

---

## 6M Data Population

### Source: Aggregated Sales Tables

The 6M data comes from the aggregated magento tables:
- `uk_aggregated_orders` → `uk_6m_data`
- `fr_aggregated_orders` + `nl_aggregated_orders` → `fr_6m_data`

### Population Methods

#### Method 1: Via Service Layer (Live)
Called when loading inventory management page:

```python
# Direct lookup from aggregated tables
uk_data = get_aggregated_data("uk")  # {sku: qty}
fr_data = get_aggregated_data("fr")  # {sku: qty}
nl_data = get_aggregated_data("nl")  # {sku: qty}

# Combine FR + NL
fr_combined = merge_fr_nl_data(fr_data, nl_data)

# Populate items
for item in items:
    sku = item["sku"]
    item["custom_fields"]["uk_6m_data"] = uk_data.get(sku, 0)
    item["custom_fields"]["fr_6m_data"] = fr_combined.get(sku, 0)
```

#### Method 2: Via Magento Sync (Persistent)
Manual sync (or auto-sync on page load) that writes to `inventory_metadata`:

```python
# 1. Sync Live Magento -> Local Cache -> Aggregated Tables (UK, FR, NL)
# 2. Sync Aggregated Tables -> Inventory Metadata

# Note: MD variants already merged in aggregated tables
# No additional merging needed - direct lookup by SKU

# Update inventory_metadata
UPDATE inventory_metadata 
SET uk_6m_data = %s, fr_6m_data = %s
WHERE sku = %s
```

**Key Differences:**
- **Service Layer:** Reads aggregated tables on-demand, temporary
- **Magento Sync:** Writes to `inventory_metadata`, persistent
- **Auto-Sync:** Can be triggered on page load via frontend call to ensure fresh data
- MD variants already merged in aggregated tables (no additional processing needed)

---

## Item ID Generation

### Format
- **18-digit numeric** string
- Format: `772578000000491823`
- Starts with `7` for legacy compatibility

### Algorithm
```python
def generate_item_id(sku: str) -> str:
    # SHA-256 hash of SKU
    hash_obj = hashlib.sha256(sku.encode())
    hash_int = int(hash_obj.hexdigest(), 16)
    
    # Take first 18 digits, ensure starts with 7
    item_id = str(700000000000000000 + (hash_int % 100000000000000000))
    
    return item_id
```

**Properties:**
- Deterministic (same SKU → same ID)
- Consistent across system restarts
- Unique per SKU (collision probability ~0)

---

## Product Filtering

### 1. Empty Categories Filter
**Applied:** In SQL queries when fetching from UK Magento (in both `sync_magento_products_to_inventory_metadata()` and `get_magento_products()`)

**Logic:**
```sql
-- In get_magento_products():
HAVING categories IS NOT NULL
    AND categories != ''

-- In sync_magento_products_to_inventory_metadata():
-- Additionally checked in Python:
if not categories or categories.strip() == "":
    skip_product()  # Not added to inventory_metadata
```

**Purpose:** Exclude products that have no categories assigned

**Note:** In CSV exports, these appear as "(Blanks)" in the categories column

### 2. AW365 Category Filter
**Applied:** In SQL queries when fetching from UK Magento (in both `sync_magento_products_to_inventory_metadata()` and `get_magento_products()`)

**Logic:**
```sql
-- In get_magento_products():
HAVING categories NOT LIKE '%AW365%'

-- In sync_magento_products_to_inventory_metadata():
-- Additionally checked in Python:
if "AW365" in categories.upper():
    skip_product()  # Not added to inventory_metadata
```

**Purpose:** Exclude products in AW365 categories from inventory tracking

**Examples of excluded categories:**
- `AW365 Default Category`
- `AW365 Default Category/Apparel`
- `AW365 Default Category/Apparel/Featured Brands/Miu Miu`

**Note:** Products are excluded if ANY of their assigned categories contain "AW365"

### 3. Product Website Filter
**Applied:** In SQL queries when fetching from UK Magento (in both `sync_magento_products_to_inventory_metadata()` and `get_magento_products()`)

**Logic:**
```sql
-- In get_magento_products():
WHERE EXISTS (
    SELECT 1 FROM catalog_product_website cpw 
    WHERE cpw.product_id = cpe.entity_id
)

-- In sync_magento_products_to_inventory_metadata():
-- Uses COUNT approach:
HAVING website_count > 0
-- where website_count is calculated as:
-- (SELECT COUNT(*) FROM catalog_product_website cpw WHERE cpw.product_id = cpe.entity_id)
```

**Purpose:** Exclude products that are not assigned to any website

**Note:** In CSV exports, these appear as "(Blanks)" in the product_websites column

### 4. Product Status Filter (via variant_statuses)
**Applied:** When filtering products in the UI

**How It Works:**
1. Each variant in Magento has a `discontinued_status` attribute
2. `update_variant_statuses()` collects all these into the `variant_statuses` JSONB array
3. UI filters by checking if ANY status in the array matches the selected filters

**Query Logic:**
```sql
-- Filter by variant_statuses array (ANY match)
SELECT * FROM inventory_metadata
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(variant_statuses) AS s
    WHERE s = ANY(ARRAY['Active', 'Temporarily OOS', ...])
)
```

**Purpose:** Filter products by their aggregated `variant_statuses` (which come from each variant's `discontinued_status` attribute in Magento)

**Available Status Values:**
- `Active` - Currently available products
- `Temporarily OOS` - Temporarily out of stock
- `Pre Order` - Available for pre-order
- `Samples` - Sample products
- `Discontinued (Supplier)` - Discontinued by supplier
- `Discontinued (RM)` - Discontinued by RM
- `Special Offer` - On special offer
- `Special Item` - Special items

**Behavior:**
- Products are filtered by `variant_statuses` array (aggregated from all variants' `discontinued_status` values)
- If ANY status in the array matches the filter, the product is included (OR logic)
- If no filters specified: Returns **all products** (default)
- Does NOT filter by Magento's enabled/disabled system status
- The `status` field in `inventory_metadata` is for stock calculations (overstock/low stock), NOT filtering

**Important Notes:**
- **All products** are visible by default (no status filtering)
- Magento's enabled/disabled status field is **NOT used** for filtering
- `discontinued_status` (Magento attribute) → aggregated into `variant_statuses` (database array) → used for filtering
- `inventory_metadata.status` is for warehouse calculations (overstock/low stock), not product visibility

---

## Data Flow Diagram

```
UK MAGENTO DATABASE (catalog_product_entity)
    ↓ Read-only query for ALL products (no status filtering)
    ↓ sync (new SKUs only, AW365 products excluded)
[inventory_metadata]    ← Persistent warehouse data (never deleted)
    ↓ merge variants
[inventory_metadata]    ← Consolidated base SKUs
    ↓ generate IDs
[inventory_metadata]    ← 18-digit item IDs assigned
    ↓ ↑ ← magento sync updates 6M data
    ↓ ↑ ← update_variant_statuses() aggregates discontinued_status values
    ↓
INVENTORY MANAGEMENT PAGE
    ↑
    ├─ Product catalog from UK Magento (live query for names)
    ├─ Warehouse data from inventory_metadata
    ├─ Filtering via variant_statuses array (aggregated from discontinued_status)
    └─ Live 6M data from aggregated_orders tables
    
NOTE: All products visible by default (filter by variant_statuses if needed)
```

---

## Import & Sync Operations

### Automatic Product Discovery
**How it works:** ALL products synced from UK Magento catalog (regardless of enabled/disabled status)

**Process:**
1. Query `catalog_product_entity` table for ALL products (no status filtering)
2. Join with Entity-Attribute-Value attribute tables to get product names and `discontinued_status`
3. Filter out products with categories containing "AW365"
4. Filter out products with no categories assigned (blank categories)
5. Filter out products with no website assignment (blank product_websites)
6. New products automatically added to `inventory_metadata` on page load
7. `update_variant_statuses()` aggregates all `discontinued_status` values into `variant_statuses` array

**Benefits:**
- No manual CSV imports required
- All products synced to `inventory_metadata` for data persistence
- Filter by `variant_statuses` array (aggregated from `discontinued_status` attributes)
- `inventory_metadata` preserved even if product status changes
- Always up-to-date with Magento catalog

**Important:**
- Gets ALL products from Magento catalog (no enabled/disabled filtering)
- ALL products synced to `inventory_metadata` (data persists)
- Uses UK Magento as canonical source
- Read-only database access
- Product names from EAV (Entity-Attribute-Value) attribute system
- `discontinued_status` (per variant) → `variant_statuses` (aggregated array) → UI filtering

### Sync Magento Sales Data
**Endpoint:** `POST /inventory/management/sync-magento-data`

**Process:**
1. Fetch aggregated sales from `uk/fr/nl_aggregated_orders`
2. Strip variant suffixes to get base SKUs
3. Aggregate quantities by base SKU
4. Update `uk_6m_data` and `fr_6m_data` in `inventory_metadata`

**Options:**
- `dry_run=true` - Preview changes without committing

---

## Metadata Updates

### Save Inventory Metadata
**Endpoint:** `PATCH /inventory/management/metadata/{sku}`

**Updatable Fields:**
- `location` - Warehouse location
- `date` - Inventory date
- `shelf_lt1`, `shelf_lt1_qty` - Low shelf location and quantity
- `shelf_gt1`, `shelf_gt1_qty` - High shelf location and quantity
- `top_floor_expiry`, `top_floor_total` - Top floor stock
- `status` - Product status
- `uk_fr_preorder` - Pre-order information

**NOT Updated (Preserved):**
- `uk_6m_data` - Only updated by magento sync
- `fr_6m_data` - Only updated by magento sync
- `item_id` - Never changed once generated

**Upsert Logic:**
```sql
INSERT INTO inventory_metadata (sku, location, shelf_lt1_qty, ...)
VALUES (%s, %s, %s, ...)
ON CONFLICT (sku) DO UPDATE SET
    location = EXCLUDED.location,
    shelf_lt1_qty = EXCLUDED.shelf_lt1_qty,
    ...
    -- uk_6m_data and fr_6m_data NOT included
```

---

## Stock Calculation

### Total Stock Formula
```
total_stock = shelf_lt1_qty + shelf_gt1_qty + top_floor_total
```

### Stock Display
- `shelf_total` - Combined shelf quantities (lt1 + gt1)
- `reserve_stock` - Top floor total
- `stock_on_hand` - Total of all locations

---

## Legacy System Compatibility

### Item ID Format
- Uses 18-digit numeric format matching legacy system
- Ensures compatibility with existing integrations
- Format: `7XXXXXXXXXXXXXXXXX` (starts with 7)

### Field Mappings
- `qty_ordered_jason` - Legacy field (deprecated, kept for compatibility)
- `uk_fr_preorder` - Legacy pre-order field
- Some fields may be unused but preserved for data migration

---

## Search & Pagination

### Search Functionality
**Searches across:**
- Product SKU (`sku`)
- Product Name (`name` from live Magento database)

**Query Logic:**
```sql
-- Filter by variant_statuses (checks if ANY status in array matches)
SELECT * FROM inventory_metadata
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(variant_statuses) AS s
    WHERE s = ANY(ARRAY['Active', 'Pre Order', ...])
)
AND (
    sku ILIKE '%search%'
    -- name comes from live Magento, not stored in inventory_metadata
)
LIMIT per_page OFFSET (page-1)*per_page
```

**Note:** Product names are fetched from live Magento database and joined with `inventory_metadata` at query time - they are not stored locally.

### Pagination
- **Default:** 100 items per page
- **Configurable:** Frontend can request different page sizes
- **Backend returns:**
  - `items` - Current page items
  - `total` - Total matching items
  - `page` - Current page number
  - `per_page` - Items per page

### Orphaned Products Filter
**Parameter:** `show_orphaned` (boolean, default: `false`)

**Purpose:** Control visibility of SKUs that exist in `inventory_metadata` but have no matching product in Magento catalog.

**Behavior:**
- `show_orphaned=false` (default): Hides orphaned SKUs from results
- `show_orphaned=true`: Includes orphaned SKUs in results

**Orphaned Detection:**
1. First tries to find product name in live Magento catalog
2. Falls back to `orders_cache` tables (historical order data)
3. Falls back to direct Magento catalog lookup (including variants)
4. If still no name found after all fallbacks → marked as orphaned

**Frontend:** Checkbox "Show Orphaned" toggles this filter

---

## Key Differences from Magento 6M Data

| Aspect | Magento 6M Data | Inventory Management |
|--------|----------------|---------------------|
| **Variant Merging** | Only MD variants | Only MD variants |
| **Merge Location** | Aggregated orders tables | inventory_metadata table |
| **Merge Method** | SQL regex in query | Pre-processing before item IDs |
| **6M Data Source** | Aggregated tables only | Both aggregated tables + metadata table |
| **Product Catalog** | Not managed | Direct from UK Magento database |
| **Filtering** | Customer/group/threshold exclusions | AW365 name filter only |
| **Product Discovery** | Manual sync required | Automatic from orders |

---

## Common Operations

### Adding New Products
- Products automatically appear when added to UK Magento catalog AND enabled
- No manual action required
- Sync happens on inventory management page load
- Variant merging happens automatically
- Item ID generated automatically on first page load
- Start tracking inventory via metadata updates

### Changing Product Status
- Products always remain in `inventory_metadata` once synced
- Changing `discontinued_status` custom attribute in Magento affects filtering
- UI can filter by `discontinued_status` to show/hide products
- `inventory_metadata` is PRESERVED with all warehouse data
- Item ID, locations, quantities, and 6M data remain intact

### Product Not Appearing Yet
- Product must exist in UK Magento catalog (`catalog_product_entity`)
- Product must have categories assigned (not blank)
- Product must have a website assignment
- Product must not have "AW365" in any category
- Refresh inventory management page to trigger sync
- Verify Magento database connection is working

### Updating Product Names
- Product names come from UK Magento catalog Entity-Attribute-Value tables
- Updates from Magento reflected on next page load
- Inventory data unaffected

### Resetting Product List
- Not applicable - products auto-sync from Magento catalog
- To force refresh, reload the inventory management page
- `inventory_metadata` always retains warehouse data

---

## Troubleshooting

### Product Not Showing
**Check:**
1. Does it exist in UK Magento catalog (`catalog_product_entity`)?
2. Does product have categories assigned? (blank categories are filtered out)
3. Do any categories contain "AW365"? (auto-filtered)
4. Does product have a website assignment? (products without websites are filtered out)
5. Is it a variant SKU? (all variants normalized to base SKU - check for base SKU instead)
6. Was variant merging applied correctly?
7. Is UK Magento database accessible?
8. Try refreshing the inventory management page to force sync
9. Are you filtering by `discontinued_status`? Check if ANY variant has that status

### Product Shows as Empty/No Data
**Possible Causes:**
1. **Variant without base:** Product is a variant (e.g., PROD123-MD) but base PROD123 exists
   - Variant data was merged into base SKU
   - Look for the base SKU (PROD123) instead
2. **Recently added:** First page load creates the record, subsequent loads populate data
3. **Magento sync issue:** Check if UK Magento connection is working

### Variant SKU Appearing Instead of Base
**This should not happen** - if it does:
1. Check normalization logs for errors
2. Verify regex pattern is matching: `-(?:MD|SD|DP|NP|MV)(?:-.*)?$`
3. Check if merge process completed successfully
4. Database may need manual cleanup of variant records

### Filtering Not Finding Product
**Check variant_statuses:**
1. Product found by ANY status in its `variant_statuses` array
2. Example: Product has `["Active", "Pre Order"]`
   - Filter "Active" → ✅ Found
   - Filter "Pre Order" → ✅ Found  
   - Filter "Special Offer" → ❌ Not found (doesn't have this status)
3. Verify `variant_statuses` in database:
   ```sql
   SELECT sku, variant_statuses FROM inventory_metadata WHERE sku = 'PROD123';
   ```
4. Statuses update when Labels module runs - try generating labels to refresh variant_statuses

### Orphaned Data (Product in Database but Not Displaying)
**Cause:** Product exists in `inventory_metadata` but not in Magento catalog

**Why it happens:**
- Base SKU was deleted from Magento
- All variants were removed from Magento
- Product was renamed in Magento (old SKU orphaned)

**Result:**
- Data persists in `inventory_metadata` (with all warehouse info)
- Product won't display in UI (requires Magento presence)
- Manual intervention needed to reassign data or clean up

**Fix:**
- Re-add product to Magento (data will reappear)
- Or manually delete from `inventory_metadata` if no longer needed
- Or create base SKU in Magento if only variants exist

### Database Connection Errors
**Check:**
1. `return_products_connection` import present in repo.py
2. All database pool functions imported correctly
3. Error logs for connection pool issues
4. Database credentials in .env file

### Product Not Visible in UI
**Check:**
- Product should be synced to `inventory_metadata` if it passes the filters above
- UI filters by `variant_statuses` array (aggregated from each variant's `discontinued_status`)
- Check the product's variants' `discontinued_status` values in Magento
- Check `variant_statuses` array in `inventory_metadata` for all applicable statuses
- Try removing status filters in the UI to see all products
- `inventory_metadata` persists regardless of Magento status changes

### Lost Data After Product Changes
**This shouldn't happen** - inventory_metadata is never deleted
- Check `inventory_metadata` table directly for the SKU
- Data should persist even if product changes in Magento
- If data is missing, check application logs for errors
- Consider implementing backups for critical data

### Missing Item ID
**Solution:** Item IDs are generated on page load
- Refresh the inventory management page
- `ensure_all_products_have_item_ids()` runs automatically

### 6M Data Not Updating
**Check:**
1. Are aggregated tables populated? (Magento sync running?)
2. Is the SKU exactly matching (variants stripped)?
3. Try manual magento sync: `POST /inventory/management/sync-magento-data`

### Variant Not Merging
**Check:**
1. Is the suffix pattern correct? (-SD, -DP, -NP, -MV, -MD)
2. Case-insensitive match required
3. Merging happens in `inventory_metadata`, not Magento database
4. Check merge stats in logs

### Duplicate Item IDs
**This shouldn't happen** - item IDs are deterministic based on SKU
- If duplicates exist, it indicates data corruption
- Check for duplicate SKUs in inventory_metadata

### Cannot Connect to Magento Database
**Check:**
1. Verify Magento database credentials in `.env`
2. Check network connectivity to Magento server
3. Verify database user has SELECT permissions on:
   - `catalog_product_entity`
   - `catalog_product_entity_varchar`
   - `catalog_product_entity_int` (for status attribute)
   - `eav_attribute`
   - `eav_entity_type`
4. Check logs for specific connection errors

---

## Code References

### Key Files
- **Repository:** `backend/modules/inventory/management/repo.py`
- **Service:** `backend/modules/inventory/management/service.py`
- **Magento Sync:** `backend/modules/inventory/management/magento_sync.py`
- **Frontend:** `frontend/js/modules/inventory/management.js`

### Key Functions
- `sync_magento_products_to_inventory_metadata()` - Catalog → metadata sync
- `merge_identifier_products()` - Variant consolidation
- `ensure_all_products_have_item_ids()` - ID generation
- `get_inventory_items_from_magento()` - Main data loader
- `sync_magento_to_inventory_metadata()` - 6M data sync
- `update_variant_statuses()` - Refreshes variant_statuses JSONB from Magento (called by Labels module)
- `get_names_from_orders_cache()` - Fallback name lookup from historical orders
- `get_magento_catalog_names()` - Fallback name lookup from Magento catalog

---

*Last Updated: January 23, 2026*
