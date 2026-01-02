# Labels Generation Logic Documentation

## Overview
The Labels Generation system creates product labels with barcodes, prices, and sales data. It uses the **exact same data architecture as Inventory Management** for consistency. Instead of querying Magento directly, it leverages the `inventory_metadata` table as the single source of truth, ensuring that product lists, variant merging, and status filtering are identical across both systems.

**Key Principle:** Labels and Inventory Management share identical product sourcing, variant normalization, status filtering, and 6M data logic to ensure consistency across the system.

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
4.  **Filter:** System queries `inventory_metadata` filtering by the `status` column.

**Data Fetched:**
- `sku` - Base SKU from inventory_metadata
- `status` - Discontinued status synced from Magento:
  - `Active` - Currently available
  - `Temporarily OOS` - Out of stock temporarily
  - `Pre Order` - Available for pre-order
  - `Samples` - Sample products
  - `Discontinued (Supplier)` - Discontinued by supplier
  - `Discontinued (RM)` - Discontinued by RM
  - `Special Offer` - On special offer
  - `Special Item` - Special items

**Default Filter:** `['Active', 'Temporarily OOS', 'Pre Order', 'Samples']`

**Variant Status Logic:**
- Handled during the **Merge** step in Inventory Management logic.
- If a base SKU exists, variants are merged into it.
- If only variants exist, one is renamed to the base SKU.
- The status is preserved during sync/merge.

**Key Points:**
- **Single Source of Truth:** Uses `inventory_metadata` just like Inventory Management.
- **Identical Logic:** By calling the exact same sync and merge functions, we guarantee 1:1 consistency.
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

### 4. Prices: Magento Orders Cache
**Source:** PostgreSQL `{region}_orders_cache` tables

**Purpose:** Get most recent product pricing with currency

**Data Fetched:**
- Latest `special_price` or `original_price` for each SKU
- Currency (GBP for UK, EUR for FR/NL)
- Formatted with symbol: `£24.99` or `€29.99`

**Region Priority:**
- User can select preferred region (uk/fr/nl)
- System checks preferred region first, then falls back to others
- Ensures most relevant pricing is shown

### 5. Product Names: Magento Orders Cache
**Source:** PostgreSQL `{region}_orders_cache` tables

**Purpose:** Get product display names

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
   ├─→ PROD123-MD: "Active" → variant_statuses: ["Active"]
   ├─→ PROD123-SD: "Discontinued (RM)" → variant_statuses: ["Active", "Discontinued (RM)"]
   └─→ Store in variant_statuses JSONB array
   
4. FILTER BY VARIANT STATUS
   ↓ Apply discontinued_status filter to variant_statuses array
   ├─→ Default: ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
   ├─→ Keep product if ANY variant status matches filter
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
   ↓ Query orders_cache with region preference
   └─→ Latest price with currency symbol
   
8. LOAD PRODUCT NAMES
   ↓ Query orders_cache with region preference
   └─→ Latest product name
   
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
**Applied:** After variant normalization, during Python filtering

**Logic:**
```python
# Collect all discontinued_status values from all variants
variant_statuses = [variant['discontinued_status'] for variant in variants]

# Filter: Keep if ANY variant status matches filter criteria
matches = any(status in allowed_statuses for status in variant_statuses)

# Default allowed_statuses: ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
```

**Purpose:** Include products where ANY variant has an appropriate status for label generation

**Examples:**
- PROD123-MD: "Active", PROD123-SD: "Discontinued (RM)"
  - Filter for ["Active"] → ✅ Included (MD variant is Active)
  - Filter for ["Discontinued (RM)"] → ✅ Included (SD variant is Discontinued)
  - Filter for ["Temporarily OOS"] → ❌ Excluded (no variant matches)

**Customizable:** API accepts comma-separated list of statuses to override defaults

### 2. AW365 Products Filter
**Applied:** During product fetching from Magento

**Logic:**
```sql
WHERE cpev_name.value NOT LIKE '%AW365%'
```

**Purpose:** Exclude AW365 product category from labels

**Note:** Same as Inventory Management filtering

### 3. CSV Upload Validation (Optional)
**Applied:** When generating labels from CSV upload

**Logic:**
- User uploads CSV with SKU list
- System validates each SKU against UK Magento catalog
- Only includes SKUs with valid discontinued_status
- Same filtering rules apply

**Purpose:** Allow targeted label generation for specific products while maintaining data integrity

---

## Two Generation Modes

### Mode 1: Database-Driven (Full Catalog)
**Use Case:** Generate labels for all active products

**Process:**
1. Fetch all SKUs from UK Magento with status filter
2. Apply MD merging
3. Load all supporting data (item IDs, 6M, prices, names)
4. Generate labels

**Advantages:**
- Complete product list
- Always up-to-date with catalog
- No manual SKU management

### Mode 2: CSV-Driven (Selective)
**Use Case:** Generate labels for specific products only

**Process:**
1. User uploads CSV with SKU list
2. Validate SKUs against UK Magento (same filters)
3. Apply MD merging
4. Load supporting data for validated SKUs only
5. Generate labels

**Advantages:**
- Targeted label generation
- Useful for specific shipments or stock takes
- Validated against catalog to prevent invalid SKUs

---

## Region Preference

Labels support **region preference** for pricing and product names:

### UK Preference (Default)
- Prices in GBP (£)
- Product names from UK orders_cache
- Falls back to FR/NL if UK data unavailable

### FR/NL Preference
- Prices in EUR (€)
- Product names from FR/NL orders_cache
- Falls back to UK if regional data unavailable

**Use Case:** Generate labels appropriate for specific warehouses or markets

---

## Data Consistency with Inventory Management

Labels Generation and Inventory Management use **identical logic** for:

| Aspect | Shared Logic |
|--------|--------------|
| Product Source | UK Magento `catalog_product_entity` |
| Filtering | Custom `discontinued_status` attribute |
| AW365 Exclusion | Product name contains "AW365" |
| SKU Merging | Only MD variants merge |
| 6M Data | Same aggregated_orders tables |
| Item IDs | Same inventory_metadata table |

**Why This Matters:**
- Ensures label data matches inventory data
- Prevents discrepancies between systems
- Single source of truth for product information
- Consistent MD merging across all modules

---

## Label Output Fields

Each label contains:

| Field | Source | Description |
|-------|--------|-------------|
| `item_id` | inventory_metadata | 18-digit barcode |
| `sku` | UK Magento catalog | Product SKU (always base form) |
| `product_name` | orders_cache | Latest product name |
| `uk_6m_data` | uk_aggregated_orders | UK 6-month sales quantity |
| `fr_6m_data` | fr + nl aggregated | FR+NL 6-month sales quantity |
| `price` | orders_cache | Latest price with currency |
| `variant_statuses` | UK Magento (internal) | Array of all variant statuses (used for filtering) |

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

1. **Inventory Sync Must Run First**
   - Populates `inventory_metadata` with item IDs
   - Without item IDs, labels cannot generate barcodes
   - Run: Inventory Management → Sync from Magento

2. **Aggregated Data Must Be Refreshed**
   - Populates `uk/fr/nl_aggregated_orders` tables
   - Without 6M data, labels show 0 for sales quantities
   - Run: Magento Data → Refresh Aggregated Data

3. **Orders Cache Must Be Populated**
   - Provides prices and product names
   - Without orders data, labels may show missing prices/names
   - Run: Magento Data → Sync Orders

### Data Freshness:

- **Product Catalog:** Real-time (queries Magento directly)
- **Item IDs:** Updated when inventory sync runs
- **6M Data:** Updated when aggregated data refreshes (after magento sync)
- **Prices/Names:** Updated when orders cache syncs

---

## Technical Implementation

### Database Connections

Labels module requires connections to:

1. **UK Magento MySQL Database** (read-only)
   - Host: From magento database config
   - Purpose: Fetch product catalog with EAV attributes
   - Tables: `catalog_product_entity`, `eav_attribute`, etc.

2. **Products PostgreSQL Database** (read-only)
   - Purpose: Fetch aggregated data, prices, names
   - Tables: `uk/fr/nl_aggregated_orders`, `uk/fr/nl_orders_cache`

3. **Inventory PostgreSQL Database** (read-only)
   - Purpose: Fetch item IDs
   - Table: `inventory_metadata`

### Performance Considerations

- **Batch Queries:** Loads all SKUs first, then batch fetches data
- **Region Tables:** Queries each region table separately to avoid timeouts
- **Caching:** Results can be cached temporarily during label generation
- **Index Usage:** Relies on indexes on SKU columns for fast lookups

---

## Error Handling

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
   - Defaults to "£0.00" or "€0.00"
   - Label still generates
   - Indicates product hasn't been ordered recently

4. **SKU has no product name**
   - Falls back to using SKU as name
   - Label still generates
   - Rare scenario (usually has name from catalog)

### Validation:

- CSV uploads validate all SKUs against Magento catalog
- Invalid SKUs are filtered out with warning
- Only valid, active-status SKUs proceed to label generation

---

## Comparison: Labels vs Inventory Management

| Feature | Labels | Inventory Management |
|---------|--------|---------------------|
| Product Source | UK Magento catalog_product_entity | UK Magento catalog_product_entity |
| Filtering | variant_statuses (ANY match) | variant_statuses (ANY match) |
| Variant Normalization | ALL variants → base SKU | ALL variants → base SKU |
| Status Tracking | variant_statuses JSONB array | variant_statuses JSONB array |
| 6M Data Source | aggregated_orders tables | aggregated_orders tables |
| Item IDs | From inventory_metadata | From inventory_metadata |
| Prices | From orders_cache (region pref) | Not shown |
| Output | PDF/CSV label file | Web table UI |
| CSV Upload | Yes (selective generation) | No |
| Region Preference | Yes (price/name) | No (always UK) |

**Key Difference:** Labels adds pricing and regional preferences, but uses **100% identical** variant normalization, status tracking, and filtering logic as Inventory Management.

---

## Future Enhancements

Potential improvements while maintaining current architecture:

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
