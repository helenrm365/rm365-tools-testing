// frontend/js/modules/inventory/order-fulfillment.js
// Order Fulfillment Module - Process orders and returns

import { getApiUrl } from '../../config.js';
import { getToken } from '../../services/state/sessionStore.js';
import { getUserData, setUserData } from '../../services/state/userStore.js';
import { me as fetchCurrentUser } from '../../services/api/authApi.js';
import { wsService } from '../../services/websocket.js';
import { showNotification, showConfirm, showError, showSuccess, showWarning, showInfo } from '../../ui/modal.js';
import { updateRoute } from '../../router.js';

// Helper to get auth headers
function getAuthHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

class MagentoPickPackManager {
  constructor(initialPath) {
    this.currentSession = null;
    this.currentSessionId = null;
    this.currentPath = initialPath || '/inventory/order-fulfillment';
    this.initializeElements();
    this.attachEventListeners();
    this.setupWebSocket();
    this.ensureRealtimeConnection();
    // Check if we're loading a specific session from URL
    this.checkSessionFromPath(initialPath);
    // TODO: Implement active sessions endpoint on backend
    // this.loadActiveSessions();
  }

  async ensureRealtimeConnection() {
    try {
      let user = getUserData();
      if (!user?.username) {
        try {
          user = await fetchCurrentUser();
          if (user?.username) {
            setUserData(user);
          }
        } catch (error) {
          console.warn('[MagentoPickPack] Failed to fetch current user for WebSocket connection:', error);
        }
      }

      if (!user?.username) {
        console.warn('[MagentoPickPack] Cannot initialize WebSocket — no user data available');
        return;
      }

      if (!wsService.isConnected()) {
        console.log('[MagentoPickPack] Connecting to WebSocket for realtime session events');
        await wsService.connect(user);
      }

      wsService.joinRoom('inventory_management');
    } catch (error) {
      console.warn('[MagentoPickPack] Failed to ensure realtime connection:', error);
    }
  }

  setupWebSocket() {
    console.log('[MagentoPickPack] Setting up WebSocket listeners');
    
    // Bind methods to this instance
    this.handleTakeoverRequest = this.handleTakeoverRequest.bind(this);
    this.handleTakeoverResponse = this.handleTakeoverResponse.bind(this);
    this.handleSessionTransferred = this.handleSessionTransferred.bind(this);
    this.handleSessionForcedCancel = this.handleSessionForcedCancel.bind(this);
    this.handleSessionForcedTakeover = this.handleSessionForcedTakeover.bind(this);
    this.handleSessionAssigned = this.handleSessionAssigned.bind(this);
    
    // Listen for takeover and session events
    wsService.on('takeover_request', this.handleTakeoverRequest);
    wsService.on('takeover_response', this.handleTakeoverResponse);
    wsService.on('session_transferred', this.handleSessionTransferred);
    wsService.on('session_forced_cancel', this.handleSessionForcedCancel);
    wsService.on('session_forced_takeover', this.handleSessionForcedTakeover);
    wsService.on('session_assigned', this.handleSessionAssigned);
    
    console.log('[MagentoPickPack] WebSocket listeners registered');
  }

  cleanupWebSocket() {
    console.log('[MagentoPickPack] Cleaning up WebSocket listeners');
    
    wsService.off('takeover_request', this.handleTakeoverRequest);
    wsService.off('takeover_response', this.handleTakeoverResponse);
    wsService.off('session_transferred', this.handleSessionTransferred);
    wsService.off('session_forced_cancel', this.handleSessionForcedCancel);
    wsService.off('session_forced_takeover', this.handleSessionForcedTakeover);
    wsService.off('session_assigned', this.handleSessionAssigned);
  }

  async handleTakeoverRequest(data) {
    console.log('[MagentoPickPack] Takeover request received:', data);
    
    // Only show if this is our session
    if (this.currentSessionId === data.session_id) {
      const requester = data.requester_username || data.requester;
      const confirmed = await showConfirm(
        `${requester} is requesting to take over your session for order ${data.order_number}.\n\nDo you want to allow this takeover?`,
        'Takeover Request',
        'Allow',
        'Deny'
      );
      
      // TODO: Send response to backend
      // For now, just log it
      console.log('[MagentoPickPack] Takeover request response:', confirmed ? 'accepted' : 'rejected');
    }
  }

  handleTakeoverResponse(data) {
    console.log('[MagentoPickPack] Takeover response received:', data);
    
    if (data.accepted) {
      showSuccess(`Your takeover request for order ${data.order_number} was accepted!`);
    } else {
      showWarning(`Your takeover request for order ${data.order_number} was rejected.`);
    }
  }

  async handleSessionTransferred(data) {
    console.log('[MagentoPickPack] Session transferred:', data);
    
    // If our session was transferred away, return to lookup
    if (this.currentSessionId === data.session_id) {
      await showWarning(`This session has been transferred to ${data.new_owner}.`);
      this.showOrderLookup();
      window.__currentMagentoSession = null;
    }
  }

  async handleSessionForcedCancel(data) {
    console.log('[MagentoPickPack] Session force cancelled:', data);
    
    // If our session was forcefully cancelled, return to lookup
    if (this.currentSessionId === data.session_id) {
      const reason = data.reason ? `\n\nReason: ${data.reason}` : '';
      await showWarning(`This session has been cancelled by an administrator.${reason}`);
      this.currentSession = null;
      this.currentSessionId = null;
      window.__currentMagentoSession = null;
      this.showOrderLookup();
    }
  }

  async handleSessionForcedTakeover(data) {
    console.log('[MagentoPickPack] Session force taken over:', data);
    
    // If our session was forcefully taken over, return to lookup
    if (this.currentSessionId === data.session_id) {
      await showWarning(`This session has been taken over by ${data.new_owner}.`);
      window.__currentMagentoSession = null;
      this.showOrderLookup();
    }
  }

  async handleSessionAssigned(data) {
    console.log('[MagentoPickPack] Session assigned to me:', data);
    // When an admin assigns/takes over to this user, navigate into the active session
    const orderNumber = data.order_number;
    const sessionId = data.session_id;
    if (orderNumber && sessionId) {
      try {
        // Check if we're already on this session page - avoid re-navigation
        const currentPath = window.location.pathname;
        const targetPath = `/inventory/order-fulfillment/session-${orderNumber}-`;
        if (currentPath && currentPath.startsWith(targetPath)) {
          console.log('[MagentoPickPack] Already on the assigned session page, skipping redirect');
          return;
        }
        
        // Load session status to retrieve invoice_number for deep-link
        const url = `${getApiUrl()}/v1/magento/session/status/${sessionId}`;
        const response = await fetch(url, { headers: getAuthHeaders() });
        if (response.ok) {
          const status = await response.json();
          if (status?.order_number && status?.invoice_number) {
            const path = `/inventory/order-fulfillment/session-${status.order_number}-${status.invoice_number}`;
            if (window.navigate) {
              window.navigate(path);
            } else {
              history.pushState({ path }, '', path);
              location.reload();
            }
          }
        }
      } catch (err) {
        console.warn('[MagentoPickPack] Failed to navigate to assigned session:', err);
      }
    }
  }

  async checkSessionFromPath(path) {
    if (!path || path === '/inventory/order-fulfillment') {
      // Base path, show order lookup
      this.showOrderLookup();
      return;
    }

    // Check if path matches session URL pattern: /inventory/order-fulfillment/session-{order}-{invoice}
    const sessionMatch = path.match(/\/inventory\/order-fulfillment\/session-([^-]+)-(.+)/);
    if (sessionMatch) {
      const orderNumber = sessionMatch[1];
      const invoiceNumber = sessionMatch[2];
      console.log('[MagentoPickPack] Detected session URL:', { orderNumber, invoiceNumber });

      // Try to find and load this session
      try {
        // Prefer status endpoint by matching session URL after module loads
        // Fallback: attempt to get status by known pattern or ignore if not available
        // If this fetch returns HTML (e.g., due to auth redirect), catch and fallback gracefully
        const statusUrl = `${getApiUrl()}/v1/magento/session/check/${orderNumber}`;
        const response = await fetch(statusUrl, { headers: getAuthHeaders() });
        if (response.ok) {
          let info = null;
          try {
            info = await response.json();
          } catch (e) {
            console.warn('[MagentoPickPack] Non-JSON response while checking session; showing lookup', e);
            this.showOrderLookup();
            return;
          }
          // If an in-progress session exists for this order, we still rely on websocket-assigned event to inject session_id
          // Here just keep UI stable on order lookup if not in progress
        }
      } catch (error) {
        console.error('[MagentoPickPack] Error loading session from path:', error);
        // Avoid crashing the module; show lookup view
        this.showOrderLookup();
      }

      // If we couldn't load the session, redirect to base path
      this.showOrderLookup();
    }
  }

  initializeElements() {
    console.log('[MagentoPickPack] Initializing elements...');
    
    // Sections
    this.orderLookupSection = document.getElementById('orderLookupSection');
    this.activeSessionSection = document.getElementById('activeSessionSection');

    // Order Lookup Elements
    this.orderNumberInput = document.getElementById('orderNumberInput');
    this.sessionTypeDropdown = document.getElementById('sessionTypeDropdown');
    this.sessionTypeToggle = document.getElementById('sessionTypeToggle');
    this.startSessionBtn = document.getElementById('startSessionBtn');
    this.lookupMessage = document.getElementById('lookupMessage');

    // Active Session Elements
    this.sessionOrderNumber = document.getElementById('sessionOrderNumber');
    this.sessionInvoiceNumber = document.getElementById('sessionInvoiceNumber');
    this.sessionCustomer = document.getElementById('sessionCustomer');
    this.sessionTypeBadge = document.getElementById('sessionTypeBadge');
    this.progressText = document.getElementById('progressText');
    this.progressPercent = document.getElementById('progressPercent');
    this.progressFill = document.getElementById('progressFill');
    this.scannerStatus = document.getElementById('scannerStatus');
    this.skuInput = document.getElementById('skuInput');
    this.scanQuantityInput = document.getElementById('scanQuantityInput');
    this.shelfFieldSelect = document.getElementById('shelfFieldSelect');
    this.scanBtn = document.getElementById('scanBtn');
    this.scanMessage = document.getElementById('scanMessage');
    this.itemsList = document.getElementById('itemsList');
    this.cancelSessionBtn = document.getElementById('cancelSessionBtn');
    this.completeSessionBtn = document.getElementById('completeSessionBtn');

    console.log('[MagentoPickPack] Elements found:', {
      orderNumberInput: !!this.orderNumberInput,
      sessionTypeDropdown: !!this.sessionTypeDropdown,
      startSessionBtn: !!this.startSessionBtn
    });

    // Initialize custom dropdowns
    this.initializeDropdowns();
  }

  initializeDropdowns() {
    console.log('[MagentoPickPack] Initializing dropdowns...');
    // Session Type Dropdown
    this.selectedSessionType = 'pick';
    this.initDropdown('sessionTypeDropdown', (value) => {
      console.log('[MagentoPickPack] Session type changed to:', value);
      this.selectedSessionType = value;
    });
  }

  initDropdown(dropdownId, onSelect) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) {
      console.warn(`Dropdown not found: ${dropdownId}`);
      return;
    }

    console.log('[MagentoPickPack] Initializing dropdown:', dropdownId);

    const toggle = dropdown.querySelector('.c-select__button');
    const list = dropdown.querySelector('.c-select__list');
    const label = dropdown.querySelector('.c-select__label');
    const items = dropdown.querySelectorAll('.c-select__item');

    if (!toggle || !label || items.length === 0) {
      console.warn(`Dropdown elements not found for: ${dropdownId}`, { toggle: !!toggle, label: !!label, itemsCount: items.length });
      return;
    }

    console.log('[MagentoPickPack] Dropdown elements found:', { toggle: !!toggle, label: !!label, itemsCount: items.length });

    // Prevent button from submitting or triggering other actions
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[MagentoPickPack] Dropdown toggle clicked');
      const isExpanded = dropdown.getAttribute('aria-expanded') === 'true';
      dropdown.setAttribute('aria-expanded', !isExpanded);
      toggle.setAttribute('aria-expanded', !isExpanded);
      console.log('[MagentoPickPack] Dropdown expanded:', !isExpanded);
    });

    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const value = item.getAttribute('data-value');
        const text = item.textContent.trim();
        console.log('[MagentoPickPack] Dropdown item selected:', { value, text });
        label.textContent = text;
        dropdown.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-expanded', 'false');
        if (onSelect) onSelect(value, text);
      });
    });

    // Close dropdown when clicking outside
    const closeHandler = (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-expanded', 'false');
      }
    };
    
    // Store handler reference for potential cleanup
    if (!dropdown._closeHandler) {
      dropdown._closeHandler = closeHandler;
      document.addEventListener('click', closeHandler);
    }
  }

  attachEventListeners() {
    // Start Session
    this.startSessionBtn?.addEventListener('click', () => this.startSession());
    this.orderNumberInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.startSession();
    });

    // Scanning
    this.scanBtn?.addEventListener('click', () => this.scanProduct());
    this.skuInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.scanProduct();
    });

    // Session Actions
    this.cancelSessionBtn?.addEventListener('click', () => this.cancelSession());
    this.completeSessionBtn?.addEventListener('click', () => this.completeSession());
  }

  async startSession() {
    console.log('[MagentoPickPack] startSession called');
    const orderNumber = this.orderNumberInput.value.trim();
    
    if (!orderNumber) {
      this.showLookupMessage('Please enter an order number', 'error');
      return;
    }

    console.log('[MagentoPickPack] Starting session with:', { orderNumber, sessionType: this.selectedSessionType });

    try {
      this.startSessionBtn.disabled = true;
      this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

      // First, check the order status
      const checkUrl = `${getApiUrl()}/v1/magento/session/check/${encodeURIComponent(orderNumber)}`;
      console.log('[MagentoPickPack] Checking order status:', checkUrl);

      const checkResponse = await fetch(checkUrl, {
        method: 'GET',
        headers: getAuthHeaders()
      });

      if (!checkResponse.ok) {
        const error = await checkResponse.json().catch(() => ({ detail: `HTTP ${checkResponse.status}` }));
        console.error('[MagentoPickPack] Check API Error:', error);
        throw new Error(error.detail || 'Failed to check order status');
      }

      const statusData = await checkResponse.json();
      console.log('[MagentoPickPack] Order status:', statusData);

      // Handle different statuses
      if (statusData.status === 'in_progress') {
        const message = statusData.can_claim 
          ? `This order is currently being worked on by ${statusData.user}.\n\nWould you like to request to take it over?`
          : `This order is being worked on by you in another session.\n\nPlease complete or cancel that session first.`;
        
        if (!(await showConfirm(message, 'Order In Progress', 'Yes', 'No'))) {
          this.showLookupMessage('Session start cancelled', 'info');
          this.startSessionBtn.disabled = false;
          this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
          return;
        }
        
        // TODO: Implement takeover request
        await showInfo('Takeover requests are not yet implemented. Please contact an administrator.');
        this.startSessionBtn.disabled = false;
        this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
        return;
      }

      if (statusData.status === 'draft') {
        const message = statusData.can_claim
          ? `There is a draft session for this order started by ${statusData.user}.\n\nWould you like to claim it and continue?`
          : `You have a draft session for this order.\n\nWould you like to continue where you left off?`;
        
        if (!(await showConfirm(message, 'Draft Session Available', 'Continue', 'Cancel'))) {
          this.showLookupMessage('Session start cancelled', 'info');
          this.startSessionBtn.disabled = false;
          this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
          return;
        }
        
        // Claim the draft session
        await this.claimSession(statusData.session_id);
        return;
      }

      if (statusData.status === 'completed') {
        await showError(`This order has already been completed.\n\nCompleted by: ${statusData.user}\n\nYou cannot start a new session for completed orders.`, 'Order Completed');
        this.showLookupMessage('Order already completed', 'error');
        this.startSessionBtn.disabled = false;
        this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
        return;
      }

      if (statusData.status === 'cancelled') {
        const message = `There is a cancelled session for this order.\n\nWould you like to start a fresh session?`;
        
        if (!(await showConfirm(message, 'Cancelled Session', 'Start Fresh', 'Cancel'))) {
          this.showLookupMessage('Session start cancelled', 'info');
          this.startSessionBtn.disabled = false;
          this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
          return;
        }
      }

      // Proceed with starting a new session
      this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

      const url = `${getApiUrl()}/v1/magento/session/start`;
      console.log('[MagentoPickPack] Calling API:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_number: orderNumber,
          session_type: this.selectedSessionType
        })
      });

      console.log('[MagentoPickPack] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
        console.error('[MagentoPickPack] API Error:', error);
        throw new Error(error.detail || 'Failed to start session');
      }

      const session = await response.json();
      console.log('[MagentoPickPack] Session started:', session);
      this.currentSession = session;
      this.currentSessionId = session.session_id;
      
      // Store session ID globally for cleanup
      window.__currentMagentoSession = session.session_id;

      // Navigate to session-specific URL
      const sessionUrl = `/inventory/order-fulfillment/session-${session.order_number}-${session.invoice_number}`;
      updateRoute(sessionUrl, false, { sessionId: session.session_id });
      this.currentPath = sessionUrl;

      // Switch to active session view
      this.showActiveSession();
      this.updateSessionDisplay();

    } catch (error) {
      console.error('Error starting session:', error);
      this.showLookupMessage(error.message, 'error');
    } finally {
      this.startSessionBtn.disabled = false;
      this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
    }
  }

  async claimSession(sessionId) {
    try {
      this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Claiming...';

      const url = `${getApiUrl()}/v1/magento/sessions/${sessionId}/claim`;
      console.log('[MagentoPickPack] Claiming session:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
        throw new Error(error.detail || 'Failed to claim session');
      }

      const result = await response.json();
      console.log('[MagentoPickPack] Session claimed:', result);

      const claimedSessionId = result.session_id;
      this.currentSessionId = claimedSessionId;
      window.__currentMagentoSession = claimedSessionId;

      // Load the full session payload so UI fields (order, items, etc.) populate correctly
      await this.refreshSessionStatus();

      if (!this.currentSession) {
        throw new Error('Failed to load claimed session data');
      }

      const sessionUrl = `/inventory/order-fulfillment/session-${this.currentSession.order_number}-${this.currentSession.invoice_number}`;
      updateRoute(sessionUrl, false, { sessionId: claimedSessionId });
      this.currentPath = sessionUrl;

      this.showActiveSession();
      // refreshSessionStatus already called updateSessionDisplay, but ensure the latest data renders
      this.updateSessionDisplay();

    } catch (error) {
      console.error('Error claiming session:', error);
      this.showLookupMessage(error.message, 'error');
    } finally {
      this.startSessionBtn.disabled = false;
      this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
    }
  }

  showActiveSession() {
    this.orderLookupSection.style.display = 'none';
    this.activeSessionSection.style.display = 'block';
    
    // Ensure tab stays highlighted
    ensureTabHighlighted();
    
    // Enable scanner inputs
    this.skuInput.disabled = false;
    this.scanQuantityInput.disabled = false;
    this.shelfFieldSelect.disabled = false;
    this.scanBtn.disabled = false;
    
    // Focus on SKU input
    setTimeout(() => this.skuInput.focus(), 100);
  }

  showOrderLookup() {
    this.activeSessionSection.style.display = 'none';
    this.orderLookupSection.style.display = 'block';
    
    // Navigate back to base order fulfillment URL
    const baseUrl = '/inventory/order-fulfillment';
    if (this.currentPath !== baseUrl) {
      updateRoute(baseUrl, false, {});
      this.currentPath = baseUrl;
    }
    
    // Ensure tab stays highlighted
    ensureTabHighlighted();
    
    this.orderNumberInput.value = '';
    this.currentSession = null;
    this.currentSessionId = null;
  }

  updateSessionDisplay() {
    if (!this.currentSession) return;

    // Update header info
    this.sessionOrderNumber.textContent = this.currentSession.order_number;
    this.sessionInvoiceNumber.textContent = this.currentSession.invoice_number;
    this.sessionCustomer.textContent = 'Customer'; // Can be enhanced with billing info

    // Update session type badge
    const badgeIcon = this.currentSession.session_type === 'pick' ? 'fa-box' : 'fa-undo';
    const badgeText = this.currentSession.session_type === 'pick' ? 'PICK & PACK' : 'RETURNS';
    this.sessionTypeBadge.innerHTML = `<i class="fas ${badgeIcon}"></i><span>${badgeText}</span>`;

    // Update progress
    const completed = this.currentSession.completed_items;
    const total = this.currentSession.total_items;
    const percent = this.currentSession.progress_percentage;

    this.progressText.textContent = `${completed} of ${total} items scanned`;
    this.progressPercent.textContent = `${percent}%`;
    this.progressFill.style.width = `${percent}%`;

    // Enable/disable complete button
    this.completeSessionBtn.disabled = completed !== total;

    // Update items list
    this.updateItemsList();
  }

  updateItemsList() {
    if (!this.currentSession || !this.currentSession.items) {
      this.itemsList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <p>No items to display</p>
        </div>
      `;
      return;
    }

    const itemsHtml = this.currentSession.items.map(item => {
      let statusClass = '';
      let statusIcon = 'fa-circle';
      let badgeText = 'Pending';

      if (item.is_complete) {
        if (item.qty_scanned > item.qty_invoiced) {
          statusClass = 'overpicked';
          statusIcon = 'fa-exclamation-triangle';
          badgeText = 'Overpicked';
        } else {
          statusClass = 'complete';
          statusIcon = 'fa-check';
          badgeText = 'Complete';
        }
      } else if (item.qty_scanned > 0) {
        statusClass = 'in-progress';
        statusIcon = 'fa-clock';
        badgeText = 'In Progress';
      }

      return `
        <div class="item-card ${statusClass}">
          <div class="item-status-icon">
            <i class="fas ${statusIcon}"></i>
          </div>
          <div class="item-details">
            <div class="item-name">${this.escapeHtml(item.name)}</div>
            <div class="item-sku">${this.escapeHtml(item.sku)}</div>
          </div>
          <div class="item-quantity">
            <div class="qty-numbers">${item.qty_scanned} / ${item.qty_invoiced}</div>
            <div class="qty-label">Scanned / Expected</div>
          </div>
          <div class="item-badge">${badgeText}</div>
        </div>
      `;
    }).join('');

    this.itemsList.innerHTML = itemsHtml;
  }

  async scanProduct() {
    const sku = this.skuInput.value.trim();
    const quantity = parseFloat(this.scanQuantityInput.value) || 1;
    const field = this.shelfFieldSelect.value || 'auto';

    if (!sku) {
      this.showScanMessage('Please enter a SKU', 'error');
      return;
    }

    if (!this.currentSessionId) {
      this.showScanMessage('No active session', 'error');
      return;
    }

    try {
      this.scanBtn.disabled = true;
      this.scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';

      const response = await fetch(`${getApiUrl()}/v1/magento/session/scan`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: this.currentSessionId,
          sku: sku,
          quantity: quantity,
          field: field
        })
      });

      const result = await response.json();

      if (result.success) {
        // Refresh session status
        await this.refreshSessionStatus();

        // Show scan result
        let messageType = 'success';
        if (result.is_overpicked) {
          messageType = 'warning';
        }
        this.showScanMessage(result.message, messageType);

        // Clear input and focus
        this.skuInput.value = '';
        this.scanQuantityInput.value = '1';
        this.skuInput.focus();

        // Play success sound (optional)
        this.playBeep();

      } else {
        this.showScanMessage(result.message, 'error');
      }

    } catch (error) {
      console.error('Error scanning product:', error);
      this.showScanMessage('Scan failed: ' + error.message, 'error');
    } finally {
      this.scanBtn.disabled = false;
      this.scanBtn.innerHTML = '<i class="fas fa-check"></i> Scan';
    }
  }

  async refreshSessionStatus() {
    if (!this.currentSessionId) return;

    try {
      const response = await fetch(`${getApiUrl()}/v1/magento/session/status/${this.currentSessionId}`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        this.currentSession = await response.json();
        this.updateSessionDisplay();
      }
    } catch (error) {
      console.error('Error refreshing session:', error);
    }
  }

  async completeSession() {
    if (!this.currentSessionId) return;

    const confirmed = await showConfirm('Are you sure you want to complete this session?', 'Complete Session', 'Complete', 'Cancel');
    if (!confirmed) return;

    try {
      this.completeSessionBtn.disabled = true;
      this.completeSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';

      const response = await fetch(`${getApiUrl()}/v1/magento/session/complete`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: this.currentSessionId,
          force_complete: false
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to complete session');
      }

      // Show success message
      await showSuccess('Session completed successfully!');

      // Clear global session tracking
      window.__currentMagentoSession = null;
      
      // Return to order lookup
      this.showOrderLookup();

    } catch (error) {
      console.error('Error completing session:', error);
      await showError('Error: ' + error.message);
    } finally {
      this.completeSessionBtn.disabled = false;
      this.completeSessionBtn.innerHTML = '<i class="fas fa-check"></i> Complete';
    }
  }

  async cancelSession() {
    if (!this.currentSessionId) return;

    const confirmed = await showConfirm('Are you sure you want to cancel this session? All progress will be lost.', 'Cancel Session', 'Cancel Session', 'Keep Working');
    if (!confirmed) return;

    try {
      const response = await fetch(`${getApiUrl()}/v1/magento/session/${this.currentSessionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to cancel session');
      }

      // Clear global session tracking
      window.__currentMagentoSession = null;
      
      // Return to order lookup
      this.showOrderLookup();

    } catch (error) {
      console.error('Error cancelling session:', error);
      await showError('Error: ' + error.message);
    }
  }

  async loadActiveSessions() {
    try {
      const response = await fetch(`${getApiUrl()}/v1/magento/sessions/active`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const sessions = await response.json();
        
        // If there's an active session, ask if user wants to resume
        if (sessions.length > 0) {
          const session = sessions[0];
          const resume = await showConfirm(`You have an active session for order ${session.order_number}. Resume?`, 'Resume Session', 'Resume', 'Start New');
          
          if (resume) {
            this.currentSession = session;
            this.currentSessionId = session.session_id;
            this.showActiveSession();
            this.updateSessionDisplay();
          }
        }
      }
    } catch (error) {
      console.error('Error loading active sessions:', error);
    }
  }

  showLookupMessage(message, type = 'info') {
    this.lookupMessage.textContent = message;
    this.lookupMessage.className = `message-area ${type}`;
    this.lookupMessage.style.display = 'flex';

    setTimeout(() => {
      this.lookupMessage.style.display = 'none';
    }, 5000);
  }

  showScanMessage(message, type = 'success') {
    this.scanMessage.textContent = message;
    this.scanMessage.className = `scan-message scan-${type}`;
    this.scanMessage.style.display = 'block';

    setTimeout(() => {
      this.scanMessage.style.display = 'none';
    }, 3000);
  }

  playBeep() {
    // Optional: Play a beep sound for successful scans
    // Can be implemented with Web Audio API or audio element
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.1;

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
      // Audio not supported or not allowed
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Module initialization and export
export async function init(path) {
  console.log('[OrderFulfillment] Initializing Order Fulfillment module with path:', path);
  
  if (!window.__magentoPickPackInitialized) {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve);
      });
    }
    
    const manager = new MagentoPickPackManager(path);
    window.__magentoPickPackManager = manager;
    window.__magentoPickPackInitialized = true;
  } else if (window.__magentoPickPackManager) {
    // Module already initialized, just check if we need to load a session from path
    window.__magentoPickPackManager.checkSessionFromPath(path);
  }
}

// Helper function to ensure tab highlighting
function ensureTabHighlighted() {
  // Find all tab buttons in the inner-tabs
  const tabButtons = document.querySelectorAll('.inner-tabs .tab-button');
  tabButtons.forEach(btn => {
    // Remove active class from all tabs
    btn.classList.remove('active');
    
    // Add active to the Order Fulfillment tab
    if (btn.textContent.includes('Order Fulfillment')) {
      btn.classList.add('active');
    }
  });
}

// Cleanup on navigation away
export function cleanup() {
  console.log('[MagentoPickPack] Cleanup called');
  
  // Cleanup WebSocket listeners if manager exists
  if (window.__magentoPickPackManager) {
    window.__magentoPickPackManager.cleanupWebSocket();
  }
  
  // NOTE: We do NOT clear window.__currentMagentoSession or call release here
  // The router-level auto-draft manager handles unload, navigation, connection
  // drops, and long-lived tab hides so that legitimate tab switches stay safe.
  // This cleanup is only for when navigating between inventory sub-modules.
  
  window.__magentoPickPackInitialized = false;
  window.__magentoPickPackManager = null;
}

// Also support direct script inclusion (fallback) - but this shouldn't run when using router
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[MagentoPickPack] DOMContentLoaded - checking if already initialized');
    // Only init if not already initialized by router
    if (!window.__magentoPickPackInitialized) {
      window.__magentoPickPackInitialized = true;
      window.__magentoPickPackManager = new MagentoPickPackManager();
    }
  });
} else {
  console.log('[MagentoPickPack] Document already loaded - checking if already initialized');
  if (!window.__magentoPickPackInitialized) {
    window.__magentoPickPackInitialized = true;
    window.__magentoPickPackManager = new MagentoPickPackManager();
  }
}
