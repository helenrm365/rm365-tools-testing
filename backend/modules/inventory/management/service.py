from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging
import requests

from .repo import InventoryManagementRepo
from modules._integrations.zoho.client import get_cached_inventory_token
from core.config import settings

logger = logging.getLogger(__name__)


class InventoryManagementService:
    def __init__(self, repo: Optional[InventoryManagementRepo] = None):
        self.repo = repo or InventoryManagementRepo()
        self.zoho_org_id = settings.ZC_ORG_ID

    def get_zoho_inventory_items(self) -> List[Dict[str, Any]]:
        """Get inventory items from Zoho Inventory API"""
        try:
            inventory_token = get_cached_inventory_token()
            if not inventory_token:
                logger.error("Failed to get Zoho inventory token")
                return []

            headers = {
                "Authorization": f"Zoho-oauthtoken {inventory_token}"
            }

            all_items = []
            page = 1
            per_page = 200

            while True:
                url = f"https://www.zohoapis.eu/inventory/v1/items"
                params = {
                    "organization_id": self.zoho_org_id,
                    "page": page,
                    "per_page": per_page
                }
                
                response = requests.get(url, headers=headers, params=params)
                data = response.json()

                if data.get("code") != 0:
                    logger.error(f"Zoho API error: {data}")
                    break

                items = data.get("items", [])
                for item in items:
                    # Parse custom fields properly
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

                if len(items) < per_page:
                    break
                page += 1

            return all_items

        except Exception as e:
            logger.error(f"Error fetching Zoho inventory items: {e}")
            return []

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
