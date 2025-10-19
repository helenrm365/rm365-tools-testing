from __future__ import annotations
from typing import Dict, Any, List, Optional, BinaryIO
import csv
import io
import logging
from datetime import datetime

from .repo import SalesImportsRepo

logger = logging.getLogger(__name__)


class SalesImportsService:
    def __init__(self, repo: Optional[SalesImportsRepo] = None):
        self.repo = repo or SalesImportsRepo()

    def import_csv_file(self, file_content: str, filename: str) -> Dict[str, Any]:
        """
        Import sales data from CSV file based on column position.
        Expected column order (matching UK Sales Data display):
        1. order_number
        2. created_at (date/timestamp)
        3. sku
        4. name
        5. qty (quantity)
        6. price (optional, defaults to 0.0)
        7. status (optional, defaults to 'pending')
        """
        try:
            # Parse CSV content - use regular reader to get raw rows
            lines = io.StringIO(file_content)
            reader = csv.reader(lines)
            
            all_rows = list(reader)
            
            if len(all_rows) < 2:  # Need at least header + 1 data row
                return {
                    "status": "error",
                    "message": "No data found in CSV file"
                }
            
            headers = all_rows[0]
            data_rows = all_rows[1:]
            
            # Validate number of columns (minimum 5 required: order, date, sku, name, qty)
            # Up to 7 columns: + price, + status
            num_columns = len(headers)
            if num_columns < 5:
                return {
                    "status": "error",
                    "message": f"CSV must have at least 5 columns. Found {num_columns} columns. Expected order: order_number, created_at, sku, name, qty, price (optional), status (optional)"
                }
            
            if num_columns > 7:
                return {
                    "status": "error",
                    "message": f"CSV has too many columns. Found {num_columns} columns. Maximum is 7. Expected order: order_number, created_at, sku, name, qty, price (optional), status (optional)"
                }
            
            # Process and save data
            imported_count = 0
            errors = []
            
            for i, row in enumerate(data_rows, 1):
                try:
                    # Skip empty rows
                    if not row or all(cell.strip() == '' for cell in row):
                        continue
                    
                    # Validate row has correct number of columns
                    if len(row) != num_columns:
                        raise ValueError(f"Row has {len(row)} columns, expected {num_columns}")
                    
                    # Clean and validate row data by position
                    processed_row = self._process_uk_sales_row(row, num_columns)
                    self.repo.save_uk_sales_data(processed_row)
                    imported_count += 1
                except Exception as e:
                    errors.append(f"Row {i}: {str(e)}")
                    if len(errors) > 10:  # Limit error reporting
                        errors.append("... (truncated)")
                        break
            
            # Save import history
            self.repo.save_import_history({
                "filename": filename,
                "total_rows": len(data_rows),
                "imported_rows": imported_count,
                "errors_count": len(errors),
                "status": "completed" if not errors else "partial"
            })
            
            return {
                "status": "success",
                "imported_count": imported_count,
                "total_rows": len(data_rows),
                "errors": errors,
                "has_errors": len(errors) > 0
            }
            
        except Exception as e:
            logger.error(f"Error importing CSV: {e}")
            return {
                "status": "error",
                "message": str(e)
            }

    def _process_uk_sales_row(self, row: List[str], num_columns: int) -> Dict[str, Any]:
        """
        Process and validate a single CSV row by column position for UK Sales Data.
        Expected column order (positions 0-6):
        0. order_number (required)
        1. created_at (required - date/timestamp)
        2. sku (required)
        3. name (required - product name)
        4. qty (required - quantity)
        5. price (optional, defaults to 0.0)
        6. status (optional, defaults to 'pending')
        """
        processed = {}
        
        # Required fields (all formats need these 5 columns minimum)
        processed['order_number'] = row[0].strip()
        
        # Parse date/timestamp - try common formats
        date_str = row[1].strip()
        try:
            # Try parsing various date formats (UK format first since that's most common for this use case)
            for fmt in [
                '%d/%m/%Y %H:%M:%S',   # 14/09/2025 00:13:00 (UK format with seconds)
                '%d/%m/%Y %H:%M',      # 14/09/2025 00:13 (UK format without seconds)
                '%d/%m/%Y',            # 14/09/2025 (UK date only)
                '%Y-%m-%d %H:%M:%S',   # 2024-01-15 10:30:00 (ISO format with seconds)
                '%Y-%m-%d %H:%M',      # 2024-01-15 10:30 (ISO format without seconds)
                '%Y-%m-%d',            # 2024-01-15 (ISO date only)
                '%m/%d/%Y %H:%M:%S',   # 01/15/2024 10:30:00 (US format with seconds)
                '%m/%d/%Y %H:%M',      # 01/15/2024 10:30 (US format without seconds)
                '%m/%d/%Y',            # 01/15/2024 (US date only)
            ]:
                try:
                    processed['created_at'] = datetime.strptime(date_str, fmt)
                    break
                except ValueError:
                    continue
            else:
                # If no format matched, try to parse as ISO format
                processed['created_at'] = datetime.fromisoformat(date_str)
        except Exception as e:
            raise ValueError(f"Invalid date format '{date_str}'. Supported formats: DD/MM/YYYY HH:MM, DD/MM/YYYY, YYYY-MM-DD HH:MM:SS, etc.")
        
        processed['sku'] = row[2].strip()
        processed['name'] = row[3].strip()
        
        # Quantity - required field
        try:
            processed['qty'] = int(row[4].strip()) if row[4].strip() else 1
        except ValueError:
            raise ValueError(f"Quantity must be a valid number, got: {row[4]}")
        
        # Optional fields based on column count
        if num_columns >= 6:
            # Price field
            try:
                processed['price'] = float(row[5].strip()) if row[5].strip() else 0.0
            except ValueError:
                raise ValueError(f"Price must be a valid number, got: {row[5]}")
        else:
            processed['price'] = 0.0
        
        if num_columns >= 7:
            # Status field
            processed['status'] = row[6].strip() if row[6].strip() else 'pending'
        else:
            processed['status'] = 'pending'
        
        # Validate required fields are not empty
        required_fields = ['order_number', 'created_at', 'sku', 'name']
        for field in required_fields:
            if not processed[field]:
                raise ValueError(f"Required field '{field}' is empty")
        
        # Validate quantity is positive
        if processed['qty'] <= 0:
            raise ValueError("Quantity must be greater than 0")
        
        # Validate price is non-negative
        if processed['price'] < 0:
            raise ValueError("Price cannot be negative")
        
        return processed

    def get_import_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get recent import history"""
        try:
            return self.repo.get_import_history(limit)
        except Exception as e:
            logger.error(f"Error getting import history: {e}")
            return []

    def get_sales_orders(self, limit: int = 100, search: str = "") -> List[Dict[str, Any]]:
        """Get recent sales orders"""
        try:
            return self.repo.get_sales_orders(limit, search)
        except Exception as e:
            logger.error(f"Error getting sales orders: {e}")
            return []

    def delete_sales_order(self, order_id: int) -> Dict[str, Any]:
        """Delete a sales order"""
        try:
            success = self.repo.delete_sales_order(order_id)
            if success:
                return {"status": "success", "message": "Order deleted successfully"}
            else:
                return {"status": "error", "message": "Order not found"}
        except Exception as e:
            logger.error(f"Error deleting sales order: {e}")
            return {"status": "error", "message": str(e)}

    def validate_csv_format(self, file_content: str) -> Dict[str, Any]:
        """
        Validate CSV format based on column count (not header names).
        Expected column order for UK Sales Data:
        - 5 cols (minimum): order_number, created_at, sku, name, qty
        - 6 cols: + price
        - 7 cols: + status
        """
        try:
            lines = io.StringIO(file_content)
            reader = csv.reader(lines)
            all_rows = list(reader)
            
            if len(all_rows) < 2:  # Need at least header + 1 data row
                return {
                    "valid": False,
                    "message": "No data found in CSV file"
                }
            
            headers = all_rows[0]
            data_rows = all_rows[1:]
            
            # Count non-empty data rows
            non_empty_rows = [row for row in data_rows if row and any(cell.strip() for cell in row)]
            
            # Check number of columns
            num_columns = len(headers)
            if num_columns < 5:
                return {
                    "valid": False,
                    "message": f"CSV must have at least 5 columns. Found {num_columns} columns.",
                    "expected_order": "order_number, created_at, sku, name, qty, price (opt), status (opt)",
                    "total_rows": len(non_empty_rows)
                }
            
            if num_columns > 7:
                return {
                    "valid": False,
                    "message": f"CSV has too many columns. Found {num_columns} columns. Maximum is 7.",
                    "expected_order": "order_number, created_at, sku, name, qty, price (opt), status (opt)",
                    "total_rows": len(non_empty_rows)
                }
            
            # Determine expected column interpretation
            if num_columns == 5:
                column_interpretation = "order_number, created_at, sku, name, qty"
            elif num_columns == 6:
                column_interpretation = "order_number, created_at, sku, name, qty, price"
            else:  # 7
                column_interpretation = "order_number, created_at, sku, name, qty, price, status"
            
            return {
                "valid": True,
                "message": f"CSV format is valid with {num_columns} columns",
                "total_rows": len(non_empty_rows),
                "columns": headers,
                "column_count": num_columns,
                "interpretation": column_interpretation
            }
            
        except Exception as e:
            return {
                "valid": False,
                "message": f"Invalid CSV format: {str(e)}"
            }

    def get_uk_sales_data(self, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get UK sales data with pagination"""
        try:
            data, total = self.repo.get_uk_sales_data(limit, offset, search)
            return {
                "status": "success",
                "data": data,
                "count": len(data),
                "total": total
            }
        except Exception as e:
            logger.error(f"Error getting UK sales data: {e}")
            return {
                "status": "error",
                "message": str(e),
                "data": [],
                "count": 0,
                "total": 0
            }