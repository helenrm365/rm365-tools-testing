# modules/labels/repo.py
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import logging
from common.deps import products_conn

logger = logging.getLogger(__name__)
log = logging.getLogger("labels")


class LabelsRepo:
    # --- helpers (suffix/base) ---
    @staticmethod
    def _base_of(sku: str) -> str:
        return (sku or "").split("-")[0].strip()

    @classmethod
    def _choose_sku_for_base(cls, base: str, variants: List[str]) -> Optional[str]:
        """
        Simply return any available SKU - no filtering logic.
        All SKUs are treated as valid products.
        """
        vs = {v.strip() for v in (variants or []) if v}
        if not vs:
            return None
        # Just return the first available SKU
        return next(iter(vs), None)

    # --- psycopg2 queries ---
    def _fetch_allowed_skus_from_magento_psycopg(self, conn, discontinued_statuses: Optional[List[str]] = None) -> List[str]:
        """
        Magento allow-list: fetch SKUs filtered by discontinued_status.
        Parses discontinued_status from additional_attributes field.
        
        Args:
            conn: database connection
            discontinued_statuses: list of statuses to include (e.g., ['Active', 'Temporarily OOS'])
                                  If None, defaults to ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
        """
        # Default to the standard active statuses if not specified
        if discontinued_statuses is None:
            discontinued_statuses = ['Active', 'Temporarily OOS', 'Pre Order', 'Samples']
        
        if not discontinued_statuses:
            return []
        
        # Build LIKE conditions dynamically
        conditions = " OR ".join([
            f"additional_attributes LIKE %s"
            for _ in discontinued_statuses
        ])
        
        # Build parameter list with wildcards
        params = [f'%discontinued_status={status}%' for status in discontinued_statuses]
        
        with conn.cursor() as cur:
            query = f"""
                SELECT sku
                FROM magento_product_list
                WHERE sku IS NOT NULL
                  AND sku <> ''
                  AND ({conditions})
            """
            cur.execute(query, params)
            return [str(r[0]).strip() for r in cur.fetchall()]

    # DEPRECATED: No longer used - 6M data now comes from inventory_metadata table
    # def _load_six_month_data_psycopg(self, conn, resolved_data: Dict[str, Tuple[str, str, str]]) -> Dict[str, Tuple[str, str]]:
    #     """Old method that loaded 6M data from condensed_sales tables using Zoho item_ids"""
    #     pass

    def _load_inventory_metadata_map(self, inventory_conn) -> Dict[str, Tuple[str, str, str]]:
        """
        Load inventory metadata mapping: sku -> (item_id, uk_6m_data, fr_6m_data)
        
        Args:
            inventory_conn: Connection to inventory database
            
        Returns:
            Dict mapping SKU to tuple of (item_id, uk_6m_data, fr_6m_data)
        """
        metadata_map = {}
        try:
            with inventory_conn.cursor() as cur:
                cur.execute("""
                    SELECT sku, item_id, uk_6m_data, fr_6m_data
                    FROM inventory_metadata
                    WHERE sku IS NOT NULL 
                      AND item_id IS NOT NULL
                """)
                
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    item_id = str(row[1]).strip()
                    uk_6m = str(row[2] or "0")
                    fr_6m = str(row[3] or "0")
                    metadata_map[sku] = (item_id, uk_6m, fr_6m)
                    
            logger.info(f"Loaded {len(metadata_map)} records from inventory_metadata")
        except Exception as e:
            logger.error(f"Failed to load inventory_metadata: {e}")
            # Return empty map if table doesn't exist yet
            
        return metadata_map
    
    def _load_latest_prices_psycopg(self, conn, skus: List[str], preferred_region: str = "uk") -> Dict[str, str]:
        """
        Return { sku: price } with the most recent price from sales data.
        Checks uk_sales_data, fr_sales_data, and nl_sales_data.
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
            (f'{preferred_region}_sales_data', preferred_region),
            ('uk_sales_data', 'uk'),
            ('fr_sales_data', 'fr'),
            ('nl_sales_data', 'nl')
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
                            price,
                            COALESCE(currency, %s) as currency
                        FROM {table_name}
                        WHERE sku = ANY(%s) 
                          AND price IS NOT NULL 
                          AND price > 0
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
        Return { sku: product_name } with the most recent product name from sales data.
        Prioritizes preferred region, then falls back to other regions.
        Queries each table separately to avoid timeout issues.
        
        Args:
            conn: Database connection
            skus: List of SKUs to get names for
            preferred_region: "uk" (default), "fr", or "nl" - determines name priority
        """
        if not skus:
            return {}
        
        names = {}
        
        # Query order based on preferred region (preferred region first)
        tables = [
            f'{preferred_region}_sales_data',
            'uk_sales_data',
            'fr_sales_data',
            'nl_sales_data'
        ]
        # Remove duplicates while preserving order
        tables = list(dict.fromkeys(tables))
        
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
        
        logger.info(f"Loaded names for {len(names)}/{len(skus)} SKUs")
        return names

    def _load_inventory_metadata_map(self, inventory_conn) -> Dict[str, Tuple[str, str, str]]:
        """
        Load inventory metadata mapping: sku -> (item_id, uk_6m_data, fr_6m_data)
        
        Args:
            inventory_conn: Connection to inventory database
            
        Returns:
            Dict mapping SKU to tuple of (item_id, uk_6m_data, fr_6m_data)
        """
        metadata_map = {}
        try:
            with inventory_conn.cursor() as cur:
                cur.execute("""
                    SELECT sku, item_id, uk_6m_data, fr_6m_data
                    FROM inventory_metadata
                    WHERE sku IS NOT NULL 
                      AND item_id IS NOT NULL
                """)
                
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    item_id = str(row[1]).strip()
                    uk_6m = str(row[2] or "0")
                    fr_6m = str(row[3] or "0")
                    metadata_map[sku] = (item_id, uk_6m, fr_6m)
                    
            logger.info(f"Loaded {len(metadata_map)} records from inventory_metadata")
        except Exception as e:
            logger.error(f"Failed to load inventory_metadata: {e}")
            # Return empty map if table doesn't exist yet
            
        return metadata_map

    def _resolve_to_rows(
        self,
        inventory_conn,  # for magento_product_list and inventory_metadata
        candidate_skus: List[str],
        preferred_region: str = "uk",  # region preference for price/name selection
    ) -> List[Dict[str, Any]]:
        """
        Collapse per-base to base/-MD, map to inventory_metadata, attach 6M data and prices.
        SKUs come from UK (magento), but prices/names come from sales data.
        Item IDs and 6M data come from inventory_metadata table.
        
        Args:
            inventory_conn: Connection to inventory_logs database (for magento and inventory_metadata)
            candidate_skus: List of SKUs to process
            preferred_region: Region preference for pricing (uk/fr/nl)
        """
        if not candidate_skus:
            return []

        # Load inventory metadata mapping (item_id and 6M data)
        metadata_map = self._load_inventory_metadata_map(inventory_conn)
        if not metadata_map:
            logger.warning("No inventory_metadata records found. Ensure inventory sync has run.")
            return []

        # group by base
        grouped: Dict[str, List[str]] = {}
        for sku in candidate_skus:
            base = self._base_of(sku)
            grouped.setdefault(base, []).append(sku)

        # choose base or -MD per group
        chosen_by_base: Dict[str, str] = {}
        for base, variants in grouped.items():
            chosen = self._choose_sku_for_base(base, variants)
            if chosen:
                chosen_by_base[base] = chosen
            else:
                log.debug("No allowed variant for base=%s (variants=%s)", base, variants)
        if not chosen_by_base:
            return []

        # map to inventory_metadata - get item_id and 6M data
        resolved: Dict[str, Tuple[str, str, str, str]] = {}  # base -> (item_id, sku_used, uk_6m, fr_6m)
        for base, chosen in chosen_by_base.items():
            # Try the chosen SKU directly
            if chosen in metadata_map:
                item_id, uk_6m, fr_6m = metadata_map[chosen]
                resolved[base] = (item_id, chosen, uk_6m, fr_6m)
            else:
                log.warning("inventory_metadata mapping missing for SKU=%s", chosen)
        if not resolved:
            return []

        # Get unique SKUs for data loading
        all_skus = list(set([t[1] for t in resolved.values()]))
        logger.info(f"Loading data for {len(all_skus)} unique SKUs from {len(resolved)} products")
        
        # Load prices with region preference from sales data
        with products_conn() as prod_conn:
            prices = self._load_latest_prices_psycopg(prod_conn, all_skus, preferred_region)
            logger.info(f"Loaded prices for {len(prices)} SKUs (region: {preferred_region})")
        
        # Load product names from sales data with region preference
        with products_conn() as prod_conn:
            sales_names = self._load_product_names_psycopg(prod_conn, all_skus, preferred_region)
            logger.info(f"Loaded names for {len(sales_names)} SKUs (region: {preferred_region})")

        # build rows
        out: List[Dict[str, Any]] = []
        for base, (item_id, sku_used, uk_6m, fr_6m) in resolved.items():
            price = prices.get(sku_used, "£0.00")  # Get price for this SKU with region preference
            product_name = sales_names.get(sku_used, "")
            
            out.append({
                "item_id": item_id,       # barcode from inventory_metadata
                "sku": sku_used,          # chosen SKU (base or -MD) - always from UK
                "product_name": product_name,     # from sales data (region preference)
                "uk_6m_data": uk_6m,      # UK 6-month data from inventory_metadata
                "fr_6m_data": fr_6m,      # FR+NL combined 6-month data from inventory_metadata
                "price": price,           # most recent price from preferred region
            })
        
        logger.info(f"Built {len(out)} label rows")
        return out

    # --- public (psycopg2) ---
    def get_labels_to_print_psycopg(self, conn, discontinued_statuses: Optional[List[str]] = None, preferred_region: str = "uk") -> List[Dict[str, Any]]:
        """
        DB-driven: Magento 'discontinued_status' decides inclusion.
        Gets item_id and 6M data from inventory_metadata table.
        Gets prices and names from sales_data tables.
        
        Args:
            conn: database connection to inventory_logs database
            discontinued_statuses: list of discontinued statuses to filter by (optional)
            preferred_region: "uk" (default), "fr", or "nl" - determines price/name priority
        """
        magento_skus = self._fetch_allowed_skus_from_magento_psycopg(conn, discontinued_statuses)

        return self._resolve_to_rows(
            conn,
            magento_skus,
            preferred_region=preferred_region,
        )

    def get_labels_to_print_from_csv_psycopg(
        self,
        conn,
        csv_skus: List[str],
        preferred_region: str = "uk",
    ) -> List[Dict[str, Any]]:
        """
        CSV-driven (optional): validate against Magento to exclude discontinued.
        Only includes Active, Temporarily OOS, Pre Order, and Samples.
        Parses discontinued_status from additional_attributes field.
        Gets item_id and 6M data from inventory_metadata table.
        """
        if not csv_skus:
            return []
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sku
                FROM magento_product_list
                WHERE sku = ANY(%s)
                  AND (
                    additional_attributes LIKE '%discontinued_status=Active%'
                    OR additional_attributes LIKE '%discontinued_status=Temporarily OOS%'
                    OR additional_attributes LIKE '%discontinued_status=Pre Order%'
                    OR additional_attributes LIKE '%discontinued_status=Samples%'
                  )
                """,
                (csv_skus,)
            )
            allowed = [str(r[0]).strip() for r in cur.fetchall()]
        return self._resolve_to_rows(conn, allowed, preferred_region=preferred_region)
