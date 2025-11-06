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
        Creates uk_sales_data, fr_sales_data, nl_sales_data and their condensed versions.
        Also populates condensed tables with existing data.
        """
        try:
            tables = self.repo.init_tables()
            
            # Refresh condensed data for all regions
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_condensed_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
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
    
    def import_csv(self, region: str, csv_content: str, filename: str = None, username: str = None) -> Dict[str, Any]:
        """Import CSV data for a specific region and refresh condensed data"""
        try:
            table_name = self._get_table_name(region)
            result = self.repo.import_csv_data(table_name, csv_content, filename, username)
            
            if result['success']:
                # Refresh condensed data after import
                try:
                    condensed_result = self.repo.refresh_condensed_data(region)
                    logger.info(f"Refreshed condensed data for {region}: {condensed_result['rows_aggregated']} SKUs")
                except Exception as e:
                    logger.error(f"Failed to refresh condensed data for {region}: {e}")
                
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
    
    def get_condensed_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get condensed (6-month aggregated) sales data for a specific region"""
        try:
            result = self.repo.get_condensed_data(region, limit, offset, search)
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
            logger.error(f"Error getting condensed {region} data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get condensed data: {str(e)}",
                "data": [],
                "total_count": 0
            }
    
    def get_sku_aliases(self) -> Dict[str, Any]:
        """Get all SKU aliases"""
        try:
            aliases = self.repo.get_sku_aliases()
            return {
                "status": "success",
                "aliases": aliases,
                "count": len(aliases)
            }
        except Exception as e:
            logger.error(f"Error getting SKU aliases: {e}")
            return {
                "status": "error",
                "message": f"Failed to get SKU aliases: {str(e)}",
                "aliases": []
            }
    
    def add_sku_alias(self, alias_sku: str, unified_sku: str) -> Dict[str, Any]:
        """Add a new SKU alias mapping"""
        try:
            result = self.repo.add_sku_alias(alias_sku, unified_sku)
            
            # Refresh all condensed data to apply the new alias
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_condensed_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                "message": f"SKU alias added: {alias_sku} → {unified_sku}",
                **result
            }
        except ValueError as e:
            return {
                "status": "error",
                "message": str(e)
            }
        except Exception as e:
            logger.error(f"Error adding SKU alias: {e}")
            return {
                "status": "error",
                "message": f"Failed to add SKU alias: {str(e)}"
            }
    
    def delete_sku_alias(self, alias_id: int) -> Dict[str, Any]:
        """Delete a SKU alias mapping"""
        try:
            result = self.repo.delete_sku_alias(alias_id)
            
            # Refresh all condensed data to remove the alias effect
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_condensed_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                "message": "SKU alias deleted",
                **result
            }
        except ValueError as e:
            return {
                "status": "error",
                "message": str(e)
            }
        except Exception as e:
            logger.error(f"Error deleting SKU alias: {e}")
            return {
                "status": "error",
                "message": f"Failed to delete SKU alias: {str(e)}"
            }
    
    def get_import_history(self, limit: int = 100, offset: int = 0, region: str = None) -> Dict[str, Any]:
        """Get import history with pagination and optional region filter"""
        try:
            result = self.repo.get_import_history(limit, offset, region)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error getting import history: {e}")
            return {
                "status": "error",
                "message": f"Failed to get import history: {str(e)}",
                "data": [],
                "total_count": 0
            }
