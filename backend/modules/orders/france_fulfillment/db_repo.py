"""
Database-backed repository for managing France Orders fulfillment sessions.
Replaces the JSON file-based storage with PostgreSQL for better reliability,
concurrency, and historical analysis.

Uses the INVENTORY database (rm365) for storage.
Inventory operations use the fr_paris_inventory table.
"""
from typing import Dict, Optional, List
from datetime import datetime
import uuid
import json
import logging

from core.db import get_inventory_log_connection, return_inventory_connection
from modules.orders.order_fulfillment.models import ScanSession

logger = logging.getLogger(__name__)

# France branch inventory table
FRANCE_INVENTORY_TABLE = 'fr_paris_inventory'

# France session tables (renamed from order_fulfillment_* to france_order_fulfillment_*)
FRANCE_SESSIONS_TABLE = 'france_order_fulfillment_sessions'
FRANCE_TAKEOVER_TABLE = 'france_order_fulfillment_takeover_requests'


def init_france_fulfillment_tables():
    """Initialize the order fulfillment database tables in the INVENTORY database"""
    conn = None
    try:
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        
        # Migration: Rename old tables if they exist
        cursor.execute("""
            DO $$
            BEGIN
                -- Rename sessions table if old name exists and new name doesn't
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'order_fulfillment_sessions')
                   AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'france_order_fulfillment_sessions') THEN
                    ALTER TABLE order_fulfillment_sessions RENAME TO france_order_fulfillment_sessions;
                    RAISE NOTICE 'Renamed order_fulfillment_sessions to france_order_fulfillment_sessions';
                END IF;
                
                -- Rename takeover table if old name exists and new name doesn't
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'order_fulfillment_takeover_requests')
                   AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'france_order_fulfillment_takeover_requests') THEN
                    ALTER TABLE order_fulfillment_takeover_requests RENAME TO france_order_fulfillment_takeover_requests;
                    RAISE NOTICE 'Renamed order_fulfillment_takeover_requests to france_order_fulfillment_takeover_requests';
                END IF;
            END $$;
        """)
        
        # Main sessions table (now with france_ prefix)
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {FRANCE_SESSIONS_TABLE} (
                session_id UUID PRIMARY KEY,
                invoice_id VARCHAR(100) NOT NULL,
                order_number VARCHAR(100) NOT NULL,
                session_type VARCHAR(30) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'draft',
                user_id VARCHAR(100),
                created_by VARCHAR(100),
                last_modified_by VARCHAR(100),
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                last_modified_at TIMESTAMPTZ DEFAULT NOW(),
                items_expected JSONB DEFAULT '[]'::jsonb,
                items_scanned JSONB DEFAULT '[]'::jsonb,
                items_counted JSONB DEFAULT '[]'::jsonb,
                audit_logs JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        
        # Takeover requests table
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {FRANCE_TAKEOVER_TABLE} (
                request_id UUID PRIMARY KEY,
                session_id UUID REFERENCES {FRANCE_SESSIONS_TABLE}(session_id) ON DELETE CASCADE,
                requested_by VARCHAR(100) NOT NULL,
                current_owner VARCHAR(100) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'pending',
                requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                responded_at TIMESTAMPTZ
            )
        """)
        
        # Create indexes for common queries
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_sessions_order_number 
            ON {FRANCE_SESSIONS_TABLE}(order_number)
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_sessions_status 
            ON {FRANCE_SESSIONS_TABLE}(status)
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_sessions_user_id 
            ON {FRANCE_SESSIONS_TABLE}(user_id)
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_sessions_started_at 
            ON {FRANCE_SESSIONS_TABLE}(started_at)
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_sessions_invoice_id 
            ON {FRANCE_SESSIONS_TABLE}(invoice_id)
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_takeover_session_id 
            ON {FRANCE_TAKEOVER_TABLE}(session_id)
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_france_takeover_current_owner 
            ON {FRANCE_TAKEOVER_TABLE}(current_owner)
        """)
        
        # Migration: Add items_counted column if it doesn't exist (for existing databases)
        cursor.execute(f"""
            ALTER TABLE {FRANCE_SESSIONS_TABLE} 
            ADD COLUMN IF NOT EXISTS items_counted JSONB DEFAULT '[]'::jsonb
        """)
        
        conn.commit()
        cursor.close()
        logger.info("✅ France order fulfillment tables initialized in INVENTORY database")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error initializing order fulfillment tables: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            return_inventory_connection(conn)


def check_france_fulfillment_tables_exist() -> dict:
    """Check which order fulfillment tables exist in the database"""
    conn = None
    try:
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        
        # France order fulfillment module requires these tables
        tables = [
            FRANCE_SESSIONS_TABLE,
            FRANCE_TAKEOVER_TABLE
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


class FranceDbRepo:
    """Database-backed repository for Magento invoice scanning sessions (uses INVENTORY database)"""
    
    def __init__(self):
        # Initialize tables on first use
        try:
            init_france_fulfillment_tables()
        except Exception as e:
            logger.warning(f"Could not initialize tables (may already exist): {e}")
    
    def _get_connection(self):
        """Get a database connection from INVENTORY pool"""
        return get_inventory_log_connection()
    
    def _return_connection(self, conn):
        """Return connection to INVENTORY pool"""
        return_inventory_connection(conn)
    
    def _row_to_session(self, row, cursor) -> ScanSession:
        """Convert a database row to a ScanSession object"""
        columns = [desc[0] for desc in cursor.description]
        data = dict(zip(columns, row))
        
        return ScanSession(
            session_id=str(data['session_id']),
            invoice_id=data['invoice_id'],
            order_number=data['order_number'],
            session_type=data['session_type'],
            status=data['status'],
            user_id=data['user_id'],
            created_by=data['created_by'],
            last_modified_by=data['last_modified_by'],
            started_at=data['started_at'],
            completed_at=data['completed_at'],
            last_modified_at=data['last_modified_at'],
            items_expected=data['items_expected'] or [],
            items_scanned=data['items_scanned'] or [],
            items_counted=data.get('items_counted') or [],
            audit_logs=data['audit_logs'] or []
        )
    
    def get_sku_by_item_id(self, item_id: str) -> Optional[str]:
        """
        Look up SKU by item_id from France inventory table.
        READ-ONLY operation.
        """
        conn = None
        conn_type = None
        try:
            # Try inventory database first, fallback to main database
            try:
                from core.db import get_inventory_log_connection, return_inventory_connection
                conn = get_inventory_log_connection()
                conn_type = 'inventory'
            except (ValueError, Exception) as e:
                logger.warning(f"Inventory database not available ({e}), using main database")
                conn = self._get_connection()
                conn_type = 'psycopg'
            
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT sku FROM {FRANCE_INVENTORY_TABLE} WHERE item_id = %s",
                (item_id,)
            )
            result = cursor.fetchone()
            cursor.close()
            
            # Return connection to appropriate pool
            if conn_type == 'inventory':
                from core.db import return_inventory_connection
                return_inventory_connection(conn)
            else:
                self._return_connection(conn)
            
            if result:
                logger.info(f"Found SKU '{result[0]}' for item_id '{item_id}'")
                return result[0]
            
            logger.warning(f"No SKU found for item_id '{item_id}'")
            return None
            
        except Exception as e:
            logger.error(f"Error looking up SKU by item_id: {e}")
            return None
    
    def _add_audit_log(self, conn, session_id: str, action: str, user: str, details: Optional[str] = None):
        """Add an audit log entry to a session"""
        cursor = conn.cursor()
        
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'action': action,
            'user': user,
            'details': details
        }
        
        # Append to the audit_logs JSONB array
        cursor.execute("""
            UPDATE france_order_fulfillment_sessions 
            SET audit_logs = COALESCE(audit_logs, '[]'::jsonb) || %s::jsonb
            WHERE session_id = %s
        """, (json.dumps([log_entry]), session_id))
        
        cursor.close()
    
    def create_session(self, 
                      invoice_id: str,
                      order_number: str,
                      session_type: str,
                      items_expected: List[dict],
                      user_id: Optional[str] = None) -> ScanSession:
        """Create a new scanning session"""
        session_id = str(uuid.uuid4())
        
        # If user_id provided, start as in_progress, otherwise draft
        status = "in_progress" if user_id else "draft"
        now = datetime.now()
        
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO france_order_fulfillment_sessions 
                (session_id, invoice_id, order_number, session_type, status, 
                 user_id, created_by, last_modified_by, started_at, last_modified_at,
                 items_expected, items_scanned, audit_logs)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                session_id, invoice_id, order_number, session_type, status,
                user_id, user_id, user_id, now, now,
                json.dumps(items_expected), json.dumps([]), json.dumps([])
            ))
            
            # Add audit log
            if user_id:
                self._add_audit_log(conn, session_id, "started", user_id, f"Started {session_type} session")
            
            conn.commit()
            cursor.close()
            
            # Fetch and return the created session
            return self.get_session(session_id)
            
        except Exception as e:
            logger.error(f"Error creating session: {e}")
            if conn:
                conn.rollback()
            raise
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_session(self, session_id: str) -> Optional[ScanSession]:
        """Get a session by ID"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return None
            
            session = self._row_to_session(row, cursor)
            cursor.close()
            return session
            
        except Exception as e:
            logger.error(f"Error getting session: {e}")
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_active_session_for_invoice(self, invoice_id: str) -> Optional[ScanSession]:
        """Get any active (in_progress) session for a specific invoice"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM france_order_fulfillment_sessions 
                WHERE invoice_id = %s AND status = 'in_progress'
                LIMIT 1
            """, (invoice_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return None
            
            session = self._row_to_session(row, cursor)
            cursor.close()
            return session
            
        except Exception as e:
            logger.error(f"Error getting active session for invoice: {e}")
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_any_session_for_invoice(self, invoice_id: str) -> Optional[ScanSession]:
        """
        Get the most recent ACTIVE session for an invoice.
        Excludes archived and cancelled sessions so orders can be re-approved.
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Exclude archived and cancelled sessions - they should not block new sessions
            cursor.execute("""
                SELECT * FROM france_order_fulfillment_sessions 
                WHERE invoice_id = %s
                AND status NOT IN ('archived', 'cancelled')
                ORDER BY started_at DESC
                LIMIT 1
            """, (invoice_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return None
            
            session = self._row_to_session(row, cursor)
            cursor.close()
            return session
            
        except Exception as e:
            logger.error(f"Error getting any session for invoice: {e}")
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_archived_session_for_invoice(self, invoice_id: str) -> Optional[ScanSession]:
        """
        Get the most recent archived session for an invoice.
        Used when reactivating an order that was archived but still processing on Magento.
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM france_order_fulfillment_sessions 
                WHERE invoice_id = %s
                AND status = 'archived'
                ORDER BY last_modified_at DESC
                LIMIT 1
            """, (invoice_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return None
            
            session = self._row_to_session(row, cursor)
            cursor.close()
            return session
            
        except Exception as e:
            logger.error(f"Error getting archived session for invoice: {e}")
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def reactivate_session(self, session_id: str, user_id: str) -> bool:
        """
        Reactivate an archived session by setting status to 'approved'.
        Preserves all audit history and adds a reactivation entry.
        
        Args:
            session_id: The session to reactivate
            user_id: The user reactivating the session
            
        Returns:
            True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session for audit log
            cursor.execute("""
                SELECT status, audit_logs FROM france_order_fulfillment_sessions 
                WHERE session_id = %s
            """, (session_id,))
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
                
            old_status, audit_logs = row
            
            # Parse existing audit logs
            if isinstance(audit_logs, str):
                audit_logs = json.loads(audit_logs) if audit_logs else []
            elif audit_logs is None:
                audit_logs = []
            
            # Add reactivation entry
            audit_logs.append({
                'timestamp': datetime.now().isoformat(),
                'action': 'reactivated',
                'user': user_id,
                'details': f'Session reactivated from {old_status} status - order still processing on Magento'
            })
            
            # Update session
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'approved',
                    audit_logs = %s::jsonb,
                    last_modified_at = NOW(),
                    last_modified_by = %s
                WHERE session_id = %s
            """, (json.dumps(audit_logs), user_id, session_id))
            
            conn.commit()
            cursor.close()
            
            logger.info(f"✅ Reactivated session {session_id} from {old_status} to approved by {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error reactivating session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)

    def get_all_sessions(self, include_archived: bool = False) -> List[ScanSession]:
        """Get all sessions from the database.
        
        Args:
            include_archived: If True, includes archived/cancelled sessions. Default False.
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            if include_archived:
                cursor.execute("""
                    SELECT * FROM france_order_fulfillment_sessions 
                    ORDER BY started_at DESC
                """)
            else:
                # Exclude archived and cancelled sessions from active view
                cursor.execute("""
                    SELECT * FROM france_order_fulfillment_sessions 
                    WHERE status NOT IN ('archived', 'cancelled')
                    ORDER BY started_at DESC
                """)
            
            rows = cursor.fetchall()
            sessions = []
            
            for row in rows:
                session = self._row_to_session(row, cursor)
                if session:
                    sessions.append(session)
            
            cursor.close()
            return sessions
            
        except Exception as e:
            logger.error(f"Error getting all sessions: {e}")
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def update_session(self, session_id: str, **updates) -> Optional[ScanSession]:
        """Update session fields"""
        if not updates:
            return self.get_session(session_id)
        
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Build SET clause dynamically
            set_clauses = []
            values = []
            
            for key, value in updates.items():
                if key in ['items_expected', 'items_scanned', 'audit_logs']:
                    set_clauses.append(f"{key} = %s::jsonb")
                    values.append(json.dumps(value))
                else:
                    set_clauses.append(f"{key} = %s")
                    values.append(value)
            
            values.append(session_id)
            
            cursor.execute(f"""
                UPDATE france_order_fulfillment_sessions 
                SET {', '.join(set_clauses)}
                WHERE session_id = %s
            """, values)
            
            conn.commit()
            cursor.close()
            
            return self.get_session(session_id)
            
        except Exception as e:
            logger.error(f"Error updating session: {e}")
            if conn:
                conn.rollback()
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def add_scanned_item(self, session_id: str, sku: str, quantity: float, deduction_sources: list = None) -> bool:
        """
        Add a scanned item to the session
        
        Args:
            session_id: The session ID
            sku: The product SKU
            quantity: The quantity scanned (positive to add, negative to remove)
            deduction_sources: List of dicts with 'field' and 'quantity' showing where items were taken from
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current items_scanned
            cursor.execute("""
                SELECT items_scanned FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            items_scanned = row[0] or []
            
            # Find if this SKU was already scanned
            existing_idx = None
            for i, item in enumerate(items_scanned):
                if item['sku'] == sku:
                    existing_idx = i
                    break
            
            if existing_idx is not None:
                items_scanned[existing_idx]['qty_scanned'] += quantity
                
                # Merge deduction sources
                if deduction_sources:
                    existing_sources = items_scanned[existing_idx].get('deduction_sources', [])
                    for new_source in deduction_sources:
                        # Find if this field already exists
                        field_exists = False
                        for es in existing_sources:
                            if es['field'] == new_source['field']:
                                es['quantity'] += new_source['quantity']
                                es['remaining'] = es.get('remaining', 0) + new_source['quantity']
                                field_exists = True
                                break
                        if not field_exists:
                            existing_sources.append({
                                'field': new_source['field'],
                                'quantity': new_source['quantity'],
                                'remaining': new_source['quantity']
                            })
                    items_scanned[existing_idx]['deduction_sources'] = existing_sources
            else:
                new_item = {
                    'sku': sku,
                    'qty_scanned': quantity,
                    'scanned_at': datetime.now().isoformat()
                }
                if deduction_sources:
                    new_item['deduction_sources'] = [
                        {'field': s['field'], 'quantity': s['quantity'], 'remaining': s['quantity']}
                        for s in deduction_sources
                    ]
                items_scanned.append(new_item)
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET items_scanned = %s::jsonb, last_modified_at = NOW()
                WHERE session_id = %s
            """, (json.dumps(items_scanned), session_id))
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error adding scanned item: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_scanned_quantity(self, session_id: str, sku: str) -> float:
        """Get the total quantity scanned for a specific SKU"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT items_scanned FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return 0.0
            
            items_scanned = row[0] or []
            cursor.close()
            
            for item in items_scanned:
                if item['sku'] == sku:
                    return item['qty_scanned']
            
            return 0.0
            
        except Exception as e:
            logger.error(f"Error getting scanned quantity: {e}")
            return 0.0
        finally:
            if conn:
                self._return_connection(conn)

    def get_deduction_sources(self, session_id: str, sku: str) -> list:
        """
        Get the deduction sources for a specific SKU in a session.
        Returns list of {'field': str, 'quantity': int, 'remaining': int}
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT items_scanned FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return []
            
            items_scanned = row[0] or []
            cursor.close()
            
            for item in items_scanned:
                if item['sku'] == sku:
                    return item.get('deduction_sources', [])
            
            return []
            
        except Exception as e:
            logger.error(f"Error getting deduction sources: {e}")
            return []
        finally:
            if conn:
                self._return_connection(conn)

    def update_deduction_source_remaining(self, session_id: str, sku: str, field: str, qty_returned: int) -> bool:
        """
        Update the 'remaining' count for a deduction source after items are returned.
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current items_scanned
            cursor.execute("""
                SELECT items_scanned FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            items_scanned = row[0] or []
            
            # Find the SKU and update the deduction source
            for item in items_scanned:
                if item['sku'] == sku:
                    sources = item.get('deduction_sources', [])
                    for source in sources:
                        if source['field'] == field:
                            source['remaining'] = max(0, source.get('remaining', source['quantity']) - qty_returned)
                            break
                    item['deduction_sources'] = sources
                    break
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET items_scanned = %s::jsonb, last_modified_at = NOW()
                WHERE session_id = %s
            """, (json.dumps(items_scanned), session_id))
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error updating deduction source remaining: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)

    def reduce_scanned_quantity(self, session_id: str, sku: str, quantity: float) -> bool:
        """Reduce the scanned quantity for a SKU (for returns/undos)"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current items_scanned
            cursor.execute("""
                SELECT items_scanned FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            items_scanned = row[0] or []
            
            # Find and update the SKU's quantity
            for item in items_scanned:
                if item['sku'] == sku:
                    item['qty_scanned'] = max(0, item['qty_scanned'] - quantity)
                    break
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET items_scanned = %s::jsonb, last_modified_at = NOW()
                WHERE session_id = %s
            """, (json.dumps(items_scanned), session_id))
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error reducing scanned quantity: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def complete_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Mark a session as completed"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session info
            cursor.execute("""
                SELECT user_id, last_modified_by FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            completing_user = user_id or row[0] or row[1] or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'completed', completed_at = NOW(), 
                    last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s
            """, (completing_user, session_id))
            
            self._add_audit_log(conn, session_id, "completed", completing_user, "Completed session")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error completing session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def cancel_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Cancel a session and clear all scanned data"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session info
            cursor.execute("""
                SELECT user_id, last_modified_by FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            cancelling_user = user_id or row[0] or row[1] or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'cancelled', completed_at = NOW(), 
                    last_modified_by = %s, last_modified_at = NOW(),
                    items_scanned = '[]'::jsonb
                WHERE session_id = %s
            """, (cancelling_user, session_id))
            
            self._add_audit_log(conn, session_id, "cancelled", cancelling_user, "Cancelled session")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error cancelling session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def restart_cancelled_session(self, session_id: str, user_id: Optional[str] = None) -> Optional[ScanSession]:
        """Restart a cancelled session by changing status back to in_progress"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Check if session is cancelled
            cursor.execute("""
                SELECT status FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row or row[0] != 'cancelled':
                cursor.close()
                return None
            
            restarting_user = user_id or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'in_progress', user_id = %s,
                    last_modified_by = %s, last_modified_at = NOW(),
                    completed_at = NULL
                WHERE session_id = %s
            """, (restarting_user, restarting_user, session_id))
            
            self._add_audit_log(conn, session_id, "restarted", restarting_user, "Restarted cancelled session")
            
            conn.commit()
            cursor.close()
            
            return self.get_session(session_id)
            
        except Exception as e:
            logger.error(f"Error restarting session: {e}")
            if conn:
                conn.rollback()
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def start_checking_session(self, session_id: str, user_id: Optional[str] = None) -> Optional[ScanSession]:
        """Start checking a session that's in ready_to_check status"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Check if session is ready_to_check
            cursor.execute("""
                SELECT status FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row or row[0] != 'ready_to_check':
                cursor.close()
                return None
            
            checking_user = user_id or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'in_progress', session_type = 'check',
                    user_id = %s, last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s
            """, (checking_user, checking_user, session_id))
            
            self._add_audit_log(conn, session_id, "checking_started", checking_user, "Started checking session")
            
            conn.commit()
            cursor.close()
            
            return self.get_session(session_id)
            
        except Exception as e:
            logger.error(f"Error starting checking session: {e}")
            if conn:
                conn.rollback()
            return None
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_active_sessions(self, user_id: Optional[str] = None) -> List[ScanSession]:
        """Get all active (in_progress) sessions, optionally filtered by user"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            if user_id:
                cursor.execute("""
                    SELECT * FROM france_order_fulfillment_sessions 
                    WHERE status = 'in_progress' AND user_id = %s
                    ORDER BY started_at DESC
                """, (user_id,))
            else:
                cursor.execute("""
                    SELECT * FROM france_order_fulfillment_sessions 
                    WHERE status = 'in_progress'
                    ORDER BY started_at DESC
                """)
            
            rows = cursor.fetchall()
            sessions = [self._row_to_session(row, cursor) for row in rows]
            cursor.close()
            return sessions
            
        except Exception as e:
            logger.error(f"Error getting active sessions: {e}")
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_draft_sessions(self) -> List[ScanSession]:
        """Get all draft sessions available to be claimed"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM france_order_fulfillment_sessions 
                WHERE status = 'draft'
                ORDER BY started_at DESC
            """)
            
            rows = cursor.fetchall()
            sessions = [self._row_to_session(row, cursor) for row in rows]
            cursor.close()
            return sessions
            
        except Exception as e:
            logger.error(f"Error getting draft sessions: {e}")
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_session_history(self, 
                           days: int = 7,
                           user_id: Optional[str] = None) -> List[ScanSession]:
        """Get session history for the last N days"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            if user_id:
                cursor.execute("""
                    SELECT * FROM france_order_fulfillment_sessions 
                    WHERE started_at >= NOW() - INTERVAL '%s days'
                    AND user_id = %s
                    ORDER BY started_at DESC
                """, (days, user_id))
            else:
                cursor.execute("""
                    SELECT * FROM france_order_fulfillment_sessions 
                    WHERE started_at >= NOW() - INTERVAL '%s days'
                    ORDER BY started_at DESC
                """, (days,))
            
            rows = cursor.fetchall()
            sessions = [self._row_to_session(row, cursor) for row in rows]
            cursor.close()
            return sessions
            
        except Exception as e:
            logger.error(f"Error getting session history: {e}")
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    # Collaborative session management methods
    
    def claim_session(self, session_id: str, user_id: str) -> bool:
        """Claim a draft or approved session and make it in_progress"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Check if session is claimable
            cursor.execute("""
                SELECT status, created_by FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row or row[0] not in ('draft', 'approved'):
                cursor.close()
                return False
            
            previous_owner = row[1] or "Unknown"
            previous_status = row[0]
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'in_progress', user_id = %s,
                    last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s
            """, (user_id, user_id, session_id))
            
            self._add_audit_log(conn, session_id, "claimed", user_id, 
                               f"Claimed {previous_status} session from {previous_owner}")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error claiming session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def release_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Release a session back to draft status (preserves scanned data)"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session info
            cursor.execute("""
                SELECT user_id FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            releasing_user = user_id or row[0] or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'draft', user_id = NULL, last_modified_at = NOW()
                WHERE session_id = %s
            """, (session_id,))
            
            self._add_audit_log(conn, session_id, "drafted", releasing_user, "Released session as draft")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error releasing session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def can_access_session(self, session_id: str, user_id: str) -> tuple:
        """Check if a user can access/modify a session"""
        session = self.get_session(session_id)
        if not session:
            return False, "Session not found"
        
        if session.status == "draft":
            return True, "Session is available (draft)"
        
        if session.status == "in_progress":
            if session.user_id == user_id:
                return True, "You own this session"
            else:
                return False, f"Session is in progress by {session.user_id}"
        
        if session.status in ["completed", "cancelled"]:
            return False, f"Session is {session.status}"
        
        return True, "Session accessible"
    
    def transfer_session(self, session_id: str, new_owner: str, 
                        transferred_by: Optional[str] = None, forced: bool = False) -> bool:
        """Transfer session ownership to another user"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session info
            cursor.execute("""
                SELECT user_id FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            previous_owner = row[0] or "Unknown"
            transfer_initiator = transferred_by or new_owner
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET user_id = %s, last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s
            """, (new_owner, new_owner, session_id))
            
            if forced:
                self._add_audit_log(conn, session_id, "forced_takeover", transfer_initiator,
                                   f"Forcefully transferred from {previous_owner} to {new_owner}")
            else:
                self._add_audit_log(conn, session_id, "transferred", transfer_initiator,
                                   f"Transferred from {previous_owner} to {new_owner}")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error transferring session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    # Order Tracking methods
    
    def get_sessions_by_status(self, statuses: List[str]) -> List[ScanSession]:
        """Get all sessions matching any of the given statuses"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            placeholders = ','.join(['%s'] * len(statuses))
            cursor.execute(f"""
                SELECT * FROM france_order_fulfillment_sessions 
                WHERE status IN ({placeholders})
                ORDER BY started_at DESC
            """, statuses)
            
            rows = cursor.fetchall()
            sessions = [self._row_to_session(row, cursor) for row in rows]
            cursor.close()
            return sessions
            
        except Exception as e:
            logger.error(f"Error getting sessions by status: {e}")
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def mark_session_ready_to_check(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Mark a session as ready to check instead of completed"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session info
            cursor.execute("""
                SELECT user_id, last_modified_by FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            marking_user = user_id or row[0] or row[1] or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'ready_to_check', 
                    last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s
            """, (marking_user, session_id))
            
            self._add_audit_log(conn, session_id, "ready_to_check", marking_user, "Marked as ready to check")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error marking session ready to check: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def send_back_for_picking(self, session_id: str, user_id: Optional[str] = None, items_counted: Optional[List[dict]] = None) -> bool:
        """Send an order back for picking from the checking phase
        
        Args:
            session_id: The session ID
            user_id: The user sending the order back
            items_counted: List of {sku, qty_counted} from the checker's count
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get current session info
            cursor.execute("""
                SELECT user_id, last_modified_by FROM france_order_fulfillment_sessions WHERE session_id = %s
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                cursor.close()
                return False
            
            sending_user = user_id or row[0] or row[1] or "Unknown"
            
            # Build update query - include items_counted if provided
            if items_counted is not None:
                cursor.execute("""
                    UPDATE france_order_fulfillment_sessions 
                    SET status = 'draft', session_type = 'pick',
                        items_counted = %s::jsonb,
                        last_modified_by = %s, last_modified_at = NOW()
                    WHERE session_id = %s
                """, (json.dumps(items_counted), sending_user, session_id))
            else:
                cursor.execute("""
                    UPDATE france_order_fulfillment_sessions 
                    SET status = 'draft', session_type = 'pick',
                        last_modified_by = %s, last_modified_at = NOW()
                    WHERE session_id = %s
                """, (sending_user, session_id))
            
            self._add_audit_log(conn, session_id, "sent_back_for_picking", sending_user, 
                               "Sent back for picking from checking phase")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error sending session back for picking: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def clear_items_counted(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Clear the items_counted field for a ready_to_check session
        
        This is used when a checker wants to restart their count without
        sending the order back for picking.
        
        Args:
            session_id: The session ID
            user_id: The user clearing the count
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            clearing_user = user_id or "Unknown"
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET items_counted = '[]'::jsonb,
                    last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s AND status = 'ready_to_check'
            """, (clearing_user, session_id))
            
            if cursor.rowcount == 0:
                cursor.close()
                return False
            
            self._add_audit_log(conn, session_id, "count_cleared", clearing_user, 
                               "Checker count cleared, order remains ready to check")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error clearing items_counted: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def approve_session(self, session_id: str, user_id: str) -> bool:
        """Approve a session for picking"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE france_order_fulfillment_sessions 
                SET status = 'approved', 
                    last_modified_by = %s, last_modified_at = NOW()
                WHERE session_id = %s
            """, (user_id, session_id))
            
            self._add_audit_log(conn, session_id, "approved", user_id, "Approved for picking")
            
            conn.commit()
            cursor.close()
            return True
            
        except Exception as e:
            logger.error(f"Error approving session: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def reset_daily_sessions(self) -> dict:
        """
        Archive all order sessions at end of day.
        
        This runs at configured time and:
        1. Adds audit log entry to ALL sessions recording their final status before archiving
        2. Marks ALL sessions as 'archived' so they don't show in the next day's list
           - Completed orders won't appear again (they're done)
           - Incomplete orders still 'processing' on Magento will reappear in pending approvals
        3. Clears all pending takeover requests
        
        Note: Inventory returns are handled by the service layer BEFORE this is called,
        only for incomplete sessions (not completed/cancelled).
        
        Returns a summary of what was archived.
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Count sessions before reset by status
            cursor.execute("""
                SELECT status, COUNT(*) FROM france_order_fulfillment_sessions 
                WHERE status != 'archived'
                GROUP BY status
            """)
            status_counts_before = dict(cursor.fetchall())
            
            # Get all non-archived sessions to add audit log entries
            cursor.execute("""
                SELECT session_id, status, audit_logs 
                FROM france_order_fulfillment_sessions 
                WHERE status != 'archived'
            """)
            sessions_to_archive = cursor.fetchall()
            
            # Add audit log entry to each session recording its final status
            archived_count = 0
            for session_id, original_status, audit_logs in sessions_to_archive:
                # Parse existing audit logs
                if isinstance(audit_logs, str):
                    audit_logs = json.loads(audit_logs) if audit_logs else []
                elif audit_logs is None:
                    audit_logs = []
                
                # Add archive entry with original status
                audit_logs.append({
                    'timestamp': datetime.now().isoformat(),
                    'action': 'archived',
                    'user': 'system_daily_reset',
                    'details': f'Daily reset - original status was: {original_status}'
                })
                
                # Update session with new audit log and archived status
                cursor.execute("""
                    UPDATE france_order_fulfillment_sessions 
                    SET status = 'archived',
                        audit_logs = %s::jsonb,
                        last_modified_at = NOW(),
                        last_modified_by = 'system_daily_reset'
                    WHERE session_id = %s
                """, (json.dumps(audit_logs), session_id))
                archived_count += 1
            
            # Clear all takeover requests
            cursor.execute("DELETE FROM france_order_fulfillment_takeover_requests")
            takeover_cleared = cursor.rowcount
            
            conn.commit()
            cursor.close()
            
            logger.info(f"✅ Daily reset completed:")
            logger.info(f"   - Archived {archived_count} sessions (by original status: {status_counts_before})")
            logger.info(f"   - Cleared {takeover_cleared} takeover requests")
            
            return {
                'success': True,
                'sessions_before': status_counts_before,
                'sessions_archived': archived_count,
                'takeover_requests_cleared': takeover_cleared,
                'reset_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Error during daily reset: {e}")
            if conn:
                conn.rollback()
            return {
                'success': False,
                'error': str(e),
                'reset_at': datetime.now().isoformat()
            }
        finally:
            if conn:
                self._return_connection(conn)
