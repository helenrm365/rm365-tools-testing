"""
Branch-specific Inventory Management Service
Wraps the main inventory service with branch-specific table configuration.

Strategy: Use the main inventory_metadata as the source of products (synced from Magento),
but store branch-specific metadata (location, quantities, etc.) in branch tables.
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging
import re
import json

from .repo import BranchInventoryRepo
from ..service import InventoryManagementService
from core.config import settings

logger = logging.getLogger(__name__)


class BranchInventoryService:
    """Service for branch-specific inventory operations"""
    
    def __init__(self, branch_id: str, table_name: str):
        self.branch_id = branch_id
        self.table_name = table_name
        self.repo = BranchInventoryRepo(branch_id=branch_id, table_name=table_name)
        # Use the main inventory service to get the product list from Magento
        self._main_service = InventoryManagementService()
    
    def check_tables_status(self) -> Dict[str, Any]:
        """Check the status of branch inventory tables"""
        try:
            status = self.repo.check_tables_exist()
            all_exist = all(status.values())
            
            return {
                "status": "success",
                "tables_status": status,
                "all_tables_exist": all_exist,
                "branch": self.branch_id
            }
        except Exception as e:
            logger.error(f"Error checking tables for {self.branch_id}: {e}")
            return {
                "status": "error",
                "message": f"Failed to check tables: {str(e)}",
                "branch": self.branch_id
            }
    
    def get_inventory_items_from_magento(self, page: int = 1, per_page: int = 100, search: str = None, discontinued_status: str = None, show_orphaned: bool = False) -> Dict[str, Any]:
        """Get inventory items using main inventory service, merged with branch-specific metadata"""
        try:
            # Get products from the main inventory service (which syncs from Magento)
            main_result = self._main_service.get_inventory_items_from_magento(
                page=page,
                per_page=per_page,
                search=search,
                discontinued_status=discontinued_status,
                show_orphaned=show_orphaned
            )
            
            # Load branch-specific metadata
            branch_metadata = self.repo.load_inventory_metadata()
            branch_metadata_by_sku = {m["sku"]: m for m in branch_metadata}
            
            # Merge branch-specific metadata into items
            items = main_result.get("items", [])
            for item in items:
                sku = item.get("sku")
                if sku and sku in branch_metadata_by_sku:
                    branch_data = branch_metadata_by_sku[sku]
                    # Override with branch-specific metadata
                    for field in ['location', 'date', 'qty_ordered_jason', 'shelf_lt1', 'shelf_lt1_qty',
                                  'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                                  'status', 'uk_fr_preorder']:
                        if field in branch_data and branch_data[field] is not None:
                            item[field] = branch_data[field]
            
            main_result["branch"] = self.branch_id
            return main_result
            
        except Exception as e:
            logger.error(f"Error getting inventory items for {self.branch_id}: {e}")
            raise
    
    def get_inventory_items(self, page: int = 1, per_page: int = 100, search: str = None, discontinued_status: str = None, show_orphaned: bool = False) -> Dict[str, Any]:
        """Get inventory items with pagination and filtering"""
        return self.get_inventory_items_from_magento(
            page=page,
            per_page=per_page,
            search=search,
            discontinued_status=discontinued_status,
            show_orphaned=show_orphaned
        )
    
    def load_inventory_metadata(self) -> List[Dict[str, Any]]:
        """Load inventory metadata from branch table"""
        return self.repo.load_inventory_metadata()
    
    def save_inventory_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Save inventory metadata to branch table"""
        return self.repo.save_inventory_metadata(metadata)
    
    def get_categories(self) -> List[str]:
        """Get all inventory categories"""
        # Categories are typically loaded from Magento and are the same across all branches
        return []
    
    def get_suppliers(self) -> List[str]:
        """Get all suppliers"""
        # Suppliers are typically loaded from configuration
        return []
    
    def get_magento_products(self, status_filters: str = None) -> List[Dict[str, Any]]:
        """Get products from live Magento database"""
        # For now, return empty - can be implemented to share data with main inventory
        return []


__all__ = ['BranchInventoryService']
