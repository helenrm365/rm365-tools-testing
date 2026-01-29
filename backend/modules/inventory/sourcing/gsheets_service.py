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
        Replaces the content of the first worksheet.
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
                    f"{s['code']}_notes"
                ])
            
            # 2. Prepare Data Rows
            rows = []
            rows.append(headers) # Header row
            
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
                        format_val(row_data.get(f"{code}_notes"))
                    ])
                rows.append(row)
            
            # 3. Update Sheet
            worksheet.clear()
            worksheet.update(rows)
            
            # 4. Optional: Formatting (freeze header)
            worksheet.freeze(rows=1)
            
            return {"status": "success", "rows_exported": len(rows) - 1}
            
        except Exception as e:
            logger.error(f"Error exporting to Google Sheet: {str(e)}")
            raise e

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
