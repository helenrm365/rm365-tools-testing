# Advanced Inventory Sourcing System

## Command Center Architecture

The Inventory Sourcing module implements a sophisticated multi-supplier price comparison and margin analysis system, inspired by a Google Sheets workflow but built as a full-featured web application. This document explains the architecture, features, and usage of the system.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [The Four Pillars](#the-four-pillars)
3. [FX Rates Engine](#fx-rates-engine)
4. [Supplier Management](#supplier-management)
5. [Supplier Matrix](#supplier-matrix)
6. [Analysis Dashboard](#analysis-dashboard)
7. [CSV Export/Import](#csv-exportimport)
8. [API Reference](#api-reference)
9. [Database Schema](#database-schema)
10. [Workflow Guide](#workflow-guide)
11. [Configuration](#configuration)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PRODUCT SOURCING COMMAND CENTER                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  FX RATES    │    │  SUPPLIERS   │    │   MATRIX     │              │
│  │  (Currency   │───▶│  (Vendor     │───▶│  (Pricing    │              │
│  │   Engine)    │    │   Master)    │    │   Data)      │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│         │                   │                   │                       │
│         ▼                   ▼                   ▼                       │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │                    ANALYSIS DASHBOARD                         │      │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │      │
│  │  │ Normalized   │  │ Best Price   │  │ Margin       │        │      │
│  │  │ Prices (GBP) │  │ Calculation  │  │ Analysis     │        │      │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Modularity**: Each component (FX, Suppliers, Matrix, Analysis) operates independently
2. **Real-time Calculations**: Prices are normalized on-the-fly using current FX rates
3. **Data Integrity**: Changes propagate automatically through the system
4. **Auditability**: All pricing changes are timestamped and tracked
5. **Magento Integration**: Products sourced from `inventory_metadata` table (same as Label Generator)

---

## The Four Pillars

The system is built on four interconnected data structures, mirroring the four-sheet Google Sheets architecture:

### Pillar 1: DB_Magento (Product Feed)

This pillar represents your product catalog synced from Magento via the Inventory Management module.

**Data Source**: `inventory_metadata` table (same source as Label Generator)

**Fields**:
- SKU
- Product Name
- UK 6M Data (sales data)
- FR 6M Data (sales data)
- Variant Statuses
- Brand (extracted from SKU prefix, e.g., "ABC123" → "ABC")

**Magento Price Logic**:
Prices are fetched from Magento's live catalog using this priority:
1. `special_price` (if set) → **USE THIS**
2. `price` (if no special_price) → **USE THIS**
3. **N/A** (if neither available)

This is the same pricing logic used by the Label Generator.

### Pillar 2: FX_Rates (Currency Engine)

Centralizes all currency conversion logic.

**Features**:
- Live exchange rates from external API (`open.er-api.com`)
- Manual rate overrides for negotiated rates
- GBP as base currency
- Automatic fallback to cached/hardcoded rates

**Benefits**:
- Single point of currency management
- Reduces API calls (rates cached for 1 hour)
- Supports 14+ currencies out of the box

### Pillar 3: Supplier_Matrix (Manual Input)

The spreadsheet-like interface for entering supplier prices.

**Features**:
- Dynamic columns per supplier
- Multi-currency support per entry
- MOQ (Minimum Order Quantity) tracking
- Shipping cost fields
- Preferred supplier flagging

### Pillar 4: Analysis_Dashboard (The Brain)

Aggregates all data to answer: "Who should I order from?"

**Calculations**:
- Normalized prices (all converted to GBP)
- Best price per SKU
- Winning supplier identification
- Margin percentage vs. Magento price
- Margin health classification

---

## FX Rates Engine

### How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  External API   │────▶│  Rate Cache     │────▶│  Combined Rates │
│  (open.er-api)  │     │  (1 hour TTL)   │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
┌─────────────────┐                                      │
│  Manual         │─────────────────────────────────────▶│
│  Overrides DB   │     (Overrides take precedence)      │
└─────────────────┘                                      ▼
                                                ┌─────────────────┐
                                                │  Final Rates    │
                                                │  for Calcs      │
                                                └─────────────────┘
```

### Supported Currencies

| Code | Currency | Default Rate (approx) |
|------|----------|----------------------|
| GBP  | British Pound | 1.0000 (base) |
| USD  | US Dollar | 1.27 |
| EUR  | Euro | 1.16 |
| CNY  | Chinese Yuan | 9.15 |
| JPY  | Japanese Yen | 189.0 |
| CAD  | Canadian Dollar | 1.75 |
| AUD  | Australian Dollar | 1.93 |
| CHF  | Swiss Franc | 1.12 |
| SEK  | Swedish Krona | 13.5 |
| NOK  | Norwegian Krone | 13.8 |
| DKK  | Danish Krone | 8.65 |
| PLN  | Polish Zloty | 5.0 |
| CZK  | Czech Koruna | 29.2 |
| HUF  | Hungarian Forint | 460.0 |

### Manual Overrides

Use manual overrides when:
- You have a negotiated FX rate with your bank
- You want to lock in a rate for budgeting
- The live API is unavailable

**Setting an Override**:
```javascript
POST /api/v1/inventory/sourcing/fx-rates/override
{
  "currency_code": "USD",
  "rate": 1.25,
  "notes": "Bank negotiated rate Q1 2026"
}
```

---

## Supplier Management

### Supplier Data Model

Each supplier record contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | Integer | Auto-generated primary key |
| `name` | String | Full supplier name |
| `code` | String | Short code (e.g., "SUPP1", "ACME") |
| `default_currency` | String | Default pricing currency |
| `contact_email` | String | Primary contact email |
| `contact_phone` | String | Phone number |
| `website` | URL | Supplier website |
| `notes` | Text | General notes |
| `is_active` | Boolean | Whether supplier is active |
| `lead_time_days` | Integer | Average lead time |
| `min_order_value` | Decimal | Minimum order requirement |
| `payment_terms` | String | e.g., "Net 30" |

### Adding a Supplier

1. Navigate to **Sourcing > Suppliers**
2. Click **Add Supplier**
3. Enter required fields (Name, Code)
4. Set default currency
5. Add contact information
6. Save

### Supplier Codes

Supplier codes are used throughout the system as shorthand identifiers. Best practices:
- Use 2-5 uppercase letters
- Make them memorable (e.g., "ACME", "CHINAD", "EUROSP")
- Codes must be unique
- Once created, avoid changing codes

---

## Supplier Matrix

### The Spreadsheet Experience

The Supplier Matrix provides a spreadsheet-like interface for managing pricing:

```
┌──────────┬──────────────┬──────────────┬──────────────┐
│   SKU    │   ACME       │   EUROSP     │   CHINAD     │
├──────────┼──────────────┼──────────────┼──────────────┤
│ PROD001  │ £12.50 ★     │ £14.20       │ £13.80       │
│ PROD002  │ £8.00        │ £7.50 ★      │ £9.00        │
│ PROD003  │ —            │ £22.00 ★     │ £24.50       │
│ PROD004  │ £5.25 ★      │ —            │ £5.50        │
└──────────┴──────────────┴──────────────┴──────────────┘
★ = Best Price (automatically highlighted)
```

### Editing Prices

**Inline Editing**:
1. Click any cell to edit
2. Enter the price (number only)
3. Click outside or press Tab to move
4. Changes are highlighted in yellow until saved
5. Click **Save Changes** to persist

**Quick Edit Modal**:
1. Click the edit icon on any SKU row
2. Modal shows all suppliers with their pricing
3. Edit price, currency and MOQ
4. Save all at once

### Multi-Currency Support

Each pricing entry can have its own currency:

```
SKU: WIDGET-001
├── ACME:    $15.00 USD → £11.81 GBP (normalized)
├── EUROSP:  €14.00 EUR → £12.07 GBP (normalized)
└── CHINAD:  ¥85.00 CNY → £9.29 GBP (normalized) ★ BEST
```

### Bulk Operations

**CSV Export**:
- Exports ALL products from `inventory_metadata` (same source as Label Generator)
- Includes `product_name` column for reference
- Products without pricing have empty supplier columns
- Format: `sku, product_name, SUPPLIER1_price, SUPPLIER1_currency, SUPPLIER1_updated, ...`
- Great for offline editing in Excel/Google Sheets

**CSV Import (Update-Only)**:
- Same format as export
- **UPDATE-ONLY behavior** (similar to Magento Add/Update import):
  - Only updates values that are provided (non-empty cells)
  - Empty cells preserve existing database values
  - SKUs must exist in `inventory_metadata` (cannot add new products)
  - If a SKU has no pricing and user adds values → creates them
  - If a SKU has pricing and user updates values → updates them
- Validates supplier codes exist
- Reports skipped invalid SKUs

---

## Analysis Dashboard

### Summary Metrics

The dashboard header shows key performance indicators:

| Metric | Description |
|--------|-------------|
| **Total Products** | Count of all products from inventory_metadata |
| **With Pricing** | Products with at least one supplier price |
| **Healthy Margin** | Products with ≥20% margin |
| **Low Margin** | Products with 0-20% margin |
| **Loss Makers** | Products with negative margin |

### Margin Calculation

```
Margin % = ((Magento Price - Best Cost) / Magento Price) × 100
```

**Magento Price Source**: Uses `special_price` if available, otherwise `price`

**Margin Status Classification**:

| Status | Margin % | Visual |
|--------|----------|--------|
| Healthy | ≥ 20% | 🟢 Green |
| Warning | 0-20% | 🟡 Yellow |
| Loss | < 0% | 🔴 Red |
| No Magento Price | N/A | ⚪ Gray (no price data) |
| No Supplier Data | N/A | ⚪ Gray (no supplier pricing) |

### Filtering & Search

**Search**: Type SKU, product name, or brand to filter

**Margin Filter Options**:
- All Margins
- Healthy (≥20%)
- Warning (0-20%)
- Loss (<0%)
- No Magento Price
- No Supplier Data

### The "Winner" Column

For each product, the analysis identifies the winning supplier:
- Compares all normalized prices (converted to GBP)
- Highlights the lowest price
- Displays the supplier code as a badge

---

## API Reference

### Base URL
```
/api/v1/inventory/sourcing
```

### Endpoints

#### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | System status |
| POST | `/init` | Initialize tables (admin only) |

#### FX Rates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/fx-rates` | Get current rates (live + overrides) |
| POST | `/fx-rates/override` | Set manual rate override |
| DELETE | `/fx-rates/override/{code}` | Remove override |

#### Suppliers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/suppliers` | List all suppliers |
| GET | `/suppliers/{id}` | Get single supplier |
| POST | `/suppliers` | Create supplier |
| PATCH | `/suppliers/{id}` | Update supplier |
| DELETE | `/suppliers/{id}` | Delete supplier |

#### Pricing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/pricing/{sku}` | Get all pricing for SKU |
| POST | `/pricing` | Create/update pricing entry |
| DELETE | `/pricing/{sku}/{supplier_id}` | Delete pricing entry |
| POST | `/pricing/bulk` | Bulk update pricing |

#### Matrix & Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/matrix` | Get supplier matrix view |
| GET | `/analysis` | Get analysis dashboard |
| GET | `/export/csv` | Export matrix as CSV (all products) |
| POST | `/import/csv` | Import matrix from CSV (update-only) |

### Example Requests

**Create a Supplier**:
```http
POST /api/v1/inventory/sourcing/suppliers
Content-Type: application/json
Authorization: Bearer {token}

{
  "name": "Acme Supplies Ltd",
  "code": "ACME",
  "default_currency": "GBP",
  "contact_email": "orders@acme.com",
  "lead_time_days": 5,
  "is_active": true
}
```

**Add Pricing**:
```http
POST /api/v1/inventory/sourcing/pricing
Content-Type: application/json
Authorization: Bearer {token}

{
  "sku": "WIDGET-001",
  "supplier_id": 1,
  "unit_price": 12.50,
  "currency": "GBP",
  "moq": 10
}
```

**Get Analysis with Filters**:
```http
GET /api/v1/inventory/sourcing/analysis?margin_status=loss&page=1&per_page=50
Authorization: Bearer {token}
```

---

## Database Schema

### Tables

#### `sourcing_suppliers`
```sql
CREATE TABLE sourcing_suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    default_currency VARCHAR(3) DEFAULT 'GBP',
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    website VARCHAR(255),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    lead_time_days INTEGER,
    min_order_value DECIMAL(10,2),
    payment_terms VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP
);
```

#### `sourcing_supplier_pricing`
```sql
CREATE TABLE sourcing_supplier_pricing (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES sourcing_suppliers(id) ON DELETE CASCADE,
    unit_price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'GBP',
    moq INTEGER,
    shipping_cost DECIMAL(10,2),
    is_preferred BOOLEAN DEFAULT FALSE,
    last_verified TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP,
    UNIQUE(sku, supplier_id)
);
```

#### `sourcing_fx_overrides`
```sql
CREATE TABLE sourcing_fx_overrides (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) NOT NULL UNIQUE,
    rate DECIMAL(12,6) NOT NULL,
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP
);
```

### Indexes

```sql
CREATE INDEX idx_sourcing_pricing_sku ON sourcing_supplier_pricing(sku);
CREATE INDEX idx_sourcing_pricing_supplier ON sourcing_supplier_pricing(supplier_id);
CREATE INDEX idx_sourcing_suppliers_active ON sourcing_suppliers(is_active);
```

---

## Workflow Guide

### Initial Setup (One-Time)

1. **Navigate to Sourcing**
   - Go to Inventory > Product Sourcing
   - Tables are auto-initialized on first visit

2. **Configure FX Rates**
   - Review live rates in FX Rates tab
   - Set any manual overrides if needed

3. **Add Suppliers**
   - Create entries for each vendor
   - Assign unique codes
   - Set default currencies

### Weekly Routine

```
┌──────────────────────────────────────────────────────────────┐
│                      WEEKLY WORKFLOW                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Monday: Sync Magento Data                                    │
│  ├── Inventory Management > Sync from Magento                 │
│  └── Ensures SKUs and current prices are up-to-date           │
│                                                               │
│  When Price Lists Arrive: Update Matrix                       │
│  ├── Go to Supplier Matrix tab                                │
│  ├── Update relevant supplier columns                         │
│  └── Click Save Changes                                       │
│                                                               │
│  Daily/Weekly: Review Analysis                                │
│  ├── Open Analysis Dashboard                                  │
│  ├── Filter by "Loss" to find problem products                │
│  ├── Look for green (best price) indicators                   │
│  └── Make purchasing decisions                                │
│                                                               │
│  Currency: Automatic                                          │
│  └── FX rates update automatically every hour                 │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Finding the Best Supplier

1. Navigate to **Analysis Dashboard**
2. Use search to find product
3. Check **Best Supplier** column
4. Verify margin is acceptable
5. Place order with winning supplier

### Handling Loss-Makers

When a product shows negative margin:

1. **Review Pricing**: Is the Magento price too low?
2. **Check Suppliers**: Is there a cheaper option not yet entered?
3. **Negotiate**: Contact suppliers for better rates
4. **Consider Alternatives**: Discontinue if unsalvageable

---

## Configuration

### Environment Variables

The sourcing module uses the standard inventory database connection:

```env
INVENTORY_LOGS_HOST=your-db-host.com
INVENTORY_LOGS_PORT=5432
INVENTORY_LOGS_NAME=rm365
INVENTORY_LOGS_USER=postgres
INVENTORY_LOGS_PASSWORD=your-password
```

### FX API Configuration

The system uses the free `open.er-api.com` endpoint. No API key required.

To use a different provider, modify:
```python
# backend/common/currency.py
response = requests.get('https://open.er-api.com/v6/latest/GBP')
```

### Cache Duration

FX rates are cached for 1 hour by default:
```python
CACHE_DURATION = timedelta(hours=1)
```

---

## Troubleshooting

### Common Issues

**"Tables not initialized"**
- Solution: Click the Initialize button or call `/api/v1/inventory/sourcing/init`

**"FX rates unavailable"**
- Check internet connectivity
- Rates will fall back to cached/hardcoded values

**"Supplier code already exists"**
- Supplier codes must be unique
- Choose a different code or update the existing supplier

**"Margin shows as 'No Data'"**
- Ensure product has a Magento price
- Add at least one supplier price

### Performance Tips

1. **Pagination**: Large inventories should use pagination (default 100 items/page)
2. **Search First**: Use search rather than scrolling through all products
3. **Bulk Updates**: Use CSV import for large pricing updates
4. **Filter Actively**: Use margin filters to focus on problem areas

---

## Future Enhancements

Planned features for future releases:

- [x] **Magento Price Integration**: Auto-pull current retail prices ✅
- [ ] **Historical Pricing**: Track price changes over time
- [ ] **Supplier Performance**: Track delivery times and quality
- [ ] **Automated Alerts**: Email when margins drop below threshold
- [ ] **Purchase Order Generation**: Create POs from analysis
- [ ] **Bulk Price Negotiations**: Track negotiated vs. list prices
- [ ] **Multi-currency Reports**: Analysis in different base currencies

---

## Support

For issues or feature requests, contact the development team or open an issue in the repository.

**Module Version**: 1.1.0  
**Last Updated**: January 2026

**Recent Changes (v1.1.0)**:
- Products now sourced from `inventory_metadata` table (same as Label Generator)
- Magento prices use `special_price > price > N/A` logic
- CSV export includes all products with `product_name` column
- CSV import uses update-only behavior (empty cells preserve existing values)
- Brand extracted from SKU prefix
