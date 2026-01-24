from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
import requests
import json
import re

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

    def check_tables_status(self) -> Dict[str, Any]:
        """Check the status of inventory management tables"""
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
    
    def _populate_magento_data_for_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Populate uk_6m_data and fr_6m_data for items from aggregated_orders tables.
        Uses SKU to match magento data.
        
        MD variants are already merged in the aggregated orders tables.
        Other variants (SD, DP, NP, MV) are kept separate and not shown in inventory management.
        """
        try:
            # Get magento data from aggregated tables (MD already merged there)
            uk_data = self.repo.get_aggregated_data("uk")
            fr_data_raw = self.repo.get_aggregated_data("fr")
            nl_data_raw = self.repo.get_aggregated_data("nl")
            
            # Combine FR and NL data
            fr_data = {}
            for sku, qty in fr_data_raw.items():
                fr_data[sku] = fr_data.get(sku, 0) + qty
            for sku, qty in nl_data_raw.items():
                fr_data[sku] = fr_data.get(sku, 0) + qty
            
            # Populate items with magento data - direct lookup, no aggregation needed
            # (MD variants are already merged in aggregated tables)
            for item in items:
                sku = item.get("sku", "")
                
                # Direct lookup - aggregated tables already have MD merged
                uk_qty = uk_data.get(sku, 0)
                fr_qty = fr_data.get(sku, 0)
                
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
    
    def get_inventory_items_from_magento(self, page: int = 1, per_page: int = 100, search: str = None, discontinued_status: str = None, show_orphaned: bool = False) -> Dict[str, Any]:
        """Get inventory items from UK Magento database with pagination and search
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            search: Search query to filter items (searches product_name and sku)
            discontinued_status: Not used when pulling from Magento DB (kept for API compatibility)
            show_orphaned: If True, show SKUs that exist in inventory_metadata but not in Magento (default: False)
            
        Returns:
            Dict with items, total count, and pagination info
        """
        try:
            # Note: Table initialization is handled by frontend calling /status then /init if needed
            # This method assumes tables already exist
            
            # Step 1: Sync products from UK Magento database to inventory_metadata
            # This creates inventory_metadata records for any new products
            self.repo.sync_magento_products_to_inventory_metadata()
            
            # Step 2: Merge identifier products with their base SKUs in inventory_metadata
            # This must happen BEFORE generating item IDs
            self.repo.merge_identifier_products()
            
            # Step 3: Ensure all products have item IDs in inventory_metadata (after merging)
            self.repo.ensure_all_products_have_item_ids()
            
            # Step 4: Update variant_statuses array for all products
            # This aggregates discontinued_status values from all variants into the variant_statuses JSONB array
            self.repo.update_variant_statuses()
            
            # Step 5: Query inventory_metadata for all products (filtered by variant_statuses if requested)
            # Now includes product_name since it's stored in inventory_metadata
            conn = self.repo.get_metadata_connection()
            try:
                cursor = conn.cursor()
                
                # Build query with optional status filter - now includes product_name
                if discontinued_status and discontinued_status.strip():
                    allowed_statuses = [s.strip() for s in discontinued_status.split(",") if s.strip()]
                    cursor.execute("""
                        SELECT sku, variant_statuses, product_name
                        FROM inventory_metadata
                        WHERE sku IS NOT NULL
                        AND EXISTS (
                            SELECT 1 
                            FROM jsonb_array_elements_text(variant_statuses) AS s 
                            WHERE s = ANY(%s)
                        )
                        ORDER BY sku
                    """, (allowed_statuses,))
                else:
                    cursor.execute("""
                        SELECT sku, variant_statuses, product_name
                        FROM inventory_metadata
                        WHERE sku IS NOT NULL
                        ORDER BY sku
                    """)
                
                # Collect all SKUs, variant_statuses, and product_names from inventory_metadata
                metadata_products = []
                for row in cursor.fetchall():
                    sku = row[0]
                    variant_statuses_json = row[1]
                    product_name = row[2] or ""
                    variant_statuses = json.loads(variant_statuses_json) if isinstance(variant_statuses_json, str) else variant_statuses_json
                    metadata_products.append({
                        'sku': sku,
                        'variant_statuses': variant_statuses or ['Active'],
                        'product_name': product_name
                    })
            finally:
                self.repo.return_connection(conn)
            
            # Step 6: Build products list using stored product_name from inventory_metadata
            # Only need Magento for categories and additional_attributes (not for names anymore)
            magento_products = self.repo.get_magento_products(status_filters=None)
            identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
            
            # Build lookup dict: base_sku -> magento product details (for categories only)
            magento_by_base_sku = {}
            for product in magento_products:
                sku = product.get('sku', '')
                base_sku = identifier_pattern.sub('', sku) if identifier_pattern.search(sku) else sku
                if base_sku not in magento_by_base_sku:
                    magento_by_base_sku[base_sku] = product
            
            # Combine inventory_metadata products with Magento category data
            # Names now come from inventory_metadata.product_name (synced from Magento catalog)
            all_products = []
            orphaned_count = 0
            skus_without_names = []  # Track SKUs that need fallback (shouldn't happen often now)
            
            for meta_product in metadata_products:
                sku = meta_product['sku']
                stored_name = meta_product.get('product_name', '')
                magento_product = magento_by_base_sku.get(sku, {})
                
                # Use stored name from inventory_metadata (synced from Magento catalog)
                # This is much faster than querying Magento on every request
                product_name = stored_name
                
                # Track SKUs without names for fallback (rare - only for products not synced yet)
                if not product_name:
                    skus_without_names.append(sku)
                
                all_products.append({
                    'sku': sku,
                    'name': product_name,
                    'categories': magento_product.get('categories'),
                    'additional_attributes': magento_product.get('additional_attributes'),
                    'discontinued_status': magento_product.get('discontinued_status'),
                    'variant_statuses': meta_product['variant_statuses']
                })
            
            # Fallback 1: Try to get names from orders_cache (historical data)
            # This handles products deleted from Magento but present in history (fixes orphan discrepancy)
            if skus_without_names:
                logger.info(f"Loading names from orders_cache or {len(skus_without_names)} SKUs without names")
                cache_names = self.repo.get_names_from_orders_cache(skus_without_names)
                
                if cache_names:
                    logger.info(f"Found {len(cache_names)} names in orders_cache")
                    # Update products
                    for product in all_products:
                        if not product['name'] and product['sku'] in cache_names:
                            product['name'] = cache_names[product['sku']]
                    
                    # Re-calculate missing names
                    skus_without_names = [sku for sku in skus_without_names if sku not in cache_names]

            # Fallback 2: Load names from Magento catalog for remaining SKUs without names
            if skus_without_names:
                logger.info(f"Loading names from Magento catalog for {len(skus_without_names)} SKUs without names")
                magento_catalog_names = self.repo.get_magento_catalog_names(skus_without_names)
                logger.info(f"Magento catalog returned {len(magento_catalog_names)} names")
                
                # Update products with names from Magento catalog
                for product in all_products:
                    if not product['name'] and product['sku'] in magento_catalog_names:
                        product['name'] = magento_catalog_names[product['sku']]
                        logger.debug(f"Updated name for {product['sku']} from Magento catalog")
            
            # Now filter out orphaned products (those still without names after fallback)
            filtered_products = []
            for product in all_products:
                is_orphaned = not product.get('name')
                
                if is_orphaned and not show_orphaned:
                    logger.debug(f"Skipping orphaned SKU {product['sku']} (not in Magento but kept in inventory_metadata)")
                    orphaned_count += 1
                    continue
                
                filtered_products.append(product)
            
            all_products = filtered_products
            
            if orphaned_count > 0:
                logger.info(f"Filtered out {orphaned_count} orphaned SKUs (use show_orphaned=true to include)")
            logger.info(f"[INVENTORY DEBUG] After orphaned filtering: {len(all_products)} products (show_orphaned={show_orphaned}, orphaned_count={orphaned_count})")
            print(f"========== AFTER NORMALIZATION: {len(all_products)} base SKU products (show_orphaned={show_orphaned}) ==========")
            
            if not all_products:
                return {
                    "items": [],
                    "total": 0,
                    "page": page,
                    "per_page": per_page,
                    "total_pages": 0
                }
            
            # Status filtering is already done at SQL level above
            filtered_products = all_products
            
            # Apply search filter if provided
            if search and search.strip():
                search_lower = search.strip().lower()
                filtered_products = [
                    product for product in filtered_products
                    if (search_lower in (product.get("name") or "").lower() or
                        search_lower in (product.get("sku") or "").lower())
                ]
                logger.info(f"Search '{search}' filtered to {len(filtered_products)} products")
            
            total_items = len(filtered_products)
            total_pages = (total_items + per_page - 1) // per_page if total_items > 0 else 1
            
            logger.info(f"[INVENTORY DEBUG] Total items after all filters: {total_items}, requesting page {page}/{total_pages}, show_orphaned={show_orphaned}")
            
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
                
                # Calculate stock values from metadata
                shelf_lt1_qty = int(metadata.get("shelf_lt1_qty") or 0)
                shelf_gt1_qty = int(metadata.get("shelf_gt1_qty") or 0)
                top_floor_total = int(metadata.get("top_floor_total") or 0)
                
                # Calculate totals per documentation
                shelf_total = shelf_lt1_qty + shelf_gt1_qty
                reserve_stock = top_floor_total
                stock_on_hand = shelf_total + top_floor_total  # Reuse shelf_total calculation
                
                item = {
                    "item_id": metadata.get("item_id") or "",  # Get from inventory_metadata
                    "product_name": product.get("name") or "",  # Name from live Magento database
                    "sku": sku or "",
                    "stock_on_hand": stock_on_hand,  # Total of all locations
                    "location": metadata.get("location"),
                    "date": str(metadata.get("date")) if metadata.get("date") else None,
                    "qty_ordered_jason": metadata.get("qty_ordered_jason"),
                    "shelf_lt1": metadata.get("shelf_lt1"),
                    "shelf_lt1_qty": shelf_lt1_qty,
                    "shelf_gt1": metadata.get("shelf_gt1"),
                    "shelf_gt1_qty": shelf_gt1_qty,
                    "top_floor_expiry": str(metadata.get("top_floor_expiry")) if metadata.get("top_floor_expiry") else None,
                    "top_floor_total": top_floor_total,
                    "status": metadata.get("status"),
                    "uk_fr_preorder": metadata.get("uk_fr_preorder"),
                    "variant_statuses": product.get("variant_statuses") or [],  # All variant statuses merged from inventory_metadata
                    "custom_fields": {
                        "shelf_total": shelf_total,  # Combined shelf quantities
                        "reserve_stock": reserve_stock  # Top floor total
                    }
                }
                items.append(item)
            
            # Populate magento data from aggregated_orders tables
            items = self._populate_magento_data_for_items(items)
            
            logger.info(f"Returning page {page}/{total_pages}: items {start_idx+1}-{end_idx} of {total_items} (search: '{search or 'none'}', show_orphaned={show_orphaned})")
            
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
        DEPRECATED: Legacy method for fetching items from external API.
        This method is no longer used. Use get_inventory_items_from_magento() instead.
        Kept for reference only.
        """
        logger.warning("_fetch_all_items_legacy called - this method is deprecated")
        return []
    
    def get_inventory_items(self, page: int = 1, per_page: int = 100, search: str = None, discontinued_status: str = None, show_orphaned: bool = False) -> Dict[str, Any]:
        """Get inventory items from inventory_metadata joined with live Magento data
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            search: Search query to filter items (searches product_name and sku)
            discontinued_status: Comma-separated discontinued statuses to filter by
            show_orphaned: If True, show SKUs that exist in inventory_metadata but not in Magento (default: False)
            
        Returns:
            Dict with items, total count, and pagination info
        """
        return self.get_inventory_items_from_magento(page, per_page, search, discontinued_status, show_orphaned)

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

    # Legacy methods for compatibility
    def list_items(self, *, limit: int = 100, search: str = "", low_stock_only: bool = False) -> List[Dict[str, Any]]:
        """Legacy method - returns items from inventory_metadata"""
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

    def get_magento_products(self, status_filters: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get products from live Magento database, optionally filtered by status.
        
        Args:
            status_filters: Comma-separated list like "Active,Temporarily OOS,Pre Order,Samples"
        """
        return self.repo.get_magento_products(status_filters)
