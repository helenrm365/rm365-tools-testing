from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging

from common.deps import pg_conn
from core.db import (
    get_inventory_log_connection,
    return_inventory_connection,
    return_psycopg_connection
)

logger = logging.getLogger(__name__)


class AdjustmentsRepo:
    def __init__(self):
        self._last_conn_type = None  # Track which pool connection came from

    def get_connection(self):
        """Get connection for inventory adjustments - try inventory DB first, fallback to main DB"""
        try:
            # Try dedicated inventory database first
            conn = get_inventory_log_connection()
            self._last_conn_type = 'inventory'
            return conn
        except (ValueError, Exception) as e:
            logger.warning(f"Inventory database not available ({e}), using main database")
            # Fallback to main database
            from core.db import get_psycopg_connection
            conn = get_psycopg_connection()
            self._last_conn_type = 'psycopg'
            return conn
    
    def return_connection(self, conn):
        """Return connection to the appropriate pool"""
        if not conn:
            return
        if self._last_conn_type == 'inventory':
            return_inventory_connection(conn)
        elif self._last_conn_type == 'psycopg':
            return_psycopg_connection(conn)
        else:
            # Fallback to inventory (most common)
            return_inventory_connection(conn)

    def create_adjustment_log(self, adjustment_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new adjustment log record"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # PostgreSQL version with RETURNING
            cursor.execute("""
                INSERT INTO inventory_logs 
                (barcode, quantity, reason, field, status, response_message, adjusted_by, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING id, barcode, quantity, reason, field, status, response_message, adjusted_by, created_at
            """, (
                adjustment_data['barcode'],
                adjustment_data['quantity'],
                adjustment_data['reason'],
                adjustment_data['field'],
                adjustment_data.get('status'),
                adjustment_data.get('response_message'),
                adjustment_data.get('adjusted_by')
            ))
            
            row = cursor.fetchone()
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'adjusted_by', 'created_at']
            
            conn.commit()
            logger.info(f"Adjustment log created for barcode: {adjustment_data['barcode']}")
            
            if row:
                result = dict(zip(columns, row))
                # Convert datetime to ISO string for frontend compatibility
                if result.get('created_at'):
                    result['created_at'] = result['created_at'].isoformat() if hasattr(result['created_at'], 'isoformat') else str(result['created_at'])
                return result
            return {}
            
        except Exception as e:
            logger.error(f"Error creating adjustment log: {e}")
            raise
        finally:
            self.return_connection(conn)

    def get_pending_adjustments(self) -> List[Dict[str, Any]]:
        """
        Get all adjustment logs for display purposes.
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, barcode, quantity, reason, field, status, response_message, adjusted_by, created_at
                FROM inventory_logs
                ORDER BY created_at DESC
                LIMIT 100
            """)
            
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'adjusted_by', 'created_at']
            rows = cursor.fetchall()
            
            adjustments = []
            for row in rows:
                adjustment = dict(zip(columns, row))
                # Convert datetime to ISO string for frontend compatibility
                if adjustment.get('created_at'):
                    adjustment['created_at'] = adjustment['created_at'].isoformat() if hasattr(adjustment['created_at'], 'isoformat') else str(adjustment['created_at'])
                adjustments.append(adjustment)
                
            logger.info(f"Retrieved {len(adjustments)} adjustment logs")
            
            return adjustments
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_pending_adjustments: {e}")
            return []
        finally:
            self.return_connection(conn)

    def update_adjustment_status(self, record_id: int, status: str, message: str) -> None:
        """Update the status of an adjustment log record"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE inventory_logs
                SET status = %s, response_message = %s
                WHERE id = %s
            """, (status, message, record_id))
            
            conn.commit()
            
        except psycopg2.Error as e:
            logger.error(f"Database error in update_adjustment_status: {e}")
            raise


    def list_adjustments(self, *, limit: int = 50, item_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List inventory adjustment logs with optional filtering"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            if item_id:
                cursor.execute("""
                    SELECT id, barcode, quantity, reason, field, status, response_message, adjusted_by, created_at
                    FROM inventory_logs
                    WHERE barcode = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (item_id, limit))
            else:
                cursor.execute("""
                    SELECT id, barcode, quantity, reason, field, status, response_message, adjusted_by, created_at
                    FROM inventory_logs
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (limit,))
            
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'adjusted_by', 'created_at']
            rows = cursor.fetchall()
            
            adjustments = []
            for row in rows:
                adjustment = dict(zip(columns, row))
                # Convert datetime to ISO string for frontend compatibility
                if adjustment.get('created_at'):
                    adjustment['created_at'] = adjustment['created_at'].isoformat() if hasattr(adjustment['created_at'], 'isoformat') else str(adjustment['created_at'])
                adjustments.append(adjustment)
            
            return adjustments
            
        except psycopg2.Error as e:
            logger.error(f"Database error in list_adjustments: {e}")
            return []
        finally:
            self.return_connection(conn)

    def get_item_history(self, barcode: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get adjustment history for a specific item by barcode"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, barcode, quantity, reason, field, status, response_message, adjusted_by, created_at
                FROM inventory_logs
                WHERE barcode = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (barcode, limit))
            
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'adjusted_by', 'created_at']
            rows = cursor.fetchall()
            
            adjustments = []
            for row in rows:
                adjustment = dict(zip(columns, row))
                # Convert datetime to ISO string for frontend compatibility
                if adjustment.get('created_at'):
                    adjustment['created_at'] = adjustment['created_at'].isoformat() if hasattr(adjustment['created_at'], 'isoformat') else str(adjustment['created_at'])
                adjustments.append(adjustment)
            
            return adjustments
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_item_history: {e}")
            return []
        finally:
            self.return_connection(conn)

    def get_adjustments_summary(self, start_date: str, end_date: str) -> Dict[str, Any]:
        """Get adjustments summary for date range"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Count by status
            cursor.execute("""
                SELECT 
                    status,
                    COUNT(*) as count,
                    SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) as total_in,
                    SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END) as total_out
                FROM inventory_logs
                WHERE created_at::date BETWEEN %s AND %s
                GROUP BY status
            """, (start_date, end_date))
            
            status_summary = {}
            total_adjustments = 0
            
            for row in cursor.fetchall():
                status, count, total_in, total_out = row
                status_key = status or 'Pending'
                status_summary[status_key] = {
                    'count': count,
                    'total_in': total_in or 0,
                    'total_out': total_out or 0
                }
                total_adjustments += count
            
            return {
                'total_adjustments': total_adjustments,
                'status_breakdown': status_summary,
                'date_range': {'start': start_date, 'end': end_date}
            }
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_adjustments_summary: {e}")
            return {
                'total_adjustments': 0,
                'status_breakdown': {},
                'date_range': {'start': start_date, 'end': end_date}
            }
        finally:
            self.return_connection(conn)

    def get_metadata_connection(self):
        """Get connection for inventory metadata - same as management module"""
        try:
            # Try dedicated inventory database first
            return get_inventory_log_connection()
        except (ValueError, Exception) as e:
            logger.warning(f"Inventory database not available ({e}), using main database")
            # Fallback to main database
            from core.db import get_psycopg_connection
            return get_psycopg_connection()

    def update_metadata_quantity(self, item_id: str, field: str, delta: int) -> None:
        """Update inventory metadata quantity immediately for real-time tracking"""
        allowed_fields = ["shelf_lt1_qty", "shelf_gt1_qty", "top_floor_total"]
        if field not in allowed_fields:
            logger.warning(f"Invalid field ignored: {field}. Allowed: {allowed_fields}")
            return

        logger.info(f"Updating metadata: item_id={item_id}, field={field}, delta={delta}")
        
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # First check if record exists
            logger.info(f"Checking if record exists for item_id: {item_id}")
            cursor.execute("SELECT item_id FROM inventory_metadata WHERE item_id = %s", (item_id,))
            exists = cursor.fetchone()
            logger.info(f"Record exists check: {exists is not None}")
            
            if exists:
                cursor.execute(f"""
                    UPDATE inventory_metadata 
                    SET {field} = GREATEST(0, COALESCE({field}, 0) + %s)
                    WHERE item_id = %s
                """, (delta, item_id))
                logger.info(f"Updated existing metadata: {item_id} [{field} += {delta}]")
            else:
                initial_values = {
                    'shelf_lt1_qty': max(0, delta) if field == 'shelf_lt1_qty' else 0,
                    'shelf_gt1_qty': max(0, delta) if field == 'shelf_gt1_qty' else 0,
                    'top_floor_total': max(0, delta) if field == 'top_floor_total' else 0
                }
                
                # Generate a temporary SKU based on item_id for new records
                temp_sku = f"SCAN-{item_id[-8:]}"
                
                cursor.execute("""
                    INSERT INTO inventory_metadata 
                    (sku, item_id, location, date, shelf_lt1, shelf_lt1_qty, shelf_gt1, shelf_gt1_qty, 
                     top_floor_expiry, top_floor_total, status, uk_fr_preorder)
                    VALUES (%s, %s, NULL, NULL, NULL, %s, NULL, %s, NULL, %s, NULL, NULL)
                    ON CONFLICT (sku) DO UPDATE SET
                        shelf_lt1_qty = GREATEST(0, COALESCE(inventory_metadata.shelf_lt1_qty, 0) + EXCLUDED.shelf_lt1_qty),
                        shelf_gt1_qty = GREATEST(0, COALESCE(inventory_metadata.shelf_gt1_qty, 0) + EXCLUDED.shelf_gt1_qty),
                        top_floor_total = GREATEST(0, COALESCE(inventory_metadata.top_floor_total, 0) + EXCLUDED.top_floor_total),
                        updated_at = CURRENT_TIMESTAMP
                """, (
                    temp_sku,
                    item_id,
                    initial_values['shelf_lt1_qty'],
                    initial_values['shelf_gt1_qty'],
                    initial_values['top_floor_total']
                ))
                logger.info(f"Created new metadata: {item_id} with {field}={delta}")
            
            conn.commit()
            
        except psycopg2.Error as e:
            logger.error(f"Failed to update inventory_metadata for {item_id}: {e}")
            conn.rollback()
            raise
        finally:
            self.return_connection(conn)

    def update_branch_inventory_quantity(self, item_id: str, field: str, delta: int, branch_id: str) -> None:
        """Update branch-specific inventory quantity for real-time tracking
        
        Args:
            item_id: The item barcode/ID
            field: The field to update (shelf_lt1_qty, shelf_gt1_qty, top_floor_total)
            delta: The quantity change (positive or negative)
            branch_id: The branch ID (e.g., 'uk-birmingham', 'uk-london', 'fr-paris')
        """
        # Map branch_id to table name
        branch_table_map = {
            'uk-birmingham': 'uk_birmingham_inventory',
            'uk-london': 'uk_london_inventory',
            'fr-paris': 'fr_paris_inventory'
        }
        
        table_name = branch_table_map.get(branch_id)
        if not table_name:
            logger.error(f"Unknown branch_id: {branch_id}")
            raise ValueError(f"Unknown branch_id: {branch_id}")
        
        allowed_fields = ["shelf_lt1_qty", "shelf_gt1_qty", "top_floor_total"]
        if field not in allowed_fields:
            logger.warning(f"Invalid field ignored: {field}. Allowed: {allowed_fields}")
            return

        logger.info(f"Updating branch inventory: table={table_name}, item_id={item_id}, field={field}, delta={delta}")
        
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # First check if record exists
            logger.info(f"Checking if record exists in {table_name} for item_id: {item_id}")
            cursor.execute(f"SELECT item_id FROM {table_name} WHERE item_id = %s", (item_id,))
            exists = cursor.fetchone()
            logger.info(f"Record exists check: {exists is not None}")
            
            if exists:
                cursor.execute(f"""
                    UPDATE {table_name} 
                    SET {field} = GREATEST(0, COALESCE({field}, 0) + %s),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE item_id = %s
                """, (delta, item_id))
                logger.info(f"Updated existing {table_name}: {item_id} [{field} += {delta}]")
            else:
                initial_values = {
                    'shelf_lt1_qty': max(0, delta) if field == 'shelf_lt1_qty' else 0,
                    'shelf_gt1_qty': max(0, delta) if field == 'shelf_gt1_qty' else 0,
                    'top_floor_total': max(0, delta) if field == 'top_floor_total' else 0
                }
                
                # Generate a temporary SKU based on item_id for new records
                temp_sku = f"SCAN-{item_id[-8:]}"
                
                cursor.execute(f"""
                    INSERT INTO {table_name} 
                    (sku, item_id, location, date, shelf_lt1, shelf_lt1_qty, shelf_gt1, shelf_gt1_qty, 
                     top_floor_expiry, top_floor_total, status, uk_fr_preorder)
                    VALUES (%s, %s, NULL, NULL, NULL, %s, NULL, %s, NULL, %s, NULL, NULL)
                    ON CONFLICT (sku) DO UPDATE SET
                        {field} = GREATEST(0, COALESCE({table_name}.{field}, 0) + EXCLUDED.{field}),
                        updated_at = CURRENT_TIMESTAMP
                """, (
                    temp_sku,
                    item_id,
                    initial_values['shelf_lt1_qty'],
                    initial_values['shelf_gt1_qty'],
                    initial_values['top_floor_total']
                ))
                logger.info(f"Created new record in {table_name}: {item_id} with {field}={delta}")
            
            conn.commit()
            
        except psycopg2.Error as e:
            logger.error(f"Failed to update {table_name} for {item_id}: {e}")
            conn.rollback()
            raise
        finally:
            self.return_connection(conn)

    def mark_corrupted_adjustments_as_failed(self) -> int:
        """Mark adjustments with corrupted barcode data (tabs, multiple IDs) as failed"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Find and mark corrupted adjustments as failed
            cursor.execute("""
                UPDATE inventory_logs
                SET status = 'Error', 
                    response_message = 'Corrupted barcode data - contains invalid characters'
                WHERE (status IS NULL OR status != 'Success')
                AND (
                    barcode LIKE '%\\t%' OR 
                    barcode LIKE '%\\n%' OR 
                    barcode LIKE '%\\r%' OR
                    LENGTH(barcode) > 50 OR
                    barcode ~ '[[:space:]]{2,}'
                )
                RETURNING id
            """)
            
            affected_rows = cursor.rowcount
            conn.commit()
            
            logger.info(f"Marked {affected_rows} corrupted adjustments as failed")
            return affected_rows
            
        except psycopg2.Error as e:
            logger.error(f"Database error in mark_corrupted_adjustments_as_failed: {e}")
            return 0
        finally:
            self.return_connection(conn)

    def get_item_metadata(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Get inventory metadata for a specific item from global table"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT item_id, shelf_lt1_qty, shelf_gt1_qty, top_floor_total
                FROM inventory_metadata
                WHERE item_id = %s
            """, (item_id,))
            
            row = cursor.fetchone()
            if row:
                return {
                    'item_id': row[0],
                    'shelf_lt1_qty': row[1],
                    'shelf_gt1_qty': row[2],
                    'top_floor_total': row[3]
                }
            return None
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_item_metadata: {e}")
            return None
        finally:
            self.return_connection(conn)

    def get_branch_item_metadata(self, item_id: str, branch_id: str) -> Optional[Dict[str, Any]]:
        """Get inventory metadata for a specific item from branch-specific table
        
        Args:
            item_id: The item barcode/ID
            branch_id: The branch ID (e.g., 'uk-birmingham', 'uk-london', 'fr-paris')
        """
        # Map branch_id to table name
        branch_table_map = {
            'uk-birmingham': 'uk_birmingham_inventory',
            'uk-london': 'uk_london_inventory',
            'fr-paris': 'fr_paris_inventory'
        }
        
        table_name = branch_table_map.get(branch_id)
        if not table_name:
            logger.error(f"Unknown branch_id: {branch_id}")
            return None
        
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT item_id, shelf_lt1_qty, shelf_gt1_qty, top_floor_total
                FROM {table_name}
                WHERE item_id = %s
            """, (item_id,))
            
            row = cursor.fetchone()
            if row:
                return {
                    'item_id': row[0],
                    'shelf_lt1_qty': row[1],
                    'shelf_gt1_qty': row[2],
                    'top_floor_total': row[3]
                }
            return None
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_branch_item_metadata for {branch_id}: {e}")
            return None
        finally:
            self.return_connection(conn)

    def init_tables(self) -> None:
        """Initialize inventory tables in PostgreSQL"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS inventory_logs (
                    id SERIAL PRIMARY KEY,
                    barcode VARCHAR(255) NOT NULL,
                    quantity INTEGER NOT NULL,
                    reason VARCHAR(255) NOT NULL,
                    field VARCHAR(50) NOT NULL,
                    status VARCHAR(50),
                    response_message TEXT,
                    adjusted_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create inventory_metadata table (matching actual production table schema)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS inventory_metadata (
                    item_id VARCHAR(50) PRIMARY KEY,
                    location VARCHAR(100),
                    date VARCHAR(20),
                    uk_6m_data VARCHAR(100),
                    shelf_lt1 VARCHAR(100),
                    shelf_lt1_qty INTEGER DEFAULT 0,
                    shelf_gt1 VARCHAR(100),
                    shelf_gt1_qty INTEGER DEFAULT 0,
                    top_floor_expiry VARCHAR(20),
                    top_floor_total INTEGER DEFAULT 0,
                    status VARCHAR(50) DEFAULT 'Active',
                    uk_fr_preorder VARCHAR(100),
                    fr_6m_data VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_inventory_logs_barcode 
                ON inventory_logs (barcode)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at 
                ON inventory_logs (created_at)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_inventory_logs_status 
                ON inventory_logs (status)
            """)
            
            conn.commit()
            logger.info("Inventory tables initialized successfully")
            
        except psycopg2.Error as e:
            logger.error(f"Database error in init_tables: {e}")
            raise
        finally:
            self.return_connection(conn)

    def init_idempotency_table(self) -> None:
        """Create the table that de-duplicates offline scan replays from mobile devices."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mobile_scan_idempotency (
                    idempotency_key  VARCHAR(255) PRIMARY KEY,
                    barcode          VARCHAR(255),
                    field            VARCHAR(50),
                    delta            INTEGER,
                    branch_id        VARCHAR(50),
                    status           VARCHAR(50) DEFAULT 'claimed',
                    response_message TEXT,
                    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
        except psycopg2.Error as e:
            logger.error(f"Database error in init_idempotency_table: {e}")
            conn.rollback()
            raise
        finally:
            self.return_connection(conn)

    def try_claim_idempotency_key(self, key: str, barcode: str, field: str,
                                  delta: int, branch_id: str) -> bool:
        """
        Atomically claim an idempotency key.

        Returns True if the key was newly inserted (caller should apply the scan),
        or False if the key already exists (a replay → caller should skip).
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mobile_scan_idempotency
                    (idempotency_key, barcode, field, delta, branch_id, status)
                VALUES (%s, %s, %s, %s, %s, 'claimed')
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING idempotency_key
            """, (key, barcode, field, delta, branch_id))
            claimed = cursor.fetchone() is not None
            conn.commit()
            return claimed
        except psycopg2.Error as e:
            logger.error(f"Database error claiming idempotency key {key}: {e}")
            conn.rollback()
            raise
        finally:
            self.return_connection(conn)

    def mark_idempotency_result(self, key: str, status: str, response_message: str) -> None:
        """Record the final outcome ('applied' or 'error') for a claimed scan key."""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE mobile_scan_idempotency
                SET status = %s, response_message = %s
                WHERE idempotency_key = %s
            """, (status, response_message, key))
            conn.commit()
        except psycopg2.Error as e:
            logger.error(f"Database error marking idempotency key {key}: {e}")
            conn.rollback()
        finally:
            self.return_connection(conn)
