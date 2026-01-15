# Product Sourcing System

A supplier-aware pricing and margin management system that normalises multiple supplier SKUs into a single internal product view, tracks buy prices, compares suppliers in real time, and links pricing data to sales, stock, and margin reporting.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Database Structure](#database-structure)
4. [Backend API](#backend-api)
5. [Frontend Interface](#frontend-interface)
6. [Data Flow](#data-flow)
7. [Key Features](#key-features)
8. [File Structure](#file-structure)
9. [Design System Compliance](#design-system-compliance)
10. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

The Product Sourcing system solves a common inventory challenge: **managing products that can be purchased from multiple suppliers at different prices**. 

Key problems it addresses:
- Tracking which supplier offers the best price for each product
- Mapping supplier-specific SKUs to internal product codes
- Monitoring price changes over time
- Calculating margins based on current buy prices vs sell prices
- Importing bulk pricing data from supplier CSV files

### Location in Application

The Product Sourcing module lives under the **Inventory** section and can be accessed via:
- Navigation path: `Inventory → Product Sourcing`
- URL: `/inventory/sourcing`

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Browser)                       │
├─────────────────────────────────────────────────────────────────┤
│  sourcing.html        │  sourcing.js         │  sourcing.css    │
│  (Page Structure)     │  (Logic & API calls) │  (Styling)       │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP API Calls
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (FastAPI Server)                    │
├─────────────────────────────────────────────────────────────────┤
│  api.py               │  service.py          │  repo.py         │
│  (HTTP Endpoints)     │  (Business Logic)    │  (Database)      │
└────────────────────────────────┬────────────────────────────────┘
                                 │ SQL Queries
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                           │
│  (inventory_log database - same as inventory management)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Structure

The system uses **4 main tables** that are automatically created when the page first loads:

### 1. `sourcing_suppliers`
Stores information about each supplier you purchase from.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Unique identifier (auto-increment) |
| `name` | VARCHAR(255) | Supplier company name (required) |
| `code` | VARCHAR(50) | Short code (e.g., "SUP001") |
| `contact_email` | VARCHAR(255) | Email for orders/enquiries |
| `contact_phone` | VARCHAR(50) | Phone number |
| `website` | VARCHAR(255) | Supplier website URL |
| `notes` | TEXT | Additional information |
| `is_active` | BOOLEAN | Whether supplier is currently used (default: true) |
| `created_at` | TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | When record was last updated |

### 2. `sourcing_supplier_products`
Maps supplier-specific products to your internal SKUs.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Unique identifier |
| `supplier_id` | INTEGER | Links to `sourcing_suppliers` (foreign key) |
| `supplier_sku` | VARCHAR(100) | The supplier's product code (required) |
| `supplier_product_name` | VARCHAR(500) | Name the supplier uses (required) |
| `internal_sku` | VARCHAR(100) | Your internal SKU (links to inventory) |
| `pack_size` | INTEGER | Units per purchase (default: 1) |
| `notes` | TEXT | Additional information |
| `is_active` | BOOLEAN | Whether this mapping is current (default: true) |
| `created_at` | TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | When record was last updated |

**Unique Constraint:** Each supplier can only have one entry per `supplier_sku`.

### 3. `sourcing_prices`
Historical record of all buy prices with temporal status management.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Unique identifier |
| `supplier_product_id` | INTEGER | Links to `sourcing_supplier_products` (foreign key) |
| `buy_price` | DECIMAL(12,4) | The purchase price (4 decimal places for precision) |
| `currency` | VARCHAR(3) | Currency code, e.g., "GBP" (default: GBP) |
| `effective_date` | DATE | When this price becomes/became valid (required) |
| `status` | VARCHAR(20) | Only stores 'cancelled' - other statuses computed dynamically |
| `notes` | TEXT | Reason for price change, etc. |
| `created_by` | VARCHAR(255) | Username who added this price |
| `created_at` | TIMESTAMP | When record was created |
| `import_batch_id` | INTEGER | Links to import batch if from CSV import |

#### Price Status System

Prices have a **computed status** based on their `effective_date` and `status` column:

| Status | Condition | Description |
|--------|-----------|-------------|
| **pending** | `effective_date > today` | Future price, not yet active |
| **active** | Most recent `effective_date <= today` (not cancelled) | Currently in effect |
| **superseded** | `effective_date <= today` but not most recent | Replaced by newer price |
| **cancelled** | `status = 'cancelled'` in DB | Explicitly cancelled (not used) |

**Why hybrid storage?**
- Only `cancelled` is stored explicitly because it's a deliberate action
- `pending`, `active`, and `superseded` are calculated dynamically from dates
- This prevents data inconsistencies (e.g., forgetting to update status when dates pass)

**Active Price Selection:**
When multiple prices exist for a supplier product, the **active price** is determined by:
1. `effective_date <= CURRENT_DATE` (must not be pending)
2. `status IS NULL OR status != 'cancelled'` (not cancelled)
3. `ORDER BY effective_date DESC, created_at DESC` (most recent wins)

The `created_at` tiebreaker handles edge cases where two prices have the same effective_date.

### 4. `sourcing_import_batches`
Tracks CSV import operations for audit purposes.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Unique identifier |
| `supplier_id` | INTEGER | Which supplier's data was imported |
| `import_source` | VARCHAR(50) | "csv" or "manual" |
| `filename` | VARCHAR(500) | Original CSV filename |
| `notes` | TEXT | Import notes |
| `status` | VARCHAR(50) | "pending", "completed", or "failed" |
| `total_rows` | INTEGER | Total rows in the import |
| `processed_rows` | INTEGER | Successfully processed rows |
| `error_rows` | INTEGER | Rows with errors |
| `created_by` | VARCHAR(255) | Username who performed import |
| `created_at` | TIMESTAMP | When import started |
| `completed_at` | TIMESTAMP | When import finished |

### Database Indexes

For performance, these indexes are created automatically:
- `idx_sourcing_supplier_products_supplier_id` - Fast supplier filtering
- `idx_sourcing_supplier_products_internal_sku` - Fast internal SKU lookups
- `idx_sourcing_prices_supplier_product_id` - Fast price lookups
- `idx_sourcing_prices_effective_date` - Fast date-based queries (descending)

---

## Backend API

All API endpoints are prefixed with `/api/v1/inventory/sourcing/`

### Health & Initialization

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Checks system status and auto-creates tables if needed |
| `/init-tables` | POST | Explicitly initialize/verify sourcing tables (requires auth) |

### Suppliers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/suppliers` | GET | List all suppliers (optional: `?include_inactive=true`) |
| `/suppliers` | POST | Add a new supplier |
| `/suppliers/{id}` | GET | Get single supplier by ID |
| `/suppliers/{id}` | PATCH | Update a supplier |

### Product Mappings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/products` | GET | List supplier product mappings (optional filters: `?supplier_id=`, `?internal_sku=`, `?include_inactive=true`) |
| `/products` | POST | Add a new product mapping |
| `/products/{id}` | PATCH | Update a mapping |

### Prices

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/prices` | GET | Get price history (optional: `?supplier_product_id=`, `?internal_sku=`, `?limit=100`) |
| `/prices` | POST | Add a new price entry (manual) |
| `/prices/history` | GET | Get full price history with computed status |
| `/prices/pending` | GET | Get pending (future) prices (optional: `?supplier_product_id=`, `?supplier_id=`) |
| `/prices/active/{supplier_product_id}` | GET | Get the currently active price for a supplier product |
| `/prices/{id}` | GET | Get single price with computed status |
| `/prices/{id}` | PUT | Update a pending price (only pending prices can be modified) |
| `/prices/{id}/cancel` | POST | Cancel a pending price (only pending prices can be cancelled) |

### Comparison & Analysis

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/comparison` | GET | Get side-by-side supplier price comparison (optional: `?internal_sku=`) |
| `/comparison-with-inventory` | GET | Get comparison WITH Magento inventory metadata (name, stock, cost) |
| `/available-skus` | GET | Get available SKUs from inventory_metadata for mapping (optional: `?search=`, `?limit=100`) |
| `/currency/rates` | GET | Get current exchange rates for multi-currency support (GBP base, 1-hour cache) |

### Import

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/import/csv` | POST | Upload and process a CSV price file (multipart form: `file`, `supplier_id`) |
| `/import/manual` | POST | Create a manual import batch for tracking |

### CSV Import Format

**Required columns:**
- `supplier_sku` - The supplier's product code
- `buy_price` - The purchase price
- `currency` - Currency code (e.g., GBP, EUR, USD)
- `internal_sku` - Your internal SKU (maps to inventory)

**Optional columns:**
- `product_name` - Supplier's name for the product
- `effective_date` - Date price is valid from (defaults to today)

---

## Frontend Interface

### Page Layout

The sourcing page has these main sections:
1. **Page Header** - Title and description
2. **Navigation Tabs** - Switch between Inventory Management and Product Sourcing
3. **Quick Stats Row** - 4 stat cards showing key metrics
4. **Sub-Navigation Tabs** - 7 tabs for different functions
5. **Tab Panels** - Content area for each tab

### Quick Stats Cards

| Stat | Description | Element ID |
|------|-------------|------------|
| Active Suppliers | Count of suppliers with `is_active=true` | `#totalSuppliers` |
| Product Mappings | Count of supplier product records | `#totalMappings` |
| Unmapped Products | Internal products without supplier mappings | `#unmappedProducts` |
| Avg Margin | Average margin across all products | `#avgMargin` |

### Sub-Tabs

The page has **7 sub-tabs** for different functions:

#### 1. Dashboard
Overview and summary view (default landing tab).

#### 2. Supplier Comparison
Shows a table comparing all products with:
- Internal SKU and product name
- Current stock level
- Sell price
- **Cheapest supplier** (highlighted with gold badge)
- Buy price from cheapest supplier
- Calculated margin percentage
- Link to view all other suppliers

#### 3. Suppliers
Manage your supplier list:
- View all suppliers in a table (name, code, email, phone, product count, status)
- **"Add Supplier" button** opens modal form
- Edit existing suppliers
- Toggle active/inactive status

#### 4. Product Mappings
Link supplier products to internal SKUs:
- Table showing: Supplier, Supplier SKU, Supplier Product Name, Internal SKU, Pack Size, Current Price, Status
- **Supplier filter dropdown** to show one supplier's products
- **"Add Mapping" button** opens modal form
- Edit/deactivate mappings

#### 5. Price History
Track all price changes over time:
- Table showing: Date, Supplier, Supplier SKU, Product Name, Buy Price, Currency, Source, Notes
- Search functionality
- **"Add Price" button** opens modal form for manual entries
- Filter by product or supplier

#### 6. Import
Bulk data import options:

**CSV Import Card:**
- Supplier dropdown selector
- Drag-and-drop file upload zone (or click to browse)
- **"Start Import" button** (enabled when supplier + file selected)
- Shows required/optional column info
- **"Download Template CSV" button** - Downloads a template file with correct headers and sample data

**Manual Entry Card:**
- **"Open Manual Entry Form" button** opens comprehensive modal
- For quick individual price entries

**API Integration Card:**
- Coming soon - locked
- Future: Connect to supplier APIs for automatic updates

#### 7. Margin Reports
Analysis and reporting:
- Report type dropdown: Low Margin, Top Margin, Biggest Drops, Trends
- **"Export" button** for downloading reports
- (Feature partially implemented - shows placeholder)

### Modals

The page includes **9 modal dialogs**:

#### Add Supplier Modal (`#addSupplierModal`)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Supplier Name | text | ✓ | Company name |
| Supplier Code | text | | Short reference code |
| Contact Email | email | | Primary email |
| Contact Phone | tel | | Phone number |
| Currency | text | | Default currency (pre-filled: GBP) |
| Notes | textarea | | Additional info |
| Active Supplier | checkbox | | Checked by default |

#### Add Mapping Modal (`#addMappingModal`)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Supplier | dropdown | ✓ | Select from existing suppliers |
| Supplier SKU | text | ✓ | Supplier's product code |
| Internal SKU | text | | Your internal SKU |
| Supplier Product Name | text | | Name from supplier |
| Buy Price | number | | Current price |
| Currency | text | | Currency (pre-filled: GBP) |
| Notes | textarea | | Additional info |
| Active Mapping | checkbox | | Checked by default |

#### Add Price Modal (`#addPriceModal`)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Supplier Product | dropdown | ✓ | Select existing product mapping |
| Buy Price | number | ✓ | The purchase price |
| Currency | text | | Currency (pre-filled: GBP) |
| Effective Date | date | | When price applies (defaults to today) |
| Notes | textarea | | Reason for price change |

#### Manual Entry Modal (`#manualEntryModal`)
All-in-one form that creates both product mapping and price:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Supplier | dropdown | ✓ | Select supplier |
| Supplier SKU | text | ✓ | Supplier's product code |
| Internal SKU | text | | Your internal SKU |
| Product Name | text | | Product description |
| Buy Price | number | ✓ | Purchase price |
| Currency | text | | Currency (pre-filled: GBP) |
| Effective Date | date | | When price applies |
| Notes | textarea | | Additional info |

#### Duplicate Mapping Warning Modal (`#duplicateMappingWarning`)
Warning dialog shown when attempting to create a duplicate supplier SKU mapping:
- **Warning Message:** Explains the duplicate detected
- **Existing Mapping Details:** Shows current mapping information
- **Actions:**
  - "Quit Mapping" - Cancel and return to form
  - "Change SKU" - Go back to edit the SKU
  - "Continue Anyway" - Create duplicate mapping despite warning

#### All Suppliers Modal (`#allSuppliersModal`)
Shows all supplier options for a specific product with comparison data:
- **Product Details:** SKU, product name, sell price, current stock
- **Suppliers Table:** Lists all suppliers with their pricing and details
- Columns: Supplier, Supplier SKU, Buy Price, Pack Size, Price/Unit (GBP), Status
- **Sorting:** Cheapest suppliers shown first (marked with gold crown badge), then sorted by price
- **Visual Indicators:** Cheapest badge, currency symbols, pack size information
- Accessed via "View All" or "+X more" buttons in Supplier Comparison table

#### Import Data Errors Modal (`#importDataErrorsModal`)
Displayed when CSV validation detects blocking errors:
- **Error Summary:** Count of total errors found
- **Error List:** Each row number with specific error message
- **Common Issues Help:** Tips for fixing common problems
  - Missing required fields
  - Invalid price format (currency symbols, commas)
  - Invalid currency codes
  - Invalid date format (must be YYYY-MM-DD)
  - Duplicate supplier SKUs within CSV
- **Action:** "Back to Import" button to return and fix CSV

#### Import Conflict Modal (`#importConflictModal`)
Sequential modal workflow for resolving import conflicts:
- **Progress Bar:** Shows "Conflict X of Y" with visual progress
- **Conflict Message:** Description of the conflict detected
- **Row Info:** Row number and supplier SKU being processed
- **Side-by-Side Comparison:**
  - **Current Data:** Existing mapping and price information
  - **New Data:** Values from CSV row (changes highlighted)
- **Pending Change Warning:** Shown if future price already scheduled
- **Actions:**
  - "Amend CSV" - Exit workflow, cancel import
  - "Skip" - Skip this row, continue to next conflict
  - "Update Anyway" - Apply changes despite conflict

**Conflict Types:**
| Type | Description | Resolution |
|------|-------------|------------|
| `existing_mapping` | Supplier SKU already exists | User confirms update or skip |
| `pending_change` | Future price already scheduled | User confirms overwrite or skip |
| `duplicate_exact` | Identical to existing record | Auto-skipped |
| `data_error` | Invalid data (blocks import) | Must fix CSV |

#### Import Summary Modal (`#importSummaryModal`)
Displayed after successful import completion:
- **Stats Display:** Total rows, Processed, Skipped, Errors
- **Error Details:** List of any errors that occurred during processing
- **Action:** "Done" button closes modal

---

## Data Flow

### Adding a New Supplier

```
1. User clicks "Add Supplier" button
2. Modal form opens (form is reset to defaults)
3. User fills in supplier details
4. Clicks "Save Supplier"
5. JavaScript validates form
6. POST request → /api/v1/inventory/sourcing/suppliers
7. Backend validates with Pydantic schema
8. Inserts into sourcing_suppliers table
9. Returns created supplier object
10. Frontend shows success toast
11. Modal closes
12. Supplier list refreshes
13. Supplier dropdowns across page update
```

### Importing CSV Prices

```
1. User navigates to Import tab
2. Selects supplier from dropdown
3. Drags CSV file onto upload zone (or clicks to browse)
4. File name appears in upload zone
5. "Start Import" button becomes enabled
6. User clicks "Start Import"
7. POST (multipart/form-data) → /api/v1/inventory/sourcing/import/validate
8. Backend Validation:
   a. Validates file is CSV
   b. Reads and parses content (handles UTF-8 BOM)
   c. Validates required columns exist (supplier_sku, buy_price, currency, internal_sku)
   d. For each row, validates:
      - Required fields are not empty
      - buy_price is a valid positive number (no currency symbols/commas)
      - currency is one of 12 supported codes
      - effective_date (if provided) is YYYY-MM-DD format
      - No duplicate supplier_sku within CSV
   e. Detects conflicts with existing data:
      - Existing mapping conflicts (SKU already mapped)
      - Pending change conflicts (future price scheduled)
      - Exact duplicates (auto-skipped)
   f. Returns: { valid, conflicts, clean_rows, can_proceed }
9. If data errors exist → Show Data Errors Modal (import blocked)
10. If resolvable conflicts exist → Show Conflict Modal for each
11. User resolves each conflict (Skip / Update Anyway / Amend CSV)
12. POST → /api/v1/inventory/sourcing/import/execute with resolutions
13. Backend:
   a. Creates import batch record (status: pending)
   b. For each row (respecting resolutions):
      - Finds existing supplier product OR creates new one
      - Adds price record with:
        - Link to import_batch_id
        - effective_date (from CSV or defaults to today)
        - currency (from CSV or defaults to GBP)
   c. Updates batch with success/failure counts
   d. Sets batch status to completed
14. Returns: { batch info, rows processed, rows skipped, rows failed, errors }
15. Frontend shows Import Summary Modal
16. Price history and comparison tables refresh
```

#### CSV Validation Rules

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `supplier_sku` | string | ✓ | Must not be empty, unique within CSV |
| `buy_price` | decimal | ✓ | Positive number, no currency symbols or commas |
| `currency` | string | ✓ | One of: GBP, EUR, USD, CAD, AUD, JPY, CHF, CNY, SEK, NOK, DKK, PLN |
| `internal_sku` | string | ✓ | Must not be empty |
| `product_name` | string | | Optional, defaults to supplier_sku |
| `effective_date` | date | | Optional, YYYY-MM-DD format, defaults to today |

**Common Errors:**
- `1,000.00` → Invalid (comma as thousands separator)
- `$25.00` → Invalid (currency symbol included)
- `15/01/2026` → Invalid date format (use 2026-01-15)
- Negative prices → Invalid
- Duplicate supplier_sku → Error (each SKU once per CSV)

### Viewing Supplier Comparison

```
1. User navigates to Comparison tab
2. GET request → /api/v1/inventory/sourcing/comparison
3. Backend:
   a. Fetches all internal products (would need integration with main inventory)
   b. For each internal SKU, finds all supplier product mappings
   c. For each mapping, gets the latest price (by effective_date DESC)
   d. Calculates margin: ((sell_price - buy_price) / sell_price) × 100
   e. Identifies cheapest supplier per product
   f. Builds comparison object with all data
4. Returns: { products: [...comparison data...] }
5. Frontend renders comparison table
6. User can search/filter by SKU or product name
7. User can click "View All" to see all supplier options for a product
```

---

## Key Features

### Auto-Table Creation
Database tables are automatically created on first page load via the `/health` endpoint. The system checks if tables exist and creates them only if needed. This happens once per application session.

### Multi-Currency Support with Live Exchange Rates
The system includes comprehensive multi-currency functionality:

**Features:**
- **12 Supported Currencies:** GBP, EUR, USD, CAD, AUD, JPY, CHF, CNY, SEK, NOK, DKK, PLN
- **Live Exchange Rates:** Fetched from open.er-api.com API (GBP base)
- **1-Hour Caching:** Exchange rates cached to minimize API calls
- **Automatic Conversion:** All non-GBP prices converted to GBP for comparison
- **Dual Display:** Shows original price with currency symbol + GBP equivalent

**Implementation:**
```javascript
// Exchange rates stored in module state
let exchangeRates = null;

// Fetched on page load
await loadExchangeRates(); // GET /v1/inventory/sourcing/currency/rates

// Conversion function
function convertToGBP(amount, fromCurrency) {
  if (!exchangeRates || !exchangeRates[fromCurrency]) return null;
  return amount / exchangeRates[fromCurrency];
}
```

**Display Examples:**
- Supplier Comparison: `€62.00` with `≈ £53.45` below
- Product Mappings: `€62.00` with `≈ £53.45` below
- Price History: `€62.00` with EUR in currency column

**Custom Currency Dropdowns:**
All currency selection uses styled custom dropdowns with:
- Currency icons (£, €, $, ¥, etc.)
- Currency code and symbol text
- Proper selection state
- Hidden input for form submission

**Backend Support:**
- `GET /currency/rates` endpoint returns live exchange rates
- `common/currency.py` module handles conversion logic
- Decimal precision handling for accurate calculations

### Price History Tracking
Every price change is permanently recorded with:
- Timestamp (created_at)
- Effective date (when price applies)
- Source indicator (via import_batch_id - null for manual, set for CSV imports)
- Optional notes
- Username who created the entry
- **Currency code** with proper symbol display

**Smart Change Detection:**
The system prevents unnecessary price history entries through intelligent change detection:

**Mapping vs Price Changes:**
- Tracks mapping fields separately from price fields
- Only updates mapping if supplier, SKU, name, pack size, notes, or status changed
- Only creates new price entry if price amount or currency changed

**Numeric Comparison:**
- Compares prices as numbers, not strings
- `62.0000` (database) = `62` (form input) → No change detected
- Prevents duplicate price entries with same value but different decimal places

**User Feedback:**
```javascript
if (!hasMappingChanges && !hasPriceChanges) {
  // Show confirmation dialog
  confirm('No changes detected. Would you like to continue editing?');
} else {
  // Save with appropriate messages:
  // "Mapping and price updated successfully"
  // "Mapping updated successfully"  
  // "Price updated successfully"
}
```

**Benefits:**
- Cleaner price history without duplicates
- Accurate audit trail
- Better performance (fewer database writes)
- Clear user feedback on what actually changed

### Margin Calculation
Margins are calculated as:
```
Margin % = ((Sell Price - Buy Price) / Sell Price) × 100
```

Visual margin indicators (in comparison table):
- 🟢 **High** (≥30%): Green - `.margin-high`
- 🔵 **Medium** (15-30%): Blue - `.margin-medium`
- 🟡 **Low** (5-15%): Orange - `.margin-low`
- 🔴 **Critical** (<5%): Red - `.margin-critical`

### Status Badges

**Supplier/Mapping Status:**
- 🟢 `Active` - Green badge
- ⚫ `Inactive` - Gray badge

**Cheapest Supplier:**
- ⭐ Gold badge with star icon showing the best-priced supplier

**Price Source:**
- 🔵 `CSV` - Blue badge (imported from file)
- 🟣 `Manual` - Purple badge (manually entered)

### Custom Dropdowns
All dropdowns use custom components (not native `<select>` elements) for consistent styling. They include:
- Click to open/close
- Click outside to dismiss
- Proper keyboard accessibility
- Visual feedback on selection

---

## File Structure

### Backend Files

```
backend/modules/inventory/sourcing/
├── __init__.py          # Module exports (router, ensure_tables_exist)
├── api.py               # FastAPI route definitions (356 lines)
│                        # - Health endpoints
│                        # - Supplier CRUD
│                        # - Product mapping CRUD
│                        # - Price endpoints
│                        # - Comparison endpoint
│                        # - Currency rates endpoint
│                        # - Import endpoints
├── service.py           # Business logic layer (381 lines)
│                        # - Data transformation
│                        # - Complex operations (CSV processing)
│                        # - Comparison with inventory
│                        # - Calls repo methods
├── repo.py              # Database operations (839 lines)
│                        # - ensure_tables_exist() - auto-creates tables
│                        # - _create_tables() - SQL DDL
│                        # - SourcingRepo class with all CRUD methods
└── schemas.py           # Pydantic models (145 lines)
                         # - SupplierBase/Create/Update/Out
                         # - SupplierProductBase/Create/Update/Out
                         # - SupplierPriceBase/Create/Out
                         # - PriceImportCreate/Out
```

### Frontend Files

```
frontend/
├── html/inventory/
│   └── sourcing.html           # Page structure (986 lines)
│                               # - Header and navigation
│                               # - Stats cards
│                               # - Sub-tabs navigation
│                               # - 7 tab panels with tables/forms
│                               # - 6 modal dialogs
├── js/modules/inventory/
│   └── sourcing.js             # Page logic (2045 lines)
│                               # - init() - entry point
│                               # - cacheElements() - DOM references
│                               # - setupEventListeners() - all handlers
│                               # - loadInitialData() - fetches data on load
│                               # - API functions (loadSuppliers, etc.)
│                               # - Render functions (renderSuppliers, etc.)
│                               # - Modal functions (open, close, submit)
│                               # - Dropdown handlers
│                               # - CSV upload handlers
│                               # - Public API on window.sourcingModule
└── css-new/pages/inventory/
    └── sourcing.css            # Page-specific styling (828 lines)
                                # - Stats cards
                                # - Sub-tabs
                                # - Tab panels
                                # - Tables
                                # - Status badges
                                # - Import cards
                                # - File upload zone
                                # - Loading/empty states
                                # - Modal form overrides
                                # - Responsive breakpoints
```

### Related Files (Modified During Setup)

```
backend/
├── app.py                           # Added: sourcing router registration
│                                    # from modules.inventory.sourcing import router as sourcing_router
│                                    # app.include_router(sourcing_router, prefix="/api/v1/inventory/sourcing")
└── modules/inventory/__init__.py    # Added: sourcing module export

frontend/
├── index.html                       # Added: CSS link to sourcing.css
├── html/home.html                   # Contains Inventory card (Product Sourcing accessed via tabs)
├── js/
│   ├── router.js                    # Added: /inventory/sourcing route definitions (8 routes)
│   └── modules/inventory/index.js   # Added: sourcing route handler
```

---

## Design System Compliance

The Product Sourcing page follows the **css-new** design system:

### Colors
- Uses `--accent` (green: `#8bc34a`) consistently for branding
- NOT `--primary` which changes between modes (blue/yellow)
- Semantic colors: `--success`, `--warning`, `--error`, `--info` for status

### Buttons
- **Primary actions** (Add, Save, Import): `.action-btn .primary-btn` - Green gradient
- **Secondary actions** (Cancel, Refresh, Export): `.action-btn .secondary-btn` - Gray gradient
- Proper icon + text structure with `<span>` wrapping

### Modals
- `.modal-overlay` - Backdrop with blur
- `.modal-content` - Container (sizes: default, `.modal-lg`)
- `.modal-header` with `.modal-header-icon` + `.modal-title`
- `.modal-body` - Scrollable content
- `.modal-footer` - Action buttons

### Dropdowns
- `.custom-dropdown` container
- `.dropdown-selected` - Current value display
- `.dropdown-options` - Options list
- `.dropdown-option` - Individual options
- Hidden `<input>` for form values

### Tables
- `.table-container` - Overflow wrapper
- `.data-table` - Full-width table
- Proper hover states
- Responsive on mobile

### Forms
- `.form-group` containers
- `.form-label` with `.required` modifier for required fields
- `.form-input` for text/number/date inputs
- `.form-row` for side-by-side fields
- `.checkbox-label` for checkboxes

All styling adapts to both **light mode** and **dark mode** automatically via CSS variables.

---

## Future Enhancements

Planned features include:
- [ ] API integration for automatic supplier price syncing
- [x] Currency conversion for multi-currency suppliers (COMPLETED - live exchange rates with 12 currencies)
- [ ] Margin alert notifications (email/in-app when margins drop)
- [ ] Supplier performance scoring
- [ ] Purchase order generation from sourcing data
- [ ] Price negotiation tracking
- [ ] Bulk internal SKU mapping tool
- [ ] Price trend charts and visualizations
- [ ] Export comparison data to CSV/Excel
- [ ] Supplier payment terms tracking
