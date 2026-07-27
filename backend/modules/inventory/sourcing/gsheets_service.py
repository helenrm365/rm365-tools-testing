# backend/modules/inventory/sourcing/gsheets_service.py
import logging
from typing import List, Dict, Any
import os
import json
from decimal import Decimal

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    gspread = None
    Credentials = None

logger = logging.getLogger(__name__)

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

# Per-supplier column suffixes this exporter used to write but no longer does.
# They are deleted from the sheet on the next export so the layout matches the
# database (imports ignore them regardless).
RETIRED_COLUMN_SUFFIXES = ('_notes',)

class GSheetsService:
    def __init__(self, credentials_path: str = "service_account.json"):
        self.credentials_path = credentials_path
        self._client = None
        self.check_dependencies()

    def check_dependencies(self):
        if not gspread:
            logger.warning("gspread or google-auth not installed. Google Sheets sync will not work.")

    def get_client(self):
        if self._client:
            return self._client
        
        if not gspread:
            raise ImportError("gspread library is missing. Install it with pip install gspread google-auth")
            
        if not os.path.exists(self.credentials_path):
            # Check relative to backend root if not found
             backend_creds = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), self.credentials_path)
             if os.path.exists(backend_creds):
                 self.credentials_path = backend_creds
             else:
                raise FileNotFoundError(f"Credentials file not found at {self.credentials_path}")

        try:
            creds = Credentials.from_service_account_file(self.credentials_path, scopes=SCOPES)
            self._client = gspread.authorize(creds)
            return self._client
        except Exception as e:
            logger.error(f"Failed to authenticate with Google Sheets: {str(e)}")
            raise

    def export_matrix_to_sheet(self, sheet_id: str, matrix_data: List[Dict[str, Any]], suppliers: List[Dict]):
        """
        Export the provided matrix data to the Google Sheet.
        Uses batch update to only change cells that are different (incremental sync).
        """
        client = self.get_client()
        try:
            sh = client.open_by_key(sheet_id)
            worksheet = sh.sheet1  # Default to first sheet
            
            # 1. Prepare Headers
            headers = ['sku', 'product_name']
            for s in suppliers:
                headers.extend([
                    f"{s['code']}_price",
                    f"{s['code']}_currency",
                    # Date this supplier's price was last updated (read-only on
                    # import — the database stamps its own date when a price changes).
                    f"{s['code']}_updated"
                ])
            
            # 2. Prepare Data Rows
            new_rows = []
            new_rows.append(headers)  # Header row
            
            for row_data in matrix_data:
                row = [
                    row_data.get('sku', ''),
                    row_data.get('product_name', '')
                ]
                
                for s in suppliers:
                    code = s['code']
                    
                    def format_val(val):
                        if isinstance(val, Decimal):
                            return float(val)
                        return val if val is not None else ''

                    row.extend([
                        format_val(row_data.get(f"{code}_price")),
                        format_val(row_data.get(f"{code}_currency")),
                        format_val(row_data.get(f"{code}_updated"))
                    ])
                new_rows.append(row)
            
            # 3. Get existing data to compare
            try:
                existing_data = worksheet.get_all_values()
            except:
                existing_data = []

            # 3a. Remove columns from an older export layout that we no longer
            # write (currently the per-supplier notes column). Done before the
            # diff below so the remaining cells line up with the new headers.
            existing_data, cols_deleted = self._drop_retired_columns(
                worksheet, existing_data, suppliers
            )

            # 3b. Ensure the sheet grid is large enough for our data
            required_rows = len(new_rows)
            required_cols = len(headers)
            current_rows = worksheet.row_count
            current_cols = max(worksheet.col_count - cols_deleted, 1)

            needs_resize = False
            resize_rows = current_rows
            resize_cols = current_cols
            
            if required_rows > current_rows:
                resize_rows = required_rows
                needs_resize = True
            if required_cols > current_cols:
                resize_cols = required_cols
                needs_resize = True
            
            if needs_resize:
                worksheet.resize(rows=resize_rows, cols=resize_cols)
                logger.info(f"[GSheet Export] Resized sheet from {current_rows}x{current_cols} to {resize_rows}x{resize_cols}")
            
            # 4. Calculate what needs to be updated
            cells_to_update = []
            
            for row_idx, new_row in enumerate(new_rows):
                # Get existing row if it exists
                existing_row = existing_data[row_idx] if row_idx < len(existing_data) else []
                
                for col_idx, new_val in enumerate(new_row):
                    # Get existing value
                    existing_val = existing_row[col_idx] if col_idx < len(existing_row) else ''
                    
                    # Normalize for comparison
                    new_val_str = str(new_val) if new_val is not None else ''
                    existing_val_str = str(existing_val) if existing_val is not None else ''
                    
                    # Compare (handle numeric comparison)
                    values_differ = False
                    try:
                        # Try numeric comparison for price values
                        if new_val_str and existing_val_str:
                            new_float = float(new_val_str)
                            existing_float = float(existing_val_str)
                            values_differ = abs(new_float - existing_float) > 0.001
                        else:
                            values_differ = new_val_str != existing_val_str
                    except (ValueError, TypeError):
                        values_differ = new_val_str != existing_val_str
                    
                    if values_differ:
                        # gspread uses 1-based indexing
                        cells_to_update.append({
                            'range': f"{self._col_letter(col_idx + 1)}{row_idx + 1}",
                            'value': new_val
                        })
            
            # 5. Check if we need to add new rows (sheet is smaller than data)
            if len(new_rows) > len(existing_data):
                # Add remaining new rows
                for row_idx in range(len(existing_data), len(new_rows)):
                    for col_idx, val in enumerate(new_rows[row_idx]):
                        cells_to_update.append({
                            'range': f"{self._col_letter(col_idx + 1)}{row_idx + 1}",
                            'value': val
                        })
            
            # 5b. Clear extra rows if sheet has more data than we're exporting
            rows_cleared = 0
            if len(existing_data) > len(new_rows):
                # Clear the extra rows by setting them to empty
                num_cols = len(headers)
                for row_idx in range(len(new_rows), len(existing_data)):
                    for col_idx in range(num_cols):
                        existing_val = existing_data[row_idx][col_idx] if col_idx < len(existing_data[row_idx]) else ''
                        if existing_val:  # Only clear non-empty cells
                            cells_to_update.append({
                                'range': f"{self._col_letter(col_idx + 1)}{row_idx + 1}",
                                'value': ''
                            })
                            rows_cleared += 1

            # 6. Batch update only changed cells
            if cells_to_update:
                # Use batch_update for efficiency
                batch_data = []
                for cell in cells_to_update:
                    batch_data.append({
                        'range': cell['range'],
                        'values': [[cell['value']]]
                    })
                
                # gspread batch_update
                worksheet.batch_update(batch_data, value_input_option='USER_ENTERED')
                
                logger.info(f"[GSheet Export] Updated {len(cells_to_update)} cells (cleared {rows_cleared} from extra rows)")
            else:
                logger.info("[GSheet Export] No changes detected, sheet is up to date")
            
            # 7. Ensure header row is frozen
            worksheet.freeze(rows=1)
            
            return {
                "status": "success", 
                "rows_exported": len(new_rows) - 1,
                "cells_updated": len(cells_to_update),
                "rows_cleared": rows_cleared,
                "columns_deleted": cols_deleted
            }
            
        except Exception as e:
            logger.error(f"Error exporting to Google Sheet: {str(e)}")
            raise e

    def _drop_retired_columns(self, worksheet, existing_data: List[List[str]], suppliers: List[Dict]):
        """Delete columns a previous export wrote but this one no longer does.

        Sheets created before the per-supplier notes column was retired still
        carry a `{CODE}_notes` column. Left in place it would sit in the middle
        of the layout holding stale values, and would be read back on import.
        Only headers we recognise as ours are deleted — columns the user added
        themselves are untouched.

        Returns (existing_data without those columns, number of columns deleted)
        so the caller's cell diff matches the sheet after deletion.
        """
        if not existing_data:
            return existing_data, 0

        retired = {
            f"{s['code']}{suffix}".strip().lower()
            for s in suppliers
            for suffix in RETIRED_COLUMN_SUFFIXES
        }
        header_row = [str(h).strip().lower() for h in existing_data[0]]
        drop = {i for i, h in enumerate(header_row) if h in retired}
        if not drop:
            return existing_data, 0

        # Delete right-to-left so the earlier indices stay valid as we go.
        for idx in sorted(drop, reverse=True):
            worksheet.delete_columns(idx + 1)  # gspread columns are 1-based
        logger.info(f"[GSheet Export] Deleted {len(drop)} retired column(s) from the sheet")

        trimmed = [
            [v for i, v in enumerate(row) if i not in drop]
            for row in existing_data
        ]
        return trimmed, len(drop)

    def _col_letter(self, col_num: int) -> str:
        """Convert column number (1-based) to letter (A, B, ..., Z, AA, AB, ...)"""
        result = ""
        while col_num > 0:
            col_num, remainder = divmod(col_num - 1, 26)
            result = chr(65 + remainder) + result
        return result

    def import_matrix_from_sheet(self, sheet_id: str) -> List[Dict]:
        """
        Reads the first worksheet and returns a list of dictionaries.
        Assumes the first row is headers.
        """
        client = self.get_client()
        try:
            sh = client.open_by_key(sheet_id)
            worksheet = sh.sheet1
            
            records = worksheet.get_all_records()
            return records
            
        except Exception as e:
            logger.error(f"Error importing from Google Sheet: {str(e)}")
            raise e
