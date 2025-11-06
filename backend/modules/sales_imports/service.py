from typing import Dict, Any
import logging
from .repo import SalesImportsRepo

logger = logging.getLogger(__name__)


class SalesImportsService:
    """Service layer for sales imports operations"""
    
    def __init__(self, repo: SalesImportsRepo = None):
        self.repo = repo or SalesImportsRepo()
    
    # Table name mapping for validation
    VALID_REGIONS = {
        'uk': 'uk_sales_data',
        'fr': 'fr_sales_data',
        'nl': 'nl_sales_data'
    }
    
    def _get_table_name(self, region: str) -> str:
        """Get the table name for a region, validating it's a known region"""
        table_name = self.VALID_REGIONS.get(region.lower())
        if not table_name:
            raise ValueError(f"Invalid region: {region}. Must be one of: {', '.join(self.VALID_REGIONS.keys())}")
        return table_name
    
    def initialize_tables(self) -> Dict[str, Any]:
        """
        Initialize the sales data tables.
        Creates uk_sales_data, fr_sales_data, and nl_sales_data if they don't exist.
        """
        try:
            tables = self.repo.init_tables()
            return {
                "status": "success",
                "message": "Sales import tables initialized successfully",
                "tables": tables
            }
        except Exception as e:
            logger.error(f"Error initializing tables: {e}")
            return {
                "status": "error",
                "message": f"Failed to initialize tables: {str(e)}",
                "tables": []
            }
    
    def check_tables_status(self) -> Dict[str, Any]:
        """Check the status of sales data tables"""
        try:
            status = self.repo.check_tables_exist()
            all_exist = all(status.values())
            
            return {
                "status": "success",
                "tables_status": status,
                "all_tables_exist": all_exist
            }
        except Exception as e:
            logger.error(f"Error checking tables: {e}")
            return {
                "status": "error",
                "message": f"Failed to check tables: {str(e)}"
            }
    
    def get_region_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get sales data for a specific region"""
        try:
            table_name = self._get_table_name(region)
            result = self.repo.get_sales_data(table_name, limit, offset, search)
            return {
                "status": "success",
                "region": region,
                **result
            }
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e),
                "data": [],
                "total_count": 0
            }
        except Exception as e:
            logger.error(f"Error getting {region} data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get data: {str(e)}",
                "data": [],
                "total_count": 0
            }
    
    def import_csv(self, region: str, csv_content: str) -> Dict[str, Any]:
        """Import CSV data for a specific region"""
        try:
            table_name = self._get_table_name(region)
            result = self.repo.import_csv_data(table_name, csv_content)
            
            if result['success']:
                return {
                    "status": "success",
                    "message": f"Successfully imported {result['rows_imported']} rows to {region.upper()} sales",
                    "rows_imported": result['rows_imported'],
                    "errors": result['errors']
                }
            else:
                return {
                    "status": "error",
                    "message": "No rows were imported",
                    "rows_imported": 0,
                    "errors": result['errors']
                }
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e),
                "rows_imported": 0
            }
        except Exception as e:
            logger.error(f"Error importing CSV to {region}: {e}")
            return {
                "status": "error",
                "message": f"Failed to import CSV: {str(e)}",
                "rows_imported": 0
            }
