"""
Repository for scanning logs database operations
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import json
import logging

from core.db import (
    get_inventory_log_connection,
    return_inventory_connection,
    get_psycopg_connection,
    return_psycopg_connection
)

logger = logging.getLogger(__name__)


class ScanningLogsRepo:
    """Repository for scanner submission logs"""
    
    def __init__(self):
        self._last_conn_type = None

    def get_connection(self):
        """Get database connection - prefer inventory DB, fallback to main"""
        try:
            conn = get_inventory_log_connection()
            self._last_conn_type = 'inventory'
            return conn
        except Exception as e:
            logger.warning(f"Inventory DB not available ({e}), using main DB")
            conn = get_psycopg_connection()
            self._last_conn_type = 'psycopg'
            return conn
    
    def return_connection(self, conn):
        """Return connection to appropriate pool"""
        if not conn:
            return
        if self._last_conn_type == 'inventory':
            return_inventory_connection(conn)
        else:
            return_psycopg_connection(conn)

    def init_tables(self):
        """Create scanning logs tables if they don't exist - separate tables per branch"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Create tables for each branch: uk_birmingham, uk_london, fr_paris
            branches = ['uk_birmingham', 'uk_london', 'fr_paris']
            
            for branch in branches:
                # Main submissions table for this branch
                cursor.execute(f"""
                    CREATE TABLE IF NOT EXISTS {branch}_scanner_submissions (
                        id SERIAL PRIMARY KEY,
                        reason TEXT,
                        submitted_by VARCHAR(255) NOT NULL,
                        submitted_at TIMESTAMP DEFAULT NOW(),
                        total_items INTEGER DEFAULT 0,
                        total_added INTEGER DEFAULT 0,
                        total_removed INTEGER DEFAULT 0
                    )
                """)
                
                # Submission items table for this branch
                cursor.execute(f"""
                    CREATE TABLE IF NOT EXISTS {branch}_scanner_submission_items (
                        id SERIAL PRIMARY KEY,
                        submission_id INTEGER NOT NULL REFERENCES {branch}_scanner_submissions(id) ON DELETE CASCADE,
                        sku VARCHAR(100) NOT NULL,
                        item_id VARCHAR(100),
                        product_name TEXT,
                        quantity INTEGER NOT NULL,
                        shelf_field VARCHAR(50) NOT NULL,
                        allocation_details JSONB,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """)
                
                # Create indexes for efficient querying
                cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{branch}_submissions_submitted_by 
                    ON {branch}_scanner_submissions(submitted_by)
                """)
                cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{branch}_submissions_submitted_at 
                    ON {branch}_scanner_submissions(submitted_at)
                """)
                cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{branch}_submission_items_sku 
                    ON {branch}_scanner_submission_items(sku)
                """)
                cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{branch}_submission_items_item_id 
                    ON {branch}_scanner_submission_items(item_id)
                """)
                cursor.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{branch}_submission_items_product_name 
                    ON {branch}_scanner_submission_items USING gin(to_tsvector('english', product_name))
                """)
            
            conn.commit()
            logger.info("Scanner logs tables initialized successfully for all branches")
            
        except Exception as e:
            logger.error(f"Error initializing scanner logs tables: {e}")
            conn.rollback()
            raise
        finally:
            self.return_connection(conn)

    def _get_table_prefix(self, branch: str) -> str:
        """Convert branch ID to table name prefix"""
        # Map branch IDs to table prefixes
        branch_map = {
            'uk-birmingham': 'uk_birmingham',
            'uk-london': 'uk_london',
            'fr-paris': 'fr_paris'
        }
        return branch_map.get(branch, branch.replace('-', '_'))

    def create_submission(
        self, 
        branch: str, 
        reason: str, 
        submitted_by: str, 
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Create a new scanner submission with all its items
        
        Args:
            branch: Branch identifier (uk-birmingham, uk-london, fr-paris)
            reason: Reason for the submission
            submitted_by: Username of the person submitting
            items: List of item dicts with sku, item_id, product_name, quantity, shelf_field, allocation_details
        
        Returns:
            The created submission with all items
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Get table prefix for this branch
            table_prefix = self._get_table_prefix(branch)
            submissions_table = f"{table_prefix}_scanner_submissions"
            items_table = f"{table_prefix}_scanner_submission_items"
            
            # Calculate totals
            total_items = len(items)
            total_added = sum(item['quantity'] for item in items if item['quantity'] > 0)
            total_removed = abs(sum(item['quantity'] for item in items if item['quantity'] < 0))
            
            # Insert submission
            cursor.execute(f"""
                INSERT INTO {submissions_table} 
                (reason, submitted_by, submitted_at, total_items, total_added, total_removed)
                VALUES (%s, %s, NOW(), %s, %s, %s)
                RETURNING id, reason, submitted_by, submitted_at, total_items, total_added, total_removed
            """, (reason, submitted_by, total_items, total_added, total_removed))
            
            submission_row = cursor.fetchone()
            submission_id = submission_row[0]
            
            # Insert all items
            inserted_items = []
            for item in items:
                allocation_json = json.dumps(item.get('allocation_details')) if item.get('allocation_details') else None
                
                cursor.execute(f"""
                    INSERT INTO {items_table}
                    (submission_id, sku, item_id, product_name, quantity, shelf_field, allocation_details)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, submission_id, sku, item_id, product_name, quantity, shelf_field, allocation_details
                """, (
                    submission_id,
                    item['sku'],
                    item.get('item_id'),
                    item.get('product_name'),
                    item['quantity'],
                    item['shelf_field'],
                    allocation_json
                ))
                
                item_row = cursor.fetchone()
                allocation_details = item_row[7]
                if allocation_details:
                    if isinstance(allocation_details, str):
                        allocation_details = json.loads(allocation_details)
                inserted_items.append({
                    'id': item_row[0],
                    'submission_id': item_row[1],
                    'sku': item_row[2],
                    'item_id': item_row[3],
                    'product_name': item_row[4],
                    'quantity': item_row[5],
                    'shelf_field': item_row[6],
                    'allocation_details': allocation_details
                })
            
            conn.commit()
            
            result = {
                'id': submission_row[0],
                'branch': branch,
                'reason': submission_row[1],
                'submitted_by': submission_row[2],
                'submitted_at': submission_row[3].isoformat() if submission_row[3] else None,
                'total_items': submission_row[4],
                'total_added': submission_row[5],
                'total_removed': submission_row[6],
                'items': inserted_items
            }
            
            logger.info(f"Created scanner submission {submission_id} with {total_items} items for {branch}")
            return result
            
        except Exception as e:
            logger.error(f"Error creating scanner submission: {e}")
            conn.rollback()
            raise
        finally:
            self.return_connection(conn)

    def get_submissions(
        self,
        branch: str,
        search: Optional[str] = None,
        user: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        page: int = 1,
        per_page: int = 20
    ) -> Dict[str, Any]:
        """
        Get submissions with filtering and pagination
        
        Args:
            branch: Branch identifier (required) - uk-birmingham, uk-london, fr-paris
            search: Optional search term to find submissions containing items matching SKU/item_id/product_name
            user: Optional username filter
            date_from: Optional start date filter
            date_to: Optional end date filter
            page: Page number (1-indexed)
            per_page: Number of results per page
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Get table names for this branch
            table_prefix = self._get_table_prefix(branch)
            submissions_table = f"{table_prefix}_scanner_submissions"
            items_table = f"{table_prefix}_scanner_submission_items"
            
            # Build WHERE clause
            where_clauses = []
            params = []
            
            if user:
                where_clauses.append("LOWER(s.submitted_by) LIKE LOWER(%s)")
                params.append(f"%{user}%")
            
            if date_from:
                where_clauses.append("s.submitted_at >= %s")
                params.append(date_from)
            
            if date_to:
                where_clauses.append("s.submitted_at <= %s")
                params.append(date_to)
            
            # If searching by product, we need to join with items
            if search:
                where_clauses.append(f"""
                    EXISTS (
                        SELECT 1 FROM {items_table} i 
                        WHERE i.submission_id = s.id 
                        AND (
                            LOWER(i.sku) LIKE LOWER(%s)
                            OR LOWER(i.item_id) LIKE LOWER(%s)
                            OR LOWER(i.product_name) LIKE LOWER(%s)
                        )
                    )
                """)
                search_pattern = f"%{search}%"
                params.extend([search_pattern, search_pattern, search_pattern])
            
            where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # Count total
            count_sql = f"SELECT COUNT(*) FROM {submissions_table} s {where_sql}"
            cursor.execute(count_sql, params)
            total = cursor.fetchone()[0]
            
            # Get paginated results
            offset = (page - 1) * per_page
            
            query_sql = f"""
                SELECT s.id, s.reason, s.submitted_by, s.submitted_at, 
                       s.total_items, s.total_added, s.total_removed
                FROM {submissions_table} s
                {where_sql}
                ORDER BY s.submitted_at DESC
                LIMIT %s OFFSET %s
            """
            
            cursor.execute(query_sql, params + [per_page, offset])
            rows = cursor.fetchall()
            
            submissions = []
            for row in rows:
                submissions.append({
                    'id': row[0],
                    'branch': branch,  # Add branch back to result since it's not in table
                    'reason': row[1],
                    'submitted_by': row[2],
                    'submitted_at': row[3].isoformat() if row[3] else None,
                    'total_items': row[4],
                    'total_added': row[5],
                    'total_removed': row[6]
                })
            
            total_pages = (total + per_page - 1) // per_page if per_page > 0 else 1
            
            return {
                'submissions': submissions,
                'total': total,
                'page': page,
                'per_page': per_page,
                'total_pages': total_pages
            }
            
        except Exception as e:
            logger.error(f"Error getting submissions for {branch}: {e}")
            return {
                'submissions': [],
                'total': 0,
                'page': page,
                'per_page': per_page,
                'total_pages': 0
            }
        finally:
            self.return_connection(conn)

    def get_submission_by_id(self, submission_id: int, branch: str) -> Optional[Dict[str, Any]]:
        """Get a single submission with all its items
        
        Args:
            submission_id: The submission ID
            branch: Branch identifier (required) - uk-birmingham, uk-london, fr-paris
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Get table names for this branch
            table_prefix = self._get_table_prefix(branch)
            submissions_table = f"{table_prefix}_scanner_submissions"
            items_table = f"{table_prefix}_scanner_submission_items"
            
            # Get submission
            cursor.execute(f"""
                SELECT id, reason, submitted_by, submitted_at, 
                       total_items, total_added, total_removed
                FROM {submissions_table}
                WHERE id = %s
            """, (submission_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            submission = {
                'id': row[0],
                'branch': branch,  # Add branch back to result since it's not in table
                'reason': row[1],
                'submitted_by': row[2],
                'submitted_at': row[3].isoformat() if row[3] else None,
                'total_items': row[4],
                'total_added': row[5],
                'total_removed': row[6],
                'items': []
            }
            
            # Get items
            cursor.execute(f"""
                SELECT id, submission_id, sku, item_id, product_name, 
                       quantity, shelf_field, allocation_details
                FROM {items_table}
                WHERE submission_id = %s
                ORDER BY id
            """, (submission_id,))
            
            for item_row in cursor.fetchall():
                allocation = None
                if item_row[7]:
                    try:
                        allocation = json.loads(item_row[7]) if isinstance(item_row[7], str) else item_row[7]
                    except:
                        allocation = item_row[7]
                
                submission['items'].append({
                    'id': item_row[0],
                    'submission_id': item_row[1],
                    'sku': item_row[2],
                    'item_id': item_row[3],
                    'product_name': item_row[4],
                    'quantity': item_row[5],
                    'shelf_field': item_row[6],
                    'allocation_details': allocation
                })
            
            return submission
            
        except Exception as e:
            logger.error(f"Error getting submission {submission_id} for {branch}: {e}")
            return None
        finally:
            self.return_connection(conn)

    def get_submissions_by_product(
        self,
        search: str,
        branch: str,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get all submissions containing a specific product
        Search by SKU, item_id, or product name
        
        Args:
            search: Search term for SKU, item_id, or product_name
            branch: Branch identifier (required) - uk-birmingham, uk-london, fr-paris
            limit: Maximum number of submissions to return
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Get table names for this branch
            table_prefix = self._get_table_prefix(branch)
            submissions_table = f"{table_prefix}_scanner_submissions"
            items_table = f"{table_prefix}_scanner_submission_items"
            
            where_clause = """
                WHERE (LOWER(i.sku) LIKE LOWER(%s)
                       OR LOWER(i.item_id) LIKE LOWER(%s)
                       OR LOWER(i.product_name) LIKE LOWER(%s))
            """
            params = [f"%{search}%", f"%{search}%", f"%{search}%"]
            
            cursor.execute(f"""
                SELECT DISTINCT s.id, s.reason, s.submitted_by, s.submitted_at,
                       s.total_items, s.total_added, s.total_removed
                FROM {submissions_table} s
                JOIN {items_table} i ON i.submission_id = s.id
                {where_clause}
                ORDER BY s.submitted_at DESC
                LIMIT %s
            """, params + [limit])
            
            submissions = []
            for row in cursor.fetchall():
                submission_id = row[0]
                
                # Get the matching items for this submission
                cursor.execute(f"""
                    SELECT id, submission_id, sku, item_id, product_name,
                           quantity, shelf_field, allocation_details
                    FROM {items_table}
                    WHERE submission_id = %s
                """, (submission_id,))
                
                items = []
                for item_row in cursor.fetchall():
                    allocation = None
                    if item_row[7]:
                        try:
                            allocation = json.loads(item_row[7]) if isinstance(item_row[7], str) else item_row[7]
                        except:
                            allocation = item_row[7]
                    
                    items.append({
                        'id': item_row[0],
                        'submission_id': item_row[1],
                        'sku': item_row[2],
                        'item_id': item_row[3],
                        'product_name': item_row[4],
                        'quantity': item_row[5],
                        'shelf_field': item_row[6],
                        'allocation_details': allocation
                    })
                
                submissions.append({
                    'id': row[0],
                    'branch': branch,  # Add branch back to result since it's not in table
                    'reason': row[1],
                    'submitted_by': row[2],
                    'submitted_at': row[3].isoformat() if row[3] else None,
                    'total_items': row[4],
                    'total_added': row[5],
                    'total_removed': row[6],
                    'items': items
                })
            
            return submissions
            
        except Exception as e:
            logger.error(f"Error searching submissions by product for {branch}: {e}")
            return []
        finally:
            self.return_connection(conn)
