# Inventory Management Logic Documentation

## Overview
The Inventory Management system tracks product inventory data, including stock levels, locations, and sales data. It uses a **direct connection to the UK Magento database** for product catalog, eliminating the need for manual CSV imports.

**Important:** The system shows **ALL products** from Magento (regardless of enabled/disabled status), except products with "AW365" in their name. Filtering is done via the custom `product_status` attribute, not Magento's system status field.

---

## Table Architecture

### Primary Tables

#### 1. UK Magento Database (External)
**Source:** `catalog_product_entity` table in UK Magento database

**Purpose:** Complete product catalog (read-only access)

**Data Fetched:**
- `sku` - Product SKU from catalog
- `name` - Product name from EAV attribute tables
- `product_status` - Custom attribute with values like:
  - `Active` - Currently available
  - `Temporarily OOS` - Out of stock temporarily
  - `Pre Order` - Available for pre-order
  - `Samples` - Sample products
  - `Discontinued (Supplier)` - Discontinued by supplier
  - `Discontinued (RM)` - Discontinued by RM
  - `Special Offer` - On special offer
  - `Special Item` - Special items

**Query Details:**
- Queries Magento's catalog tables (`catalog_product_entity`)
- Joins with EAV attribute tables for product names and custom attributes
- Returns **ALL products** (does NOT filter by Magento's enabled/disabled status)
- Filters by custom `product_status` attribute when requested
- Always filters out products with "AW365" in their name

**Key Points:**
- **All products visible** regardless of Magento enabled/disabled status
- Filtering is done via `product_status` custom attribute, not system status
- The `status` field in `inventory_metadata` is for overstock/low stock calculation, not filtering
- When `status_filters` parameter is provided (e.g., "Active,Temporarily OOS"), only those product_status values are returned
- `inventory_metadata` persists regardless of product status
- Read-only access to entire Magento database
- Always uses UK Magento as the canonical source

#### 2. `inventory_metadata`
**Purpose:** Warehouse data and sales metadata (persistent across syncs)

**Columns:**
- `sku` (PRIMARY KEY) - Product SKU
- `item_id` (UNIQUE) - Generated 18-digit ID (format: 772578000000491823)
- `location` - ???
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
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

**Key Points:**
- This table **persists** warehouse data across catalog re-imports
- SKU is primary key (item_id is derived from SKU)
- 6M data fields are **only** updated by magento sync process
- Manual inventory updates don't touch 6M data fields

---

## Product Loading Flow

### Step-by-Step Process (when page loads)

```
1. ENSURE TABLES EXIST
   ↓ Create inventory_metadata table if it doesn't exist
   
2. SYNC MAGENTO → METADATA
   ↓ Fetch ALL products from UK Magento catalog_product_entity
   ├─→ Only inserts NEW SKUs into inventory_metadata
   ├─→ Existing products are PRESERVED (no overwrites)
   ├─→ Filters out products with no categories assigned
   ├─→ Filters out products with "AW365" in any category
   ├─→ Filters out products with no website assignment (blank product_websites)
   └─→ Does NOT filter by enabled/disabled status (all products synced)
   
3. MERGE IDENTIFIER PRODUCTS
   ↓ Consolidate variant SKUs into base SKUs
   └─→ Happens BEFORE item ID generation
   
4. GENERATE ITEM IDs
   ↓ Assign 18-digit IDs to products without them
   └─→ ID is SHA-256 hash of SKU in legacy format
   
5. FETCH PRODUCTS
   ↓ Get from UK Magento database (live query)
   └─→ Optional filtering by product_status attribute
   
6. FETCH METADATA
   ↓ Get all inventory_metadata records
   └─→ Contains item_id, locations, quantities, 6M data
   
7. POPULATE 6M DATA
   ↓ Fetch aggregated sales from uk/fr/nl_aggregated_orders tables
   └─→ Merge into items as custom_fields
   
8. RETURN TO FRONTEND
   └─→ Items with merged Magento product + metadata + sales data
```

---

## SKU Variant Merging

### Same Logic as 6M Data (ONLY MD Merges)

Inventory Management now uses **identical merging logic to Magento 6M Data** - only MD variants merge with their base SKU:

| Suffix Pattern | Meaning | Merged? |
|---------------|---------|---------|
| `-MD`, `-MD-xxxx` | Manager Decision | ✅ Yes |
| `-SD`, `-SD-xxxx` | Short Date | ❌ No (stays separate) |
| `-DP`, `-DP-xxxx` | Damaged Packaging | ❌ No (stays separate) |
| `-NP`, `-NP-xxxx` | No Packaging | ❌ No (stays separate) |
| `-MV`, `-MV-xxxx` | Missing Vials | ❌ No (stays separate) |

**Regex Pattern:**
```regex
-MD(?:-.*)?$
```

### Merging Logic

**Process (happens BEFORE item ID generation):**

1. **Find all -MD variant SKUs** in `inventory_metadata`
2. **Extract base SKU** by stripping -MD suffix
3. **Check if base SKU exists:**

   **If base SKU EXISTS:**
   - **DELETE** the -MD variant record
   - Sales data will aggregate to base via magento sync
   - Example: `PROD123-MD` deleted, data goes to `PROD123`
   
   **If base SKU DOES NOT EXIST:**
   - **RENAME** -MD SKU to base SKU
   - Variant becomes the base product
   - Example: `PROD123-MD` renamed to `PROD123`

**Important Notes:**
- This operates on `inventory_metadata` (NOT `magento_product_list`)
- **Only MD variants merge** - all other variants (SD, DP, NP, MV) stay separate
- Matches the 6M Data aggregation logic exactly
- Sales data aggregation happens separately via magento sync

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
Manual sync that writes to `inventory_metadata`:

```python
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
**Applied:** During sync from UK Magento to `inventory_metadata`

**Logic:**
```python
if not categories or categories.strip() == "":
    skip_product()  # Not added to inventory_metadata
```

**Purpose:** Exclude products that have no categories assigned

**Note:** In CSV exports, these appear as "(Blanks)" in the categories column

### 2. AW365 Category Filter
**Applied:** During sync from UK Magento to `inventory_metadata`

**Logic:**
```python
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
**Applied:** During sync from UK Magento to `inventory_metadata`

**Logic:**
```python
if product_website_count == 0:
    skip_product()  # Not added to inventory_metadata
```

**Purpose:** Exclude products that are not assigned to any website

**Note:** In CSV exports, these appear as "(Blanks)" in the product_websites column

### 4. Product Status Filter
**Applied:** When fetching products from UK Magento (optional)

**Logic:**
```python
# API accepts comma-separated list of statuses
status_filters = "Active,Temporarily OOS,Pre Order,Samples"

# Query filters by product_status custom attribute
WHERE product_status IN ('Active', 'Temporarily OOS', 'Pre Order', 'Samples')
```

**Purpose:** Filter products by their custom product_status attribute

**Available Values:**
- `Active` - Currently available products
- `Temporarily OOS` - Temporarily out of stock
- `Pre Order` - Available for pre-order
- `Samples` - Sample products
- `Discontinued (Supplier)` - Discontinued by supplier
- `Discontinued (RM)` - Discontinued by RM
- `Special Offer` - On special offer
- `Special Item` - Special items

**Behavior:**
- If `status_filters` is provided: Only returns products matching those statuses
- If `status_filters` is `None`: Returns **all products** (default)
- Does NOT filter by Magento's enabled/disabled system status
- The `status` field in `inventory_metadata` is for overstock/low stock calculation, not filtering

**Important Notes:**
- **All products** are visible by default (no status filtering)
- Magento's enabled/disabled status field is **NOT used** for filtering
- Custom `product_status` attribute is the correct field for filtering
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
    ↓
INVENTORY MANAGEMENT PAGE
    ↑
    ├─ Product catalog from UK Magento (live, optional product_status filter)
    ├─ Warehouse data from inventory_metadata
    └─ Live 6M data from aggregated_orders tables
    
NOTE: All products visible by default (filter by product_status if needed)
```

---

## Import & Sync Operations

### Automatic Product Discovery
**How it works:** Enabled products synced from UK Magento catalog

**Process:**
1. Query `catalog_product_entity` table for ENABLED products (status = 1)
2. Join with EAV attribute tables to get product names
3. Filter out products with "AW365" in name
4. Filter out disabled products (status = 2)
5. New products automatically added to `inventory_metadata` on page load

**Benefits:**
- No manual CSV imports required
- Only active/enabled products appear in inventory
- Disabled products automatically hidden
- When re-enabled, products reappear with all data intact
- Always up-to-date with Magento catalog

**Important:**
- Gets only ENABLED products from Magento catalog
- Disabled products excluded but `inventory_metadata` preserved
- Uses UK Magento as canonical source
- Read-only database access
- Product names from EAV attribute system

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
**Endpoint:** `PUT /inventory/management/metadata`

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
- Product Name (`name` from `magento_product_list`)

**Query:**
```sql
SELECT * FROM magento_product_list
WHERE 
    discontinued_status IN (filters)
    AND (
        sku ILIKE '%search%' 
        OR name ILIKE '%search%'
    )
LIMIT per_page OFFSET (page-1)*per_page
```

### Pagination
- **Default:** 100 items per page
- **Configurable:** Frontend can request different page sizes
- **Backend returns:**
  - `items` - Current page items
  - `total` - Total matching items
  - `page` - Current page number
  - `per_page` - Items per page

---

## Key Differences from Magento 6M Data

| Aspect | Magento 6M Data | Inventory Management |
|--------|----------------|---------------------|
| **Variant Merging** | Only MD variants | ALL variants (SD, DP, NP, MV, MD) |
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

### Disabling a Product
- Disable product in UK Magento (set status = 2)
- Product disappears from inventory table on next page load
- `inventory_metadata` is PRESERVED with all warehouse data
- Item ID, locations, quantities, and 6M data remain intact

### Re-enabling a Product
- Enable product in UK Magento (set status = 1)
- Product reappears in inventory table on next page load
- All warehouse data restored automatically
- No data loss - everything was preserved

### Product Not Appearing Yet
- Product must exist in UK Magento catalog (`catalog_product_entity`)
- Product must be ENABLED (status = 1)
- Refresh inventory management page to trigger sync
- Check if product name contains "AW365" (auto-filtered)
- Verify Magento database connection is working

### Updating Product Names
- Product names come from UK Magento catalog EAV tables
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
2. Is the product ENABLED (status = 1)? Disabled products don't appear
3. Does product name contain "AW365"? (auto-filtered)
4. Was variant merging applied correctly?
5. Is UK Magento database accessible?
6. Try refreshing the inventory management page to force sync

### Disabled Product Still Showing
**This shouldn't happen** - disabled products are filtered automatically
- Check that product status is actually 2 in Magento
- Clear browser cache and refresh
- Verify EAV status attribute is properly set
- Check logs for sync errors

### Lost Data After Disabling Product
**This shouldn't happen** - inventory_metadata is never deleted
- Check `inventory_metadata` table directly for the SKU
- Data should still exist even if product is disabled
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

---

*Last Updated: December 31, 2025*
