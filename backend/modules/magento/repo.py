"""
Repository for managing Magento pick/pack sessions
"""
from typing import Dict, Optional, List
from datetime import datetime
import uuid
import json
from pathlib import Path
import logging

from .models import ScanSession

logger = logging.getLogger(__name__)


class MagentoRepo:
    """Repository for Magento invoice scanning sessions"""
    
    def __init__(self):
        # In-memory storage for sessions (could be replaced with database)
        self._sessions: Dict[str, ScanSession] = {}
        
        # For persistence, we'll use a JSON file
        self.data_dir = Path(__file__).parent / 'data'
        self.data_dir.mkdir(exist_ok=True)
        self.sessions_file = self.data_dir / 'scan_sessions.json'
        
        # Load existing sessions
        self._load_sessions()
    
    def get_sku_by_item_id(self, item_id: str) -> Optional[str]:
        """Look up SKU by item_id from inventory_metadata table"""
        try:
            from core.db import get_psycopg_connection
            conn = get_psycopg_connection()
            cursor = conn.cursor()
            
            cursor.execute(
                "SELECT sku FROM inventory_metadata WHERE item_id = %s",
                (item_id,)
            )
            result = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if result:
                logger.info(f"Found SKU '{result[0]}' for item_id '{item_id}'")
                return result[0]
            
            logger.warning(f"No SKU found for item_id '{item_id}'")
            return None
            
        except Exception as e:
            logger.error(f"Error looking up SKU by item_id: {e}")
            return None
    
    def _load_sessions(self):
        """Load sessions from file"""
        if self.sessions_file.exists():
            try:
                with open(self.sessions_file, 'r') as f:
                    data = json.load(f)
                    for session_id, session_data in data.items():
                        # Convert datetime strings back to datetime objects
                        session_data['started_at'] = datetime.fromisoformat(session_data['started_at'])
                        if session_data.get('completed_at'):
                            session_data['completed_at'] = datetime.fromisoformat(session_data['completed_at'])
                        self._sessions[session_id] = ScanSession(**session_data)
            except Exception as e:
                print(f"Error loading sessions: {e}")
    
    def _save_sessions(self):
        """Save sessions to file"""
        try:
            data = {}
            for session_id, session in self._sessions.items():
                session_dict = session.model_dump()
                # Convert datetime objects to strings
                session_dict['started_at'] = session.started_at.isoformat()
                if session.completed_at:
                    session_dict['completed_at'] = session.completed_at.isoformat()
                data[session_id] = session_dict
            
            with open(self.sessions_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error saving sessions: {e}")
    
    def create_session(self, 
                      invoice_id: str,
                      order_number: str,
                      session_type: str,
                      items_expected: List[dict],
                      user_id: Optional[str] = None) -> ScanSession:
        """Create a new scanning session"""
        session_id = str(uuid.uuid4())
        
        session = ScanSession(
            session_id=session_id,
            invoice_id=invoice_id,
            order_number=order_number,
            session_type=session_type,
            started_at=datetime.now(),
            items_expected=items_expected,
            items_scanned=[],
            status="in_progress",
            user_id=user_id
        )
        
        self._sessions[session_id] = session
        self._save_sessions()
        
        return session
    
    def get_session(self, session_id: str) -> Optional[ScanSession]:
        """Get a session by ID"""
        return self._sessions.get(session_id)
    
    def update_session(self, session_id: str, **updates) -> Optional[ScanSession]:
        """Update session fields"""
        session = self._sessions.get(session_id)
        if not session:
            return None
        
        for key, value in updates.items():
            if hasattr(session, key):
                setattr(session, key, value)
        
        self._save_sessions()
        return session
    
    def add_scanned_item(self, session_id: str, sku: str, quantity: float) -> bool:
        """Add a scanned item to the session"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        # Find if this SKU was already scanned
        existing_scan = None
        for item in session.items_scanned:
            if item['sku'] == sku:
                existing_scan = item
                break
        
        if existing_scan:
            existing_scan['qty_scanned'] += quantity
        else:
            session.items_scanned.append({
                'sku': sku,
                'qty_scanned': quantity,
                'scanned_at': datetime.now().isoformat()
            })
        
        self._save_sessions()
        return True
    
    def get_scanned_quantity(self, session_id: str, sku: str) -> float:
        """Get the total quantity scanned for a specific SKU"""
        session = self._sessions.get(session_id)
        if not session:
            return 0.0
        
        for item in session.items_scanned:
            if item['sku'] == sku:
                return item['qty_scanned']
        
        return 0.0
    
    def complete_session(self, session_id: str) -> bool:
        """Mark a session as completed"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        session.status = "completed"
        session.completed_at = datetime.now()
        self._save_sessions()
        return True
    
    def cancel_session(self, session_id: str) -> bool:
        """Cancel a session"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        session.status = "cancelled"
        session.completed_at = datetime.now()
        self._save_sessions()
        return True
    
    def get_active_sessions(self, user_id: Optional[str] = None) -> List[ScanSession]:
        """Get all active sessions, optionally filtered by user"""
        sessions = [
            s for s in self._sessions.values()
            if s.status == "in_progress"
        ]
        
        if user_id:
            sessions = [s for s in sessions if s.user_id == user_id]
        
        return sessions
    
    def get_session_history(self, 
                           days: int = 7,
                           user_id: Optional[str] = None) -> List[ScanSession]:
        """Get session history for the last N days"""
        cutoff = datetime.now().timestamp() - (days * 24 * 60 * 60)
        
        sessions = [
            s for s in self._sessions.values()
            if s.started_at.timestamp() >= cutoff
        ]
        
        if user_id:
            sessions = [s for s in sessions if s.user_id == user_id]
        
        # Sort by started_at descending
        sessions.sort(key=lambda s: s.started_at, reverse=True)
        
        return sessions
