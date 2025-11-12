from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
import requests

from .repo import InventoryManagementRepo
from core.config import settings

logger = logging.getLogger(__name__)

# Module-level cache for all items (shared across requests) - DEPRECATED, no longer used
_CACHED_ITEMS: Optional[List[Dict[str, Any]]] = None
_CACHE_TIMESTAMP: Optional[datetime] = None
_CACHE_TTL = 3600  # Cache for 1 hour


class InventoryManagementService:
    def __init__(self, repo: Optional[InventoryManagementRepo] = None):
        self.repo = repo or InventoryManagementRepo()
    
    def _populate_sales_data_for_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Populate uk_6m_data and fr_6m_data for items from condensed_sales tables.
        Uses SKU to match sales data.
        
        MD variants are already merged in the condensed sales tables.
        Other variants (SD, DP, NP, MV) are kept separate and not shown in inventory management.
        """
        try:
            # Get sales data from condensed tables (MD already merged there)
            uk_sales = self.repo.get_condensed_sales("uk")
            fr_sales_raw = self.repo.get_condensed_sales("fr")
            nl_sales_raw = self.repo.get_condensed_sales("nl")
            
            # Combine FR and NL sales
            fr_sales = {}
            for sku, qty in fr_sales_raw.items():
                fr_sales[sku] = fr_sales.get(sku, 0) + qty
            for sku, qty in nl_sales_raw.items():
                fr_sales[sku] = fr_sales.get(sku, 0) + qty
            
            # Populate items with sales data - direct lookup, no aggregation needed
            # (MD variants are already merged in condensed tables)
            for item in items:
                sku = item.get("sku", "")
                
                # Direct lookup - condensed tables already have MD merged
                uk_qty = uk_sales.get(sku, 0)
                fr_qty = fr_sales.get(sku, 0)
                
                # Add to custom_fields for compatibility
                if "custom_fields" not in item:
                    item["custom_fields"] = {}
                
                item["custom_fields"]["uk_6m_data"] = uk_qty
                item["custom_fields"]["fr_6m_data"] = fr_qty
            
            return items
            
        except Exception as e:
            logger.error(f"Error populating sales data: {e}", exc_info=True)
            # Return items unchanged if there's an error
            return items
    
    def get_inventory_items_from_magento(self, page: int = 1, per_page: int = 100, search: str = None, discontinued_status: str = None) -> Dict[str, Any]:
        """Get inventory items from magento_product_list table with pagination, search, and discontinued status filter
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            search: Search query to filter items (searches product_name and sku)
            discontinued_status: Comma-separated discontinued statuses to filter by (e.g., "Active,Pre Order")
            
        Returns:
            Dict with items, total count, and pagination info
        """
        try:
            # Step 0: Ensure tables exist (creates if not present)
            self.repo.init_tables()
            
            # Step 1: Sync products from magento_product_list to inventory_metadata
            # This creates inventory_metadata records for any new products
            self.repo.sync_magento_products_to_inventory_metadata()
            
            # Step 2: Merge identifier products with their base SKUs in inventory_metadata
            # This must happen BEFORE generating item IDs
            self.repo.merge_identifier_products()
            
            # Step 3: Ensure all products have item IDs in inventory_metadata (after merging)
            self.repo.ensure_all_products_have_item_ids()
            
            # Get all products from magento_product_list (with optional discontinued status filter)
            all_products = self.repo.get_magento_products(status_filters=discontinued_status)
            
            if not all_products:
                return {
                    "items": [],
                    "total": 0,
                    "page": page,
                    "per_page": per_page,
                    "total_pages": 0
                }
            
            # Filter out AW365 products (same logic as sync)
            filtered_products = [
                product for product in all_products
                if not (product.get("categories") and "AW365" in product.get("categories", "").upper())
            ]
            
            logger.info(f"Filtered out {len(all_products) - len(filtered_products)} AW365 products")
            
            # Apply search filter if provided
            if search and search.strip():
                search_lower = search.strip().lower()
                filtered_products = [
                    product for product in filtered_products
                    if (search_lower in (product.get("product_name") or "").lower() or
                        search_lower in (product.get("sku") or "").lower())
                ]
                logger.info(f"Search '{search}' filtered {len(all_products)} products to {len(filtered_products)} products")
            
            total_items = len(filtered_products)
            total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
            
            # Calculate slice indices
            start_idx = (page - 1) * per_page
            end_idx = min(start_idx + per_page, total_items)
            
            # Get the page slice
            paginated_products = filtered_products[start_idx:end_idx]
            
            # Load inventory_metadata to get item_ids
            metadata_records = self.repo.load_inventory_metadata()
            metadata_by_sku = {m["sku"]: m for m in metadata_records}
            
            # Transform to match expected format (merge with metadata)
            items = []
            for product in paginated_products:
                sku = product.get("sku")
                metadata = metadata_by_sku.get(sku, {})
                
                item = {
                    "item_id": metadata.get("item_id") or "",  # Get from inventory_metadata
                    "product_name": product.get("name") or "",  # Use 'name' column from magento_product_list
                    "sku": sku or "",
                    "stock_on_hand": 0,  # Will be calculated from metadata
                    "custom_fields": {
                        "shelf_total": None,
                        "reserve_stock": None
                    }
                }
                items.append(item)
            
            # Populate sales data from condensed_sales tables
            items = self._populate_sales_data_for_items(items)
            
            logger.info(f"Returning page {page}/{total_pages}: items {start_idx+1}-{end_idx} of {total_items} (search: '{search or 'none'}')")
            
            return {
                "items": items,
                "total": total_items,
                "page": page,
                "per_page": per_page,
                "total_pages": total_pages
            }

        except Exception as e:
            logger.error(f"Error fetching inventory items from magento: {e}", exc_info=True)
            return {
                "items": [],
                "total": 0,
                "page": page,
                "per_page": per_page,
                "total_pages": 0
            }
    
    def _fetch_all_items_legacy(self) -> List[Dict[str, Any]]:
        """
        DEPRECATED: Legacy method for fetching items from Zoho API.
        This method is no longer used. Use get_inventory_items_from_magento() instead.
        Kept for reference only.
        """
        logger.warning("_fetch_all_items_legacy called - this method is deprecated")
        return []
    
    def get_inventory_items(self, page: int = 1, per_page: int = 100, search: str = None, discontinued_status: str = None) -> Dict[str, Any]:
        """Get inventory items from magento_product_list table
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            search: Search query to filter items (searches product_name and sku)
            discontinued_status: Comma-separated discontinued statuses to filter by
            
        Returns:
            Dict with items, total count, and pagination info
        """
        return self.get_inventory_items_from_magento(page, per_page, search, discontinued_status)

    def _get_custom_field_value(self, item: Dict[str, Any], field_name: str) -> Optional[str]:
        """DEPRECATED: Extract custom field value from item (legacy method)"""
        for field in item.get("custom_fields", []):
            if field.get("label") == field_name:
                return field.get("value")
        return None

    def load_inventory_metadata(self) -> List[Dict[str, Any]]:
        """Load inventory metadata from PostgreSQL"""
        try:
            return self.repo.load_inventory_metadata()
        except Exception as e:
            logger.error(f"Error loading inventory metadata: {e}")
            return []

    def save_inventory_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Save inventory metadata - now uses SKU as primary key"""
        try:
            sku = metadata.get('sku')
            if not sku:
                # Try to get from item_id if legacy call
                item_id = metadata.get('item_id')
                if item_id:
                    raise ValueError("Please provide SKU instead of item_id")
                raise ValueError("Missing SKU")

            # Save to local PostgreSQL
            saved_metadata = self.repo.save_inventory_metadata(metadata)

            # Calculate total stock
            total_stock = (
                metadata.get('shelf_lt1_qty', 0) + 
                metadata.get('shelf_gt1_qty', 0) + 
                metadata.get('top_floor_total', 0)
            )

            # Note: Zoho sync is removed as we now use magento_product_list
            logger.info(f"Metadata saved for SKU {sku}, total_stock: {total_stock}")

            return {
                "status": "success",
                "message": "Metadata saved",
                "metadata": saved_metadata,
                "total_stock": total_stock
            }

        except Exception as e:
            logger.error(f"Error saving inventory metadata: {e}")
            raise

    def _sync_shelf_total_legacy(self, item_id: str, total_stock: int) -> None:
        """
        DEPRECATED: Legacy method to sync shelf total to Zoho.
        No longer used as we now use magento_product_list.
        Kept for reference only.
        """
        logger.warning("_sync_shelf_total_legacy called - this method is deprecated and does nothing")
        return

    def live_inventory_sync_legacy(self, item_id: str, new_quantity: int, reason: str = "Inventory Re-evaluation") -> Dict[str, Any]:
        """
        DEPRECATED: Legacy method to perform live inventory sync with Zoho.
        No longer used as we now use magento_product_list.
        Kept for reference only.
        """
        logger.warning("live_inventory_sync_legacy called - this method is deprecated")
        raise NotImplementedError("Live inventory sync is no longer supported. Inventory is now managed via magento_product_list.")

    # Legacy methods for compatibility
    def list_items(self, *, limit: int = 100, search: str = "", low_stock_only: bool = False) -> List[Dict[str, Any]]:
        """Legacy method - returns items from magento_product_list"""
        result = self.get_inventory_items(page=1, per_page=limit, search=search)
        items = result.get("items", [])
        
        if low_stock_only:
            # Filter items with low stock (placeholder logic)
            items = [item for item in items if item.get('stock_on_hand', 0) < 10]
        
        return items

    def get_categories(self) -> List[str]:
        """Legacy method - placeholder"""
        return ["Electronics", "Clothing", "Books", "Other"]

    def get_suppliers(self) -> List[str]:
        """Legacy method - placeholder"""
        return ["Supplier A", "Supplier B", "Supplier C"]

    def sync_items_to_magento_product_list(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Sync inventory items to magento_product_list table.
        Can be used to import items from any source (CSV, API, etc.)
        Updates SKU, name, item_id, and discontinued_status.
        """
        try:
            logger.info("Starting sync to magento_product_list...")
            
            if not items:
                return {
                    "status": "error",
                    "message": "No items provided for sync",
                    "stats": {}
                }
            
            # Sync to database
            stats = self.repo.sync_items_to_magento_product_list(items)
            
            return {
                "status": "success",
                "message": f"Synced {stats['total_items']} items",
                "stats": stats
            }
            
        except Exception as e:
            logger.error(f"Error syncing to magento_product_list: {e}")
            return {
                "status": "error",
                "message": f"Sync failed: {str(e)}",
                "stats": {}
            }

    def update_discontinued_status_from_additional_attributes(self) -> Dict[str, int]:
        """
        Parse discontinued_status from additional_attributes field.
        Returns stats about the update operation.
        """
        return self.repo.update_discontinued_status_from_additional_attributes()

    def get_magento_products(self, status_filters: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get products from magento_product_list table, optionally filtered by status.
        
        Args:
            status_filters: Comma-separated list like "Active,Temporarily OOS,Pre Order,Samples"
        """
        return self.repo.get_magento_products(status_filters)
