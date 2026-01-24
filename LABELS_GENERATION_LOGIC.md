# Labels Generation Logic Documentation

## Overview
The Labels Generation system creates product labels with barcodes, prices, and sales data. It uses the **same data architecture as Inventory Management** for consistency. Instead of querying Magento directly, it leverages the `inventory_metadata` table as the single source of truth, ensuring that product lists, variant merging, and status filtering are identical across both systems.

**Key Principle:** Labels and Inventory Management share identical product sourcing, variant normalization, status filtering, and 6M data logic to ensure consistency across the system.

---

## Key Terminology

| Term | Location | Description |
|------|----------|-------------|
| `discontinued_status` | Magento EAV attribute | The raw status value on each individual product variant in Magento (e.g., "Active", "Pre Order") |
| `variant_statuses` | `inventory_metadata` JSONB | An array that aggregates ALL `discontinued_status` values from ALL variants of a base SKU |

**How They Relate:**
- Each product variant in Magento has its own `discontinued_status` attribute
- When `update_variant_statuses()` runs (triggered by Labels before generation), all variants are grouped by base SKU
- All unique `discontinued_status` values are collected into the `variant_statuses` array
- Filtering uses `variant_statuses` (ANY match logic) - if a product has 3 variants with different statuses, selecting any one of those statuses will include the product

---

## Data Sources

### 1. Product Catalog: Inventory Metadata (Synced from Magento)
**Source:** PostgreSQL `inventory_metadata` table (refreshed from UK Magento)

**Purpose:** Get list of products to generate labels for

**Process:**
1.  **Auto-Sync:** Frontend calls `syncMagentoData()` automatically on load to:
    - Sync UK/FR/NL Magento orders (Live → Cache → Aggregated)
    - Sync Aggregated Data → Inventory Metadata (updates 6M sales columns)
2.  **Refresh:** System calls `InventoryManagementRepo.sync_magento_products_to_inventory_metadata()` to pull ALL products and their statuses from UK Magento.
3.  **Merge:** System calls `InventoryManagementRepo.merge_identifier_products()` to normalize ALL variants (e.g., `-MD`, `-SD`) into base SKUs.
4.  **Update Statuses:** System calls `InventoryManagementRepo.update_variant_statuses()` to refresh the `variant_statuses` JSONB array from live Magento data.
5.  **Filter:** 
    - **Database Mode:** Queries `inventory_metadata` filtering by the `variant_statuses` JSONB array (ANY match)
    - **CSV Mode:** Queries `inventory_metadata` filtering by the `status` column (base SKU status only)

**Data Fetched:**
- `sku` - Base SKU from inventory_metadata
- `variant_statuses` - Array of all variant statuses (e.g., `["Active", "Discontinued"]`)
- `status` - Base SKU status (kept for reference, not used for filtering)

**Default Filter:** ALL statuses (all 8 checkboxes checked)

**No Saved Preferences:** Filters always reset to default (all checked) on page load

**Variant Status Logic (How discontinued_status becomes variant_statuses):**
- **Identical to Inventory Management:**
- Each variant in Magento has a `discontinued_status` attribute (the source)
- All variants (e.g., `-MD`, `-SD`) are grouped by base SKU
- All `discontinued_status` values from these variants are collected into `variant_statuses` array
- **Dynamic Updates:** If a variant is deleted from Magento, its status is automatically removed from the base SKU's array
- Filtering checks if **ANY** of the `variant_statuses` values match the requested filter
- Example: If Base has "Active" and Variant has "Discontinued", filtering by "Discontinued" **WILL** include the product

**Key Points:**
- **Single Source of Truth:** Uses `inventory_metadata` just like Inventory Management.
- **Identical Logic:** By calling `update_variant_statuses()`, we guarantee 1:1 consistency.
- **Exclusions:** The sync process already handles exclusions (AW365 categories, no websites, etc.).

### 2. Item IDs (Barcodes): inventory_metadata Table
**Source:** PostgreSQL `inventory_metadata` table

**Purpose:** Get 18-digit item IDs used as barcodes on labels

**Data Fetched:**
- `sku` → `item_id` mapping

**Key Points:**
- Item IDs are generated once and persist across all systems
- Format: 18-digit numbers (e.g., `772578000000491823`)
- Same item IDs used in Inventory Management

### 3. 6-Month Sales Data: Aggregated Tables
**Source:** PostgreSQL aggregated tables (refreshed from magento sync)

**Tables:**
- `uk_aggregated_orders` → UK 6M quantities
- `fr_aggregated_orders` → FR 6M quantities  
- `nl_aggregated_orders` → NL 6M quantities

**Data Fetched:**
- `sku` → `total_qty` for each region
- FR and NL combined: `fr_6m_data = fr_qty + nl_qty`

**Key Points:**
- **Identical to Inventory Management** - queries same tables
- MD variants already merged in aggregated tables
- No need for sku_aliases (labels always use current SKUs)
- Data refreshed via "Refresh Aggregated Data" or after magento sync

### 4. Prices: Region-Specific Magento Live Catalog (Excluding VAT)
**Source:** Magento `catalog_product_entity_decimal` table (Live catalog from selected region)

**Purpose:** Get current product pricing from live Magento database, in excluding-VAT format

**Data Fetched:**
- Product's `special_price` (if exists and > 0)
- Falls back to `price` (if special_price doesn't exist or is 0)
- Shows "N/A" if neither price exists

**VAT Handling by Region:**

| Region | Price Entry in Magento | Label Display | Calculation |
|--------|------------------------|---------------|-------------|
| **UK** | Including 20% VAT | Excluding VAT | Divide by 1.20 |
| **FR** | Excluding VAT | Excluding VAT | Use directly (no calculation) |
| **NL** | Including 20% VAT | Excluding VAT | Divide by 1.20 |

**Examples:**
- **UK**: Magento shows £29.99 (incl. VAT) → Label shows £24.99 (excl. VAT)
- **FR**: Magento shows €24.99 (excl. VAT) → Label shows €24.99 (excl. VAT) ✓
- **NL**: Magento shows €29.99 (incl. VAT) → Label shows €24.99 (excl. VAT)

**Priority Logic:**
1. **Special Price First:** If product has an active special/sale price, use it (apply VAT calculation if needed)
2. **Regular Price Second:** If no special price, use the regular price (apply VAT calculation if needed)
3. **N/A Fallback:** If neither price exists, display "N/A"

**Currency:**
- UK: GBP (£)
- FR: EUR (€)
- NL: EUR (€)

**Key Points:**
- Queries the selected region's Magento catalog directly
- Gets current pricing from catalog, not historical order prices
- Searches both base SKUs and their variants (-MD, -SD, etc.)
- FR prices are used as-is since they're already entered excluding VAT
- UK and NL prices are converted from including-VAT to excluding-VAT

### 5. Product Names: Region-Smart Resolution Strategy
**Source:** Live Magento Catalog + Historical Orders Cache

**Purpose:** Get product display names with intelligent fallback logic

**Priority Logic:**
1.  **Live Catalog (Region Specific):** 
    - Checks the live Magento database for the *selected region* (UK, FR, or NL).
    - Ensures labels for France get French product names if they exist.
2.  **Order History (Region Prioritized):** 
    - If not in live catalog (e.g., deleted), checks `orders_cache` tables.
    - Prioritizes history from the selected region.
3.  **Live Catalog (UK Fallback):** 
    - If preferred region was not UK, and product wasn't found in live region catalog or history.
    - Checks UK Live Catalog as the final source of truth.

**Data Fetched:**
- Product Name (localized if available)
- Handles "Orphaned Products" by finding their names in history if deleted from live catalog.

**Why this matters:**
- **Accuracy:** French labels get French names.
- **Completeness:** Deleted products still get names (from history).
- **Fallbacks:** If a product is only in the UK catalog but you print a French label, it falls back to the UK name instead of showing nothing.

**Region Priority:**
- User can select preferred region (uk/fr/nl)
- System checks preferred region first, then falls back to others
- Ensures most relevant product name is shown (e.g., French name for FR region)

**Fallback Mechanism:**
- If product name not found in any `orders_cache` table (product never been ordered)
- Falls back to UK Magento catalog `catalog_product_entity_varchar` table
- Ensures all products have names even if they've never been ordered

### 6. Job History: Label Print Jobs
**Source:** PostgreSQL `label_print_jobs` and `label_print_items` tables

**Purpose:** Track history of generated labels

**Data Stored:**
- **Job:** ID, created_by, line (optional text field), created_at
- **Items:** SKU, product_name, 6M data, price, line (optional text field)

**Key Points:**
- Every label generation run is saved as a job
- Allows reviewing past print runs
- Tracks who generated the labels and when
- The `line` field is intentionally empty - labels display "Line: " so it can be handwritten

**Data Fetched:**
- Latest `name` for each SKU
- Uses region preference (same as prices)

---

## Label Generation Flow

```
1. FETCH PRODUCTS FROM UK MAGENTO
   ↓ Query catalog_product_entity (all variants)
   ├─→ Fetches ALL products including variants (MD, SD, DP, NP, MV)
   ├─→ No filtering at this stage - get complete product list
   ├─→ Exclude products with no categories assigned
   ├─→ Exclude products with AW365 in any category
   └─→ Exclude products with no website assignment
   
2. NORMALIZE ALL VARIANTS TO BASE SKU
   ↓ Strip ALL variant suffixes (-MD, -SD, -DP, -NP, -MV)
   ├─→ PROD123-MD → PROD123
   ├─→ PROD123-SD-2024 → PROD123
   ├─→ PROD123-DP → PROD123
   └─→ Group by base SKU
   
3. COLLECT VARIANT STATUSES
   ↓ For each base SKU, collect ALL discontinued_status values from its variants
   ├─→ Each variant has its own discontinued_status attribute in Magento
   ├─→ PROD123-MD: "Active" → add "Active" to array
   ├─→ PROD123-SD: "Discontinued (RM)" → add "Discontinued (RM)" to array
   ├─→ Result: variant_statuses = ["Active", "Discontinued (RM)"]
   └─→ Store aggregated array in inventory_metadata.variant_statuses JSONB column
   
4. FILTER BY VARIANT STATUS
   ↓ Apply filter to variant_statuses array (aggregated from all variant's discontinued_status values)
   ├─→ API Default: ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
   ├─→ UI Default: ALL 8 status checkboxes checked (overrides API default)
   ├─→ Keep product if ANY status in variant_statuses array matches filter
   └─→ Returns filtered list of base SKUs
   
5. LOAD ITEM IDs
   ↓ Query inventory_metadata for barcodes
   └─→ sku → item_id mapping
   
6. LOAD 6M DATA
   ↓ Query aggregated_orders tables
   ├─→ UK: uk_aggregated_orders
   ├─→ FR: fr_aggregated_orders + nl_aggregated_orders
   └─→ sku → (uk_6m, fr_6m) mapping
   
7. LOAD PRICES
   ↓ Query selected region's Magento live catalog
   ├─→ Search catalog_product_entity_decimal for base SKUs and variants
   ├─→ Priority: special_price > price > "N/A"
   ├─→ UK/NL: Convert from incl. VAT to excl. VAT (÷ 1.20)
   ├─→ FR: Use directly (already excl. VAT)
   └─→ Format: £24.99 / €24.99 (excl. VAT) or N/A
   
8. LOAD PRODUCT NAMES
   ↓ Query orders_cache with region preference
   ├─→ Try UK/FR/NL orders_cache (based on region preference)
   ├─→ If name found: use latest product name from orders
   └─→ If NOT found: fallback to UK Magento catalog_product_entity
   
9. BUILD LABEL DATA
   ↓ Combine all data for each product
   └─→ {item_id, sku, name, uk_6m, fr_6m, price, variant_statuses}
   
10. GENERATE LABEL FILE
    └─→ Output in selected format (PDF/CSV)
```

---

## SKU Variant Normalization

### ALL Variants Normalize to Base SKU

**Identical Logic to Inventory Management:**

| Suffix Pattern | Meaning | Normalized? |
|---------------|---------|-------------|
| `-MD`, `-MD-xxxx` | Manager Decision | ✅ Yes → Base SKU |
| `-SD`, `-SD-xxxx` | Short Date | ✅ Yes → Base SKU |
| `-DP`, `-DP-xxxx` | Damaged Packaging | ✅ Yes → Base SKU |
| `-NP`, `-NP-xxxx` | No Packaging | ✅ Yes → Base SKU |
| `-MV`, `-MV-xxxx` | Missing Vials | ✅ Yes → Base SKU |

**Normalization Process:**
1. **Fetch all products** from UK Magento (including all variants)
2. **Strip variant suffixes** using regex: `r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$'`
3. **Group by base SKU** - all variants grouped under their base
4. **Collect variant statuses** - track ALL discontinued_status values from ALL variants
5. **Filter by ANY status** - keep product if ANY variant matches filter criteria
6. **Use base SKU only** - labels always show base SKU (e.g., PROD123)

**Example Scenario:**
```
Magento Products:
- PROD123-MD (discontinued_status: "Active")
- PROD123-SD (discontinued_status: "Discontinued (RM)")
- PROD123-DP (discontinued_status: "Temporarily OOS")

Normalization:
- Base SKU: PROD123
- variant_statuses: ["Active", "Discontinued (RM)", "Temporarily OOS"]

Filtering for ['Active', 'Temporarily OOS']:
- Match found: "Active" present in variant_statuses → Product included
- Match found: "Temporarily OOS" present in variant_statuses → Product included

Result:
- Label generated for: PROD123 (base only)
- Shows combined data from all variants
```

**Important:** No base product (PROD123) needs to exist in Magento. The system always uses base SKU form regardless of which variants are present.

---

## Filtering Logic

### 1. Variant Status Filter (Primary)
**Applied:** After variant normalization, during SQL filtering on `variant_statuses` array

**Terminology Reminder:**
- `discontinued_status` = raw value per variant in Magento
- `variant_statuses` = aggregated array in `inventory_metadata` containing all unique `discontinued_status` values

**Logic:**
```sql
-- Query inventory_metadata for SKUs where ANY status in variant_statuses array matches
SELECT sku FROM inventory_metadata 
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(variant_statuses) AS s 
    WHERE s = ANY(allowed_statuses)
)
```

**Default Behavior:**
- **API Default:** `['Active', 'Temporarily OOS', 'Pre Order', 'Samples']` (4 statuses)
- **UI Default:** ALL 8 status checkboxes checked (UI sends all checked statuses)
- **Result:** Shows products matching selected status filters
- **Empty Selection:** No checkboxes → shows no products
- **No Persistence:** Filters reset to default (all checked) on every page load

**Purpose:** Include products where ANY variant has a checked status

**Examples:**
- PROD123-MD: "Active", PROD123-SD: "Discontinued (RM)"
  - Filter ["Active"] checked → ✅ Included (MD variant is Active)
  - Filter ["Discontinued (RM)"] checked → ✅ Included (SD variant is Discontinued)
  - Filter ["Temporarily OOS"] only → ❌ Excluded (no variant matches)
  - ALL filters checked → ✅ Included (has at least one matching status)

**Customizable:** UI checkboxes control which statuses are included

### 2. AW365 Products Filter
**Applied:** During product fetching from Magento

**Logic:**
```sql
WHERE cpev_name.value NOT LIKE '%AW365%'
```

**Purpose:** Exclude AW365 product category from labels

**Note:** Same as Inventory Management filtering

### 3. Product Selection in UI
**Applied:** When user manually selects products

**Logic:**
- User can select/deselect individual products in UI
- If no products selected: generates labels for all displayed products
- If products selected: generates labels only for selected products
- Selection works within current filter context

**Purpose:** Allow targeted label generation for specific products or batches

---

## Label Generation Workflow

### UI-Driven Product Selection

**Step 1: Filter Products (Status Checkboxes)**
- **Default:** ALL 8 status checkboxes checked
  - ✅ Active
  - ✅ Temporarily OOS
  - ✅ Pre Order
  - ✅ Samples
  - ✅ Special Offer
  - ✅ Discontinued (Supplier)
  - ✅ Discontinued (RM)
  - ✅ Special Item
- **No Saved Preferences:** Checkboxes always reset to all checked on page load
- **Result:** By default, displays ALL products (any variant with any status)
- **Empty Selection:** Uncheck all → displays no products

**Step 2: Search Filter (Optional)**
- Search box filters within displayed products
- Searches SKU, product name, item ID, price, and 6M data
- Works in combination with status filters
- Search does NOT trigger API call - filters client-side
- Examples:
  - All statuses checked (default) + Search "P001" → Shows all P001 products
  - Only "Active" checked + Search "P001" → Shows P001 products where variant has Active status
  - No statuses checked + Search "P001" → Shows nothing (no products displayed)

**Step 3: Select Products**
- Products are **NOT auto-selected** (prevents UI lag)
- User can manually select specific products
- Checkbox to select all displayed products

**Step 4: Generate Labels (Button Click)**
- **No products selected** → Generates labels for ALL displayed products
- **Some products selected** → Generates labels ONLY for selected products
- API call: `GET /labels/to-print?discontinued_statuses=Active,Pre Order&region=uk&show_orphaned=false`

**Step 5: View Generated Labels**
- Labels saved to history automatically
- Three viewing options:
  - **PDF** - Opens PDF file with labels
  - **CSV** - Downloads CSV file with label data
  - **View** - Preview in browser

**Process Behind the Scenes:**
1. Refresh inventory_metadata from Magento (sync products)
2. Merge all variants to base SKUs
3. Update variant_statuses from live Magento data
4. Fetch products from inventory_metadata filtered by `variant_statuses`
5. Load supporting data (item IDs, 6M data, prices, names)
6. Filter out orphaned products (unless show_orphaned=true)
7. Generate label file in requested format
8. Save to label_print_jobs table

---

## Orphaned Products Filter

**Parameter:** `show_orphaned` (boolean, default: `false`)

**Purpose:** Control visibility of SKUs that exist in `inventory_metadata` but have no matching product name in Magento catalog or order history.

**Behavior:**
- `show_orphaned=false` (default): Skips orphaned SKUs from label generation
- `show_orphaned=true`: Includes orphaned SKUs (will have empty product name)

**Detection Logic:**
1. Try to find product name in Live Magento catalog (preferred region)
2. Fall back to orders_cache tables (historical order data)
3. Fall back to UK Magento catalog (if preferred region was not UK)
4. If still no name found after all fallbacks → marked as orphaned and skipped

---

## Region Preference

Labels support **region preference** for pricing and product names:

### UK Preference (Default)
- Prices from UK Magento catalog in GBP (£), converted to excl. VAT
- Product names from UK Magento catalog (fallback: orders_cache)
- Falls back to other regions if UK data unavailable

### FR Preference
- Prices from FR Magento catalog in EUR (€), already excl. VAT
- Product names from FR Magento catalog (fallback: orders_cache, then UK catalog)
- Falls back to UK if regional data unavailable

### NL Preference
- Prices from NL Magento catalog in EUR (€), converted to excl. VAT
- Product names from NL Magento catalog (fallback: orders_cache, then UK catalog)
- Falls back to UK if regional data unavailable

**Use Case:** Generate labels appropriate for specific warehouses or markets

---

## Data Consistency with Inventory Management

Labels Generation and Inventory Management use **identical logic** for:

| Aspect | Shared Logic |
|--------|--------------|
| Product Source | `inventory_metadata` table (synced from UK Magento) |
| Filtering | `variant_statuses` JSONB array (ANY match logic) |
| Status Source | Each variant's `discontinued_status` → aggregated into `variant_statuses` |
| AW365 Exclusion | Excluded during Magento sync |
| SKU Merging | ALL variants (MD, SD, DP, NP, MV) merge to base SKU |
| 6M Data | Same aggregated_orders tables |
| Item IDs | Same inventory_metadata table |

**Why This Matters:**
- Ensures label data matches inventory data
- Prevents discrepancies between systems
- Single source of truth for product information
- Consistent variant normalization across all modules

---

## Label Output Fields

Each label contains:

| Field | Source | Description |
|-------|--------|-------------|
| `item_id` | inventory_metadata | 18-digit barcode |
| `sku` | inventory_metadata | Product SKU (always base form) |
| `product_name` | Magento catalog / orders_cache | Product name with region preference |
| `uk_6m_data` | uk_aggregated_orders | UK 6-month sales quantity |
| `fr_6m_data` | fr_aggregated_orders + nl_aggregated_orders | FR+NL combined 6-month sales quantity |
| `price` | Selected region Magento catalog | Live price excl. VAT (special_price > price > N/A) |
| `variant_statuses` | inventory_metadata (internal) | Aggregated array of all `discontinued_status` values from variants (filtering only) |

**Example Label Data:**
```json
{
  "item_id": "772578000000491823",
  "sku": "PROD123",
  "product_name": "Premium Face Serum 30ml",
  "uk_6m_data": "450",
  "fr_6m_data": "320",
  "price": "£24.99",
  "variant_statuses": ["Active", "Temporarily OOS"]
}
```

**Note:** `variant_statuses` is used internally for filtering but may not appear in the actual label output (PDF/CSV).

---

## Dependencies

### Required for Label Generation:

1. **Inventory Metadata Must Be Synced**
   - Populates `inventory_metadata` with item IDs and SKUs
   - Without item IDs, labels cannot generate barcodes
   - Note: Labels API auto-syncs on every request via `sync_magento_products_to_inventory_metadata()`

2. **Aggregated Data Must Be Refreshed**
   - Populates `uk/fr/nl_aggregated_orders` tables
   - Without 6M data, labels show 0 for sales quantities
   - Run: Magento Data → Refresh Aggregated Data (or auto-syncs on frontend load)

3. **Orders Cache Must Be Populated** (for fallback names)
   - Provides product names when not found in live Magento catalog
   - Without orders data, some labels may be skipped as orphaned
   - Run: Magento Data → Sync Orders

### Data Freshness:

- **Product Catalog:** Real-time (queries live Magento directly)
- **Item IDs:** Auto-synced on every labels API request
- **6M Data:** Updated when aggregated data refreshes
- **Prices:** Real-time (queries live Magento catalog)
- **Names:** Real-time from Magento catalog, fallback from orders cache

---

## Technical Implementation

### Database Connections

Labels module requires connections to:

1. **UK/FR/NL Magento MySQL Databases** (read-only)
   - Host: From magento database config (region-specific)
   - Purpose: Fetch product catalog with EAV attributes, live prices, and localized names
   - Tables: `catalog_product_entity`, `catalog_product_entity_decimal`, `catalog_product_entity_varchar`, `eav_attribute`, etc.

2. **Products PostgreSQL Database** (read-only)
   - Purpose: Fetch aggregated sales data and product names from order history
   - Tables: `uk/fr/nl_aggregated_orders`, `uk/fr/nl_orders_cache`

3. **Inventory PostgreSQL Database** (read-write)
   - Purpose: Fetch item IDs and product list; store label print jobs
   - Tables: `inventory_metadata`, `label_print_jobs`, `label_print_items`, `label_printing_presets`

### Performance Considerations

- **Batch Queries:** Loads all SKUs first, then batch fetches data
- **Region Tables:** Queries each region table separately to avoid timeouts
- **Caching:** Results can be cached temporarily during label generation
- **Index Usage:** Relies on indexes on SKU columns for fast lookups

### Missing Data Scenarios:

1. **SKU has no item_id**
   - Logs warning
   - Skips that SKU from labels
   - Solution: Run inventory sync

2. **SKU has no 6M data**
   - Defaults to "0" for both UK and FR
   - Label still generates
   - Indicates product has no recent sales

3. **SKU has no price**
   - Defaults to "N/A"
   - Label still generates
   - Indicates product not found in Magento catalog

4. **SKU has no product name (orphaned)**
   - By default, SKU is skipped (not included in labels)
   - Use `show_orphaned=true` to include orphaned SKUs with empty name
   - Orphaned = exists in inventory_metadata but not in Magento catalog or order history

### Validation:

- Invalid SKUs are filtered out during processing
- Only SKUs with item_ids in inventory_metadata proceed to label generation
- Orphaned SKUs (no product name found) are skipped unless `show_orphaned=true`

---

## Label Printing Presets

Presets allow saving filter configurations for quick reuse.

### Preset Data Structure
```json
{
  "id": 1,
  "name": "Active Products UK",
  "description": "All active products with UK pricing",
  "status_filters": ["Active", "Temporarily OOS"],
  "region": "uk",
  "product_skus": [],
  "created_by": "user@example.com",
  "created_at": "2026-01-11T10:00:00Z",
  "updated_at": "2026-01-11T10:00:00Z"
}
```

### Preset Fields
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Preset display name |
| `description` | string | Optional description |
| `status_filters` | array | List of statuses to filter by (matches against `variant_statuses` array) |
| `region` | string | Price/name region preference (uk/fr/nl) |
| `product_skus` | array | Specific SKUs to include (empty = all) |
| `created_by` | string | User who created the preset |

### API Endpoints
- `GET /labels/presets` - List all presets
- `GET /labels/presets/{id}` - Get preset by ID
- `POST /labels/presets` - Create new preset
- `PUT /labels/presets/{id}` - Update preset
- `DELETE /labels/presets/{id}` - Delete preset

### Key Points
- Presets are **global** (available to all users)
- Presets store filter configuration, not product data
- Using a preset applies its filters to the current view

---

## Comparison: Labels vs Inventory Management

| Feature | Labels | Inventory Management |
|---------|--------|---------------------|
| Product Source | inventory_metadata (synced from UK Magento) | inventory_metadata (synced from UK Magento) |
| Filtering | `variant_statuses` array (ANY match) | `variant_statuses` array (ANY match) |
| Variant Normalization | ALL variants → base SKU | ALL variants → base SKU |
| Status Source | `discontinued_status` from Magento → `variant_statuses` | `discontinued_status` from Magento → `variant_statuses` |
| Status Update | Calls `update_variant_statuses()` before generation | Reads existing `variant_statuses` (does NOT auto-refresh) |
| 6M Data Source | aggregated_orders tables | aggregated_orders tables |
| Item IDs | inventory_metadata | inventory_metadata |
| Prices | Region-specific Magento catalog (excl. VAT) | Not shown |
| Output | PDF/CSV label file | Web table UI |
| Product Selection | UI checkboxes + manual selection | UI table with inline editing |
| Region Preference | Yes (names: localized, prices: region-specific) | No (always UK) |
| Presets | Yes (saveable filter configs) | No |
| Orphaned Filter | Yes (`show_orphaned` param) | Yes (`show_orphaned` param) |

**Key Differences:** 
- Labels adds pricing and regional preferences
- Labels uses **identical** variant normalization, status tracking, and filtering logic as Inventory Management
- Labels allows exporting to PDF/CSV files, while Inventory Management provides inline table editing
- Labels supports saveable presets for filter configurations

## Future Enhancements

1. **Batch Label Generation**
   - Generate labels in batches to handle large catalogs
   - Progress tracking for long-running generations

2. **Label Templates**
   - Multiple label format templates
   - Custom field selection per template

3. **Automatic Refresh Triggers**
   - Auto-refresh aggregated data before label generation
   - Ensure data is always current

4. **Product Image Integration**
   - Fetch product images from Magento
   - Include on labels when needed

5. **Multi-Language Support**
   - Product names in multiple languages
   - Language selection per region preference

---

## Code References

### Key Files
- **Repository:** `backend/modules/labels/repo.py`
- **API:** `backend/modules/labels/api.py`
- **PDF Generator:** `backend/modules/labels/print_pdf.py`
- **CSV Generator:** `backend/modules/labels/print_csv.py`
- **Jobs:** `backend/modules/labels/jobs.py`
- **Frontend:** `frontend/js/modules/labels/index.js`

### Key Functions
- `get_labels_to_print_psycopg()` - Main label data loader
- `_resolve_to_rows()` - Combines all data sources into label rows
- `_load_6m_data_from_aggregated_tables()` - Loads UK/FR 6M sales data
- `_load_inventory_item_ids()` - Loads barcodes from inventory_metadata
- `_load_latest_prices_from_magento_catalog()` - Loads prices from live Magento catalog
- `_load_product_names_psycopg()` - Loads names from orders cache
- `_load_product_names_from_magento()` - Fallback name loader from catalog
- `stream_pdf_labels()` - Generates PDF label file
- `stream_csv_labels()` - Generates CSV label file

---

*Last Updated: January 23, 2026*
