# Labels Generation Logic Documentation

## Overview
The Labels Generation system creates product labels with barcodes, prices, and sales data. It uses the **same data architecture as Inventory Management** for consistency - fetching products directly from UK Magento database, filtering by custom product_status attribute, and using aggregated sales tables for 6M data.

**Key Principle:** Labels and Inventory Management share identical product sourcing, filtering, and 6M data logic to ensure consistency across the system.

---

## Data Sources

### 1. Product Catalog: UK Magento Database
**Source:** Direct connection to UK Magento `catalog_product_entity` table

**Purpose:** Get list of products to generate labels for

**Data Fetched:**
- `sku` - Product SKU from catalog
- `product_status` - Custom attribute for filtering:
  - `Active` - Currently available
  - `Temporarily OOS` - Out of stock temporarily
  - `Pre Order` - Available for pre-order
  - `Samples` - Sample products
  - `Discontinued (Supplier)` - Discontinued by supplier
  - `Discontinued (RM)` - Discontinued by RM
  - `Special Offer` - On special offer
  - `Special Item` - Special items

**Default Filter:** `['Active', 'Temporarily OOS', 'Pre Order', 'Samples']`

**Key Points:**
- Uses EAV (Entity-Attribute-Value) structure to query custom attributes
- Excludes products with "AW365" in name
- Does NOT use Magento's enabled/disabled system status
- Identical to Inventory Management product fetching

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
   ↓ Query catalog_product_entity with product_status filter
   ├─→ Default: Active, Temporarily OOS, Pre Order, Samples
   ├─→ Exclude AW365 products
   └─→ Returns list of SKUs
   
2. GROUP BY BASE SKU
   ↓ Group variants by base (e.g., PROD123, PROD123-MD)
   └─→ Prepare for MD merging
   
3. CHOOSE SKU FOR EACH BASE
   ↓ Select base or -MD variant per group
   └─→ MD variants merge into base (matching 6M logic)
   
4. LOAD ITEM IDs
   ↓ Query inventory_metadata for barcodes
   └─→ sku → item_id mapping
   
5. LOAD 6M DATA
   ↓ Query aggregated_orders tables
   ├─→ UK: uk_aggregated_orders
   ├─→ FR: fr_aggregated_orders + nl_aggregated_orders
   └─→ sku → (uk_6m, fr_6m) mapping
   
6. LOAD PRICES
   ↓ Query orders_cache with region preference
   └─→ Latest price with currency symbol
   
7. LOAD PRODUCT NAMES
   ↓ Query orders_cache with region preference
   └─→ Latest product name
   
8. BUILD LABEL DATA
   ↓ Combine all data for each product
   └─→ {item_id, sku, name, uk_6m, fr_6m, price}
   
9. GENERATE LABEL FILE
   └─→ Output in selected format (PDF/CSV)
```

---

## SKU Variant Merging

### Same Logic as 6M Data & Inventory Management

**Only MD variants merge:**

| Suffix Pattern | Meaning | Merged? |
|---------------|---------|---------|
| `-MD`, `-MD-xxxx` | Material Difference | ✅ Yes |
| `-SD`, `-SD-xxxx` | Slightly Damaged | ❌ No (stays separate) |
| `-DP`, `-DP-xxxx` | Display | ❌ No (stays separate) |
| `-NP`, `-NP-xxxx` | New Packaging | ❌ No (stays separate) |
| `-MV`, `-MV-xxxx` | Multi-Variant | ❌ No (stays separate) |

**Merging Process:**
1. Group SKUs by base (strip `-MD` suffix)
2. If base exists: use base SKU
3. If base doesn't exist: use `-MD` variant as base
4. Other variants (SD, DP, NP, MV) stay separate

**Example:**
- Products: `PROD123`, `PROD123-MD`, `PROD123-SD`
- Labels generated for: `PROD123` (base), `PROD123-SD` (separate)
- `PROD123-MD` merges into `PROD123`

---

## Filtering Logic

### 1. Product Status Filter
**Applied:** When fetching products from UK Magento

**Logic:**
```sql
WHERE COALESCE(product_status, 'Active') IN ('Active', 'Temporarily OOS', 'Pre Order', 'Samples')
```

**Purpose:** Only include products with appropriate statuses for label generation

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
- Only includes SKUs with valid product_status
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
| Filtering | Custom `product_status` attribute |
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
| `sku` | UK Magento catalog | Product SKU (base or -MD) |
| `product_name` | orders_cache | Latest product name |
| `uk_6m_data` | uk_aggregated_orders | UK 6-month sales quantity |
| `fr_6m_data` | fr + nl aggregated | FR+NL 6-month sales quantity |
| `price` | orders_cache | Latest price with currency |

**Example Label Data:**
```json
{
  "item_id": "772578000000491823",
  "sku": "PROD123",
  "product_name": "Premium Face Serum 30ml",
  "uk_6m_data": "450",
  "fr_6m_data": "320",
  "price": "£24.99"
}
```

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
| Filtering | product_status attribute | product_status attribute |
| MD Merging | Only MD merges | Only MD merges |
| 6M Data Source | aggregated_orders tables | aggregated_orders tables |
| Item IDs | From inventory_metadata | From inventory_metadata |
| Prices | From orders_cache (region pref) | Not shown |
| Output | PDF/CSV label file | Web table UI |
| CSV Upload | Yes (selective generation) | No |
| Region Preference | Yes (price/name) | No (always UK) |

**Key Difference:** Labels adds pricing and regional preferences, but uses identical underlying data architecture.

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
