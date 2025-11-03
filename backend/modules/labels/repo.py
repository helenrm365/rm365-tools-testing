from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import sqlite3
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from core.db import get_db_connection

logger = logging.getLogger(__name__)
log = logging.getLogger("labels")


class LabelsRepo:
    def __init__(self):
        self.db_path = None  # Will use get_db_connection()

    def get_sales_data(self, start_date: str, end_date: str, search: str = "") -> List[Dict[str, Any]]:
        """Get sales data for label generation"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            query = """
                SELECT 
                    id,
                    order_number,
                    customer_name,
                    customer_address,
                    product_sku,
                    product_name,
                    quantity,
                    order_date,
                    shipping_method
                FROM sales_orders 
                WHERE order_date BETWEEN ? AND ?
            """
            params = [start_date, end_date]
            
            if search:
                query += " AND (order_number LIKE ? OR customer_name LIKE ? OR product_sku LIKE ?)"
                search_param = f"%{search}%"
                params.extend([search_param, search_param, search_param])
                
            query += " ORDER BY order_date DESC"
            
            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
            
        except sqlite3.Error as e:
            logger.error(f"Database error in get_sales_data: {e}")
            return []
        finally:
            conn.close()

    def get_recent_runs(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent label generation runs"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    id,
                    run_date,
                    start_date,
                    end_date,
                    search_term,
                    labels_count,
                    status
                FROM label_runs 
                ORDER BY run_date DESC 
                LIMIT ?
            """, (limit,))
            
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
            
        except sqlite3.Error as e:
            logger.error(f"Database error in get_recent_runs: {e}")
            return []
        finally:
            conn.close()

    def save_run_history(self, run_data: Dict[str, Any]) -> None:
        """Save label generation run to history"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO label_runs 
                (run_date, start_date, end_date, search_term, labels_count, status)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().isoformat(),
                run_data.get('start_date'),
                run_data.get('end_date'),
                run_data.get('search_term', ''),
                run_data.get('labels_count', 0),
                run_data.get('status', 'completed')
            ))
            conn.commit()
            
        except sqlite3.Error as e:
            logger.error(f"Database error in save_run_history: {e}")
            raise
        finally:
            conn.close()

    def init_tables(self) -> None:
        """Initialize label-related database tables"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sales_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_number TEXT NOT NULL,
                    customer_name TEXT NOT NULL,
                    customer_address TEXT,
                    product_sku TEXT NOT NULL,
                    product_name TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    order_date TEXT NOT NULL,
                    shipping_method TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS label_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_date TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    search_term TEXT,
                    labels_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'completed',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.commit()
            
        except sqlite3.Error as e:
            logger.error(f"Database error in init_tables: {e}")
            raise
        finally:
            conn.close()


    # SQLAlchemy (Postgres) – Magento + Inventory metadata

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

    def _fetch_allowed_skus_from_magento(self, db: Session) -> List[str]:
        """
        Magento allow-list: only SKUs with discontinued IN ('No','Temporarily OOS').
        No suffix filter here (handled upstream in sales sync).
        """
        rows = db.execute(text("""
                               SELECT sku
                               FROM magento_product_list
                               WHERE discontinued IN ('No', 'Temporarily OOS')
                                 AND sku IS NOT NULL
                                 AND sku <> ''
                               """)).fetchall()
        return [str(r[0]).strip() for r in rows if r and r[0]]

    def _load_six_month_data(self, db: Session, item_ids: List[str]) -> Dict[str, Tuple[str, str]]:
        """Return { item_id: (uk_6m_data, fr_6m_data) }."""
        if not item_ids:
            return {}
        placeholders = ", ".join(f":id{i}" for i in range(len(item_ids)))
        params = {f"id{i}": v for i, v in enumerate(item_ids)}
        rows = db.execute(text(f"""
               SELECT item_id,
                      COALESCE(uk_6m_data, '0') AS uk_6m_data,
                      COALESCE(fr_6m_data, '0') AS fr_6m_data
               FROM inventory_metadata
               WHERE item_id IN ({placeholders})
           """), params).fetchall()
        return {str(r[0]): (str(r[1]), str(r[2])) for r in rows}

    def _resolve_to_rows(
            self,
            db: Session,
            zoho_map: Dict[str, Tuple[str, str]],  # sku -> (item_id, product_name)
            candidate_skus: List[str],
    ) -> List[Dict[str, Any]]:
        """
        Collapse per-base to base / -MD, map to Zoho, attach 6M data.
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
                if c in zoho_map:
                    item_id, name = zoho_map[c]
                    if item_id:
                        hit = (item_id, c, name or "")
                        break
            if not hit:
                log.warning("Zoho mapping missing for base=%s, tried=%s", base, cands)
                continue
            resolved[base] = hit
        if not resolved:
            return []

        # 6M data
        item_ids = [t[0] for t in resolved.values()]
        sixm = self._load_six_month_data(db, item_ids)

        # build rows
        out: List[Dict[str, Any]] = []
        for base, (item_id, sku_used, name) in resolved.items():
            uk, fr = sixm.get(item_id, ("0", "0"))
            out.append({
                "item_id": item_id,  # barcode (Zoho item_id)
                "sku": sku_used,  # Zoho SKU chosen
                "product_name": name,  # Zoho product name
                "uk_6m_data": uk,
                "fr_6m_data": fr,  # FR already = FR+NL from sync
            })
        return out

    # public
    def get_labels_to_print(self, db: Session, zoho_map: Dict[str, Tuple[str, str]]) -> List[Dict[str, Any]]:
        """
        DB-driven: Magento 'discontinued' decides inclusion; no suffix re-filtering here.
        """
        magento_skus = self._fetch_allowed_skus_from_magento(db)
        return self._resolve_to_rows(db, zoho_map, magento_skus)

    def get_labels_to_print_from_csv(
            self,
            db: Session,
            zoho_map: Dict[str, Tuple[str, str]],
            csv_skus: List[str],
    ) -> List[Dict[str, Any]]:
        """
        CSV-driven (optional): validate against Magento to exclude discontinued.
        """
        if not csv_skus:
            return []
        placeholders = ", ".join(f":s{i}" for i in range(len(csv_skus)))
        params = {f"s{i}": v for i, v in enumerate(csv_skus)}
        rows = db.execute(text(f"""
               SELECT sku
               FROM magento_product_list
               WHERE sku IN ({placeholders})
                 AND discontinued IN ('No','Temporarily OOS')
           """), params).fetchall()
        allowed = [str(r[0]).strip() for r in rows]
        return self._resolve_to_rows(db, zoho_map, allowed)