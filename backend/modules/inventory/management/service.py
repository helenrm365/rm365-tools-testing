from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
import requests
import threading

from .repo import InventoryManagementRepo
from modules._integrations.zoho.client import get_cached_inventory_token
from core.config import settings

logger = logging.getLogger(__name__)

# Module-level cache for total count only (lightweight)
_CACHED_TOTAL: Optional[int] = None
_TOTAL_CACHE_TIMESTAMP: Optional[datetime] = None
_TOTAL_CACHE_TTL = 3600  # Cache total count for 1 hour
_COUNTING_IN_PROGRESS = False  # Flag to prevent duplicate counting


class InventoryManagementService:
    def __init__(self, repo: Optional[InventoryManagementRepo] = None):
        self.repo = repo or InventoryManagementRepo()
        self.zoho_org_id = settings.ZC_ORG_ID
    
    def _count_total_in_background(self):
        """Count total items in background thread"""
        global _CACHED_TOTAL, _TOTAL_CACHE_TIMESTAMP, _COUNTING_IN_PROGRESS
        
        try:
            logger.info("Background: Starting total count from Zoho...")
            inventory_token = get_cached_inventory_token()
            if not inventory_token:
                _COUNTING_IN_PROGRESS = False
                return
            
            headers = {"Authorization": f"Zoho-oauthtoken {inventory_token}"}
            url = f"https://www.zohoapis.eu/inventory/v1/items"
            
            total = 0
            zoho_page = 1
            
            while True:
                params = {
                    "organization_id": self.zoho_org_id,
                    "page": zoho_page,
                    "per_page": 200
                }
                
                response = requests.get(url, headers=headers, params=params, timeout=5)
                data = response.json()
                
                if data.get("code") != 0:
                    logger.error(f"Background count error on page {zoho_page}: {data}")
                    break
                
                items = data.get("items", [])
                total += len(items)
                
                page_context = data.get("page_context", {})
                has_more = page_context.get("has_more_page", False)
                
                if zoho_page % 5 == 0:  # Log every 5 pages
                    logger.info(f"Background counting: page {zoho_page}, total so far: {total}")
                
                if not has_more or len(items) == 0:
                    break
                
                zoho_page += 1
            
            # Update cache
            _CACHED_TOTAL = total
            _TOTAL_CACHE_TIMESTAMP = datetime.now()
            _COUNTING_IN_PROGRESS = False
            logger.info(f"Background count complete: {total} items cached")
            
        except Exception as e:
            logger.error(f"Background count error: {e}")
            _COUNTING_IN_PROGRESS = False
    
    def _get_total_count_fast(self) -> int:
        """Get total count - returns estimate immediately, calculates exact count in background"""
        global _CACHED_TOTAL, _TOTAL_CACHE_TIMESTAMP, _COUNTING_IN_PROGRESS
        
        # Return cached total if available and valid
        if (_CACHED_TOTAL is not None and 
            _TOTAL_CACHE_TIMESTAMP is not None and 
            datetime.now() - _TOTAL_CACHE_TIMESTAMP < timedelta(seconds=_TOTAL_CACHE_TTL)):
            return _CACHED_TOTAL
        
        # Start background counting if not already in progress
        if not _COUNTING_IN_PROGRESS:
            _COUNTING_IN_PROGRESS = True
            thread = threading.Thread(target=self._count_total_in_background, daemon=True)
            thread.start()
            logger.info("Started background thread to count total items")
        
        # Return cached value if available (even if expired), otherwise return conservative estimate
        if _CACHED_TOTAL is not None:
            logger.info(f"Returning stale cached total while recounting: {_CACHED_TOTAL}")
            return _CACHED_TOTAL
        
        # No cache at all - return conservative estimate
        logger.info("No cache available, returning estimate of 2000")
        return 2000  # Conservative estimate
    
    def get_zoho_inventory_items(self, page: int = 1, per_page: int = 100) -> Dict[str, Any]:
        """Get inventory items from Zoho Inventory API with pagination (fast, no full cache)
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            
        Returns:
            Dict with items, total count, and pagination info
        """
        try:
            inventory_token = get_cached_inventory_token()
            if not inventory_token:
                logger.error("Failed to get Zoho inventory token")
                return {
                    "items": [],
                    "total": 0,
                    "page": page,
                    "per_page": per_page,
                    "total_pages": 0
                }

            headers = {"Authorization": f"Zoho-oauthtoken {inventory_token}"}
            url = f"https://www.zohoapis.eu/inventory/v1/items"
            
            # Get total count (returns immediately with estimate or cached value)
            total_items = self._get_total_count_fast()
            total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
            
            # Zoho uses 200 items per page max
            zoho_per_page = 200
            
            # Calculate which Zoho page(s) contain our requested items
            start_item = (page - 1) * per_page + 1
            end_item = page * per_page
            
            zoho_start_page = ((start_item - 1) // zoho_per_page) + 1
            zoho_end_page = ((end_item - 1) // zoho_per_page) + 1
            
            all_items = []
            
            # Fetch only the Zoho pages we need
            for zoho_page in range(zoho_start_page, zoho_end_page + 1):
                params = {
                    "organization_id": self.zoho_org_id,
                    "page": zoho_page,
                    "per_page": zoho_per_page
                }
                
                response = requests.get(url, headers=headers, params=params, timeout=5)
                data = response.json()

                if data.get("code") != 0:
                    logger.error(f"Zoho API error on page {zoho_page}: {data}")
                    break

                items = data.get("items", [])
                logger.info(f"Fetched {len(items)} items from Zoho page {zoho_page}")
                
                for item in items:
                    shelf_total = self._get_custom_field_value(item, "Shelf Total")
                    reserve_stock = self._get_custom_field_value(item, "Reserve Stock")
                    
                    all_items.append({
                        "item_id": item.get("item_id"),
                        "product_name": item.get("name"),
                        "sku": item.get("sku"),
                        "stock_on_hand": item.get("stock_on_hand"),
                        "custom_fields": {
                            "shelf_total": int(shelf_total) if shelf_total and shelf_total.isdigit() else None,
                            "reserve_stock": int(reserve_stock) if reserve_stock and reserve_stock.isdigit() else None
                        }
                    })
            
            # Slice to get exact items for this page
            offset = (start_item - 1) % (zoho_per_page * (zoho_end_page - zoho_start_page + 1))
            paginated_items = all_items[offset:offset + per_page]
            
            logger.info(f"Returning {len(paginated_items)} items for page {page}/{total_pages}, total: {total_items}")
            
            return {
                "items": paginated_items,
                "total": total_items,
                "page": page,
                "per_page": per_page,
                "total_pages": total_pages
            }

        except Exception as e:
            logger.error(f"Error fetching inventory items: {e}", exc_info=True)
            return {
                "items": [],
                "total": 0,
                "page": page,
                "per_page": per_page,
                "total_pages": 0
            }

    def _get_custom_field_value(self, item: Dict[str, Any], field_name: str) -> Optional[str]:
        """Extract custom field value from Zoho item"""
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
        """Save inventory metadata and sync total stock to Zoho"""
        try:
            if not metadata.get('item_id'):
                raise ValueError("Missing item_id")

            # Save to local PostgreSQL
            saved_metadata = self.repo.save_inventory_metadata(metadata)

            # Calculate total stock for Zoho sync
            total_stock = (
                metadata.get('shelf_lt1_qty', 0) + 
                metadata.get('shelf_gt1_qty', 0) + 
                metadata.get('top_floor_total', 0)
            )

            # Sync actual stock quantity to Zoho Inventory
            try:
                sync_result = self.live_inventory_sync(
                    item_id=metadata['item_id'], 
                    new_quantity=total_stock,
                    reason="Shelf count adjustment from RM365"
                )
                logger.info(f"Successfully synced stock to Zoho: {sync_result}")
            except Exception as sync_error:
                logger.warning(f"Failed to sync stock to Zoho: {sync_error}")
                # Don't fail the whole operation if Zoho sync fails

            return {
                "status": "success",
                "message": "Metadata saved and synced",
                "metadata": saved_metadata,
                "total_stock": total_stock
            }

        except Exception as e:
            logger.error(f"Error saving inventory metadata: {e}")
            raise

    def _sync_shelf_total_to_zoho(self, item_id: str, total_stock: int) -> None:
        """Sync the shelf total back to Zoho as a custom field"""
        try:
            token = get_cached_inventory_token()
            if not token:
                logger.warning("No Zoho token available for sync")
                return

            headers = {
                "Authorization": f"Zoho-oauthtoken {token}",
                "Content-Type": "application/json"
            }

            sync_payload = {
                "custom_fields": [
                    {"label": "Shelf Total", "value": str(total_stock)}
                ]
            }

            url = f"https://www.zohoapis.eu/inventory/v1/items/{item_id}"
            params = {"organization_id": self.zoho_org_id}
            
            response = requests.put(url, headers=headers, json=sync_payload, params=params)
            
            if response.status_code == 200:
                logger.info(f"Successfully synced shelf total to Zoho for item {item_id}")
            else:
                logger.warning(f"Failed to sync to Zoho: {response.status_code} - {response.text}")

        except Exception as e:
            logger.error(f"Error syncing shelf total to Zoho: {e}")

    def live_inventory_sync(self, item_id: str, new_quantity: int, reason: str = "Inventory Re-evaluation") -> Dict[str, Any]:
        """Perform live inventory sync - adjust Zoho stock directly"""
        try:
            token = get_cached_inventory_token()
            if not token:
                raise ValueError("Invalid Zoho token")

            headers = {
                "Authorization": f"Zoho-oauthtoken {token}",
                "Content-Type": "application/json"
            }

            # Step 1: Get current stock_on_hand from Zoho
            item_url = f"https://www.zohoapis.eu/inventory/v1/items/{item_id}"
            params = {"organization_id": self.zoho_org_id}
            
            item_resp = requests.get(item_url, headers=headers, params=params)
            item_data = item_resp.json()
            
            if item_resp.status_code != 200 or item_data.get("code") != 0:
                raise ValueError(f"Failed to fetch current stock: {item_data}")
            
            current_qty = item_data.get("item", {}).get("stock_on_hand", 0)
            diff = new_quantity - current_qty
            
            if diff == 0:
                return {"detail": "No adjustment needed", "stock_on_hand": current_qty}

            # Step 2: Perform inventory adjustment
            adj_url = f"https://www.zohoapis.eu/inventory/v1/inventoryadjustments"
            payload = {
                "date": datetime.now().strftime("%Y-%m-%d"),
                "reason": reason,
                "line_items": [{
                    "item_id": item_id,
                    "quantity_adjusted": diff
                }]
            }

            response = requests.post(adj_url, headers=headers, json=payload, params=params)
            result = response.json()
            
            if response.status_code != 201 or result.get("code") != 0:
                raise ValueError(f"Adjustment failed: {result}")
            
            return {
                "detail": f"Stock adjusted by {diff}",
                "new_stock_on_hand": new_quantity,
                "adjustment_id": result.get("inventoryadjustment", {}).get("inventoryadjustment_id")
            }

        except Exception as e:
            logger.error(f"Error in live inventory sync: {e}")
            raise

    # Legacy methods for compatibility
    def list_items(self, *, limit: int = 100, search: str = "", low_stock_only: bool = False) -> List[Dict[str, Any]]:
        """Legacy method - returns Zoho items"""
        items = self.get_zoho_inventory_items()
        
        if search:
            search_lower = search.lower()
            items = [item for item in items if 
                    search_lower in item.get('product_name', '').lower() or
                    search_lower in item.get('sku', '').lower()]
        
        return items[:limit]

    def get_categories(self) -> List[str]:
        """Legacy method - placeholder"""
        return ["Electronics", "Clothing", "Books", "Other"]

    def get_suppliers(self) -> List[str]:
        """Legacy method - placeholder"""
        return ["Supplier A", "Supplier B", "Supplier C"]

    def sync_zoho_to_magento_product_list(self) -> Dict[str, Any]:
        """
        Sync Zoho inventory items to magento_product_list table.
        Fetches all items from Zoho and updates the magento_product_list table
        with SKU, name, item_id, and discontinued_status.
        """
        try:
            logger.info("Starting Zoho to magento_product_list sync...")
            
            # Fetch all items from Zoho
            zoho_items = self.get_zoho_inventory_items()
            
            if not zoho_items:
                return {
                    "status": "error",
                    "message": "No items fetched from Zoho",
                    "stats": {}
                }
            
            # Sync to database
            stats = self.repo.sync_zoho_to_magento_product_list(zoho_items)
            
            return {
                "status": "success",
                "message": f"Synced {stats['total_items']} items from Zoho",
                "stats": stats
            }
            
        except Exception as e:
            logger.error(f"Error syncing Zoho to magento_product_list: {e}")
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
