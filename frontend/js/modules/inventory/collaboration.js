/**
 * Collaboration Module for Inventory Management
 * Handles presence indicators, cursor tracking, and live updates
 */

import { wsService } from '../../services/websocket.js';
import { showToast } from '../../ui/toast.js';

class CollaborationManager {
  constructor() {
    this.activeUsers = new Map();
    this.presenceContainer = null;
    this.cellHighlights = new Map(); // Map of cell key -> Set of user_ids
    this.userCellMap = new Map(); // Map of user_id -> {sku, field, cell}
    this.isInitialized = false;
    this.currentUserId = null;
    this.currentUsername = 'Guest';
    this.selfPresence = null;
  }

  /**
   * Initialize collaboration features
   */
  async init(currentUser) {
    if (this.isInitialized) {
      return;
    }
    this.currentUserId = currentUser?.username || 'unknown';
    this.currentUsername = currentUser?.username || 'Guest';

    try {
      // Connect to WebSocket with timeout
      const connectionPromise = wsService.connect(currentUser);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );
      
      await Promise.race([connectionPromise, timeoutPromise]);

      // Setup event handlers
      this._setupEventHandlers();

      // Create presence UI
      this._createPresenceUI();

      // Join inventory room
      wsService.joinRoom('inventory_management');

      this.isInitialized = true;
    } catch (error) {
      console.error('[Collaboration] Initialization failed:', error);
      // Only show error on localhost - fail silently in production
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocal) {
        showToast('Could not enable real-time collaboration', 'error');
      } else {
        console.warn('[Collaboration] Features disabled - WebSocket unavailable in production');
      }
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  _setupEventHandlers() {
    // Connection events
    wsService.on('connected', () => {
      this._updateConnectionStatus(true);
    });

    wsService.on('disconnected', () => {
      this._updateConnectionStatus(false);
      this.activeUsers.clear();
      this.selfPresence = null;
      this._renderPresence();
    });

    wsService.on('connection_error', (data) => {
      console.error('[Collaboration] Connection error:', data);
      if (data.attempts >= 3) {
        showToast('Collaboration server connection unstable', 'warning');
      }
    });

    // Room events
    wsService.on('room_joined', (data) => {
      this._registerSelfPresence(data.user);
      this._syncPresenceList(data.users || []);
      this._renderPresence();
      const count = this.activeUsers.size;
      showToast(`Collaboration enabled - ${count} user${count !== 1 ? 's' : ''} online`, 'success');
    });

    wsService.on('user_joined', (data) => {
      const enriched = { ...data, is_self: this._isSelf(data) };
      if (enriched.is_self) {
        this.selfPresence = enriched;
      }
      this.activeUsers.set(enriched.user_id, enriched);
      this._renderPresence();
      if (!enriched.is_self) {
        this._showUserNotification(enriched.username, 'joined');
      }
    });

    wsService.on('user_left', (data) => {
      if (this._isSelf(data)) {
        return;
      }
      this.activeUsers.delete(data.user_id);
      this._removeUserHighlight(data.user_id);
      this._renderPresence();
      this._showUserNotification(data.username, 'left');
    });

    // Collaboration events
    wsService.on('cursor_updated', (data) => {
      this._updateUserCursor(data);
    });

    wsService.on('inventory_changed', (data) => {
      this._handleInventoryChange(data);
    });

    wsService.on('presence_update', (data) => {
      this._syncPresenceList(data.users || []);
      this._renderPresence();
    });
  }

  /**
   * Create presence indicator UI
   */
  _createPresenceUI() {
    // Check if already exists
    if (document.querySelector('.collab-presence-container')) {
      this.presenceContainer = document.querySelector('.collab-presence-container');
      return;
    }

    const container = document.createElement('div');
    container.className = 'collab-presence-container';
    container.innerHTML = `
      <div class="collab-status">
        <div class="collab-status-indicator"></div>
        <span class="collab-status-text">Connecting...</span>
      </div>
      <div class="collab-users-list"></div>
    `;

    // Insert at the top of the page header
    const pageHeader = document.querySelector('.page-header');
    if (pageHeader) {
      pageHeader.appendChild(container);
    } else {
      // Fallback to management content
      const managementContent = document.querySelector('.management-content');
      if (managementContent) {
        managementContent.insertBefore(container, managementContent.firstChild);
      }
    }

    this.presenceContainer = container;
  }

  /**
   * Update connection status indicator
   */
  _updateConnectionStatus(connected) {
    if (!this.presenceContainer) return;

    const indicator = this.presenceContainer.querySelector('.collab-status-indicator');
    const statusText = this.presenceContainer.querySelector('.collab-status-text');

    if (connected) {
      indicator.classList.add('connected');
      indicator.classList.remove('disconnected');
      statusText.textContent = 'Live';
    } else {
      indicator.classList.remove('connected');
      indicator.classList.add('disconnected');
      statusText.textContent = 'Offline';
    }
  }

  /**
   * Render active users in presence UI
   */
  _renderPresence() {
    if (!this.presenceContainer) return;

    const usersList = this.presenceContainer.querySelector('.collab-users-list');
    if (!usersList) return;
    usersList.innerHTML = '';

    if (this.activeUsers.size === 0) {
      usersList.innerHTML = '<div class="collab-no-users">You\'re the only one here</div>';
      return;
    }

    const sortedUsers = Array.from(this.activeUsers.values()).sort((a, b) => {
      if (a.is_self && !b.is_self) return -1;
      if (!a.is_self && b.is_self) return 1;
      return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
    });

    sortedUsers.forEach(user => {
      const userEl = document.createElement('div');
      userEl.className = 'collab-user';
      userEl.title = this._escapeHtml(user.username);
      
      const avatar = document.createElement('div');
      avatar.className = 'collab-user-avatar';
      avatar.style.backgroundColor = this._sanitizeColor(user.color);
      avatar.textContent = this._getInitials(user.username);
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'collab-user-name';
      nameSpan.textContent = user.is_self ? `${user.username} (You)` : user.username;
      
      userEl.appendChild(avatar);
      userEl.appendChild(nameSpan);
      usersList.appendChild(userEl);
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Sanitize color value
   */
  _sanitizeColor(color) {
    // Only allow hex colors
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return color;
    }
    return '#667eea'; // Default color
  }

  /**
   * Get user initials for avatar
   */
  _getInitials(username) {
    if (!username) return '?';
    const parts = username.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return username.substring(0, 2).toUpperCase();
  }

  /**
   * Show user join/leave notification
   */
  _showUserNotification(username, action) {
    const message = `${username} ${action === 'joined' ? 'joined' : 'left'} the page`;
    showToast(message, action === 'joined' ? 'info' : 'info');
  }

  /**
   * Update user cursor position
   */
  _updateUserCursor(data) {
    const { user_id, username, color, editing_row, editing_field } = data;
    // Always clear previous highlight for this user first
    this._removeUserHighlight(user_id);

    if (!editing_row || !editing_field) {
      return;
    }

    const escapedSku = CSS.escape(editing_row);
    const row = document.querySelector(`tr[data-sku="${escapedSku}"]`);
    if (!row) {
      console.warn('[Collaboration] Row not found for SKU:', editing_row);
      return;
    }

    const cell = row.querySelector(`[data-field="${editing_field}"]`);
    if (!cell) {
      console.warn('[Collaboration] Cell not found for field:', editing_field);
      return;
    }

    // Create cell key for tracking
    const cellKey = `${editing_row}:${editing_field}`;

    // Initialize cellHighlights set for this cell if needed
    if (!this.cellHighlights.has(cellKey)) {
      this.cellHighlights.set(cellKey, new Set());
    }

    // Add this user to the cell's highlight set
    this.cellHighlights.get(cellKey).add(user_id);

    // Store user's current cell
    this.userCellMap.set(user_id, { sku: editing_row, field: editing_field, cell, color });

    // Re-render all indicators for this cell
    this._renderCellIndicators(cell, cellKey);
  }

  /**
   * Render all user indicators for a specific cell
   */
  _renderCellIndicators(cell, cellKey) {
    // Remove all existing indicators from this cell
    const existingIndicators = cell.querySelectorAll('.collab-user-indicator');
    existingIndicators.forEach(ind => ind.remove());

    // Get all users editing this cell
    const userIds = this.cellHighlights.get(cellKey);
    if (!userIds || userIds.size === 0) {
      cell.classList.remove('collab-cell-editing');
      cell.removeAttribute('data-collab-count');
      for (let i = 1; i <= 5; i++) {
        cell.style.removeProperty(`--collab-user-color-${i}`);
      }
      return;
    }

    // Add editing class and set count
    cell.classList.add('collab-cell-editing');
    cell.setAttribute('data-collab-count', userIds.size);

    // Set CSS variables for user colors
    const userArray = Array.from(userIds);
    userArray.forEach((userId, index) => {
      const userData = this.userCellMap.get(userId);
      if (userData && index < 5) {
        cell.style.setProperty(`--collab-user-color-${index + 1}`, this._sanitizeColor(userData.color));
      }
    });

    // Create indicator for each user
    userArray.forEach((userId, index) => {
      const userData = this.userCellMap.get(userId);
      if (!userData) return;

      const userInfo = this.activeUsers.get(userId);
      const username = userInfo?.username || 'User';
      const color = userData.color;

      const indicator = document.createElement('div');
      indicator.className = 'collab-user-indicator';
      indicator.dataset.userId = userId;
      indicator.style.backgroundColor = this._sanitizeColor(color);
      indicator.textContent = this._getInitials(username);
      indicator.title = `${this._escapeHtml(username)} is editing this field`;

      cell.appendChild(indicator);
    });
  }

  /**
   * Remove user highlights
   */
  _removeUserHighlight(userId) {
    const userData = this.userCellMap.get(userId);
    if (!userData) return;

    const { sku, field, cell } = userData;
    const cellKey = `${sku}:${field}`;

    // Remove user from cell's highlight set
    const cellUsers = this.cellHighlights.get(cellKey);
    if (cellUsers) {
      cellUsers.delete(userId);
      
      // If no users left, clean up
      if (cellUsers.size === 0) {
        this.cellHighlights.delete(cellKey);
      }
    }

    // Remove from user map
    this.userCellMap.delete(userId);

    // Re-render the cell to update indicators
    if (cell && cell.isConnected) {
      this._renderCellIndicators(cell, cellKey);
    }
  }

  /**
   * Format field name for display (convert lt1/gt1 to < and >)
   */
  _formatFieldName(field) {
    if (!field) return field;
    
    // Replace _lt1, _gt1, etc. with symbols
    return field
      .replace(/_lt1/g, ' <1')
      .replace(/_gt1/g, ' >1')
      .replace(/_lt/g, ' <')
      .replace(/_gt/g, ' >')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
  }

  /**
   * Handle inventory change from another user
   */
  _handleInventoryChange(data) {
    const { username, sku, field, new_value, update_type } = data;
    // Show notification with formatted field name
    const formattedField = this._formatFieldName(field);
    showToast(`${username} updated ${formattedField} for ${sku}`, 'info');

    // Trigger a data refresh
    this._triggerDataRefresh({ sku, field, new_value, update_type, username });

    // Highlight the changed row briefly
    this._highlightChangedRow(sku);
  }

  /**
   * Trigger data refresh for a specific SKU
   */
  _triggerDataRefresh(payload) {
    const detail = typeof payload === 'object' && payload !== null
      ? { ...payload }
      : { sku: payload };

    if (!detail.sku && typeof payload === 'string') {
      detail.sku = payload;
    }

    const event = new CustomEvent('inventory-data-changed', { detail });
    window.dispatchEvent(event);
  }

  _registerSelfPresence(userPayload) {
    const currentId = this._getCurrentUserId();
    if (userPayload && userPayload.user_id === currentId) {
      this.selfPresence = { ...userPayload, is_self: true };
      this.activeUsers.set(currentId, this.selfPresence);
      return;
    }

    if (!this.selfPresence) {
      this.selfPresence = {
        user_id: currentId,
        username: this.currentUsername,
        color: userPayload?.color || '#4ECDC4',
        is_self: true,
      };
      this.activeUsers.set(currentId, this.selfPresence);
    }
  }

  _syncPresenceList(users) {
    const nextMap = new Map();

    users.forEach(user => {
      const enriched = { ...user, is_self: this._isSelf(user) };
      if (enriched.is_self) {
        this.selfPresence = { ...enriched, is_self: true };
      }
      nextMap.set(enriched.user_id, enriched);
    });

    // Always ensure self is in the list
    if (this.selfPresence && !nextMap.has(this.selfPresence.user_id)) {
      nextMap.set(this.selfPresence.user_id, this.selfPresence);
    }
    this.activeUsers = nextMap;
  }

  _isSelf(user) {
    if (!user) return false;
    return user.user_id === this._getCurrentUserId();
  }

  _getCurrentUserId() {
    return this.currentUserId || wsService.currentUser?.username || 'unknown';
  }

  /**
   * Highlight a row that was changed
   */
  _highlightChangedRow(sku) {
    const escapedSku = CSS.escape(sku);
    const row = document.querySelector(`tr[data-sku="${escapedSku}"]`);
    if (!row) return;

    row.classList.add('collab-flash-update');
    setTimeout(() => {
      row.classList.remove('collab-flash-update');
    }, 2000);
  }

  /**
   * Notify when user starts editing a row
   */
  notifyRowFocus(sku, field) {
    if (!wsService.isConnected()) return;
    wsService.updateCursor(sku, field);
  }

  /**
   * Notify when user stops editing
   */
  notifyRowBlur() {
    if (!wsService.isConnected()) return;
    wsService.updateCursor(null, null);
  }

  /**
   * Broadcast an inventory update
   */
  broadcastUpdate(sku, field, oldValue, newValue) {
    if (!wsService.isConnected()) return;

    wsService.broadcastInventoryUpdate({
      update_type: 'edit',
      sku,
      field,
      old_value: oldValue,
      new_value: newValue
    });
  }

  /**
   * Cleanup
   */
  destroy() {
    if (wsService.isConnected()) {
      wsService.disconnect();
    }
    
    this.activeUsers.clear();
    this.cellHighlights.clear();
    this.userCellMap.clear();
    this.selfPresence = null;
    
    if (this.presenceContainer && this.presenceContainer.parentNode) {
      this.presenceContainer.remove();
    }
    
    this.isInitialized = false;
  }
}

// Export singleton instance
export const collaborationManager = new CollaborationManager();
