# modules/labels/repo.py
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import logging
from common.deps import products_conn
from modules.magentodata.db import get_magento_connection

logger = logging.getLogger(__name__)
log = logging.getLogger("labels")


class LabelsRepo:
    # --- helpers (suffix/base) ---
    @staticmethod
    def _base_of(sku: str) -> str:
        """
        Get base SKU by stripping ALL identifier suffixes (-MD, -SD, -DP, -NP, -MV).
        Matches inventory management logic - all variants normalize to base SKU.
        
        Examples:
        - PROD123 -> PROD123
        - PROD123-MD -> PROD123
        - PROD123-SD-2024 -> PROD123
        - PROD123-DP -> PROD123
        - AB-123 -> AB-123 (not split on first dash)
        """
        import re
        if not sku:
            return ""
        # Pattern to match all identifier suffixes with optional -xxxx extension
        pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
        return pattern.sub('', sku).strip()

    @classmethod
    def _choose_sku_for_base(cls, base: str, variants: List[str]) -> Optional[str]:
        """
        ALWAYS return the base SKU (with all identifier suffixes stripped).
        This matches inventory management logic which normalizes ALL variants to base.
        
        Why: The aggregated_orders tables strip suffixes via SQL regex, so:
        - If catalog has PROD123-MD/SD/DP/NP/MV, aggregated table has PROD123
        - If catalog has PROD123, aggregated table has PROD123
        - We must ALWAYS query by base SKU to match aggregated data
        
        Similarly, inventory_metadata normalizes all variants:
        - Deletes variant if base exists
        - Renames variant to base if base doesn't exist
        - So inventory_metadata only has base SKUs after normalization
        
        Args:
            base: Base SKU (with all suffixes already stripped by _base_of)
            variants: List of SKU variants in this group (unused - base always wins)
        
        Returns:
            Always returns base SKU (never variant)
        """
        return base if base else None

    # --- psycopg2 queries ---
    # _fetch_allowed_skus_from_magento_psycopg REMOVED - now using inventory_metadata

    # DEPRECATED: No longer used - 6M data now comes from aggregated_orders tables directly
    # def _load_inventory_metadata_map(self, inventory_conn) -> Dict[str, Tuple[str, str, str]]:
    #     """Old method that loaded 6M data from inventory_metadata table"""
    #     pass

    def _load_6m_data_from_aggregated_tables(self, conn) -> Dict[str, Tuple[str, str]]:
        """
        Load 6M data directly from aggregated_orders tables (same as inventory management).
        Returns mapping: sku -> (uk_6m_qty, fr_6m_qty)
        
        FR 6M data combines fr_aggregated_orders + nl_aggregated_orders (same logic as inventory management).
        
        Args:
            conn: Connection to products database (where aggregated tables live)
            
        Returns:
            Dict mapping SKU to tuple of (uk_6m, fr_6m) quantities as strings
        """
        data_map = {}
        
        try:
            # Fetch UK 6M data
            uk_data = {}
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT sku, total_qty
                    FROM uk_aggregated_orders
                    WHERE sku IS NOT NULL
                """)
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    qty = int(row[1] or 0)
                    uk_data[sku] = qty
            
            # Fetch FR 6M data
            fr_data = {}
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT sku, total_qty
                    FROM fr_aggregated_orders
                    WHERE sku IS NOT NULL
                """)
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    qty = int(row[1] or 0)
                    fr_data[sku] = qty
            
            # Fetch NL 6M data and combine with FR
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT sku, total_qty
                    FROM nl_aggregated_orders
                    WHERE sku IS NOT NULL
                """)
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    qty = int(row[1] or 0)
                    fr_data[sku] = fr_data.get(sku, 0) + qty
            
            # Combine all SKUs
            all_skus = set(uk_data.keys()) | set(fr_data.keys())
            for sku in all_skus:
                uk_qty = str(uk_data.get(sku, 0))
                fr_qty = str(fr_data.get(sku, 0))
                data_map[sku] = (uk_qty, fr_qty)
            
            logger.info(f"Loaded 6M data for {len(data_map)} SKUs from aggregated tables")
        except Exception as e:
            logger.error(f"Failed to load 6M data from aggregated tables: {e}")
            
        return data_map
    
    def _load_inventory_item_ids(self, inventory_conn) -> Dict[str, str]:
        """
        Load item_id mapping from inventory_metadata: sku -> item_id
        Item IDs are used as barcodes on labels.
        
        Args:
            inventory_conn: Connection to inventory database
            
        Returns:
            Dict mapping SKU to item_id
        """
        item_id_map = {}
        try:
            with inventory_conn.cursor() as cur:
                cur.execute("""
                    SELECT sku, item_id
                    FROM inventory_metadata
                    WHERE sku IS NOT NULL 
                      AND item_id IS NOT NULL
                """)
                
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    item_id = str(row[1]).strip()
                    item_id_map[sku] = item_id
                    
            logger.info(f"Loaded {len(item_id_map)} item IDs from inventory_metadata")
        except Exception as e:
            logger.error(f"Failed to load item IDs from inventory_metadata: {e}")
            
        return item_id_map
    
    def _load_latest_prices_psycopg(self, conn, skus: List[str], preferred_region: str = "uk") -> Dict[str, str]:
        """
        Return { sku: price } with the most recent price from magento data.
        Checks uk_orders_cache, fr_orders_cache, and nl_orders_cache.
        Queries each table separately to avoid timeout issues.
        
        Args:
            conn: Database connection
            skus: List of SKUs to get prices for
            preferred_region: "uk" (default), "fr", or "nl" - determines price priority
        """
        if not skus:
            return {}
        
        prices = {}
        
        # Currency mapping for regions
        region_currency_map = {
            'uk': 'GBP',
            'fr': 'EUR', 
            'nl': 'EUR'
        }
        
        # Query order based on preferred region (preferred region first)
        tables = [
            (f'{preferred_region}_orders_cache', preferred_region),
            ('uk_orders_cache', 'uk'),
            ('fr_orders_cache', 'fr'),
            ('nl_orders_cache', 'nl')
        ]
        # Remove duplicates while preserving order
        seen = set()
        tables = [(t, r) for t, r in tables if not (t in seen or seen.add(t))]
        
        logger.info(f"Looking up prices for {len(skus)} SKUs. Sample SKUs: {skus[:5]}")
        
        with conn.cursor() as cur:
            for table_name, region in tables:
                try:
                    # Get latest price for each SKU from this table
                    cur.execute(f"""
                        SELECT DISTINCT ON (sku) 
                            sku, 
                            COALESCE(special_price, original_price) as price,
                            COALESCE(currency, %s) as currency
                        FROM {table_name}
                        WHERE sku = ANY(%s) 
                          AND (original_price IS NOT NULL OR special_price IS NOT NULL)
                        ORDER BY sku, created_at DESC
                    """, (region_currency_map[region], skus))
                    
                    for row in cur.fetchall():
                        sku = str(row[0]).strip()
                        price = float(row[1]) if row[1] else 0.00
                        currency = str(row[2]) if len(row) > 2 else region_currency_map[region]
                        
                        # Only set if not already found (preferred region wins)
                        if sku not in prices and price > 0:
                            currency_symbol = "£" if currency == "GBP" else "€"
                            prices[sku] = f"{currency_symbol}{price:.2f}"
                    
                    logger.debug(f"Loaded {len([s for s in skus if s in prices])} prices from {table_name}")
                except Exception as e:
                    logger.debug(f"Could not fetch prices from {table_name}: {e}")
                    continue
        
        logger.info(f"Loaded prices for {len(prices)}/{len(skus)} SKUs. Sample prices: {list(prices.items())[:5]}")
        return prices

    def _load_product_names_psycopg(self, conn, skus: List[str], preferred_region: str = "uk") -> Dict[str, str]:
        """
        Return { sku: product_name } with the most recent product name from magento data.
        Prioritizes preferred region, then falls back to other regions.
        If no name found in orders_cache, falls back to Magento catalog.
        Queries each table separately to avoid timeout issues.
        
        Args:
            conn: Database connection to products database (for orders_cache)
            skus: List of SKUs to get names for
            preferred_region: "uk" (default), "fr", or "nl" - determines name priority
        """
        if not skus:
            return {}
        
        names = {}
        
        # Query order based on preferred region (preferred region first)
        tables = [
            f'{preferred_region}_orders_cache',
            'uk_orders_cache',
            'fr_orders_cache',
            'nl_orders_cache'
        ]
        # Remove duplicates while preserving order
        tables = list(dict.fromkeys(tables))
        
        # Try to get names from orders_cache tables
        with conn.cursor() as cur:
            for table_name in tables:
                try:
                    # Get latest product name for each SKU from this table
                    cur.execute(f"""
                        SELECT DISTINCT ON (sku) 
                            sku, 
                            name
                        FROM {table_name}
                        WHERE sku = ANY(%s) 
                          AND name IS NOT NULL 
                          AND name != ''
                        ORDER BY sku, created_at DESC
                    """, (skus,))
                    
                    for row in cur.fetchall():
                        sku = str(row[0]).strip()
                        name = str(row[1]).strip() if row[1] else ""
                        
                        # Only set if not already found (preferred region wins)
                        if sku not in names and name:
                            names[sku] = name
                    
                    logger.debug(f"Loaded {len([s for s in skus if s in names])} names from {table_name}")
                except Exception as e:
                    logger.debug(f"Could not fetch names from {table_name}: {e}")
                    continue
        
        # Fallback: Load names from Magento catalog for SKUs not found in orders_cache
        skus_without_names = [sku for sku in skus if sku not in names]
        if skus_without_names:
            logger.info(f"Loading names from Magento catalog for {len(skus_without_names)} SKUs not found in orders_cache: {skus_without_names[:10]}")
            magento_names = self._load_product_names_from_magento(skus_without_names)
            logger.info(f"Magento catalog returned {len(magento_names)} names")
            names.update(magento_names)
        
        logger.info(f"Loaded names for {len(names)}/{len(skus)} SKUs (from orders_cache + Magento fallback)")
        if len(names) < len(skus):
            missing = [sku for sku in skus if sku not in names]
            logger.warning(f"Still missing names for {len(missing)} SKUs: {missing[:10]}")
        
        return names
    
    def _load_product_names_from_magento(self, skus: List[str]) -> Dict[str, str]:
        """
        Load product names directly from UK Magento catalog as a fallback.
        Used when products don't have names in orders_cache (i.e., never been ordered).
        
        For base SKUs that don't exist in Magento (because they were merged from variants),
        searches for variants and uses their names, trimming " - Special Offer" if present.
        
        Args:
            skus: List of base SKUs to get names for
        
        Returns:
            Dict mapping SKU to product name from Magento catalog
        """
        if not skus:
            return {}
        
        names = {}
        
        try:
            conn = get_magento_connection("uk")
            with conn.cursor() as cur:
                # First, try exact base SKU matches
                cur.execute("""
                    SELECT DISTINCT
                        cpe.sku,
                        cpev_name.value as name
                    FROM catalog_product_entity cpe
                    LEFT JOIN catalog_product_entity_varchar cpev_name 
                        ON cpe.entity_id = cpev_name.entity_id
                        AND cpev_name.attribute_id = (
                            SELECT attribute_id 
                            FROM eav_attribute 
                            WHERE attribute_code = 'name' 
                            AND entity_type_id = (
                                SELECT entity_type_id 
                                FROM eav_entity_type 
                                WHERE entity_type_code = 'catalog_product'
                            )
                        )
                        AND cpev_name.store_id = 0
                    WHERE cpe.sku IN %s
                        AND cpev_name.value IS NOT NULL
                        AND cpev_name.value != ''
                """, (tuple(skus),))
                
                for row in cur.fetchall():
                    sku = str(row['sku']).strip() if row.get('sku') else ""
                    name = str(row['name']).strip() if row.get('name') else ""
                    if name and sku:
                        names[sku] = name
                
                logger.info(f"Found {len(names)} exact base SKU matches in Magento")
                
                # For missing base SKUs, search for their variants
                still_missing = [sku for sku in skus if sku not in names]
                if still_missing:
                    logger.info(f"Searching for variants of {len(still_missing)} base SKUs")
                    
                    # Build query to find any SKU that starts with base SKU + dash
                    like_conditions = " OR ".join(["cpe.sku LIKE %s"] * len(still_missing))
                    like_params = [f"{sku}-%" for sku in still_missing]
                    
                    variant_query = f"""
                        SELECT DISTINCT
                            cpe.sku,
                            cpev_name.value as name
                        FROM catalog_product_entity cpe
                        LEFT JOIN catalog_product_entity_varchar cpev_name 
                            ON cpe.entity_id = cpev_name.entity_id
                            AND cpev_name.attribute_id = (
                                SELECT attribute_id 
                                FROM eav_attribute 
                                WHERE attribute_code = 'name' 
                                AND entity_type_id = (
                                    SELECT entity_type_id 
                                    FROM eav_entity_type 
                                    WHERE entity_type_code = 'catalog_product'
                                )
                            )
                            AND cpev_name.store_id = 0
                        WHERE ({like_conditions})
                            AND cpev_name.value IS NOT NULL
                            AND cpev_name.value != ''
                    """
                    
                    cur.execute(variant_query, tuple(like_params))
                    
                    for row in cur.fetchall():
                        variant_sku = str(row['sku']).strip() if row.get('sku') else ""
                        name = str(row['name']).strip() if row.get('name') else ""
                        if name and variant_sku:
                            # Clean the name - trim " - Special Offer" from the end
                            cleaned_name = name
                            if cleaned_name.endswith(" - Special Offer"):
                                cleaned_name = cleaned_name[:-len(" - Special Offer")].strip()
                            
                            # Map the base SKU to this variant's cleaned name
                            base = self._base_of(variant_sku)
                            if base not in names:
                                names[base] = cleaned_name
                                logger.debug(f"Found variant {variant_sku} -> base {base}: {cleaned_name}")
                    
                    logger.info(f"Found {len([s for s in still_missing if s in names])} names from variants")
            
            logger.info(f"Total: Loaded {len(names)}/{len(skus)} product names from Magento catalog")
        except Exception as e:
            logger.error(f"Failed to load names from Magento catalog: {e}", exc_info=True)
        
        return names

    def _resolve_to_rows(
        self,
        inventory_conn,  # for inventory_metadata (item IDs)
        candidate_skus: List[str],
        preferred_region: str = "uk",  # region preference for price/name selection
        show_orphaned: bool = False,  # whether to include orphaned SKUs
    ) -> List[Dict[str, Any]]:
        """
        Process SKUs: normalize all variants to base SKU, fetch item IDs, 6M data, prices, and names.
        Uses same logic as inventory management:
        - Item IDs from inventory_metadata (normalized to base SKUs)
        - 6M data from aggregated_orders tables (UK, FR+NL combined)
        - Prices/names from magento orders_cache tables
        - ALL variants (MD, SD, DP, NP, MV) normalize to base SKU
        
        Args:
            inventory_conn: Connection to inventory_logs database (for inventory_metadata)
            candidate_skus: List of base SKUs to process (already normalized)
            preferred_region: Region preference for pricing (uk/fr/nl)
            show_orphaned: If True, include SKUs without names (not in Magento)
        """
        if not candidate_skus:
            return []

        # Load item IDs from inventory_metadata
        item_id_map = self._load_inventory_item_ids(inventory_conn)
        if not item_id_map:
            logger.warning("No item IDs found in inventory_metadata. Ensure inventory sync has run.")
            return []

        # Load 6M data from aggregated tables (same as inventory management)
        with products_conn() as prod_conn:
            sixm_data_map = self._load_6m_data_from_aggregated_tables(prod_conn)

        # Group by base SKU (all variants will normalize)
        grouped: Dict[str, List[str]] = {}
        for sku in candidate_skus:
            base = self._base_of(sku)
            grouped.setdefault(base, []).append(sku)

        # Choose base for each group (all variants normalize to base)
        chosen_by_base: Dict[str, str] = {}
        for base, variants in grouped.items():
            chosen = self._choose_sku_for_base(base, variants)
            if chosen:
                chosen_by_base[base] = chosen
            else:
                log.debug("No allowed variant for base=%s (variants=%s)", base, variants)
        if not chosen_by_base:
            return []

        # Resolve to final SKUs with item IDs
        resolved: Dict[str, Tuple[str, str]] = {}  # base -> (item_id, sku_used)
        for base, chosen in chosen_by_base.items():
            # Try the chosen SKU directly
            if chosen in item_id_map:
                item_id = item_id_map[chosen]
                resolved[base] = (item_id, chosen)
            else:
                log.warning("item_id missing for SKU=%s in inventory_metadata", chosen)
        if not resolved:
            return []

        # Get unique SKUs for data loading
        all_skus = list(set([t[1] for t in resolved.values()]))
        logger.info(f"Loading data for {len(all_skus)} unique SKUs from {len(resolved)} products")
        
        # Load prices with region preference from magento data
        with products_conn() as prod_conn:
            prices = self._load_latest_prices_psycopg(prod_conn, all_skus, preferred_region)
            logger.info(f"Loaded prices for {len(prices)} SKUs (region: {preferred_region})")
        
        # Load product names from magento data with region preference
        with products_conn() as prod_conn:
            sales_names = self._load_product_names_psycopg(prod_conn, all_skus, preferred_region)
            logger.info(f"Loaded names for {len(sales_names)} SKUs (region: {preferred_region})")

        # Build rows, filtering out orphaned SKUs (not in Magento) unless show_orphaned=True
        out: List[Dict[str, Any]] = []
        skipped_orphaned = 0
        for base, (item_id, sku_used) in resolved.items():
            price = prices.get(sku_used, "£0.00")
            product_name = sales_names.get(sku_used, "")
            
            # Skip orphaned SKUs (exist in inventory_metadata but not in Magento) unless explicitly requested
            if not product_name and not show_orphaned:
                logger.debug(f"Skipping orphaned SKU {sku_used} (not in Magento but kept in inventory_metadata)")
                skipped_orphaned += 1
                continue
            
            # Get 6M data from aggregated tables
            uk_6m, fr_6m = sixm_data_map.get(sku_used, ("0", "0"))
            
            out.append({
                "item_id": item_id,           # barcode from inventory_metadata
                "sku": sku_used,              # base SKU (all variants normalized)
                "product_name": product_name, # from magento orders_cache
                "uk_6m_data": uk_6m,          # from uk_aggregated_orders
                "fr_6m_data": fr_6m,          # from fr_aggregated_orders + nl_aggregated_orders
                "price": price,               # from orders_cache (region preference)
            })
        
        if skipped_orphaned > 0:
            logger.info(f"Skipped {skipped_orphaned} orphaned SKUs (use show_orphaned=true to include)")
        logger.info(f"Built {len(out)} label rows")
        return out

    # --- public (psycopg2) ---
    def get_labels_to_print_psycopg(self, conn, product_statuses: Optional[List[str]] = None, preferred_region: str = "uk", show_orphaned: bool = False) -> List[Dict[str, Any]]:
        """
        Fetch products from inventory_metadata (synced from Magento) filtered by status.
        Uses EXACT SAME logic as inventory management:
        1. Syncs ALL products from Magento to inventory_metadata (refresh)
        2. Merges all variants to base SKUs
        3. Filters by status from inventory_metadata
        
        Args:
            conn: database connection to inventory_logs database (for inventory_metadata)
            product_statuses: list of discontinued_status values to filter by (e.g., ['Active', 'Temporarily OOS'])
                            If None, defaults to ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
            preferred_region: "uk" (default), "fr", or "nl" - determines price/name priority
            show_orphaned: if False (default), exclude SKUs with no product name (orphaned SKUs)
        """
        from modules.inventory.management.repo import InventoryManagementRepo
        
        # Default statuses if not provided
        if product_statuses is None:
            product_statuses = ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
            
        # 1. Refresh inventory_metadata from Magento (same as inventory management)
        inv_repo = InventoryManagementRepo()
        logger.info("Refreshing inventory_metadata from Magento for label generation...")
        inv_repo.sync_magento_products_to_inventory_metadata()
        
        # 2. Merge variants (same as inventory management)
        logger.info("Merging identifier products...")
        inv_repo.merge_identifier_products()
        
        # 3. Update variant statuses (same as inventory management)
        logger.info("Updating variant statuses...")
        inv_repo.update_variant_statuses()
        
        # 4. Fetch SKUs from inventory_metadata filtered by variant_statuses
        # Uses JSONB containment to check if ANY of the variant statuses match the requested statuses
        allowed_skus = []
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT sku 
                    FROM inventory_metadata 
                    WHERE EXISTS (
                        SELECT 1 
                        FROM jsonb_array_elements_text(variant_statuses) AS s 
                        WHERE s = ANY(%s)
                    )
                    ORDER BY sku
                """, (product_statuses,))
                allowed_skus = [str(row[0]).strip() for row in cur.fetchall()]
                logger.info(f"Fetched {len(allowed_skus)} SKUs from inventory_metadata with variant_statuses matching: {product_statuses}")
        except Exception as e:
            logger.error(f"Error fetching SKUs from inventory_metadata: {e}")
            return []

        return self._resolve_to_rows(
            conn,
            allowed_skus,
            preferred_region=preferred_region,
            show_orphaned=show_orphaned,
        )

    # CSV upload functionality removed - dead code that was never fully implemented
    # --- Label Printing Presets CRUD ---
    
    @staticmethod
    def create_preset(conn, name: str, description: Optional[str], status_filters: List[str], 
                     region: str, product_skus: List[str], created_by: Optional[str]) -> int:
        """Create a new label printing preset"""
        import json
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO label_printing_presets 
                    (name, description, status_filters, region, product_skus, created_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (name, description, json.dumps(status_filters), region, 
                 json.dumps(product_skus), created_by)
            )
            preset_id = cur.fetchone()[0]
            logger.info(f"Created label preset {preset_id}: {name}")
            return preset_id
    
    @staticmethod
    def get_all_presets(conn) -> List[Dict[str, Any]]:
        """Get all label printing presets"""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, description, status_filters, region, 
                       product_skus, created_by, created_at, updated_at
                FROM label_printing_presets
                ORDER BY created_at DESC
                """
            )
            cols = [c[0] for c in cur.description]
            rows = cur.fetchall()
            
            presets = []
            for row in rows:
                preset = dict(zip(cols, row))
                # JSONB columns are already Python objects, no need to parse
                preset['status_filters'] = preset['status_filters'] if preset['status_filters'] else []
                preset['product_skus'] = preset['product_skus'] if preset['product_skus'] else []
                # Convert timestamps to strings
                preset['created_at'] = preset['created_at'].isoformat() if preset['created_at'] else None
                preset['updated_at'] = preset['updated_at'].isoformat() if preset['updated_at'] else None
                presets.append(preset)
            
            return presets
    
    @staticmethod
    def get_preset_by_id(conn, preset_id: int) -> Optional[Dict[str, Any]]:
        """Get a specific label printing preset by ID"""
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, description, status_filters, region, 
                       product_skus, created_by, created_at, updated_at
                FROM label_printing_presets
                WHERE id = %s
                """,
                (preset_id,)
            )
            row = cur.fetchone()
            if not row:
                return None
            
            cols = [c[0] for c in cur.description]
            preset = dict(zip(cols, row))
            # JSONB columns are already Python objects, no need to parse
            preset['status_filters'] = preset['status_filters'] if preset['status_filters'] else []
            preset['product_skus'] = preset['product_skus'] if preset['product_skus'] else []
            # Convert timestamps to strings
            preset['created_at'] = preset['created_at'].isoformat() if preset['created_at'] else None
            preset['updated_at'] = preset['updated_at'].isoformat() if preset['updated_at'] else None
            
            return preset
    
    @staticmethod
    def update_preset(conn, preset_id: int, name: Optional[str] = None, 
                     description: Optional[str] = None, status_filters: Optional[List[str]] = None,
                     region: Optional[str] = None, product_skus: Optional[List[str]] = None) -> bool:
        """Update an existing label printing preset"""
        import json
        
        # Build dynamic update query
        update_fields = []
        params = []
        
        if name is not None:
            update_fields.append("name = %s")
            params.append(name)
        if description is not None:
            update_fields.append("description = %s")
            params.append(description)
        if status_filters is not None:
            update_fields.append("status_filters = %s")
            params.append(json.dumps(status_filters))
        if region is not None:
            update_fields.append("region = %s")
            params.append(region)
        if product_skus is not None:
            update_fields.append("product_skus = %s")
            params.append(json.dumps(product_skus))
        
        if not update_fields:
            return False
        
        # Always update updated_at
        update_fields.append("updated_at = CURRENT_TIMESTAMP")
        
        params.append(preset_id)
        
        with conn.cursor() as cur:
            query = f"""
                UPDATE label_printing_presets
                SET {', '.join(update_fields)}
                WHERE id = %s
            """
            cur.execute(query, params)
            updated = cur.rowcount > 0
            
            if updated:
                logger.info(f"Updated label preset {preset_id}")
            
            return updated
    
    @staticmethod
    def delete_preset(conn, preset_id: int) -> bool:
        """Delete a label printing preset"""
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM label_printing_presets WHERE id = %s",
                (preset_id,)
            )
            deleted = cur.rowcount > 0
            
            if deleted:
                logger.info(f"Deleted label preset {preset_id}")
            
            return deleted