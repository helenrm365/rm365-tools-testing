# modules/labels/repo.py
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import logging

logger = logging.getLogger(__name__)
log = logging.getLogger("labels")


class LabelsRepo:
    # --- helpers (suffix/base) ---
    @staticmethod
    def _base_of(sku: str) -> str:
        return (sku or "").split("-")[0].strip()

    @classmethod
    def _choose_sku_for_base(cls, base: str, variants: List[str]) -> Optional[str]:
        """Prefer base; fallback to base-MD."""
        vs = {v.strip() for v in (variants or []) if v}
        if base in vs:
            return base
        md = f"{base}-MD"
        if md in vs:
            return md
        return None

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

    def _load_six_month_data_psycopg(self, conn, item_ids: List[str]) -> Dict[str, Tuple[str, str]]:
        """Return { item_id: (uk_6m_data, fr_6m_data) }."""
        if not item_ids:
            return {}
        with conn.cursor() as cur:
            # psycopg2 "IN %s" trick: pass a tuple for the IN list
            cur.execute(
                """
                SELECT item_id,
                       COALESCE(uk_6m_data, '0') AS uk_6m_data,
                       COALESCE(fr_6m_data, '0') AS fr_6m_data
                FROM inventory_metadata
                WHERE item_id = ANY(%s)
                """,
                (item_ids,)  # ARRAY/ANY is simpler than building a dynamic IN
            )
            return {str(r[0]): (str(r[1]), str(r[2])) for r in cur.fetchall()}
    
    def _load_latest_prices_psycopg(self, conn, skus: List[str]) -> Dict[str, str]:
        """
        Return { sku: price } with the most recent price from sales data.
        Checks uk_sales_data, fr_sales_data, and nl_sales_data.
        Returns empty dict if tables don't exist yet.
        """
        if not skus:
            return {}
        
        prices = {}
        with conn.cursor() as cur:
            # First check if the sales tables exist
            cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('uk_sales_data', 'fr_sales_data', 'nl_sales_data')
            """)
            
            existing_tables = [row[0] for row in cur.fetchall()]
            
            if not existing_tables:
                # No sales tables exist yet - return empty dict
                logger.warning("No sales data tables found. Please initialize sales data first.")
                return {}
            
            # Build dynamic query for only existing tables
            union_parts = []
            params = []
            
            for table in existing_tables:
                region = table.split('_')[0]  # uk, fr, or nl
                union_parts.append(f"""
                    SELECT sku, price, created_at, '{region}' as source
                    FROM {table}
                    WHERE sku = ANY(%s) AND price IS NOT NULL
                """)
                params.append(skus)
            
            if not union_parts:
                return {}
            
            combined_query = f"""
                WITH combined_sales AS (
                    {' UNION ALL '.join(union_parts)}
                ),
                ranked_sales AS (
                    SELECT 
                        sku,
                        price,
                        created_at,
                        ROW_NUMBER() OVER (PARTITION BY sku ORDER BY created_at DESC) as rn
                    FROM combined_sales
                )
                SELECT sku, price
                FROM ranked_sales
                WHERE rn = 1
            """
            
            try:
                cur.execute(combined_query, params)
                for row in cur.fetchall():
                    sku = str(row[0]).strip()
                    price = str(row[1]) if row[1] else "0.00"
                    prices[sku] = price
            except Exception as e:
                logger.error(f"Error querying sales data for prices: {e}")
                # Return empty dict on error rather than crashing
                return {}
        
        return prices

    def _resolve_to_rows(
        self,
        conn,
        zoho_map: Dict[str, str],       # sku -> item_id  (from get_zoho_items_with_skus)
        candidate_skus: List[str],
        zoho_name_lookup: Optional[Dict[str, str]] = None,  # if later you return names too
    ) -> List[Dict[str, Any]]:
        """
        Collapse per-base to base/-MD, map to Zoho, attach 6M data.
        """
        if not candidate_skus:
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

        # map to Zoho (fallback base <-> -MD)
        resolved: Dict[str, Tuple[str, str, str]] = {}  # base -> (item_id, sku_used, name)
        for base, chosen in chosen_by_base.items():
            cands = [chosen, (base if chosen.upper().endswith("-MD") else f"{base}-MD")]
            hit = None
            for c in cands:
                if c in zoho_map and zoho_map[c]:
                    item_id = zoho_map[c]
                    # product name optional; can be fetched separately if needed
                    name = "" if not zoho_name_lookup else (zoho_name_lookup.get(c, "") or "")
                    hit = (item_id, c, name)
                    break
            if not hit:
                log.warning("Zoho mapping missing for base=%s, tried=%s", base, cands)
                continue
            resolved[base] = hit
        if not resolved:
            return []

        # 6M data
        item_ids = [t[0] for t in resolved.values()]
        sixm = self._load_six_month_data_psycopg(conn, item_ids)
        
        # Latest prices from sales data
        all_skus = list(set([t[1] for t in resolved.values()]))  # Get unique SKUs
        prices = self._load_latest_prices_psycopg(conn, all_skus)

        # build rows
        out: List[Dict[str, Any]] = []
        for base, (item_id, sku_used, name) in resolved.items():
            uk, fr = sixm.get(item_id, ("0", "0"))
            price = prices.get(sku_used, "0.00")  # Get price for this SKU
            out.append({
                "item_id": item_id,       # barcode (Zoho item_id)
                "sku": sku_used,          # chosen Zoho SKU (base or -MD)
                "product_name": name,     # may be blank unless you hydrate it
                "uk_6m_data": uk,
                "fr_6m_data": fr,         # FR already includes FR+NL in your sync
                "price": price,           # most recent price from sales data
            })
        return out

    # --- public (psycopg2) ---
    def get_labels_to_print_psycopg(self, conn, zoho_sku_map, discontinued_statuses: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """
        DB-driven: Magento 'discontinued_status' decides inclusion.
        Accepts either:
          - {sku: item_id}  (legacy)
          - {sku: (item_id, name)}  (full)
        
        Args:
            conn: database connection
            zoho_sku_map: mapping of SKUs to Zoho item IDs and names
            discontinued_statuses: list of discontinued statuses to filter by (optional)
        """
        magento_skus = self._fetch_allowed_skus_from_magento_psycopg(conn, discontinued_statuses)

        # Normalize maps
        if magento_skus and zoho_sku_map:
            # sku -> item_id
            sku_to_item_id = {
                k: (v if isinstance(v, str) else v[0])
                for k, v in zoho_sku_map.items()
            }
            # sku -> name (only for full map)
            sku_to_name = {
                k: (v[1] if isinstance(v, tuple) and len(v) > 1 else "")
                for k, v in zoho_sku_map.items()
            }
        else:
            sku_to_item_id, sku_to_name = {}, {}

        return self._resolve_to_rows(
            conn,
            sku_to_item_id,  # existing param
            magento_skus,
            zoho_name_lookup=sku_to_name,  # <— NEW: passes names through
        )

    def get_labels_to_print_from_csv_psycopg(
        self,
        conn,
        zoho_sku_to_item_id: Dict[str, str],
        csv_skus: List[str],
    ) -> List[Dict[str, Any]]:
        """
        CSV-driven (optional): validate against Magento to exclude discontinued.
        Only includes Active, Temporarily OOS, Pre Order, and Samples.
        Parses discontinued_status from additional_attributes field.
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
        return self._resolve_to_rows(conn, zoho_sku_to_item_id, allowed)
