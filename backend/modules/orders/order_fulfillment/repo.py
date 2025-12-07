"""
Repository for managing Magento pick/pack sessions
"""
from typing import Dict, Optional, List
from datetime import datetime
import uuid
import json
from pathlib import Path
import logging

from .models import ScanSession, TakeoverRequest

logger = logging.getLogger(__name__)


class MagentoRepo:
    """Repository for Magento invoice scanning sessions"""
    
    def __init__(self):
        # In-memory storage for sessions (could be replaced with database)
        self._sessions: Dict[str, ScanSession] = {}
        self._takeover_requests: Dict[str, TakeoverRequest] = {}
        
        # For persistence, we'll use a JSON file
        self.data_dir = Path(__file__).parent / 'data'
        self.data_dir.mkdir(exist_ok=True)
        self.sessions_file = self.data_dir / 'scan_sessions.json'
        self.takeover_requests_file = self.data_dir / 'takeover_requests.json'
        
        # Load existing sessions
        self._load_sessions()
        self._load_takeover_requests()
    
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
                        if session_data.get('last_modified_at'):
                            session_data['last_modified_at'] = datetime.fromisoformat(session_data['last_modified_at'])
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
                if session.last_modified_at:
                    session_dict['last_modified_at'] = session.last_modified_at.isoformat()
                data[session_id] = session_dict
            
            with open(self.sessions_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error saving sessions: {e}")
    
    def _load_takeover_requests(self):
        """Load takeover requests from file"""
        if self.takeover_requests_file.exists():
            try:
                with open(self.takeover_requests_file, 'r') as f:
                    data = json.load(f)
                    for request_id, request_data in data.items():
                        request_data['requested_at'] = datetime.fromisoformat(request_data['requested_at'])
                        if request_data.get('responded_at'):
                            request_data['responded_at'] = datetime.fromisoformat(request_data['responded_at'])
                        self._takeover_requests[request_id] = TakeoverRequest(**request_data)
            except Exception as e:
                print(f"Error loading takeover requests: {e}")
    
    def _save_takeover_requests(self):
        """Save takeover requests to file"""
        try:
            data = {}
            for request_id, request in self._takeover_requests.items():
                request_dict = request.model_dump()
                request_dict['requested_at'] = request.requested_at.isoformat()
                if request.responded_at:
                    request_dict['responded_at'] = request.responded_at.isoformat()
                data[request_id] = request_dict
            
            with open(self.takeover_requests_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error saving takeover requests: {e}")
    
    def _add_audit_log(self, session_id: str, action: str, user: str, details: Optional[str] = None):
        """Add an audit log entry to a session"""
        session = self._sessions.get(session_id)
        if not session:
            return
        
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'action': action,
            'user': user,
            'details': details
        }
        
        session.audit_logs.append(log_entry)
        self._save_sessions()

    
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
        
        session = ScanSession(
            session_id=session_id,
            invoice_id=invoice_id,
            order_number=order_number,
            session_type=session_type,
            started_at=datetime.now(),
            items_expected=items_expected,
            items_scanned=[],
            status=status,
            user_id=user_id,  # Set owner if provided
            created_by=user_id,
            last_modified_by=user_id,
            last_modified_at=datetime.now(),
            audit_logs=[]
        )
        
        self._sessions[session_id] = session
        
        # Add audit log
        if user_id:
            self._add_audit_log(session_id, "started", user_id, f"Started {session_type} session")
        
        self._save_sessions()
        
        return session
    
    def get_session(self, session_id: str) -> Optional[ScanSession]:
        """Get a session by ID"""
        return self._sessions.get(session_id)
    
    def get_active_session_for_invoice(self, invoice_id: str) -> Optional[ScanSession]:
        """Get any active (in_progress) session for a specific invoice"""
        for session in self._sessions.values():
            if session.invoice_id == invoice_id and session.status == "in_progress":
                return session
        return None
    
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
    
    def complete_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Mark a session as completed"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        completing_user = user_id or session.user_id or session.last_modified_by or "Unknown"
        session.status = "completed"
        session.completed_at = datetime.now()
        session.last_modified_by = completing_user
        session.last_modified_at = datetime.now()
        
        self._add_audit_log(session_id, "completed", completing_user, "Completed session")
        self._save_sessions()
        return True
    
    def cancel_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Cancel a session and clear all scanned data"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        cancelling_user = user_id or session.user_id or session.last_modified_by or "Unknown"
        session.status = "cancelled"
        session.completed_at = datetime.now()
        session.last_modified_by = cancelling_user
        session.last_modified_at = datetime.now()
        # Clear all scanned items when cancelling
        session.items_scanned = []
        
        self._add_audit_log(session_id, "cancelled", cancelling_user, "Cancelled session")
        self._save_sessions()
        return True
    
    def restart_cancelled_session(self, session_id: str, user_id: Optional[str] = None) -> Optional[ScanSession]:
        """Restart a cancelled session by changing status back to in_progress"""
        session = self._sessions.get(session_id)
        if not session:
            return None
        
        if session.status != "cancelled":
            return None  # Can only restart cancelled sessions
        
        restarting_user = user_id or "Unknown"
        session.status = "in_progress"
        session.user_id = restarting_user
        session.last_modified_by = restarting_user
        session.last_modified_at = datetime.now()
        session.completed_at = None  # Clear the completion timestamp
        # items_scanned are already cleared from cancellation, so it starts fresh
        
        self._add_audit_log(session_id, "restarted", restarting_user, "Restarted cancelled session")
        self._save_sessions()
        return session
    
    def get_active_sessions(self, user_id: Optional[str] = None) -> List[ScanSession]:
        """Get all active (in_progress) sessions, optionally filtered by user"""
        sessions = [
            s for s in self._sessions.values()
            if s.status == "in_progress"
        ]
        
        if user_id:
            sessions = [s for s in sessions if s.user_id == user_id]
        
        return sessions
    
    def get_draft_sessions(self) -> List[ScanSession]:
        """Get all draft sessions available to be claimed"""
        return [
            s for s in self._sessions.values()
            if s.status == "draft"
        ]
    
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
    
    # Collaborative session management methods
    
    def claim_session(self, session_id: str, user_id: str) -> bool:
        """Claim a draft session and make it in_progress"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        if session.status != "draft":
            return False  # Can only claim draft sessions
        
        previous_owner = session.created_by or "Unknown"
        session.status = "in_progress"
        session.user_id = user_id
        session.last_modified_by = user_id
        session.last_modified_at = datetime.now()
        
        self._add_audit_log(session_id, "claimed", user_id, f"Claimed draft session from {previous_owner}")
        self._save_sessions()
        return True
    
    def release_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """
        Release a session back to draft status
        Preserves all scanned data so another user can continue
        """
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        releasing_user = user_id or session.user_id or "Unknown"
        session.status = "draft"
        session.user_id = None  # Remove ownership
        session.last_modified_at = datetime.now()
        # Note: items_scanned is preserved
        
        self._add_audit_log(session_id, "drafted", releasing_user, "Released session as draft")
        self._save_sessions()
        return True
    
    def can_access_session(self, session_id: str, user_id: str) -> tuple[bool, str]:
        """
        Check if a user can access/modify a session
        Returns (can_access, message)
        """
        session = self._sessions.get(session_id)
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
    
    def transfer_session(self, session_id: str, new_owner: str, transferred_by: Optional[str] = None, forced: bool = False) -> bool:
        """Transfer session ownership to another user"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        previous_owner = session.user_id or "Unknown"
        transfer_initiator = transferred_by or new_owner
        
        session.user_id = new_owner
        session.last_modified_by = new_owner
        session.last_modified_at = datetime.now()
        
        if forced:
            self._add_audit_log(session_id, "forced_takeover", transfer_initiator, 
                               f"Forcefully transferred from {previous_owner} to {new_owner}")
        else:
            self._add_audit_log(session_id, "transferred", transfer_initiator, 
                               f"Transferred from {previous_owner} to {new_owner}")
        
        self._save_sessions()
        return True
    
    # Takeover request methods
    
    def create_takeover_request(self, session_id: str, requested_by: str) -> Optional[TakeoverRequest]:
        """Create a new takeover request"""
        session = self._sessions.get(session_id)
        if not session or session.status != "in_progress":
            return None
        
        # Check if there's already a pending request from this user for this session
        for req in self._takeover_requests.values():
            if (req.session_id == session_id and 
                req.requested_by == requested_by and 
                req.status == "pending"):
                return req  # Return existing pending request
        
        request_id = str(uuid.uuid4())
        request = TakeoverRequest(
            request_id=request_id,
            session_id=session_id,
            requested_by=requested_by,
            current_owner=session.user_id or "Unknown",
            requested_at=datetime.now(),
            status="pending"
        )
        
        self._takeover_requests[request_id] = request
        self._save_takeover_requests()
        return request
    
    def get_takeover_request(self, request_id: str) -> Optional[TakeoverRequest]:
        """Get a specific takeover request"""
        return self._takeover_requests.get(request_id)
    
    def get_pending_takeover_requests(self, user_id: str) -> List[TakeoverRequest]:
        """Get all pending takeover requests for a user's sessions"""
        return [
            req for req in self._takeover_requests.values()
            if req.current_owner == user_id and req.status == "pending"
        ]
    
    def respond_to_takeover_request(self, request_id: str, accept: bool) -> Optional[TakeoverRequest]:
        """Respond to a takeover request"""
        request = self._takeover_requests.get(request_id)
        if not request or request.status != "pending":
            return None
        
        request.status = "accepted" if accept else "declined"
        request.responded_at = datetime.now()
        
        if accept:
            # Transfer the session
            self.transfer_session(request.session_id, request.requested_by)
        
        self._save_takeover_requests()
        return request
    
    # Order Tracking methods
    
    def get_sessions_by_status(self, statuses: List[str]) -> List[ScanSession]:
        """Get all sessions matching any of the given statuses"""
        return [
            s for s in self._sessions.values()
            if s.status in statuses
        ]
    
    def mark_session_ready_to_check(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Mark a session as ready to check instead of completed"""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        marking_user = user_id or session.user_id or session.last_modified_by or "Unknown"
        session.status = "ready_to_check"
        session.last_modified_by = marking_user
        session.last_modified_at = datetime.now()
        
        self._add_audit_log(session_id, "ready_to_check", marking_user, "Marked as ready to check")
        self._save_sessions()
        return True
    
    def approve_session(self, session_id: str, user_id: str) -> bool:
        """
        Approve a session for picking.
        
        IMPORTANT: This only updates the local session state. No changes are made to Magento.
        The order remains in its original Magento status (typically 'processing').
        """
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        session.status = "approved"
        session.last_modified_by = user_id
        session.last_modified_at = datetime.now()
        
        self._add_audit_log(session_id, "approved", user_id, "Approved for picking")
        self._save_sessions()
        return True
    
    def reset_daily_sessions(self) -> dict:
        """
        Reset all order sessions daily.
        
        This allows orders that are still in 'processing' status on Magento to 
        reappear in the pending orders list, even if they were previously 
        approved/in-progress/completed.
        
        Process:
        1. Archive all current sessions to a history file
        2. Clear the active sessions
        3. Orders still in 'processing' on Magento will appear in pending list again
        
        Returns a summary of what was reset.
        """
        try:
            # Count sessions by status before reset
            status_counts = {}
            for session in self._sessions.values():
                status_counts[session.status] = status_counts.get(session.status, 0) + 1
            
            total_sessions = len(self._sessions)
            
            # Archive to history file with timestamp
            history_file = self.data_dir / f'session_history_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
            
            if self._sessions:
                # Save current sessions to history
                data = {}
                for session_id, session in self._sessions.items():
                    session_dict = session.model_dump()
                    session_dict['started_at'] = session.started_at.isoformat()
                    if session.completed_at:
                        session_dict['completed_at'] = session.completed_at.isoformat()
                    if session.last_modified_at:
                        session_dict['last_modified_at'] = session.last_modified_at.isoformat()
                    # Add archive timestamp
                    session_dict['archived_at'] = datetime.now().isoformat()
                    data[session_id] = session_dict
                
                with open(history_file, 'w') as f:
                    json.dump(data, f, indent=2)
                
                logger.info(f"✅ Archived {total_sessions} sessions to {history_file}")
            
            # Clear all active sessions
            self._sessions.clear()
            
            # Clear takeover requests
            self._takeover_requests.clear()
            
            # Save empty state
            self._save_sessions()
            self._save_takeover_requests()
            
            logger.info(f"✅ Daily reset completed - cleared {total_sessions} sessions")
            
            return {
                'success': True,
                'total_sessions_reset': total_sessions,
                'sessions_by_status': status_counts,
                'archived_to': str(history_file),
                'reset_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Error during daily reset: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'reset_at': datetime.now().isoformat()
            }

