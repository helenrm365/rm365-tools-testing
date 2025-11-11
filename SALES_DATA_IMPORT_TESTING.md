# Sales Data Import Testing Guide

## Overview
The sales data import functionality has been updated to support 14 columns with the following structure:

## CSV Column Structure (in order):
1. **Order number** - Required (e.g., ORD-001)
2. **Created At** - Required (e.g., 2024-11-01 10:30:00)
3. **Product SKU** - Required (e.g., SKU-12345)
4. **Product Name** - Required (e.g., Test Product A)
5. **Product Qty** - Required (e.g., 2)
6. **Product Price** - Required (e.g., 29.99)
7. **Status** - Required (e.g., complete, pending, cancelled)
8. **Currency** - Optional (e.g., GBP, EUR)
9. **Grand Total** - Optional (e.g., 59.98) - This is the order's grand total price
10. **Customer Email** - Optional (e.g., customer@example.com)
11. **Customer Full Name** - Optional (e.g., John Smith)
12. **Billing Address** - Optional (e.g., 123 Main St London UK)
13. **Shipping Address** - Optional (e.g., 123 Main St London UK)
14. **Customer Group Code** - Optional (e.g., RETAIL, WHOLESALE)

## Testing Steps

### 1. Initialize Tables
1. Navigate to the Sales Data home page
2. The system will automatically create the three regional tables:
   - `uk_sales_data`
   - `fr_sales_data`
   - `nl_sales_data`
3. You should see a success message: "Database Ready - Tables initialized"

### 2. Test CSV Import
A sample CSV file has been created: `test_sales_import.csv`

To test:
1. Go to UK Sales, FR Sales, or NL Sales page
2. Click "Upload File" 
3. Select the `test_sales_import.csv` file
4. Click "Upload File" button
5. You should see: "Successfully imported 3 rows!"

### 3. Verify Data Display
After import, the table should display:
- All 14 columns in the table header
- Data properly formatted:
  - Prices shown with currency symbols (£ for UK, € for FR/NL)
  - Grand Total formatted with currency
  - All customer information visible
  - Addresses displayed (may be truncated if very long)

### 4. Test Search
1. Try searching for:
   - Order number (e.g., "ORD-001")
   - SKU (e.g., "SKU-12345")
   - Product name (e.g., "Test Product A")
   - Customer email (e.g., "customer1@example.com")
   - Customer name (e.g., "John Smith")

## Backend Changes Summary

### Database Schema
- Tables now have 14 columns (previously had 9)
- New columns: `grand_total`, `customer_email`, `customer_full_name`, `billing_address`, `shipping_address`, `customer_group_code`
- Removed old column: `customer_group` (replaced by `customer_group_code`)

### Import Function
- Expects exactly 14 columns in CSV
- Validates required fields: `order_number` and `sku` must not be empty
- Handles optional fields gracefully (allows NULL/empty values)
- Improved error handling for grand_total conversion
- Reports detailed errors for any failed rows

### Data Retrieval
- All SELECT queries updated to fetch new columns
- Search functionality includes customer_email and customer_full_name

## Frontend Changes Summary

### HTML Tables (UK, FR, NL)
- Updated to display all 14 columns
- Proper column headers with icons
- Adjusted colspan from 9 to 14 for loading/error states

### JavaScript Display Logic
- Updated `displaySalesData()` to render all 14 columns
- Grand Total formatted with currency symbol
- All fields properly escaped to prevent XSS
- Empty fields display as blank (not "undefined" or "null")

## Known Behaviors

1. **Optional Fields**: Currency, Grand Total, Customer Email, Customer Full Name, Billing Address, Shipping Address, and Customer Group Code can be empty
2. **Required Fields**: Order Number, Created At, Product SKU, Product Name, Product Qty, Product Price, and Status must have values
3. **Number Conversion**: If Qty or Price can't be converted to numbers, they default to 0
4. **Grand Total**: If Grand Total is empty or can't be converted, it will be stored as NULL and displayed as empty

## Troubleshooting

### Import Fails
- Check CSV has exactly 14 columns
- Ensure Order Number and SKU are not empty
- Verify CSV is properly formatted (no extra commas, proper encoding)

### Data Not Displaying
- Check browser console for errors
- Verify backend is running
- Check that tables were initialized successfully

### Search Not Working
- Ensure the search term matches data in the table
- Search works on: order_number, sku, name, status, customer_email, customer_full_name
