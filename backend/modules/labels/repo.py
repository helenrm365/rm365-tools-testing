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
    
    def _load_product_names_from_inventory_metadata(self, inventory_conn, skus: List[str] = None) -> Dict[str, str]:
        """
        Load product names from inventory_metadata table.
        Names are now stored during the catalog sync, so this is much faster than querying Magento.
        
        Args:
            inventory_conn: Connection to inventory database
            skus: Optional list of SKUs to filter by. If None, loads all.
            
        Returns:
            Dict mapping SKU to product_name
        """
        name_map = {}
        try:
            with inventory_conn.cursor() as cur:
                if skus:
                    cur.execute("""
                        SELECT sku, product_name
                        FROM inventory_metadata
                        WHERE sku = ANY(%s)
                          AND product_name IS NOT NULL 
                          AND product_name != ''
                    """, (skus,))
                else:
                    cur.execute("""
                        SELECT sku, product_name
                        FROM inventory_metadata
                        WHERE product_name IS NOT NULL 
                          AND product_name != ''
                    """)
                
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    name = str(row[1]).strip() if row[1] else ""
                    if name:
                        name_map[sku] = name
                    
            logger.info(f"Loaded {len(name_map)} product names from inventory_metadata")
        except Exception as e:
            logger.error(f"Failed to load product names from inventory_metadata: {e}")
            
        return name_map
    
    def _load_latest_prices_from_magento_catalog(self, skus: List[str], region: str = "uk") -> Dict[str, str]:
        """
        Return { sku: price } from Magento live catalog, EXCLUDING VAT.
        Queries catalog_product_entity_decimal for special_price and price attributes.
        Priority: special_price > price > "N/A"
        
        VAT handling by region:
        - UK: Prices entered INCLUDING tax → divide by 1.20 to get excluding tax
        - FR: Prices entered EXCLUDING tax → use directly (no calculation)
        - NL: Prices entered INCLUDING tax → divide by 1.20 to get excluding tax
        
        Args:
            skus: List of SKUs to get prices for
            region: Region to query (uk/fr/nl) - determines which Magento database and VAT handling
            
        Returns:
            Dict mapping SKU to formatted price string excluding VAT (e.g., "£24.99" or "€24.99" or "N/A")
        """
        if not skus:
            return {}
        
        prices = {}
        conn = None
        
        # VAT rate (20% for UK and NL)
        VAT_RATE = 0.20
        VAT_MULTIPLIER = 1 + VAT_RATE  # 1.20
        
        # Determine if we need to calculate excluding VAT
        # UK and NL: prices are entered including tax, need to divide
        # FR: prices are entered excluding tax, use directly
        needs_vat_calculation = region.lower() in ['uk', 'nl']
        
        # Currency symbol by region
        currency_symbol = "£" if region.lower() == 'uk' else "€"
        
        try:
            conn = get_magento_connection(region)
            with conn.cursor() as cur:
                # Get attribute IDs for price and special_price
                cur.execute("""
                    SELECT attribute_id, attribute_code
                    FROM eav_attribute
                    WHERE attribute_code IN ('price', 'special_price')
                      AND entity_type_id = (
                          SELECT entity_type_id 
                          FROM eav_entity_type 
                          WHERE entity_type_code = 'catalog_product'
                      )
                """)
                
                attribute_map = {}
                for row in cur.fetchall():
                    attribute_map[row['attribute_code']] = row['attribute_id']
                
                if not attribute_map:
                    logger.warning("Could not find price attribute IDs in Magento")
                    return {}
                
                price_attr_id = attribute_map.get('price')
                special_price_attr_id = attribute_map.get('special_price')
                
                logger.info(f"Looking up prices for {len(skus)} SKUs from {region.upper()} Magento catalog. Sample SKUs: {skus[:5]}")
                
                # Query prices for all SKUs
                # We need to get both base SKUs and their variants (MD, SD, etc.)
                # Build LIKE patterns for variants
                import re
                like_conditions = []
                like_params = []
                
                # Add exact SKU matches
                for sku in skus:
                    like_conditions.append("cpe.sku = %s")
                    like_params.append(sku)
                    # Also search for variants
                    like_conditions.append("cpe.sku LIKE %s")
                    like_params.append(f"{sku}-%")
                
                like_clause = " OR ".join(like_conditions)
                
                # Get prices and special prices
                cur.execute(f"""
                    SELECT 
                        cpe.sku,
                        MAX(CASE WHEN cped.attribute_id = %s THEN cped.value END) as price,
                        MAX(CASE WHEN cped.attribute_id = %s THEN cped.value END) as special_price
                    FROM catalog_product_entity cpe
                    LEFT JOIN catalog_product_entity_decimal cped 
                        ON cpe.entity_id = cped.entity_id
                        AND cped.attribute_id IN (%s, %s)
                        AND cped.store_id = 0
                    WHERE ({like_clause})
                    GROUP BY cpe.sku
                """, (price_attr_id, special_price_attr_id, price_attr_id, special_price_attr_id, *like_params))
                
                identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
                
                for row in cur.fetchall():
                    variant_sku = str(row['sku']).strip() if row.get('sku') else ""
                    price_val = float(row['price']) if row.get('price') else None
                    special_price_val = float(row['special_price']) if row.get('special_price') else None
                    
                    # Normalize to base SKU
                    base_sku = identifier_pattern.sub('', variant_sku) if identifier_pattern.search(variant_sku) else variant_sku
                    
                    # Only set if we haven't found this base SKU yet
                    if base_sku and base_sku not in prices:
                        # Priority: special_price > price > N/A
                        # Apply VAT calculation only for UK and NL (FR prices are already excluding tax)
                        if special_price_val and special_price_val > 0:
                            if needs_vat_calculation:
                                price_excl_vat = special_price_val / VAT_MULTIPLIER
                                prices[base_sku] = f"{currency_symbol}{price_excl_vat:.2f}"
                            else:
                                prices[base_sku] = f"{currency_symbol}{special_price_val:.2f}"
                        elif price_val and price_val > 0:
                            if needs_vat_calculation:
                                price_excl_vat = price_val / VAT_MULTIPLIER
                                prices[base_sku] = f"{currency_symbol}{price_excl_vat:.2f}"
                            else:
                                prices[base_sku] = f"{currency_symbol}{price_val:.2f}"
                        else:
                            prices[base_sku] = "N/A"
                
                vat_note = "(excl. VAT)" if needs_vat_calculation else "(already excl. VAT)"
                logger.info(f"Loaded prices {vat_note} for {len(prices)}/{len(skus)} SKUs from {region.upper()} Magento catalog. Sample prices: {list(prices.items())[:5]}")
                
        except Exception as e:
            logger.error(f"Failed to load prices from UK Magento catalog: {e}", exc_info=True)
        finally:
            if conn:
                conn.close()
        
        return prices

    def _load_product_names_psycopg(self, conn, skus: List[str], preferred_region: str = "uk") -> Dict[str, str]:
        """
        Return { sku: product_name } with the most recent product name from magento data.
        Prioritizes preferred region, then falls back to other regions.
        Queries HISTORY from orders_cache tables.
        
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
        
        logger.info(f"Loaded names for {len(names)}/{len(skus)} SKUs (from orders_cache)")
        
        return names
    
    def _load_product_names_from_magento(self, skus: List[str], region: str = "uk") -> Dict[str, str]:
        """
        Load product names directly from Magento catalog.
        
        Args:
            skus: List of base SKUs to get names for
            region: Magento region to query (uk, fr, nl)
            
        Returns:
            Dict mapping SKU to product name from Magento catalog
        """
        if not skus:
            return {}
        
        names = {}
        
        try:
            conn = get_magento_connection(region)
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
                
                logger.info(f"Found {len(names)} exact base SKU matches in Magento ({region})")
                
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
            
            logger.info(f"Total: Loaded {len(names)}/{len(skus)} product names from Magento catalog ({region})")
        except Exception as e:
            logger.error(f"Failed to load names from Magento catalog ({region}): {e}")
        
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
        
        # Load prices from selected region's Magento live catalog (special_price > price > N/A)
        prices = self._load_latest_prices_from_magento_catalog(all_skus, region=preferred_region)
        logger.info(f"Loaded prices for {len(prices)} SKUs from {preferred_region.upper()} Magento catalog")
        
        # Load product names - now primarily from inventory_metadata (synced from Magento catalog)
        # This is much faster than querying Magento on every request
        # Strategy: inventory_metadata (primary) -> Magento catalog (fallback) -> orders_cache (fallback)
        
        # 1. Load names from inventory_metadata (synced from Magento catalog during sync)
        sales_names = self._load_product_names_from_inventory_metadata(inventory_conn, all_skus)
        logger.info(f"Loaded {len(sales_names)} names from inventory_metadata")
        
        # 2. Fallback: Try Live Magento Catalog for missing names (rare - only for unsynced products)
        skus_missing_names = [sku for sku in all_skus if sku not in sales_names]
        if skus_missing_names:
            logger.info(f"Fallback: Loading names from Magento catalog for {len(skus_missing_names)} missing SKUs")
            magento_names = self._load_product_names_from_magento(skus_missing_names, region=preferred_region)
            sales_names.update(magento_names)
        
        # 3. Fallback: Try History (Orders Cache) for still missing
        skus_missing_names = [sku for sku in all_skus if sku not in sales_names]
        if skus_missing_names:
            logger.info(f"Fallback: Loading names from orders_cache for {len(skus_missing_names)} missing SKUs")
            with products_conn() as prod_conn:
                history_names = self._load_product_names_psycopg(prod_conn, skus_missing_names, preferred_region)
                sales_names.update(history_names)
        
        # 4. Final Fallback: Try UK Catalog if preferred region was not UK (and still missing)
        if preferred_region != "uk":
            skus_missing_names = [sku for sku in all_skus if sku not in sales_names]
            if skus_missing_names:
                logger.info(f"Fallback: Checking UK catalog for {len(skus_missing_names)} missing names")
                uk_catalog_names = self._load_product_names_from_magento(skus_missing_names, region="uk")
                sales_names.update(uk_catalog_names)
        
        logger.info(f"Loaded names for {len(sales_names)}/{len(all_skus)} SKUs total")
        
        if len(sales_names) < len(all_skus):
            missing = [sku for sku in all_skus if sku not in sales_names]
            logger.warning(f"Still missing names for {len(missing)} SKUs: {missing[:10]}")
        
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
                "product_name": product_name, # from inventory_metadata (synced from Magento catalog)
                "uk_6m_data": uk_6m,          # from uk_aggregated_orders
                "fr_6m_data": fr_6m,          # from fr_aggregated_orders + nl_aggregated_orders
                "price": price,               # from Magento live catalog (special_price > price)
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
        1. Syncs ALL products from Magento to inventory_metadata (batch mode for performance)
        2. Merges all variants to base SKUs
        3. Filters by status from inventory_metadata
        
        Args:
            conn: database connection to inventory_logs database (for inventory_metadata)
            product_statuses: list of discontinued_status values to filter by (e.g., ['Active', 'Temporarily OOS'])
                            If None, defaults to ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
            preferred_region: "uk" (default), "fr", or "nl" - determines price/name priority
            show_orphaned: if False (default), exclude SKUs with no product name (orphaned SKUs)
        """
        import time
        start_time = time.time()
        
        from modules.inventory.management.repo import InventoryManagementRepo
        
        # Default statuses if not provided
        if product_statuses is None:
            product_statuses = ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
        
        # Always sync from Magento to get latest products (uses batch operations for speed)
        inv_repo = InventoryManagementRepo()
        
        # 1. Refresh inventory_metadata from Magento (batch mode)
        logger.info("Syncing inventory_metadata from Magento...")
        inv_repo.sync_magento_products_to_inventory_metadata()
        
        # 2. Merge variants (same as inventory management)
        logger.info("Merging identifier products...")
        inv_repo.merge_identifier_products()
        
        # 3. Ensure all products have item IDs (barcodes)
        logger.info("Ensuring all products have item IDs...")
        inv_repo.ensure_all_products_have_item_ids()
        
        # 4. Update variant statuses (same as inventory management)
        logger.info("Updating variant statuses...")
        inv_repo.update_variant_statuses()
        
        sync_elapsed = time.time() - start_time
        logger.info(f"✅ Sync completed in {sync_elapsed:.2f}s")
        
        # Fetch SKUs from inventory_metadata filtered by variant_statuses
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

    def check_tables_exist(self) -> dict:
        """Check which labels-related tables exist"""
        from core.db import get_inventory_log_connection, return_inventory_connection
        conn = None
        try:
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            
            # Labels module requires these tables
            tables = [
                'label_print_jobs',
                'label_print_items', 
                'label_printing_presets',
                'inventory_metadata'
            ]
            status = {}
            
            for table_name in tables:
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table_name,))
                
                status[table_name] = cursor.fetchone()[0]
            
            cursor.close()
            return status
            
        except Exception as e:
            logger.error(f"Error checking tables: {e}")
            raise
        finally:
            if conn:
                return_inventory_connection(conn)

    def get_today_count(self) -> int:
        """Get count of labels generated today for dashboard"""
        from core.db import get_inventory_log_connection, return_inventory_connection
        from datetime import date
        conn = None
        try:
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            
            # Check if table exists first
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'label_print_jobs'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.close()
                return 0
            
            # Count jobs created today
            cursor.execute("""
                SELECT COALESCE(SUM(total_rows), 0)
                FROM label_print_jobs
                WHERE DATE(created_at) = %s
            """, (date.today(),))
            
            count = cursor.fetchone()[0]
            cursor.close()
            return int(count) if count else 0
            
        except Exception as e:
            logger.error(f"Error getting today's label count: {e}")
            return 0
        finally:
            if conn:
                return_inventory_connection(conn)