"""
UK Sales Data CSV Import Script for PostgreSQL

This script imports sales data from a CSV file into the PostgreSQL uk_sales_data table.
Expected CSV columns (in order):
- Order # (increment_id)
- Created At (created_at)
- Product Sku (oitem_sku)
- Product Name (oitem_name)
- Product Qty Invoiced (oitem_qty_invoiced)
- Product Price (oitem_price)
- Status (status)

Usage:
    python import_uk_sales.py <csv_file_path>
"""

import csv
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from modules.sales_imports.repo import SalesImportsRepo


def import_csv_to_uk_sales(csv_file_path):
    """Import CSV file to uk_sales_data table"""
    
    if not Path(csv_file_path).exists():
        print(f"Error: File not found: {csv_file_path}")
        return False
    
    try:
        repo = SalesImportsRepo()
        
        try:
            repo.init_tables()
            print("✅ Database table ready")
        except Exception as e:
            print(f"Note: {e}")
        
        # Read CSV file
        with open(csv_file_path, 'r', encoding='utf-8-sig') as file:
            # First, read as a regular reader to get column order
            file.seek(0)
            first_line = file.readline()
            file.seek(0)
            
            csv_reader = csv.reader(file)
            headers = next(csv_reader)  # Get headers
            
            print(f"📋 Detected {len(headers)} columns:")
            for i, header in enumerate(headers):
                print(f"   Column {i+1}: '{header}'")
            
            # Expected column order:
            # 1. Order # / increment_id
            # 2. Created At / created_at  
            # 3. Product Sku / oitem_sku
            # 4. Product Name / oitem_name
            # 5. Product Qty Invoiced / oitem_qty_invoiced
            # 6. Product Price / oitem_price
            # 7. Status / status
            
            if len(headers) < 7:
                print(f"\n❌ Error: Expected 7 columns, found {len(headers)}")
                return False
            
            print(f"\n✅ Using positional import (column order-based)")
            print(f"   Order mapping:")
            print(f"   Column 1 → Order Number")
            print(f"   Column 2 → Created At")
            print(f"   Column 3 → Product SKU")
            print(f"   Column 4 → Product Name")
            print(f"   Column 5 → Quantity")
            print(f"   Column 6 → Price")
            print(f"   Column 7 → Status\n")
            
            imported_count = 0
            error_count = 0
            batch = []
            
            for row_num, row in enumerate(csv_reader, start=2):
                try:
                    # Use positional indexing instead of column names
                    order_number = row[0].strip() if len(row) > 0 else ''
                    created_at = row[1].strip() if len(row) > 1 else ''
                    sku = row[2].strip() if len(row) > 2 else ''
                    name = row[3].strip() if len(row) > 3 else ''
                    qty_str = row[4].strip() if len(row) > 4 else '0'
                    price_str = row[5].strip() if len(row) > 5 else '0.0'
                    status = row[6].strip() if len(row) > 6 else ''
                    
                    # Validate required fields
                    if not all([order_number, created_at, sku, name]):
                        print(f"Warning: Skipping row {row_num} - missing required fields")
                        error_count += 1
                        continue
                    
                    # Convert quantity and price
                    try:
                        qty = int(float(qty_str))
                    except (ValueError, TypeError):
                        qty = 1
                    
                    try:
                        price = float(price_str)
                    except (ValueError, TypeError):
                        price = 0.0
                    
                    # Add to batch
                    batch.append({
                        'order_number': order_number,
                        'created_at': created_at,
                        'sku': sku,
                        'name': name,
                        'qty': qty,
                        'price': price,
                        'status': status
                    })
                    
                    # Insert in batches of 100
                    if len(batch) >= 100:
                        
                        inserted = repo.bulk_insert_uk_sales_data(batch)
                        skipped = len(batch) - inserted

                        if inserted:
                            print(f"Imported {inserted} new records this batch.")
                            imported_count += inserted
                        if skipped:
                            print(f"Skipped {skipped} duplicate records this batch.")
                            error_count += skipped
                        
                        batch = []
                
                except Exception as e:
                    print(f"Error processing row {row_num}: {e}")
                    error_count += 1
                    continue
            
            # Insert remaining records
            if batch:
                inserted = repo.bulk_insert_uk_sales_data(batch)
                skipped = len(batch) - inserted

                if inserted:
                    print(f"Imported {inserted} new records in final batch.")
                    imported_count += inserted
                if skipped:
                    print(f"Skipped {skipped} duplicate records in final batch.")
                    error_count += skipped
            
            print(f"\n=== Import Complete ===")
            print(f"Successfully imported: {imported_count} records")
            print(f"Errors/Skipped: {error_count} records")
            
            return True
            
    except Exception as e:
        print(f"Error importing CSV: {e}")
        return False


def verify_import():
    """Verify the import by showing stats"""
    try:
        repo = SalesImportsRepo()
        stats = repo.get_uk_sales_stats()
        
        print(f"\n=== Database Statistics ===")
        print(f"Total records: {stats['total_records']:,}")
        print(f"Total quantity: {stats['total_quantity']:,}")
        print(f"Total value: £{stats['total_value']:.2f}")
        print(f"Unique orders: {stats['unique_orders']:,}")
        print(f"Unique products: {stats['unique_products']:,}")
        
    except Exception as e:
        print(f"Error getting stats: {e}")


def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage: python import_uk_sales.py <csv_file_path>")
        print("\nExpected CSV columns:")
        print("  - Order # (or increment_id)")
        print("  - Created At (or created_at)")
        print("  - Product Sku (or oitem_sku)")
        print("  - Product Name (or oitem_name)")
        print("  - Product Qty Invoiced (or oitem_qty_invoiced)")
        print("  - Product Price (or oitem_price)")
        print("  - Status (or status)")
        sys.exit(1)
    
    csv_file_path = sys.argv[1]
    
    print(f"Starting import from: {csv_file_path}")
    print("-" * 80)
    
    success = import_csv_to_uk_sales(csv_file_path)
    
    if success:
        verify_import()
        print("\n✅ Import completed successfully!")
    else:
        print("\n❌ Import failed. Please check the error messages above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
