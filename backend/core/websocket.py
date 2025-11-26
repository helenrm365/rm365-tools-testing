"""WebSocket Manager for Real-time Collaboration.
Handles user presence, cursor positions, and live data updates.
"""
import logging
from typing import Dict, Optional, Any
from datetime import datetime, timezone, timedelta

import socketio

logger = logging.getLogger(__name__)

# Create Socket.IO server with CORS support
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=True,
    ping_timeout=60,  # Increased from default 20s to prevent premature disconnects
    ping_interval=25,  # Send ping every 25s
    max_http_buffer_size=1000000,  # 1MB buffer for large messages
    allow_upgrades=True,  # Allow upgrade from polling to WebSocket
    # Don't set socketio_path here - let the mount point handle it
)


class PresenceManager:
    """Manages user presence across different rooms/pages"""
    
    def __init__(self):
        # room_id -> {user_id: {sid, username, color, cursor_position, last_seen}}
        self.rooms: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # sid -> {user_id, username, room_id}
        self.sessions: Dict[str, Dict[str, str]] = {}
        self.user_colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
            '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
        ]
        self.color_index = 0
        # Session timeout: remove inactive users after 1 hour
        self.session_timeout = timedelta(hours=1)
    
    def get_user_color(self) -> str:
        """Get next available color for user"""
        color = self.user_colors[self.color_index]
        self.color_index = (self.color_index + 1) % len(self.user_colors)
        return color
    
    def cleanup_stale_sessions(self):
        """Remove sessions that haven't been seen in over an hour"""
        now = datetime.now(timezone.utc)
        stale_sessions = []
        
        for room_id, users in list(self.rooms.items()):
            for user_id, user_data in list(users.items()):
                try:
                    last_seen_str = user_data.get('last_seen')
                    if last_seen_str:
                        last_seen = datetime.fromisoformat(last_seen_str.replace('Z', '+00:00'))
                        if now - last_seen > self.session_timeout:
                            stale_sessions.append((room_id, user_id, user_data.get('sid')))
                except Exception as e:
                    logger.warning(f"Error parsing last_seen for user {user_id}: {e}")
        
        # Remove stale sessions
        for room_id, user_id, sid in stale_sessions:
            if room_id in self.rooms and user_id in self.rooms[room_id]:
                del self.rooms[room_id][user_id]
                logger.info(f"Cleaned up stale session for user {user_id} in room {room_id}")
            
            if sid and sid in self.sessions:
                del self.sessions[sid]
            
            # Clean up empty rooms
            if room_id in self.rooms and not self.rooms[room_id]:
                del self.rooms[room_id]
        
        if stale_sessions:
            logger.info(f"Cleaned up {len(stale_sessions)} stale session(s)")
    
    async def join_room(self, sid: str, room_id: str, user_id: str, username: str) -> Dict[str, Any]:
        """User joins a collaboration room"""
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        
        color = self.get_user_color()
        
        user_data = {
            'sid': sid,
            'username': username,
            'color': color,
            'cursor_position': None,
            'editing_row': None,
            'editing_field': None,
            'last_seen': datetime.now(timezone.utc).isoformat()
        }
        
        self.rooms[room_id][user_id] = user_data
        self.sessions[sid] = {
            'user_id': user_id,
            'username': username,
            'room_id': room_id
        }
        
        logger.info(f"User {username} ({user_id}) joined room {room_id}")
        
        # Return current room state
        return {
            'user': {
                'user_id': user_id,
                'username': username,
                'color': color
            },
            'users': self.get_room_users(room_id)
        }
    
    async def leave_room(self, sid: str) -> Optional[Dict[str, str]]:
        """User leaves a collaboration room"""
        if sid not in self.sessions:
            return None
        
        session = self.sessions[sid]
        room_id = session['room_id']
        user_id = session['user_id']
        
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            del self.rooms[room_id][user_id]
            
            # Clean up empty rooms
            if not self.rooms[room_id]:
                del self.rooms[room_id]
        
        del self.sessions[sid]
        
        logger.info(f"User {session['username']} ({user_id}) left room {room_id}")
        
        return {
            'room_id': room_id,
            'user_id': user_id,
            'username': session['username']
        }
    
    def get_room_users(self, room_id: str) -> list:
        """Get all users in a room"""
        if room_id not in self.rooms:
            return []
        
        users = []
        for user_id, data in self.rooms[room_id].items():
            users.append({
                'user_id': user_id,
                'username': data['username'],
                'color': data['color'],
                'cursor_position': data.get('cursor_position'),
                'editing_row': data.get('editing_row'),
                'editing_field': data.get('editing_field'),
                'last_seen': data['last_seen']
            })
        return users
    
    async def update_cursor(self, sid: str, cursor_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update user's cursor position"""
        if sid not in self.sessions:
            return None
        
        session = self.sessions[sid]
        room_id = session['room_id']
        user_id = session['user_id']
        
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            position = cursor_data.get('position')
            editing_row = cursor_data.get('row_id')
            editing_field = cursor_data.get('field')

            self.rooms[room_id][user_id]['cursor_position'] = position
            self.rooms[room_id][user_id]['editing_row'] = editing_row
            self.rooms[room_id][user_id]['editing_field'] = editing_field
            self.rooms[room_id][user_id]['last_seen'] = datetime.now(timezone.utc).isoformat()
            
            return {
                'room_id': room_id,
                'user_id': user_id,
                'username': session['username'],
                'color': self.rooms[room_id][user_id]['color'],
                'cursor_position': position,
                'editing_row': editing_row,
                'editing_field': editing_field
            }
        
        return None


# Global presence manager instance
presence_manager = PresenceManager()

# Flag to track if cleanup task has been started
_cleanup_task_started = False

# Periodic cleanup task to remove stale sessions
async def cleanup_task():
    """Background task to clean up stale sessions every 15 minutes"""
    import asyncio
    while True:
        await asyncio.sleep(900)  # 15 minutes
        try:
            presence_manager.cleanup_stale_sessions()
        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")


# Socket.IO Event Handlers
@sio.event
async def connect(sid, environ):
    """Handle client connection"""
    global _cleanup_task_started
    
    logger.info(f"Client connected: {sid}")
    await sio.emit('connection_established', {'sid': sid}, room=sid)
    
    # Start cleanup task on first connection if not already running
    if not _cleanup_task_started:
        _cleanup_task_started = True
        import asyncio
        asyncio.create_task(cleanup_task())
        logger.info("Started background cleanup task")


@sio.event
async def disconnect(sid):
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {sid}")
    
    # Remove user from presence
    leave_data = await presence_manager.leave_room(sid)
    if leave_data:
        # Notify other users in the room
        await sio.emit('user_left', leave_data, room=leave_data['room_id'], skip_sid=sid)


@sio.event
async def join_inventory_room(sid, data):
    """User joins inventory management room"""
    user_id = data.get('user_id')
    username = data.get('username')
    room_id = 'inventory_management'  # Single room for inventory management
    
    # Join Socket.IO room
    await sio.enter_room(sid, room_id)

    # Also join a personal room so server can send targeted events (e.g. force cancel notices)
    personal_room = user_id or username
    if personal_room:
        await sio.enter_room(sid, str(personal_room))
    
    # Update presence
    room_state = await presence_manager.join_room(sid, room_id, user_id, username)
    
    # Send current state to joining user
    await sio.emit('room_joined', room_state, room=sid)
    
    # Notify others about new user
    await sio.emit('user_joined', {
        'user_id': user_id,
        'username': username,
        'color': room_state['user']['color']
    }, room=room_id, skip_sid=sid)


@sio.event
async def update_cursor(sid, data):
    """Update user's cursor/editing position"""
    cursor_update = await presence_manager.update_cursor(sid, data)
    
    if cursor_update:
        # Broadcast cursor position to others in room
        room_id = cursor_update['room_id']
        await sio.emit('cursor_updated', {
            'user_id': cursor_update['user_id'],
            'username': cursor_update['username'],
            'color': cursor_update['color'],
            'cursor_position': cursor_update['cursor_position'],
            'editing_row': cursor_update['editing_row'],
            'editing_field': cursor_update['editing_field']
        }, room=room_id, skip_sid=sid)


@sio.event
async def inventory_update(sid, data):
    """Broadcast inventory data update to all users"""
    if sid not in presence_manager.sessions:
        return
    
    session = presence_manager.sessions[sid]
    room_id = session['room_id']
    
    # Broadcast the update to all users in the room
    await sio.emit('inventory_changed', {
        'user_id': session['user_id'],
        'username': session['username'],
        'update_type': data.get('update_type', 'edit'),
        'sku': data.get('sku'),
        'field': data.get('field'),
        'old_value': data.get('old_value'),
        'new_value': data.get('new_value'),
        'timestamp': datetime.now(timezone.utc).isoformat()
    }, room=room_id)


@sio.event
async def request_presence(sid):
    """Request current presence information"""
    if sid not in presence_manager.sessions:
        return
    
    session = presence_manager.sessions[sid]
    room_id = session['room_id']
    
    users = presence_manager.get_room_users(room_id)
    await sio.emit('presence_update', {'users': users}, room=sid)


# Export the presence manager for use in other modules
__all__ = ['sio', 'presence_manager']
