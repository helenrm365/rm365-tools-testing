# Magento 6M Data Logic Documentation

## Overview
The "6M Data" (6-month data) represents aggregated sales data from Magento orders over the last 6 calendar months. This data is used across multiple modules including Magento Data pages, Inventory Management, and Labels generation.

---

## Time Range

### Calculation Method
- **Exactly 6 calendar months** using `relativedelta(months=6)`
- Accounts for actual days in each month (28/29/30/31 days)
- No artificial buffer or extra days added
- Typically ranges from **~180-184 days** depending on which months are included

### Examples
- **December 31, 2025** → goes back to **June 30, 2025** (184 days)
- **July 15, 2025** → goes back to **January 15, 2025** (~181 days)
- **March 1, 2025** → goes back to **September 1, 2024** (~182 days)

Each month keeps its natural number of days - there's no fixed day count.

---

## Data Sources

Data is pulled from region-specific order cache tables and aggregated into summary tables:

| Region | Source Table | Aggregated Table | Currency |
|--------|-------------|------------------|----------|
| UK | `uk_orders_cache` | `uk_aggregated_orders` | GBP |
| FR | `fr_orders_cache` | `fr_aggregated_orders` | EUR |
| NL | `nl_orders_cache` | `nl_aggregated_orders` | EUR |

---

## SKU Merging Rules

### 1. Manual Merging (Highest Priority)
**SKU Aliases Table:** `sku_aliases`
- Maps `alias_sku` → `unified_sku`
- Applied **first** (takes priority over automatic rules)
- Allows custom grouping of any SKUs
- Manually configured through the Magento Data interface

**Example:**
```
OLD-SKU-123 → NEWSKU123
ALT-PROD → ALTPROD
```
Both `OLD-SKU-123` and `ALT-PROD` will show as `PROD123` in aggregated data if both have a unified SKU of `PROD123`.

### 2. Automatic MD Variant Merging
**-MD and -MD-xxxx suffixes are ALWAYS merged automatically:**

| Original SKU | Becomes | Merged With Base? |
|-------------|---------|-------------------|
| `PROD123-MD` | `PROD123` | ✅ Yes (unconditional) |
| `PROD123-MD-1225` | `PROD123` | ✅ Yes (unconditional) |
| `ITEM-MD-XYZ-789` | `ITEM` | ✅ Yes (unconditional) |

**Important:** This happens via SQL regex pattern matching, regardless of whether the base SKU exists:
- If you only have `PROD123-MD` in orders (no `PROD123`), it still shows as `PROD123` in 6M data
- The `-MD` suffix and everything after it is stripped

**Implementation:**
```sql
REGEXP_REPLACE(s.sku, '-MD(-.*)?$', '', 'i')
```

### 3. Other Variants (NOT Merged)
These suffixes remain **SEPARATE** in Magento 6M data:

| Suffix Pattern | Meaning | Merged? |
|---------------|---------|---------|
| `-SD`, `-SD-xxxx` | Short Date | ❌ No |
| `-DP`, `-DP-xxxx` | Damaged Packaging | ❌ No |
| `-NP`, `-NP-xxxx` | No Packaging | ❌ No |
| `-MV`, `-MV-xxxx` | Missing Vials | ❌ No |
| Any other suffix | Various | ❌ No |

**Example:**
- `PROD123-SD-1234` remains as `PROD123-SD-1234` (not merged)
- `PROD123-DP` remains as `PROD123-DP` (not merged)

**Note:** Inventory Management and Labels Generation use the **same logic** - only MD variants merge, all other variants stay separate.

---

## Filtering & Exclusions

The 6M aggregation applies multiple filters to focus on relevant orders:

### 1. Customer Exclusions
**Table:** `aggregated_excluded_customers`

**Purpose:** Filter out specific customer email addresses
- Configured per region (UK/FR/NL)
- Example use cases:
  - Remove test accounts
  - Exclude staff purchases
  - Remove problematic/fraudulent customers
  - Remove potential wholesale customers

**Columns:**
- `region` - UK/FR/NL
- `customer_email` - Email to exclude
- `customer_full_name` - Name for reference
- `added_by` - Who added the exclusion

### 2. Customer Group Exclusions
**Table:** `aggregated_excluded_customer_groups`

**Purpose:** Filter out entire customer groups
- Configured per region
- Use cases:
  - Exclude wholesale customers
  - Remove trade/B2B accounts
  - Filter specific customer segments

**Columns:**
- `region` - UK/FR/NL
- `customer_group` - Group code to exclude
- `added_by` - Who added the exclusion

### 3. Grand Total Threshold
**Table:** `aggregated_grand_total_threshold`

**Purpose:** Exclude orders with grand totals above a certain amount
- Configured per region
- **Currency conversion applied automatically**:
  - UK orders: Converted to GBP
  - FR/NL orders: Converted to EUR
- Use cases:
  - Filter out bulk wholesale orders
  - Remove large B2B purchases
  - Focus on retail-sized orders

**Example:**
- UK threshold: £500
- FR threshold: €600
- Orders above these amounts are excluded from aggregation

**Columns:**
- `region` - UK/FR/NL
- `threshold` - Maximum grand total allowed
- `updated_by` - Who set the threshold

### 4. Quantity Threshold
**Table:** `aggregated_grand_total_threshold` (same table)

**Purpose:** Exclude individual product line items with high quantities
- Filters at the line-item level (not order level)
- Use cases:
  - Remove bulk quantity orders
  - Filter out wholesale line items
  - Focus on standard retail quantities

**Example:**
- Quantity threshold: 50
- Any line item with qty > 50 is excluded

**Columns:**
- `qty_threshold` - Maximum quantity per line item

---

## Aggregation Process

### Step-by-Step Flow

```
1. FETCH
   ↓ Get all orders from last 6 months from region table
   
2. SKU MAPPING
   ↓ Apply in order:
   ├─→ Check sku_aliases table (if exists, use unified_sku)
   ├─→ Check for -MD pattern (if matches, strip suffix)
   └─→ Otherwise, use SKU as-is
   
3. FILTERING
   ↓ Exclude orders where:
   ├─→ customer_email is in excluded list
   ├─→ customer_group is in excluded list
   ├─→ grand_total > threshold (with currency conversion)
   └─→ qty > qty_threshold (line item level)
   
4. AGGREGATION
   ↓ Group by final SKU and sum:
   ├─→ sku (merged/unified)
   ├─→ name (product name, latest wins)
   └─→ total_qty (sum of all quantities)
   
5. STORE
   ↓ Save to aggregated table:
   └─→ {region}_aggregated_orders
```

### SQL Logic (Simplified)

```sql
SELECT 
    COALESCE(
        sa.unified_sku,                                    -- Use alias if exists (priority 1)
        CASE 
            WHEN s.sku ~* '-MD(-|$)'                      -- Check for -MD pattern
            THEN REGEXP_REPLACE(s.sku, '-MD(-.*)?$', '', 'i')  -- Strip -MD suffix
            ELSE s.sku                                     -- Use as-is
        END
    ) as sku,
    s.name, 
    s.qty, 
    s.grand_total, 
    s.currency, 
    s.customer_email, 
    s.customer_group_code, 
    s.created_at
FROM {region}_orders_cache s
LEFT JOIN sku_aliases sa ON s.sku = sa.alias_sku
WHERE 
    -- 6 months date filter
    created_at >= CURRENT_DATE - INTERVAL '6 months'
    -- Exclusions applied in Python after fetch
```

### Aggregated Table Schema

Each `{region}_aggregated_orders` table contains:

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `sku` | VARCHAR | Unified/merged SKU |
| `name` | VARCHAR | Product name (latest) |
| `total_qty` | INTEGER | Sum of quantities sold |
| `last_updated` | TIMESTAMP | Last aggregation refresh |

---

## Where 6M Data Is Used

### 1. Magento Data Pages (Frontend)
**Locations:**
- `/magentodata/uk-magento` (UK aggregated view)
- `/magentodata/fr-magento` (FR aggregated view)
- `/magentodata/nl-magento` (NL aggregated view)

**Features:**
- Shows combined quantities by unified SKU
- Auto-refreshes before displaying
- Searchable and paginated
- Shows last 6 months of sales volume per product

### 2. Inventory Management
**Location:** `/inventory/management`

**Usage:**
- Populates `uk_6m_data` column (from UK aggregated data)
- Populates `fr_6m_data` column (from FR + NL combined aggregated data)
- Shows recent sales volume alongside inventory levels
- Helps identify fast-moving vs slow-moving products

**Special behavior:**
- FR and NL data are **combined** into single `fr_6m_data` column
- This is done via `merge_fr_nl_data()` function

### 3. Labels Module
**Location:** `/labels`

**Usage:**
- Uses 6M data to determine product popularity
- Prioritizes products with higher sales volume
- Helps decide which products to include in label batches
- Filters products based on recent sales activity

---

## Refresh Behavior

### Automatic Refresh
- Triggered **before** retrieving aggregated data for display
- Ensures data is always up-to-date when viewing
- Happens on every page load of aggregated views

### Manual Refresh
- Available via API endpoint: `POST /magentodata/{region}/refresh-aggregated`
- Useful for testing or forcing immediate updates
- Can refresh all regions at once: `POST /magentodata/refresh-all-aggregated`

### Refresh Process
1. Clear existing aggregated table
2. Fetch all orders from last 6 months
3. Apply filters and mappings
4. Re-aggregate by SKU
5. Store updated results

---

## Configuration Management

### Through Web Interface
Most 6M data settings can be configured through the Magento Data pages:

1. **SKU Aliases:** Manage through alias management interface
2. **Customer Exclusions:** Add/remove excluded customers
3. **Group Exclusions:** Add/remove excluded customer groups
4. **Thresholds:** Set grand total and quantity thresholds

### Database Tables Summary

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sku_aliases` | Manual SKU merging | `alias_sku`, `unified_sku` |
| `aggregated_excluded_customers` | Customer filter | `region`, `customer_email` |
| `aggregated_excluded_customer_groups` | Group filter | `region`, `customer_group` |
| `aggregated_grand_total_threshold` | Order value/qty filter | `region`, `threshold`, `qty_threshold` |
| `uk_aggregated_orders` | UK aggregated results | `sku`, `name`, `total_qty` |
| `fr_aggregated_orders` | FR aggregated results | `sku`, `name`, `total_qty` |
| `nl_aggregated_orders` | NL aggregated results | `sku`, `name`, `total_qty` |

---

## Important Notes

### MD Variant Auto-Alias
- The system attempts to auto-create SKU aliases for MD variants
- This runs after each sync operation
- Only creates aliases when **both** MD variant and base SKU exist
- However, SQL regex handles MD stripping regardless, so aliases are redundant but kept for consistency

### Currency Conversion
- Grand total threshold filtering requires currency conversion
- UK orders converted to GBP for comparison
- FR/NL orders converted to EUR for comparison
- Uses exchange rates from `common/currency.py`

### FR + NL Combination
- In Inventory Management, FR and NL 6M data are **combined**
- This is NOT done in the Magento Data aggregation itself
- Each region maintains separate aggregated tables
- Combination happens at the service layer when populating inventory

### Variant Behavior Differences
- **Magento Data:** Only MD variants merge
- **Inventory Management:** SD, DP, NP, MV, MD all merge
- This is intentional - different business logic for different purposes

---

## Code References

### Key Files
- **Aggregation Logic:** `backend/modules/magentodata/repo.py` (lines 1348-1550)
- **Service Layer:** `backend/modules/magentodata/service.py` (lines 493-598)
- **MD Auto-Alias:** `backend/modules/magentodata/repo.py` (lines 1959-2060)
- **Currency Conversion:** `backend/common/currency.py`

### Key Functions
- `refresh_aggregated_data(region)` - Regenerates 6M aggregation
- `get_aggregated_data(region, limit, offset, search)` - Retrieves aggregated results
- `auto_create_md_variant_aliases()` - Creates MD variant aliases automatically
- `get_aggregated_data_custom_range()` - Custom date range aggregation

---

## Troubleshooting

### 6M Data Seems Outdated
**Solution:** Trigger a manual refresh for the region

### SKUs Not Merging as Expected
**Check:**
1. Is it an MD variant? (only MD merges automatically)
2. Is there a SKU alias defined?
3. Is the SKU pattern exactly matching?

### Missing Products in 6M Data
**Check:**
1. Are they older than 6 months?
2. Is the customer excluded?
3. Is the customer group excluded?
4. Does the order exceed grand total threshold?
5. Does the line item exceed quantity threshold?

### MD Variants Still Showing Separately
**This shouldn't happen** - MD variants are stripped unconditionally in SQL. Check:
1. The SKU pattern (must be `-MD` or `-MD-xxxx`)
2. Case sensitivity (should be case-insensitive)
3. Database query logs for the actual SQL being executed

---

*Last Updated: December 31, 2025*
