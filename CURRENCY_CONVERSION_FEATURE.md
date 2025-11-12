# Currency Conversion Feature

## Overview
The sales data system now includes **live currency conversion** when filtering orders by grand total threshold. This ensures that threshold filters work correctly across different currencies.

## How It Works

### The Problem
Previously, when setting a threshold filter (e.g., "exclude orders over £100"), the system would:
- ❌ Exclude orders where `grand_total > 100` regardless of currency
- ❌ This meant $100 USD orders were treated the same as £100 GBP orders
- ❌ At current rates (£1 = $1.31), a £100 threshold should actually be $131, not $100

### The Solution
Now the system:
- ✅ Fetches live exchange rates every hour from a free API
- ✅ Converts all order totals to the base currency before comparing
- ✅ UK region uses GBP (£) as base currency
- ✅ FR/NL regions use EUR (€) as base currency

### Example
**UK Region - Filter: Exclude orders over £100**

| Order | Original Currency | Original Amount | Converted to GBP | Result |
|-------|------------------|----------------|------------------|---------|
| Order A | GBP | £95.00 | £95.00 | ✅ Included |
| Order B | USD | $100.00 | £76.34 | ✅ Included |
| Order C | USD | $140.00 | £106.87 | ❌ Excluded (over £100) |
| Order D | EUR | €120.00 | £103.45 | ❌ Excluded (over £100) |

**FR/NL Region - Filter: Exclude orders over €100**

| Order | Original Currency | Original Amount | Converted to EUR | Result |
|-------|------------------|----------------|------------------|---------|
| Order A | EUR | €95.00 | €95.00 | ✅ Included |
| Order B | GBP | £85.00 | €98.60 | ✅ Included |
| Order C | USD | $120.00 | €102.56 | ❌ Excluded (over €100) |

## Technical Implementation

### Backend

#### 1. Currency Conversion Service (`backend/common/currency.py`)
- Fetches live rates from `https://open.er-api.com/v6/latest/GBP`
- Caches rates for 1 hour to minimize API calls
- Falls back to hardcoded rates if API fails
- Provides conversion functions:
  - `convert_to_gbp(amount, from_currency)` - Convert any currency to GBP
  - `convert_to_eur(amount, from_currency)` - Convert any currency to EUR
  - `get_rate_for_display(from, to)` - Get exchange rate for UI display

#### 2. Updated Filtering Logic (`backend/modules/salesdata/repo.py`)
- Changed from SQL-based filtering to Python-based filtering
- Fetches all 6-month data from database
- Applies currency conversion during filtering:
  ```python
  if grand_total_threshold is not None:
      converted_total = converter_func(float(grand_total), currency)
      if converted_total > float(grand_total_threshold):
          # Exclude this order
          continue
  ```

#### 3. New API Endpoint (`backend/modules/salesdata/api.py`)
- `GET /api/v1/salesdata/currency/rates`
- Returns current exchange rates and common conversions
- Used by frontend to display conversion info to users

### Frontend

#### 1. Display Currency Conversion Info (`frontend/js/modules/salesdata/condensed-filters.js`)
- Fetches and displays live exchange rates in the filters modal
- Shows example conversions (e.g., "£100 = $131.13 USD = €116.00 EUR")
- Updates users that currency conversion is active

#### 2. Updated Filter Description
- Clearly states that all currencies are automatically converted
- Shows which base currency is used for the region

## Supported Currencies

The system supports the following currencies with proper symbol mapping:
- **GBP** (£) - British Pound
- **EUR** (€) - Euro
- **USD** ($) - US Dollar
- **CAD** (C$) - Canadian Dollar
- **AUD** (A$) - Australian Dollar
- **JPY** (¥) - Japanese Yen
- **CNY** (¥) - Chinese Yuan
- **CHF** (Fr) - Swiss Franc
- **SEK** (kr) - Swedish Krona
- **NOK** (kr) - Norwegian Krone
- **DKK** (kr) - Danish Krone
- **PLN** (zł) - Polish Złoty
- **CZK** (Kč) - Czech Koruna
- **HUF** (Ft) - Hungarian Forint

For unsupported currencies, the currency code itself is displayed.

## Exchange Rate Updates

- **Update Frequency**: Every 1 hour
- **API Source**: open.er-api.com (free tier, no API key required)
- **Cache Duration**: 1 hour
- **Fallback**: Hardcoded approximate rates if API unavailable
- **Base Currency**: GBP (British Pound)

## User Experience

### In the Filters Modal
1. Open the 6M Condensed Sales Filters
2. Navigate to "Grand Total Threshold" section
3. See live exchange rate info displayed below description:
   - UK: "£100 = $131.13 USD = €116.00 EUR"
   - FR/NL: "€100 = $113.04 USD = £86.21 GBP"
4. Set threshold in base currency (£ for UK, € for FR/NL)
5. System automatically converts all order currencies for comparison

### When Refreshing 6M Data
- The conversion happens automatically in the background
- Orders are properly excluded based on converted amounts
- Logs show how many orders were filtered

## Benefits

1. **Accurate Filtering**: Thresholds work correctly across all currencies
2. **Transparent**: Users see current exchange rates being used
3. **Automatic**: No manual conversion needed
4. **Reliable**: Falls back to cached/hardcoded rates if API fails
5. **Efficient**: Rates cached for 1 hour to minimize API calls

## Example Use Cases

### Use Case 1: Exclude Large USD Orders from UK Data
**Scenario**: UK team wants to exclude all orders over £100 to focus on smaller sales.

**Without Currency Conversion**:
- Sets threshold to £100
- System excludes orders where amount > 100
- $100 USD order gets excluded (incorrect - only worth £76)
- $200 USD order gets excluded (correct - worth £152)

**With Currency Conversion**:
- Sets threshold to £100
- System converts all currencies to GBP
- $100 USD (£76) is INCLUDED ✅
- $140 USD (£107) is EXCLUDED ✅
- Accurately filters by actual value

### Use Case 2: B2B Filter for EU Regions
**Scenario**: FR team wants to exclude wholesale orders over €500.

**With Currency Conversion**:
- Sets threshold to €500
- €600 order from France → EXCLUDED
- £450 GBP order from UK (€522 converted) → EXCLUDED
- $400 USD order from US (€354 converted) → INCLUDED

## Troubleshooting

### Exchange Rate Not Loading
- Check network connection
- Verify API endpoint is accessible: https://open.er-api.com/v6/latest/GBP
- System will use fallback rates if API fails

### Incorrect Conversions
- Rates update every hour
- Check backend logs for exchange rate fetch status
- Verify the currency field in order data is correct

### Performance Impact
- Currency conversion adds minimal overhead
- Rates are cached for 1 hour
- Conversion happens once during 6M refresh, not on every view

## Future Enhancements

Potential improvements:
- Allow users to see converted amounts in the main sales table
- Add currency conversion to other filters (e.g., product price)
- Support custom exchange rates for specific business needs
- Historical exchange rate tracking
