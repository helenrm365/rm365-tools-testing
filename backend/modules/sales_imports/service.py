from typing import Dict, Any
import logging
from .repo import SalesImportsRepo

logger = logging.getLogger(__name__)


class SalesImportsService:
    """Service layer for sales imports operations"""
    
    def __init__(self, repo: SalesImportsRepo = None):
        self.repo = repo or SalesImportsRepo()
    
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
