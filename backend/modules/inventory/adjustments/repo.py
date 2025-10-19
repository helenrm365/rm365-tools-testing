from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging

from common.deps import pg_conn
from core.db import get_inventory_log_connection

logger = logging.getLogger(__name__)


class AdjustmentsRepo:
    def __init__(self):
        pass

    def get_connection(self):
        """Get connection for inventory adjustments - try inventory DB first, fallback to main DB"""
        try:
            # Try dedicated inventory database first
            return get_inventory_log_connection()
        except (ValueError, Exception) as e:
            logger.warning(f"Inventory database not available ({e}), using main database")
            # Fallback to main database
            from core.db import get_psycopg_connection
            return get_psycopg_connection()

    def create_adjustment_log(self, adjustment_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new adjustment log record"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # PostgreSQL version with RETURNING
            cursor.execute("""
                INSERT INTO inventory_logs 
                (barcode, quantity, reason, field, status, response_message, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                RETURNING id, barcode, quantity, reason, field, status, response_message, created_at
            """, (
                adjustment_data['barcode'],
                adjustment_data['quantity'],
                adjustment_data['reason'],
                adjustment_data['field'],
                adjustment_data.get('status'),
                adjustment_data.get('response_message')
            ))
            
            row = cursor.fetchone()
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'created_at']
            
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
            conn.close()

    def get_pending_adjustments(self) -> List[Dict[str, Any]]:
        """Get all pending adjustment logs (not yet synced to Zoho)"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, barcode, quantity, reason, field, status, response_message, created_at
                FROM inventory_logs
                WHERE status IS NULL OR status != 'Success'
                ORDER BY created_at ASC
            """)
            
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'created_at']
            rows = cursor.fetchall()
            
            adjustments = []
            for row in rows:
                adjustment = dict(zip(columns, row))
                # Convert datetime to ISO string for frontend compatibility
                if adjustment.get('created_at'):
                    adjustment['created_at'] = adjustment['created_at'].isoformat() if hasattr(adjustment['created_at'], 'isoformat') else str(adjustment['created_at'])
                adjustments.append(adjustment)
                
            logger.info(f"Found {len(adjustments)} pending adjustments to sync")
            
            return adjustments
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_pending_adjustments: {e}")
            return []
        finally:
            conn.close()

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
                    SELECT id, barcode, quantity, reason, field, status, response_message, created_at
                    FROM inventory_logs
                    WHERE barcode = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (item_id, limit))
            else:
                cursor.execute("""
                    SELECT id, barcode, quantity, reason, field, status, response_message, created_at
                    FROM inventory_logs
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (limit,))
            
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'created_at']
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
            conn.close()

    def get_item_history(self, barcode: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get adjustment history for a specific item by barcode"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, barcode, quantity, reason, field, status, response_message, created_at
                FROM inventory_logs
                WHERE barcode = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (barcode, limit))
            
            columns = ['id', 'barcode', 'quantity', 'reason', 'field', 'status', 'response_message', 'created_at']
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
            conn.close()

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
            conn.close()

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
                
                cursor.execute("""
                    INSERT INTO inventory_metadata 
                    (item_id, location, date, shelf_lt1, shelf_lt1_qty, shelf_gt1, shelf_gt1_qty, 
                     top_floor_expiry, top_floor_total, status, uk_fr_preorder)
                    VALUES (%s, '', '', '', %s, '', %s, '', %s, '', '')
                """, (
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
            conn.close()

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
            conn.close()

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
            conn.close()
