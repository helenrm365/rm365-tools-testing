/**
 * WebSocket Service for Real-time Collaboration
 * Handles Socket.IO connections and event management
 */

import { config } from '../config.js';

class WebSocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.activeRoom = null;
    this.roomState = null;
    this.pendingRoom = null;
    this.currentUser = null;
    this.eventHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  /**
   * Initialize WebSocket connection
   */
  async connect(user) {
    if (this.connected) {
      console.log('[WebSocket] Already connected');
      return;
    }

    this.currentUser = user;

    // Determine WebSocket URL
    const wsUrl = this._getWebSocketUrl();
    console.log('[WebSocket] Connecting to:', wsUrl);

    try {
      // Load Socket.IO client library
      if (!window.io) {
        await this._loadSocketIOClient();
      }

      // Create socket connection with polling fallback for Railway
      this.socket = io(wsUrl, {
        path: '/ws/socket.io',  // Socket.IO mounted at /ws
        transports: ['polling', 'websocket'], // Try polling first for Railway compatibility
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000, // Increased to 10s to allow for slower connections
        upgrade: true, // Allow upgrade from polling to websocket
        pingTimeout: 60000, // Match server ping_timeout (60s)
        pingInterval: 25000, // Match server ping_interval (25s)
        forceNew: false, // Reuse existing connections
        multiplex: true, // Enable multiplexing
      });

      this._setupEventHandlers();
      
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this._handleConnectionError(error);
    }
  }

  /**
   * Get WebSocket URL based on environment
   */
  _getWebSocketUrl() {
    // Use the same base URL as API but for WebSocket
    const apiUrl = config.API;
    
    // Remove /api/v1 suffix if present
    const baseUrl = apiUrl.replace(/\/api\/v1$/, '');
    
    return baseUrl;
  }

  /**
   * Load Socket.IO client library dynamically
   */
  async _loadSocketIOClient() {
    return new Promise((resolve, reject) => {
      if (window.io) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.6.0/socket.io.min.js';
      script.integrity = 'sha384-c79GN5VsunZvi+Q/WObgk2in0CbZsHnjEqvFxC5DxHn9lTfNce2WW6h2pH6u/kF+';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        console.log('[WebSocket] Socket.IO client loaded');
        resolve();
      };
      script.onerror = (error) => {
        console.error('[WebSocket] Failed to load Socket.IO client:', error);
        reject(error);
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Setup Socket.IO event handlers
   */
  _setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected with ID:', this.socket.id);
      this.connected = true;
      this.reconnectAttempts = 0;
      this._emit('connected', { sid: this.socket.id });
      this._attemptRoomJoin();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      this.connected = false;
       // remember the last room so we can rejoin once back online
      if (this.activeRoom && !this.pendingRoom) {
        this.pendingRoom = this.activeRoom;
      }
      this.activeRoom = null;
      this.roomState = null;
      this._emit('disconnected', { reason });
    });

    this.socket.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error);
      this.reconnectAttempts++;
      this._emit('connection_error', { error, attempts: this.reconnectAttempts });
    });

    this.socket.on('connection_established', (data) => {
      console.log('[WebSocket] Connection established:', data);
    });

    // Room-specific events
    this.socket.on('room_joined', (data) => {
      console.log('[WebSocket] Joined room:', data);
      this.roomState = data;
      this._emit('room_joined', data);
    });

    this.socket.on('user_joined', (data) => {
      console.log('[WebSocket] User joined:', data);
      this._emit('user_joined', data);
    });

    this.socket.on('user_left', (data) => {
      console.log('[WebSocket] User left:', data);
      this._emit('user_left', data);
    });

    // Collaboration events
    this.socket.on('cursor_updated', (data) => {
      this._emit('cursor_updated', data);
    });

    this.socket.on('inventory_changed', (data) => {
      console.log('[WebSocket] Inventory changed:', data);
      this._emit('inventory_changed', data);
    });

    this.socket.on('presence_update', (data) => {
      this._emit('presence_update', data);
    });
  }

  /**
   * Join a room (e.g., inventory management)
   */
  joinRoom(roomName = 'inventory_management') {
    this.pendingRoom = roomName;

    if (!this.socket) {
      console.warn('[WebSocket] Socket not ready yet; will join room when connection is established');
      return;
    }

    if (!this.connected) {
      console.warn('[WebSocket] Not connected yet; room join queued');
      return;
    }

    this._attemptRoomJoin();
  }

  /**
   * Update cursor position
   */
  updateCursor(rowId, field = null, position = null) {
    if (!this.connected || !this.socket) {
      return;
    }

    this.socket.emit('update_cursor', {
      row_id: rowId,
      field,
      position: position,
    });
  }

  /**
   * Broadcast inventory update
   */
  broadcastInventoryUpdate(updateData) {
    if (!this.connected || !this.socket) {
      return;
    }

    this.socket.emit('inventory_update', updateData);
  }

  /**
   * Request current presence information
   */
  requestPresence() {
    if (!this.connected || !this.socket) {
      return;
    }

    this.socket.emit('request_presence');
  }

  /**
   * Register event handler
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Unregister event handler
   */
  off(event, handler) {
    if (!this.eventHandlers.has(event)) {
      return;
    }
    
    const handlers = this.eventHandlers.get(event);
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Emit event to registered handlers
   */
  _emit(event, data) {
    if (!this.eventHandlers.has(event)) {
      return;
    }

    const handlers = this.eventHandlers.get(event);
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[WebSocket] Error in event handler for ${event}:`, error);
      }
    });
  }

  /**
   * Handle connection errors
   */
  _handleConnectionError(error) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached');
      this._emit('max_reconnect_attempts', { error });
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.activeRoom = null;
      this.pendingRoom = null;
      this.roomState = null;
      console.log('[WebSocket] Disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected && this.socket && this.socket.connected;
  }

  _attemptRoomJoin() {
    if (!this.pendingRoom || !this.socket || !this.connected) {
      return;
    }

    const roomToJoin = this.pendingRoom;
    this.pendingRoom = null;
    this.activeRoom = roomToJoin;

    console.log('[WebSocket] Joining room:', roomToJoin);

    this.socket.emit('join_inventory_room', {
      user_id: this.currentUser?.username || 'unknown',
      username: this.currentUser?.username || 'Guest',
      room: roomToJoin,
    });
  }
}

// Export singleton instance
export const wsService = new WebSocketService();
