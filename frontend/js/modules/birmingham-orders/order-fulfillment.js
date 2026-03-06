// frontend/js/modules/birmingham-orders/order-fulfillment.js
// Birmingham Orders - Order Fulfillment Module
// Uses UK Birmingham branch inventory (uk_birmingham_inventory table)

import { getApiUrl } from '../../config.js';
import { getToken } from '../../services/state/sessionStore.js';
import { getUserData, setUserData } from '../../services/state/userStore.js';
import { me as fetchCurrentUser } from '../../services/api/authApi.js';
import { wsService } from '../../services/websocket.js';
import { showNotification } from '../../ui/modal.js';
import * as orderModals from '../../ui/orderFulfillmentModals.js';
import { updateRoute, showLoading, hideLoading } from '../../router.js';
import { showToast } from '../../ui/toast.js';
import { initDropdown } from '../../ui/dropdown.js';

// Currency symbol mapping
function getCurrencySymbol(currencyCode) {
  const symbols = {
    'GBP': '£',
    'EUR': '€',
    'USD': '$',
    'CAD': 'C$',
    'AUD': 'A$',
    'JPY': '¥',
    'CNY': '¥',
    'CHF': 'Fr',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'PLN': 'zł',
    'CZK': 'Kč',
    'HUF': 'Ft'
  };
  
  const code = currencyCode?.toUpperCase();
  return symbols[code] || code || '';
}

// Helper to get auth headers
function getAuthHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

class MagentoPickPackManager {
  constructor(initialPath) {
    this.currentSession = null;
    this.currentSessionId = null;
    this.currentPath = initialPath || '/birmingham-orders/order-fulfillment';
    this.initialLoadPromise = null;
    this.isMobileMode = false;
    this.activeColumn = 'ready-to-pick';
    this.resizeHandler = null; // Store resize handler for cleanup
    this.initializeElements();
    this.attachEventListeners();
    this.setupMobileMode();
    this.setupWebSocket();
    // NOTE: ensureRealtimeConnection() is now called from init() to ensure proper awaiting
    // The initialLoadPromise is set after WebSocket connection in init()
    // WebSocket handles all real-time updates, no auto-refresh needed
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

      console.log('[MagentoPickPack] Initializing WebSocket connection for user:', user.username);
      if (!wsService.isConnected()) {
        await wsService.connect(user);
        console.log('[MagentoPickPack] WebSocket connection initiated');
      } else {
        console.log('[MagentoPickPack] WebSocket already connected');
      }

      wsService.joinRoom('birmingham_orders');
      console.log('[MagentoPickPack] Requested to join birmingham_orders room');
    } catch (error) {
      console.warn('[MagentoPickPack] Failed to ensure realtime connection:', error);
    }
  }

  setupWebSocket() {
    // Bind methods to this instance
    this.handleSessionTransferred = this.handleSessionTransferred.bind(this);
    this.handleSessionForcedCancel = this.handleSessionForcedCancel.bind(this);
    this.handleSessionForcedTakeover = this.handleSessionForcedTakeover.bind(this);
    this.handleSessionAssigned = this.handleSessionAssigned.bind(this);
    this.handleOrderStatusChanged = this.handleOrderStatusChanged.bind(this);
    this.handleOrderCreated = this.handleOrderCreated.bind(this);
    this.handleOrderDeleted = this.handleOrderDeleted.bind(this);
    this.updateLiveStatus = this.updateLiveStatus.bind(this);
    
    // Listen for session events
    wsService.on('session_transferred', this.handleSessionTransferred);
    wsService.on('session_forced_cancel', this.handleSessionForcedCancel);
    wsService.on('session_forced_takeover', this.handleSessionForcedTakeover);
    wsService.on('session_assigned', this.handleSessionAssigned);
    
    // Listen for tracking board updates
    wsService.on('order_status_changed', this.handleOrderStatusChanged);
    wsService.on('order_created', this.handleOrderCreated);
    wsService.on('order_deleted', this.handleOrderDeleted);
    
    // Listen for connection status
    wsService.on('connected', this.updateLiveStatus);
    wsService.on('disconnected', this.updateLiveStatus);
    wsService.on('connection_error', this.updateLiveStatus);
    
    // Update live status immediately to reflect current connection state
    this.updateLiveStatus();
  }

  cleanupWebSocket() {
    console.log('[Birmingham cleanupWebSocket] Removing WebSocket handlers');
    wsService.off('session_transferred', this.handleSessionTransferred);
    wsService.off('session_forced_cancel', this.handleSessionForcedCancel);
    wsService.off('session_forced_takeover', this.handleSessionForcedTakeover);
    wsService.off('session_assigned', this.handleSessionAssigned);
    wsService.off('order_status_changed', this.handleOrderStatusChanged);
    wsService.off('order_created', this.handleOrderCreated);
    wsService.off('order_deleted', this.handleOrderDeleted);
    wsService.off('connected', this.updateLiveStatus);
    wsService.off('disconnected', this.updateLiveStatus);
    wsService.off('connection_error', this.updateLiveStatus);
    console.log('[Birmingham cleanupWebSocket] Handlers removed');
    
    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  async handleSessionTransferred(data) {
    // If our session was transferred away, return to lookup
    if (this.currentSessionId === data.session_id) {
      await orderModals.alertSessionTransferred(data.new_owner);
      this.showOrderLookup();
      window.__currentMagentoSession = null;
    }
  }

  async handleSessionForcedCancel(data) {
    // If our session was forcefully cancelled, return to lookup
    if (this.currentSessionId === data.session_id) {
      await orderModals.alertSessionForceCancelled(data.reason);
      this.currentSession = null;
      this.currentSessionId = null;
      window.__currentMagentoSession = null;
      this.showOrderLookup();
    }
  }

  async handleSessionForcedTakeover(data) {
    // If our session was forcefully taken over, return to lookup
    if (this.currentSessionId === data.session_id) {
      await orderModals.alertSessionForceTakeover(data.new_owner);
      window.__currentMagentoSession = null;
      this.showOrderLookup();
    }
  }

  async handleSessionAssigned(data) {
    // When an admin assigns/takes over to this user, navigate into the active session
    const orderNumber = data.order_number;
    const sessionId = data.session_id;
    if (orderNumber && sessionId) {
      try {
        // Check if we're already on this session page - avoid re-navigation
        const currentPath = window.location.pathname;
        const targetPath = `/birmingham-orders/order-fulfillment/session-${orderNumber}-`;
        if (currentPath && currentPath.startsWith(targetPath)) {
          return;
        }
        
        // Load session status to retrieve invoice_number for deep-link
        const url = `${getApiUrl()}/v1/magento/session/status/${sessionId}`;
        const response = await fetch(url, { headers: getAuthHeaders() });
        if (response.ok) {
          const status = await response.json();
          if (status?.order_number && status?.invoice_number) {
            const path = `/birmingham-orders/order-fulfillment/session-${status.order_number}-${status.invoice_number}`;
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

  async handleOrderStatusChanged(data) {
    console.log('[MagentoPickPack] Order status changed:', data);
    // Only reload tracking board if we're not in an active session
    if (!this.currentSession) {
      await this.loadTrackingBoard();
    }
  }

  async handleOrderCreated(data) {
    console.log('[MagentoPickPack] New order created:', data);
    if (!this.currentSession) {
      await this.loadTrackingBoard();
    }
  }

  async handleOrderDeleted(data) {
    console.log('[MagentoPickPack] Order deleted:', data);
    if (!this.currentSession) {
      await this.loadTrackingBoard();
    }
  }

  updateLiveStatus() {
    const liveStatus = document.getElementById('liveStatus');
    if (!liveStatus) return;
    
    if (wsService.isConnected()) {
      liveStatus.className = 'ot-live-status connected';
      liveStatus.querySelector('.status-text').textContent = 'Live';
    } else {
      liveStatus.className = 'ot-live-status disconnected';
      liveStatus.querySelector('.status-text').textContent = 'Offline';
    }
  }

  async checkSessionFromPath(path) {
    if (!path || path === '/birmingham-orders/order-fulfillment') {
      // Base path, show order lookup (this is initial load)
      await this.showOrderLookup(true);
      return;
    }

    // Check if path matches session URL pattern: /birmingham-orders/order-fulfillment/session-{order}-{invoice}
    const sessionMatch = path.match(/\/birmingham-orders\/order-fulfillment\/session-([^-]+)-(.+)/);
    if (sessionMatch) {
      const orderNumber = sessionMatch[1];
      const invoiceNumber = sessionMatch[2];
      // Try to find and load this session
      try {
        const statusUrl = `${getApiUrl()}/v1/magento/session/check/${orderNumber}`;
        const response = await fetch(statusUrl, { headers: getAuthHeaders() });
        if (response.ok) {
          let info = null;
          try {
            info = await response.json();
          } catch (e) {
            console.warn('[MagentoPickPack] Non-JSON response while checking session; showing lookup', e);
            await this.showOrderLookup();
            return;
          }
          
          // If session exists and is active (not available/cancelled), load it
          if (info && info.session_id && ['in_progress', 'draft', 'approved', 'ready_to_check'].includes(info.status)) {
            console.log('[MagentoPickPack] Found active session, loading:', info.session_id, 'type:', info.session_type);
            
            // If session is ready_to_check (status), it's waiting for a checker to start
            // If there's an existing check session (session_type=check), just claim/continue it
            if (info.status === 'ready_to_check' && info.session_type !== 'check') {
              console.log('[MagentoPickPack] Starting check session for ready_to_check order');
              await this.startSession(orderNumber, 'check');
              return;
            }
            
            // If session is draft or approved, claim it to start/resume work
            if (info.status === 'draft' || info.status === 'approved') {
              console.log('[MagentoPickPack] Claiming draft/approved session:', info.session_id);
              await this.claimSession(info.session_id);
              return;
            }
            
            this.currentSessionId = info.session_id;
            window.__currentMagentoSession = info.session_id;
            
            // Load the full session data
            await this.refreshSessionStatus();
            
            if (this.currentSession) {
              // Update the path to match the session
              this.currentPath = path;
              this.showActiveSession();
              return;
            }
          } else {
            console.log('[MagentoPickPack] Session not active or not found, status:', info?.status);
          }
        }
      } catch (error) {
        console.error('[MagentoPickPack] Error loading session from path:', error);
      }

      // If we couldn't load the session, redirect to base path
      await this.showOrderLookup();
      return;
    }
    
    // Unknown path format, show lookup
    await this.showOrderLookup();
  }

  initializeElements() {
    // Sections
    this.orderLookupSection = document.getElementById('orderLookupSection');
    this.activeSessionSection = document.getElementById('activeSessionSection');
    this.progressSection = document.getElementById('progressSection');
    this.stickyBottomPanel = document.getElementById('stickyBottomPanel');
    this.scannerSection = document.getElementById('scannerSection');
    this.itemsListSection = document.getElementById('itemsListSection');
    this.sessionActionsSection = document.getElementById('sessionActionsSection');

    // Order Lookup Elements
    this.orderNumberInput = document.getElementById('orderNumberInput');
    this.sessionTypeSelect = document.getElementById('sessionTypeSelect');
    this.startSessionBtn = document.getElementById('startSessionBtn');
    this.lookupMessage = document.getElementById('lookupMessage');

    // Order Preview Modal Elements
    this.orderPreviewModal = document.getElementById('orderPreviewModal');
    this.closeOrderPreviewBtn = document.getElementById('closeOrderPreviewBtn');
    this.cancelOrderPreviewBtn = document.getElementById('cancelOrderPreviewBtn');
    this.startSessionFromPreviewBtn = document.getElementById('startSessionFromPreviewBtn');
    this.pendingPreviewOrder = null;
    this.pendingPreviewSessionType = null;

    // Completed Session Modal Elements
    this.completedSessionModal = document.getElementById('completedSessionModal');
    this.closeCompletedSessionBtn = document.getElementById('closeCompletedSessionBtn');
    this.closeCompletedSessionOkBtn = document.getElementById('closeCompletedSessionOkBtn');

    // Active Session Elements
    this.sessionOrderNumber = document.getElementById('sessionOrderNumber');
    this.sessionInvoiceNumber = document.getElementById('sessionInvoiceNumber');
    this.sessionOrderDate = document.getElementById('sessionOrderDate');
    this.sessionPaymentMethod = document.getElementById('sessionPaymentMethod');
    this.sessionShippingMethod = document.getElementById('sessionShippingMethod');
    this.sessionBillingName = document.getElementById('sessionBillingName');
    this.sessionBillingAddress = document.getElementById('sessionBillingAddress');
    this.sessionBillingPostcode = document.getElementById('sessionBillingPostcode');
    this.sessionBillingPhone = document.getElementById('sessionBillingPhone');
    this.sessionShippingName = document.getElementById('sessionShippingName');
    this.sessionShippingAddress = document.getElementById('sessionShippingAddress');
    this.sessionShippingPostcode = document.getElementById('sessionShippingPostcode');
    this.sessionShippingPhone = document.getElementById('sessionShippingPhone');
    this.sessionTypeBadge = document.getElementById('sessionTypeBadge');
    
    // Progress bar elements - Items completed
    this.itemsProgressText = document.getElementById('itemsProgressText');
    this.itemsProgressPercent = document.getElementById('itemsProgressPercent');
    this.itemsProgressFill = document.getElementById('itemsProgressFill');
    
    // Progress bar elements - Quantity scanned
    this.qtyProgressText = document.getElementById('qtyProgressText');
    this.qtyProgressPercent = document.getElementById('qtyProgressPercent');
    this.qtyProgressFill = document.getElementById('qtyProgressFill');
    
    this.scannerStatus = document.getElementById('scannerStatus');
    this.skuInput = document.getElementById('skuInput');
    this.scanQuantityInput = document.getElementById('scanQuantityInput');
    this.shelfFieldSelect = document.getElementById('shelfFieldSelect');
    this.scanBtn = document.getElementById('scanBtn');
    this.scanMessage = document.getElementById('scanMessage');
    this.itemsList = document.getElementById('itemsList');
    this.cancelSessionBtn = document.getElementById('cancelSessionBtn');
    this.completeSessionBtn = document.getElementById('completeSessionBtn');
    this.markReadyToCheckBtn = document.getElementById('markReadyToCheckBtn');
    this.sendBackForPickingBtn = document.getElementById('sendBackForPickingBtn');
    this.saveAsDraftBtn = document.getElementById('saveAsDraftBtn');
    // Initialize custom dropdowns
    this.initializeDropdowns();
  }


  initializeDropdowns() {
    this.selectedSessionType = 'pick';

    const sessionTypeSelect = document.getElementById('sessionTypeSelect');
    if (sessionTypeSelect) {
      initDropdown(sessionTypeSelect);
      this.selectedSessionType = sessionTypeSelect.value;
      sessionTypeSelect.addEventListener('change', (e) => {
        this.selectedSessionType = e.target.value;
        console.log('Session type changed to:', this.selectedSessionType);
      });
    }

    initDropdown(this.shelfFieldSelect);
  }

  attachEventListeners() {
    // Refresh Button
    const refreshBtn = document.getElementById('refreshBoardBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('spinning');
        await this.loadTrackingBoard();
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('spinning');
      });
    }
    
    // Start Session
    this.startSessionBtn?.addEventListener('click', () => this.startSession());
    this.orderNumberInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.startSession();
    });

    // Order Preview Modal
    this.closeOrderPreviewBtn?.addEventListener('click', () => this.hideOrderPreview());
    this.cancelOrderPreviewBtn?.addEventListener('click', () => this.hideOrderPreview());
    this.startSessionFromPreviewBtn?.addEventListener('click', () => this.confirmStartSessionFromPreview());

    // Completed Session Modal
    this.closeCompletedSessionBtn?.addEventListener('click', () => this.hideCompletedSessionModal());
    this.closeCompletedSessionOkBtn?.addEventListener('click', () => this.hideCompletedSessionModal());

    // Scanning
    this.scanBtn?.addEventListener('click', () => this.scanProduct());
    this.skuInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.scanProduct();
    });

    // Session Actions
    this.cancelSessionBtn?.addEventListener('click', () => this.cancelSession());
    this.completeSessionBtn?.addEventListener('click', () => this.completeSession());
    this.markReadyToCheckBtn?.addEventListener('click', () => this.markReadyToCheck());
    this.sendBackForPickingBtn?.addEventListener('click', () => this.sendBackForPicking());
    this.saveAsDraftBtn?.addEventListener('click', () => this.saveAsDraft());
  }

  setupMobileMode() {
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    
    // Function to check if we should be in mobile mode based on window size
    // Using 768px as breakpoint for phones only (iPad portrait and smaller)
    // This allows "Request Desktop Site" to work (browsers report ~980px)
    // CSS still handles responsive layout at 1024px for tablets
    const checkMobileSize = () => {
      return window.innerWidth <= 768;
    };
    
    // Set initial state based on window size
    this.isMobileMode = checkMobileSize();
    this.toggleMobileMode(this.isMobileMode);
    
    // Create resize handler
    let resizeTimeout;
    this.resizeHandler = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const shouldBeMobile = checkMobileSize();
        if (this.isMobileMode !== shouldBeMobile) {
          this.isMobileMode = shouldBeMobile;
          this.toggleMobileMode(shouldBeMobile);
        }
      }, 100); // Debounce resize events
    };
    
    // Listen for window resize to automatically toggle mobile mode
    window.addEventListener('resize', this.resizeHandler);
    
    // Mobile tab listeners
    if (mobileColumnTabs) {
      const tabButtons = mobileColumnTabs.querySelectorAll('.mobile-tab-button');
      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          this.activeColumn = button.getAttribute('data-column');
          this.updateMobileTabs();
          this.updateMobileColumnVisibility();
        });
      });
    }
  }

  toggleMobileMode(enabled) {
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    const trackingBoard = document.getElementById('trackingBoard');
    const pageContainer = document.querySelector('.order-fulfillment');
    
    if (enabled) {
      document.body.classList.add('mobile-mode');
      if (pageContainer) pageContainer.classList.add('mobile-mode-active');
      if (mobileColumnTabs) mobileColumnTabs.style.display = 'flex';
      this.updateMobileColumnVisibility();
    } else {
      document.body.classList.remove('mobile-mode');
      if (pageContainer) pageContainer.classList.remove('mobile-mode-active');
      if (mobileColumnTabs) mobileColumnTabs.style.display = 'none';
      // Show all columns
      if (trackingBoard) {
        const columns = trackingBoard.querySelectorAll('.ot-column');
        columns.forEach(col => col.style.display = 'flex');
      }
    }
  }

  updateMobileTabs() {
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    if (!mobileColumnTabs) return;
    
    const tabButtons = mobileColumnTabs.querySelectorAll('.mobile-tab-button');
    tabButtons.forEach(button => {
      if (button.getAttribute('data-column') === this.activeColumn) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  }

  updateMobileColumnVisibility() {
    if (!this.isMobileMode) return;
    
    const columnMap = {
      'ready-to-pick': 'readyToPickColumn',
      'ready-to-check': 'readyToCheckColumn',
      'completed': 'completedColumn'
    };
    
    Object.entries(columnMap).forEach(([key, _]) => {
      const column = document.querySelector(`[id="${columnMap[key]}"]`)?.closest('.ot-column');
      if (column) {
        column.style.display = key === this.activeColumn ? 'flex' : 'none';
      }
    });
  }

  async startSession(orderNumber = null, sessionType = null) {
    // Use provided parameters or fall back to input values
    const order = orderNumber || this.orderNumberInput?.value?.trim();
    const type = sessionType || this.selectedSessionType;
    
    if (!order) {
      this.showLookupMessage('Please enter an order number', 'error');
      return;
    }
    try {
      if (this.startSessionBtn) {
        this.startSessionBtn.disabled = true;
        this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
      }

      // First, check the order status
      const checkUrl = `${getApiUrl()}/v1/magento/session/check/${encodeURIComponent(order)}`;
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
      // Handle different statuses
      
      if (statusData.status === 'approved') {
        // Session is approved and ready to pick - claim it directly
        await this.claimSession(statusData.session_id);
        return;
      }
      
      if (statusData.status === 'in_progress') {
        // Order is currently being worked on
        if (statusData.can_claim) {
          // Another user is working on this order - inform them
          await orderModals.alertInfo(
            `This order is currently being processed by ${statusData.user}.\n\nPlease wait until they are finished or contact an administrator if urgent.`,
            'Order In Progress'
          );
        } else {
          // User's own session is in progress
          await orderModals.confirmOwnOrderInProgress();
        }
        this.showLookupMessage('Session start cancelled', 'info');
        if (this.startSessionBtn) {
          this.startSessionBtn.disabled = false;
          this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
        }
        return;
      }

      if (statusData.status === 'draft') {
        const isOwnDraft = !statusData.can_claim;
        const result = await orderModals.confirmClaimDraft(order, statusData.user, isOwnDraft);
        
        // Handle the modal response
        // For own draft: true/false, for other user's draft: 'continue'/'cancel'/'cancel_order'
        const shouldContinue = result === true || result === 'continue';
        const shouldCancelOrder = result === 'cancel_order';
        
        if (shouldCancelOrder) {
          // Cancel the order/session
          try {
            const cancelUrl = `${getApiUrl()}/v1/birmingham-magento/session/${statusData.session_id}/cancel`;
            const cancelResponse = await fetch(cancelUrl, {
              method: 'POST',
              headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ reason: 'Cancelled by user - draft from another user' })
            });
            
            if (cancelResponse.ok) {
              this.showLookupMessage('Order draft cancelled successfully', 'success');
              await this.loadTrackingBoard();
            } else {
              const errorData = await cancelResponse.json().catch(() => ({}));
              this.showLookupMessage(errorData.detail || 'Failed to cancel order', 'error');
            }
          } catch (e) {
            console.error('Error cancelling order:', e);
            this.showLookupMessage('Failed to cancel order', 'error');
          }
          if (this.startSessionBtn) {
            this.startSessionBtn.disabled = false;
            this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
          }
          return;
        }
        
        if (!shouldContinue) {
          this.showLookupMessage('Session start cancelled', 'info');
          if (this.startSessionBtn) {
            this.startSessionBtn.disabled = false;
            this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
          }
          return;
        }
        
        // Claim the draft session
        await this.claimSession(statusData.session_id);
        return;
      }

      if (statusData.status === 'completed') {
        await orderModals.alertOrderCompleted(order, statusData.user);
        this.showLookupMessage('Order already completed', 'error');
        if (this.startSessionBtn) {
          this.startSessionBtn.disabled = false;
          this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
        }
        return;
      }

      if (statusData.status === 'cancelled') {
        const confirmed = await orderModals.confirmStartAfterCancelled(order);
        
        if (!confirmed) {
          this.showLookupMessage('Session start cancelled', 'info');
          if (this.startSessionBtn) {
            this.startSessionBtn.disabled = false;
            this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
          }
          return;
        }
      }

      // Proceed with starting a new session
      if (this.startSessionBtn) {
        this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
      }

      const url = `${getApiUrl()}/v1/magento/session/start`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_number: order,
          session_type: type
        })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
        console.error('[MagentoPickPack] API Error:', error);
        throw new Error(error.detail || 'Failed to start session');
      }

      const session = await response.json();
      this.currentSession = session;
      this.currentSessionId = session.session_id;
      
      // Store session ID globally for cleanup
      window.__currentMagentoSession = session.session_id;

      // Navigate to session-specific URL
      const sessionUrl = `/birmingham-orders/order-fulfillment/session-${session.order_number}-${session.invoice_number}`;
      updateRoute(sessionUrl, false, { sessionId: session.session_id });
      this.currentPath = sessionUrl;

      // Switch to active session view
      this.showActiveSession();
      this.updateSessionDisplay();

    } catch (error) {
      console.error('Error starting session:', error);
      this.showLookupMessage(error.message, 'error');
      showNotification(error.message, 'error');
    } finally {
      if (this.startSessionBtn) {
        this.startSessionBtn.disabled = false;
        this.startSessionBtn.innerHTML = '<i class="fas fa-play"></i> Start Session';
      }
    }
  }

  async claimSession(sessionId) {
    try {
      this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Claiming...';

      const url = `${getApiUrl()}/v1/magento/sessions/${sessionId}/claim`;
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
      const claimedSessionId = result.session_id;
      this.currentSessionId = claimedSessionId;
      window.__currentMagentoSession = claimedSessionId;

      // Load the full session payload so UI fields (order, items, etc.) populate correctly
      await this.refreshSessionStatus();

      if (!this.currentSession) {
        throw new Error('Failed to load claimed session data');
      }

      const sessionUrl = `/birmingham-orders/order-fulfillment/session-${this.currentSession.order_number}-${this.currentSession.invoice_number}`;
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
    
    // Add session-active class to container for CSS-based hiding of bottom bars
    const container = document.querySelector('.order-fulfillment');
    if (container) {
      container.classList.add('session-active');
    }
    
    // Show progress section and sticky bottom panel
    if (this.progressSection) this.progressSection.style.display = 'block';
    if (this.stickyBottomPanel) this.stickyBottomPanel.style.display = 'flex';
    
    // Hide tracking board section when in active session
    const trackingBoardSection = document.getElementById('trackingBoardSection');
    if (trackingBoardSection) {
      trackingBoardSection.style.display = 'none';
    }
    
    // Hide the tracking board and mobile column tabs during active session
    const trackingBoard = document.getElementById('trackingBoard');
    if (trackingBoard) {
      trackingBoard.style.display = 'none';
    }
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    if (mobileColumnTabs) {
      mobileColumnTabs.style.display = 'none';
    }
    
    // Hide navigation tabs during active session
    const innerTabs = document.querySelector('.inner-tabs');
    if (innerTabs) {
      innerTabs.style.display = 'none';
    }
    
    // Ensure tab stays highlighted
    ensureTabHighlighted();
    
    // Enable scanner inputs
    this.skuInput.disabled = false;
    this.scanQuantityInput.disabled = false;
    if (this.shelfFieldSelect) {
      this.shelfFieldSelect.disabled = false;
    }
    this.scanBtn.disabled = false;
    
    // Focus on SKU input
    setTimeout(() => this.skuInput.focus(), 100);
  }

  async showOrderLookup(isInitialLoad = false) {
    console.log('[Birmingham showOrderLookup] Starting - hiding session, showing lookup');
    console.log('[Birmingham showOrderLookup] DOM elements:', {
      activeSessionSection: !!this.activeSessionSection,
      orderLookupSection: !!this.orderLookupSection
    });
    
    if (!this.activeSessionSection || !this.orderLookupSection) {
      console.error('[Birmingham showOrderLookup] CRITICAL: Missing DOM elements!');
      showToast('Error: Missing DOM elements - please refresh', 'error');
      return;
    }
    
    // Remove session-active class from container
    const container = document.querySelector('.order-fulfillment');
    if (container) {
      container.classList.remove('session-active');
    }
    
    this.activeSessionSection.style.display = 'none';
    this.orderLookupSection.style.display = 'block';
    
    console.log('[Birmingham showOrderLookup] Section visibility updated:', {
      activeSession: this.activeSessionSection?.style.display,
      orderLookup: this.orderLookupSection?.style.display
    });
    
    // Hide progress section and sticky bottom panel
    if (this.progressSection) this.progressSection.style.display = 'none';
    if (this.stickyBottomPanel) this.stickyBottomPanel.style.display = 'none';
    
    // Show tracking board section
    const trackingBoardSection = document.getElementById('trackingBoardSection');
    if (trackingBoardSection) {
      trackingBoardSection.style.display = 'flex';
    }
    
    // Show the tracking board
    const trackingBoard = document.getElementById('trackingBoard');
    if (trackingBoard) {
      trackingBoard.style.display = 'grid';
    }
    
    // Restore mobile column tabs visibility if in mobile mode
    if (this.isMobileMode) {
      const mobileColumnTabs = document.getElementById('mobileColumnTabs');
      if (mobileColumnTabs) {
        mobileColumnTabs.style.display = 'flex';
      }
      this.updateMobileColumnVisibility();
    }
    
    // Show navigation tabs when returning to order lookup
    const innerTabs = document.querySelector('.inner-tabs');
    if (innerTabs) {
      innerTabs.style.display = 'flex';
    }
    
    // Load the tracking board and wait for it
    await this.loadTrackingBoard();
    
    // Navigate back to base order fulfillment URL
    const baseUrl = '/birmingham-orders/order-fulfillment';
    if (this.currentPath !== baseUrl) {
      console.log('[showOrderLookup] Updating route to:', baseUrl);
      updateRoute(baseUrl, false, {});
      this.currentPath = baseUrl;
    }
    
    // Ensure tab stays highlighted
    ensureTabHighlighted();
    
    this.orderNumberInput.value = '';
    this.currentSession = null;
    this.currentSessionId = null;
    
    console.log('[showOrderLookup] Complete');
  }
  
  async loadTrackingBoard() {
    console.log('[loadTrackingBoard] Starting...');
    // No loading screen - router handles initial load, WebSocket handles updates
    try {
      const url = `${getApiUrl()}/v1/magento/tracking/board`;
      console.log('[loadTrackingBoard] Fetching from:', url);
      const response = await fetch(url, { headers: getAuthHeaders() });
      
      if (!response.ok) {
        console.error('[loadTrackingBoard] Response not OK:', response.status, response.statusText);
        showToast(`API Error: ${response.status} ${response.statusText}`, 'error');
        throw new Error('Failed to load tracking board');
      }
      
      const data = await response.json();
      console.log('[loadTrackingBoard] Data received:', {
        ready_to_pick: data.ready_to_pick?.length || 0,
        ready_to_check: data.ready_to_check?.length || 0,
        completed: data.completed?.length || 0
      });
      
      // Update each column
      this.updateColumn('readyToPick', data.ready_to_pick || []);
      this.updateColumn('readyToCheck', data.ready_to_check || []);
      this.updateColumn('completed', data.completed || []);
      console.log('[loadTrackingBoard] Complete');
      showToast(`Loaded ${(data.ready_to_pick?.length || 0) + (data.ready_to_check?.length || 0)} orders`, 'success');
    } catch (error) {
      console.error('[Order Fulfillment] Error loading tracking board:', error);
      showToast(`Failed to load: ${error.message}`, 'error');
    }
  }
  
  updateColumn(columnName, orders) {
    const columnMap = {
      readyToPick: { id: 'readyToPickColumn', count: 'readyToPickCount', mobileCount: 'mobileReadyToPickCount', type: 'pick' },
      readyToCheck: { id: 'readyToCheckColumn', count: 'readyToCheckCount', mobileCount: 'mobileReadyToCheckCount', type: 'check' },
      completed: { id: 'completedColumn', count: 'completedCount', mobileCount: 'mobileCompletedCount', type: 'done' }
    };
    
    const column = columnMap[columnName];
    const columnEl = document.getElementById(column.id);
    const countEl = document.getElementById(column.count);
    const mobileCountEl = document.getElementById(column.mobileCount);
    
    console.log('[updateColumn]', columnName, '- columnEl:', !!columnEl, 'countEl:', !!countEl, 'orders:', orders.length);
    
    if (!columnEl || !countEl) {
      console.error('[updateColumn] Missing DOM element for column:', columnName, 'columnEl:', !!columnEl, 'countEl:', !!countEl);
      return;
    }
    
    // Update count
    countEl.textContent = orders.length;
    if (mobileCountEl) mobileCountEl.textContent = orders.length;
    
    // Clear column
    columnEl.innerHTML = '';
    
    // Add orders
    if (orders.length === 0) {
      columnEl.innerHTML = `
        <div class="ot-empty">
          <i class="fas fa-inbox"></i>
          <span>No orders</span>
        </div>
      `;
    } else {
      // Group orders by shipping method
      const groupedOrders = this.groupOrdersByShippingMethod(orders);
      
      // Render each shipping method group
      groupedOrders.forEach(group => {
        // Add shipping method header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'ot-group-header';
        headerDiv.innerHTML = `
          <i class="fas fa-truck"></i>
          <span>${group.shippingMethod}</span>
          <span class="ot-group-count">${group.orders.length}</span>
        `;
        columnEl.appendChild(headerDiv);
        
        // Add orders in this group
        group.orders.forEach(order => {
          const card = this.createOrderCard(order, columnName, column.type);
          columnEl.appendChild(card);
        });
      });
    }
  }
  
  groupOrdersByShippingMethod(orders) {
    // Group orders by shipping method
    const groups = {};
    
    orders.forEach(order => {
      const shippingMethod = order.shipping_method || 'Unknown Shipping Method';
      if (!groups[shippingMethod]) {
        groups[shippingMethod] = [];
      }
      groups[shippingMethod].push(order);
    });
    
    // Convert to array and sort - "Shipping - Free Standard Delivery" first
    const groupArray = Object.entries(groups).map(([shippingMethod, orders]) => ({
      shippingMethod,
      orders
    }));
    
    groupArray.sort((a, b) => {
      // "Shipping - Free Standard Delivery" always first
      if (a.shippingMethod === 'Shipping - Free Standard Delivery') return -1;
      if (b.shippingMethod === 'Shipping - Free Standard Delivery') return 1;
      // Then alphabetically
      return a.shippingMethod.localeCompare(b.shippingMethod);
    });
    
    return groupArray;
  }
  
  createOrderCard(order, columnName, type) {
    const card = document.createElement('div');
    card.className = `ot-card ot-card-${type}`;
    card.dataset.orderId = order.order_id;
    card.dataset.orderNumber = order.order_number;
    
    const progressPercent = order.progress_percentage || 0;
    const completedItems = order.completed_items || 0;
    const totalItems = order.total_items || 0;
    
    // Status badge
    const status = order.status || 'pending';
    const statusClass = status.replace(/_/g, '-');
    const statusLabel = status.replace(/_/g, ' ');
    
    // Progress ring
    const radius = 14;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (progressPercent / 100) * circumference;
    
    card.innerHTML = `
      <div class="ot-card-main">
        <div class="ot-card-header">
          <span class="ot-card-order">#${order.order_number}</span>
          <span class="ot-card-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="ot-card-details">
          ${order.customer_name ? `<span><i class="fas fa-user"></i> ${order.customer_name}</span>` : ''}
          ${order.grand_total ? `<span><i class="fas fa-dollar-sign"></i> $${parseFloat(order.grand_total).toFixed(2)}</span>` : ''}
          <span><i class="fas fa-box"></i> ${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="ot-card-progress">
        <svg viewBox="0 0 32 32">
          <circle class="ring-bg" cx="16" cy="16" r="${radius}" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3"></circle>
          <circle class="ring-fill" cx="16" cy="16" r="${radius}" fill="none" stroke-width="3" stroke-linecap="round"
            stroke-dasharray="${circumference}" 
            stroke-dashoffset="${offset}"></circle>
        </svg>
        <span>${completedItems}/${totalItems}</span>
      </div>
      <i class="fas fa-chevron-right ot-card-arrow"></i>
    `;
    
    // Add click handler for the whole card
    card.addEventListener('click', () => {
      if (columnName === 'readyToPick') {
        if (order.status === 'in_progress') {
          // In-progress sessions go directly to session
          this.navigateToSession(order);
        } else if (order.status === 'draft') {
          // Draft sessions show preview modal with "Continue" option
          this.startSessionFromCard(order.order_number, 'pick', true);
        } else {
          // New sessions show preview modal
          this.startSessionFromCard(order.order_number, 'pick');
        }
      } else if (columnName === 'readyToCheck') {
        if (order.session_type === 'check' && order.status === 'in_progress') {
          // In-progress check sessions go directly
          this.navigateToSession(order);
        } else if (order.session_type === 'check' && order.status === 'draft') {
          // Draft check sessions show preview modal
          this.startSessionFromCard(order.order_number, 'check', true);
        } else {
          // New check sessions show preview modal
          this.startSessionFromCard(order.order_number, 'check');
        }
      } else if (columnName === 'completed') {
        // Completed orders show read-only session details modal
        this.showCompletedSessionModal(order);
      } else {
        this.navigateToSession(order);
      }
    });
    
    return card;
  }
  
  async startSessionFromCard(orderNumber, sessionType = 'pick', isDraft = false) {
    try {
      // Navigate to the session by order number
      const url = `${getApiUrl()}/v1/magento/invoice/lookup/${orderNumber}`;
      const response = await fetch(url, { headers: getAuthHeaders() });
      
      if (!response.ok) {
        throw new Error('Failed to lookup order');
      }
      
      const invoice = await response.json();
      
      // Show preview modal before starting session
      this.showOrderPreview(invoice, sessionType, isDraft);
    } catch (error) {
      console.error('[Order Fulfillment] Error starting session from card:', error);
      showNotification(`Failed to start session: ${error.message}`, 'error');
    }
  }

  showOrderPreview(invoice, sessionType = 'pick', isDraft = false) {
    // Store pending order and session type
    this.pendingPreviewOrder = invoice;
    this.pendingPreviewSessionType = sessionType;
    this.pendingPreviewIsDraft = isDraft;

    // Populate order information
    document.getElementById('previewOrderNumber').textContent = invoice.order_number || '-';
    document.getElementById('previewInvoiceNumber').textContent = invoice.invoice_number || '-';
    document.getElementById('previewOrderDate').textContent = invoice.order_date 
      ? new Date(invoice.order_date).toLocaleDateString() 
      : (invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : '-');
    document.getElementById('previewStatus').textContent = isDraft ? 'Draft' : (invoice.state || '-');

    // Populate billing address
    document.getElementById('previewBillingName').textContent = invoice.billing_name || '-';
    document.getElementById('previewBillingAddress').textContent = invoice.billing_address || '-';
    document.getElementById('previewBillingPostcode').textContent = invoice.billing_postcode || '-';
    document.getElementById('previewBillingPhone').textContent = invoice.billing_phone || '-';

    // Populate shipping address
    document.getElementById('previewShippingName').textContent = invoice.shipping_name || '-';
    document.getElementById('previewShippingAddress').textContent = invoice.shipping_address || '-';
    document.getElementById('previewShippingPostcode').textContent = invoice.shipping_postcode || '-';
    document.getElementById('previewShippingPhone').textContent = invoice.shipping_phone || '-';

    // Populate items table
    const itemsList = document.getElementById('previewItemsList');
    const currencySymbol = getCurrencySymbol(invoice.order_currency_code);
    
    if (invoice.items && invoice.items.length > 0) {
      itemsList.innerHTML = invoice.items.map(item => `
        <tr>
          <td><strong>${item.sku}</strong></td>
          <td>${item.name}</td>
          <td class="text-center">${item.qty_ordered || item.qty_invoiced}</td>
          <td class="text-right">${currencySymbol}${(item.price || 0).toFixed(2)}</td>
          <td class="text-right">${currencySymbol}${(item.row_total || 0).toFixed(2)}</td>
        </tr>
      `).join('');
    } else {
      itemsList.innerHTML = '<tr><td colspan="5" class="text-center">No items</td></tr>';
    }

    // Populate totals
    document.getElementById('previewSubtotal').textContent = invoice.subtotal != null 
      ? `${currencySymbol}${invoice.subtotal.toFixed(2)}` 
      : '-';
    document.getElementById('previewTax').textContent = invoice.tax_amount != null 
      ? `${currencySymbol}${invoice.tax_amount.toFixed(2)}` 
      : '-';
    document.getElementById('previewGrandTotal').textContent = invoice.grand_total != null 
      ? `${currencySymbol}${invoice.grand_total.toFixed(2)}` 
      : '-';

    // Update button text based on session type and draft status
    const startBtn = document.getElementById('startSessionFromPreviewBtn');
    if (isDraft) {
      startBtn.innerHTML = sessionType === 'pick' 
        ? '<i class="fas fa-play"></i> Continue Picking' 
        : '<i class="fas fa-play"></i> Continue Checking';
    } else {
      startBtn.innerHTML = sessionType === 'pick' 
        ? '<i class="fas fa-play"></i> Start Picking' 
        : '<i class="fas fa-play"></i> Start Checking';
    }

    // Show modal
    if (this.orderPreviewModal) {
      this.orderPreviewModal.classList.add('active');
    }
  }

  hideOrderPreview() {
    if (this.orderPreviewModal) {
      this.orderPreviewModal.classList.remove('active');
    }
    this.pendingPreviewOrder = null;
    this.pendingPreviewSessionType = null;
    this.pendingPreviewIsDraft = false;
  }

  async showCompletedSessionModal(order) {
    try {
      // First get the session ID from the order check endpoint
      const checkUrl = `${getApiUrl()}/v1/magento/session/check/${order.order_number}`;
      const checkResponse = await fetch(checkUrl, { headers: getAuthHeaders() });
      
      if (!checkResponse.ok) {
        throw new Error('Failed to lookup session');
      }
      
      const checkData = await checkResponse.json();
      
      if (!checkData.session_id) {
        showNotification('No session found for this order', 'error');
        return;
      }
      
      // Now get the full session status
      const statusUrl = `${getApiUrl()}/v1/magento/session/status/${checkData.session_id}`;
      const statusResponse = await fetch(statusUrl, { headers: getAuthHeaders() });
      
      if (!statusResponse.ok) {
        throw new Error('Failed to get session details');
      }
      
      const session = await statusResponse.json();
      
      // Populate modal with session data
      document.getElementById('completedOrderNumber').textContent = session.order_number || '-';
      document.getElementById('completedInvoiceNumber').textContent = session.invoice_number || '-';
      
      // Session type badge
      const sessionTypeText = session.session_type === 'check' ? 'Checking' : 
                             session.session_type === 'return' ? 'Returns' : 'Pick & Pack';
      document.getElementById('completedSessionType').textContent = sessionTypeText;
      
      // Completed by
      document.getElementById('completedByUser').textContent = checkData.user || '-';
      
      // Dates
      document.getElementById('completedOrderDate').textContent = session.order_date 
        ? new Date(session.order_date).toLocaleDateString() 
        : '-';
      document.getElementById('completedAtDate').textContent = session.started_at 
        ? new Date(session.started_at).toLocaleDateString() 
        : '-';
      
      // Progress
      const completedItems = session.completed_items || 0;
      const totalItems = session.total_items || 0;
      document.getElementById('completedItemsProgress').textContent = `${completedItems}/${totalItems}`;
      
      // Status badge with color
      const statusBadge = document.getElementById('completedStatusBadge');
      statusBadge.textContent = session.status === 'completed' ? 'Completed' : session.status;
      statusBadge.className = 'progress-badge';
      if (completedItems < totalItems) {
        statusBadge.classList.add('partial');
        statusBadge.textContent = 'Partially Complete';
      }
      
      // Populate items table
      const currencySymbol = getCurrencySymbol(session.order_currency_code);
      const itemsList = document.getElementById('completedItemsList');
      
      if (session.items && session.items.length > 0) {
        itemsList.innerHTML = session.items.map(item => {
          const qtyExpected = item.qty_invoiced || item.qty_ordered || 1;
          const qtyScanned = item.qty_scanned || 0;
          const isComplete = qtyScanned >= qtyExpected;
          const statusClass = isComplete ? 'status-complete' : 'status-incomplete';
          const statusIcon = isComplete ? 'fa-check-circle' : 'fa-exclamation-circle';
          const statusText = isComplete ? 'Complete' : `Missing ${qtyExpected - qtyScanned}`;
          
          return `
            <tr class="${statusClass}">
              <td><strong>${item.sku}</strong></td>
              <td>${item.name}</td>
              <td class="text-center">${qtyExpected}</td>
              <td class="text-center">${qtyScanned}</td>
              <td class="text-center">
                <span class="item-status ${statusClass}">
                  <i class="fas ${statusIcon}"></i> ${statusText}
                </span>
              </td>
            </tr>
          `;
        }).join('');
      } else {
        itemsList.innerHTML = '<tr><td colspan="5" class="text-center">No items</td></tr>';
      }
      
      // Totals
      document.getElementById('completedSubtotal').textContent = session.subtotal != null 
        ? `${currencySymbol}${session.subtotal.toFixed(2)}` 
        : '-';
      document.getElementById('completedTax').textContent = session.tax_amount != null 
        ? `${currencySymbol}${session.tax_amount.toFixed(2)}` 
        : '-';
      document.getElementById('completedGrandTotal').textContent = session.grand_total != null 
        ? `${currencySymbol}${session.grand_total.toFixed(2)}` 
        : '-';
      
      // Show modal
      if (this.completedSessionModal) {
        this.completedSessionModal.classList.add('active');
      }
      
    } catch (error) {
      console.error('[Order Fulfillment] Error showing completed session:', error);
      showNotification(`Failed to load session details: ${error.message}`, 'error');
    }
  }

  hideCompletedSessionModal() {
    if (this.completedSessionModal) {
      this.completedSessionModal.classList.remove('active');
    }
  }

  async confirmStartSessionFromPreview() {
    if (!this.pendingPreviewOrder || !this.pendingPreviewSessionType) {
      return;
    }

    // Store all values before hiding (which clears them)
    const invoice = this.pendingPreviewOrder;
    const orderNumber = invoice.order_number;
    const invoiceNumber = invoice.invoice_number;
    const sessionType = this.pendingPreviewSessionType;
    const isDraft = this.pendingPreviewIsDraft;

    // Hide the preview modal
    this.hideOrderPreview();

    // Start or continue the session
    try {
      if (isDraft) {
        // For drafts, navigate to the existing session
        await this.navigateToSession({ 
          order_number: orderNumber, 
          invoice_number: invoiceNumber 
        });
      } else {
        await this.startSession(orderNumber, sessionType);
      }
    } catch (error) {
      console.error('[Order Fulfillment] Error starting session:', error);
      showNotification(`Failed to start session: ${error.message}`, 'error');
    }
  }
  
  async navigateToSession(order) {
    const path = `/birmingham-orders/order-fulfillment/session-${order.order_number}-${order.invoice_number}`;
    
    // Just update the URL without triggering full navigation (which would destroy DOM)
    history.pushState({ path }, '', path);
    
    // Update our internal path and load the session
    this.currentPath = path;
    await this.checkSessionFromPath(path);
  }

  updateSessionDisplay() {
    if (!this.currentSession) return;

    // Update header info
    this.sessionOrderNumber.textContent = this.currentSession.order_number;
    this.sessionInvoiceNumber.textContent = this.currentSession.invoice_number;
    
    // Format and display order date
    if (this.currentSession.order_date) {
      const orderDate = new Date(this.currentSession.order_date);
      this.sessionOrderDate.textContent = orderDate.toLocaleDateString();
    } else {
      this.sessionOrderDate.textContent = '-';
    }

    // Update payment and shipping methods
    this.sessionPaymentMethod.textContent = this.currentSession.payment_method || '-';
    this.sessionShippingMethod.textContent = this.currentSession.shipping_method || '-';

    // Update billing (Sold To) information
    this.sessionBillingName.textContent = this.currentSession.billing_name || '-';
    this.sessionBillingAddress.textContent = this.currentSession.billing_address || '-';
    this.sessionBillingPostcode.textContent = this.currentSession.billing_postcode || '-';
    this.sessionBillingPhone.textContent = this.currentSession.billing_phone || '-';

    // Update shipping (Ship To) information
    this.sessionShippingName.textContent = this.currentSession.shipping_name || '-';
    this.sessionShippingAddress.textContent = this.currentSession.shipping_address || '-';
    this.sessionShippingPostcode.textContent = this.currentSession.shipping_postcode || '-';
    this.sessionShippingPhone.textContent = this.currentSession.shipping_phone || '-';

    // Update session type badge
    let badgeIcon, badgeText;
    switch (this.currentSession.session_type) {
      case 'check':
        badgeIcon = 'fa-clipboard-check';
        badgeText = 'CHECKING';
        break;
      case 'return':
        badgeIcon = 'fa-undo';
        badgeText = 'RETURNS';
        break;
      default: // 'pick'
        badgeIcon = 'fa-box';
        badgeText = 'PICK & PACK';
    }
    this.sessionTypeBadge.innerHTML = `<i class="fas ${badgeIcon}"></i><span>${badgeText}</span>`;

    // Hide scanner section for checking sessions
    const isCheckingSession = this.currentSession.session_type === 'check';
    if (this.scannerSection) {
      this.scannerSection.style.display = isCheckingSession ? 'none' : 'block';
    }

    // Calculate progress metrics
    const completedItems = this.currentSession.completed_items;
    const totalItems = this.currentSession.total_items;
    
    // Calculate quantity progress - for checking mode, use checkedQuantities
    let totalQtyExpected = 0;
    let totalQtyVerified = 0;
    let itemsVerified = 0;
    
    if (this.currentSession.items && this.currentSession.items.length > 0) {
      this.currentSession.items.forEach(item => {
        const expectedQty = item.qty_expected || item.qty_invoiced || 0;
        totalQtyExpected += expectedQty;
        
        if (isCheckingSession) {
          const checkedQty = this.checkedQuantities?.[item.sku] || 0;
          totalQtyVerified += Math.min(checkedQty, expectedQty); // Don't count over-picked
          if (checkedQty === expectedQty) {
            itemsVerified++;
          }
        } else {
          totalQtyVerified += item.qty_scanned || 0;
        }
      });
    }
    
    // For checking mode, use verified items count
    const displayCompletedItems = isCheckingSession ? itemsVerified : completedItems;
    const itemsPercent = totalItems > 0 ? Math.round((displayCompletedItems / totalItems) * 100) : 0;
    const qtyPercent = totalQtyExpected > 0 ? Math.round((totalQtyVerified / totalQtyExpected) * 100) : 0;

    // Update Items Completed Progress
    const itemsLabel = isCheckingSession ? 'verified' : 'items';
    this.itemsProgressText.textContent = `${displayCompletedItems} of ${totalItems} ${itemsLabel}`;
    this.itemsProgressPercent.textContent = `${itemsPercent}%`;
    this.itemsProgressFill.style.width = `${itemsPercent}%`;

    // Update Quantity Progress
    const qtyLabel = isCheckingSession ? 'Verified' : 'Scanned';
    this.qtyProgressText.textContent = `${totalQtyVerified} of ${totalQtyExpected} units`;
    this.qtyProgressPercent.textContent = `${qtyPercent}%`;
    this.qtyProgressFill.style.width = `${qtyPercent}%`;

    // Show buttons based on session status and session type
    const sessionStatus = this.currentSession.status;
    const allItemsComplete = completedItems === totalItems && totalItems > 0;
    
    // Complete button shows for checking sessions
    if (this.completeSessionBtn) {
      if (isCheckingSession) {
        this.completeSessionBtn.style.display = 'inline-flex';
        // Initial disabled state will be set by updateCompleteButtonState()
      } else {
        this.completeSessionBtn.style.display = 'none';
      }
    }
    
    // "Ready to Check" button only shows for picking sessions (not checking)
    if (this.markReadyToCheckBtn) {
      if (sessionStatus === 'in_progress' && !isCheckingSession) {
        this.markReadyToCheckBtn.style.display = 'inline-flex';
        this.markReadyToCheckBtn.disabled = !allItemsComplete;
        if (!allItemsComplete) {
          this.markReadyToCheckBtn.classList.add('disabled');
        } else {
          this.markReadyToCheckBtn.classList.remove('disabled');
        }
      } else {
        this.markReadyToCheckBtn.style.display = 'none';
      }
    }
    
    // "Send Back for Picking" button only shows for checking sessions
    if (this.sendBackForPickingBtn) {
      if (isCheckingSession) {
        this.sendBackForPickingBtn.style.display = 'inline-flex';
        this.sendBackForPickingBtn.disabled = false;
      } else {
        this.sendBackForPickingBtn.style.display = 'none';
      }
    }
    
    // "Save as Draft" button shows for in_progress sessions (both picking and checking)
    if (this.saveAsDraftBtn) {
      if (sessionStatus === 'in_progress') {
        this.saveAsDraftBtn.style.display = 'inline-flex';
      } else {
        this.saveAsDraftBtn.style.display = 'none';
      }
    }

    // Update items list
    this.updateItemsList();
    
    // Update complete button for checking mode
    this.updateCompleteButtonState();
  }
  
  // Initialize checked quantities tracking for checking mode
  initCheckedQuantities() {
    // Reset checked quantities for new session
    this.checkedQuantities = {};
    if (this.currentSession?.items) {
      this.currentSession.items.forEach(item => {
        this.checkedQuantities[item.sku] = 0;
      });
    }
  }
  
  updateCheckedQuantity(sku, delta) {
    if (!this.checkedQuantities) this.checkedQuantities = {};
    const current = this.checkedQuantities[sku] || 0;
    const newValue = Math.max(0, current + delta);
    this.checkedQuantities[sku] = newValue;
    
    // Update the input field
    const input = document.querySelector(`input[data-sku="${sku}"]`);
    if (input) {
      input.value = newValue;
    }
    
    // Update item card status
    this.updateItemCardStatus(sku);
    this.updateCompleteButtonState();
    this.updateProgressBars();
  }
  
  setCheckedQuantity(sku, value) {
    if (!this.checkedQuantities) this.checkedQuantities = {};
    const newValue = Math.max(0, parseInt(value) || 0);
    this.checkedQuantities[sku] = newValue;
    
    // Update item card status
    this.updateItemCardStatus(sku);
    this.updateCompleteButtonState();
    this.updateProgressBars();
  }
  
  updateItemCardStatus(sku) {
    const item = this.currentSession?.items?.find(i => i.sku === sku);
    if (!item) return;
    
    const card = document.querySelector(`.item-card[data-sku="${sku}"]`);
    if (!card) return;
    
    const checkedQty = this.checkedQuantities[sku] || 0;
    const requiredQty = item.qty_expected || item.qty_invoiced || 0;
    
    // Remove all status classes
    card.classList.remove('complete', 'in-progress', 'overpicked', 'pending');
    
    // Update status icon and class
    const iconEl = card.querySelector('.item-status-icon i');
    
    if (checkedQty === requiredQty) {
      card.classList.add('complete');
      if (iconEl) iconEl.className = 'fas fa-check';
    } else if (checkedQty > requiredQty) {
      card.classList.add('overpicked');
      if (iconEl) iconEl.className = 'fas fa-exclamation-triangle';
    } else if (checkedQty > 0) {
      card.classList.add('in-progress');
      if (iconEl) iconEl.className = 'fas fa-clock';
    } else {
      card.classList.add('pending');
      if (iconEl) iconEl.className = 'fas fa-circle';
    }
  }
  
  updateCompleteButtonState() {
    if (!this.completeSessionBtn) return;
    
    const isCheckingSession = this.currentSession?.session_type === 'check';
    
    if (isCheckingSession) {
      // For checking sessions, all items must have correct quantities
      const allCorrect = this.currentSession?.items?.every(item => {
        const checkedQty = this.checkedQuantities?.[item.sku] || 0;
        const requiredQty = item.qty_expected || item.qty_invoiced || 0;
        return checkedQty === requiredQty;
      }) ?? false;
      
      this.completeSessionBtn.disabled = !allCorrect;
      if (!allCorrect) {
        this.completeSessionBtn.classList.add('disabled');
      } else {
        this.completeSessionBtn.classList.remove('disabled');
      }
    }
  }
  
  updateProgressBars() {
    if (!this.currentSession) return;
    
    const isCheckingSession = this.currentSession.session_type === 'check';
    const completedItems = this.currentSession.completed_items;
    const totalItems = this.currentSession.total_items;
    
    // Calculate quantity progress - for checking mode, use checkedQuantities
    let totalQtyExpected = 0;
    let totalQtyVerified = 0;
    let itemsVerified = 0;
    
    if (this.currentSession.items && this.currentSession.items.length > 0) {
      this.currentSession.items.forEach(item => {
        const expectedQty = item.qty_expected || item.qty_invoiced || 0;
        totalQtyExpected += expectedQty;
        
        if (isCheckingSession) {
          const checkedQty = this.checkedQuantities?.[item.sku] || 0;
          totalQtyVerified += Math.min(checkedQty, expectedQty);
          if (checkedQty === expectedQty) {
            itemsVerified++;
          }
        } else {
          totalQtyVerified += item.qty_scanned || 0;
        }
      });
    }
    
    // For checking mode, use verified items count
    const displayCompletedItems = isCheckingSession ? itemsVerified : completedItems;
    const itemsPercent = totalItems > 0 ? Math.round((displayCompletedItems / totalItems) * 100) : 0;
    const qtyPercent = totalQtyExpected > 0 ? Math.round((totalQtyVerified / totalQtyExpected) * 100) : 0;

    // Update Items Progress
    if (this.itemsProgressText) {
      const itemsLabel = isCheckingSession ? 'verified' : 'items';
      this.itemsProgressText.textContent = `${displayCompletedItems} of ${totalItems} ${itemsLabel}`;
    }
    if (this.itemsProgressPercent) {
      this.itemsProgressPercent.textContent = `${itemsPercent}%`;
    }
    if (this.itemsProgressFill) {
      this.itemsProgressFill.style.width = `${itemsPercent}%`;
    }

    // Update Quantity Progress
    if (this.qtyProgressText) {
      this.qtyProgressText.textContent = `${totalQtyVerified} of ${totalQtyExpected} units`;
    }
    if (this.qtyProgressPercent) {
      this.qtyProgressPercent.textContent = `${qtyPercent}%`;
    }
    if (this.qtyProgressFill) {
      this.qtyProgressFill.style.width = `${qtyPercent}%`;
    }
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

    const isCheckingSession = this.currentSession.session_type === 'check';
    
    // Initialize checked quantities for checking mode
    if (isCheckingSession) {
      this.initCheckedQuantities();
    }

    const itemsHtml = this.currentSession.items.map(item => {
      if (isCheckingSession) {
        // Checking mode: show counter controls
        const checkedQty = this.checkedQuantities?.[item.sku] || 0;
        const requiredQty = item.qty_expected || item.qty_invoiced || 0;
        
        let statusClass = 'pending';
        let statusIcon = 'fa-circle';
        
        if (checkedQty === requiredQty) {
          statusClass = 'complete';
          statusIcon = 'fa-check';
        } else if (checkedQty > requiredQty) {
          statusClass = 'overpicked';
          statusIcon = 'fa-exclamation-triangle';
        } else if (checkedQty > 0) {
          statusClass = 'in-progress';
          statusIcon = 'fa-clock';
        }
        
        return `
          <div class="item-card checking-mode ${statusClass}" data-sku="${this.escapeHtml(item.sku)}">
            <div class="item-left">
              <div class="item-status-icon">
                <i class="fas ${statusIcon}"></i>
              </div>
              <div class="item-details">
                <div class="item-name">${this.escapeHtml(item.name)}</div>
                <div class="item-sku">${this.escapeHtml(item.sku)}</div>
              </div>
            </div>
            <div class="item-right checking-controls">
              <div class="required-qty">
                <span class="required-label">Required:</span>
                <span class="required-value">${requiredQty}</span>
              </div>
              <div class="counter-controls">
                <button class="btn btn-qty btn-qty-lg btn-qty-minus counter-btn minus-btn" data-sku="${this.escapeHtml(item.sku)}" data-action="minus">
                  <i class="fas fa-minus"></i>
                </button>
                <input type="number" 
                       class="counter-input" 
                       data-sku="${this.escapeHtml(item.sku)}" 
                       value="${checkedQty}" 
                       min="0"
                       inputmode="numeric">
                <button class="btn btn-qty btn-qty-lg btn-qty-plus counter-btn plus-btn" data-sku="${this.escapeHtml(item.sku)}" data-action="plus">
                  <i class="fas fa-plus"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      } else {
        // Normal picking mode: show scanned quantities
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

        // Build counted quantity display (shown when order was sent back from checker)
        const hasCounted = item.qty_counted !== null && item.qty_counted !== undefined;
        const countedHtml = hasCounted ? `
              <div class="item-quantity counted-qty">
                <div class="qty-numbers">${item.qty_counted}</div>
                <div class="qty-label">Counted</div>
              </div>
        ` : '';

        return `
          <div class="item-card ${statusClass}${hasCounted ? ' has-counted' : ''}">
            <div class="item-left">
              <div class="item-status-icon">
                <i class="fas ${statusIcon}"></i>
              </div>
              <div class="item-details">
                <div class="item-name">${this.escapeHtml(item.name)}</div>
                <div class="item-sku">${this.escapeHtml(item.sku)}</div>
              </div>
            </div>
            <div class="item-right">
              ${countedHtml}
              <div class="item-quantity">
                <div class="qty-numbers">${item.qty_scanned} / ${item.qty_invoiced}</div>
                <div class="qty-label">Scanned</div>
              </div>
            </div>
          </div>
        `;
      }
    }).join('');

    this.itemsList.innerHTML = itemsHtml;
    
    // Attach event listeners for checking mode controls
    if (isCheckingSession) {
      this.attachCheckingControls();
    }
  }
  
  attachCheckingControls() {
    // Minus buttons
    this.itemsList.querySelectorAll('.minus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sku = btn.dataset.sku;
        this.updateCheckedQuantity(sku, -1);
      });
    });
    
    // Plus buttons
    this.itemsList.querySelectorAll('.plus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sku = btn.dataset.sku;
        this.updateCheckedQuantity(sku, 1);
      });
    });
    
    // Input fields
    this.itemsList.querySelectorAll('.counter-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const sku = input.dataset.sku;
        this.setCheckedQuantity(sku, e.target.value);
      });
      
      input.addEventListener('focus', (e) => {
        e.target.select();
      });
    });
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

    // Call the internal scan method with ability to specify field override
    await this._performScan(sku, quantity, field);
  }

  async _performScan(sku, quantity, field) {
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
        this.showScanMessage(result.message, 'success');

        // Clear input and focus
        this.skuInput.value = '';
        this.scanQuantityInput.value = '1';
        this.skuInput.focus();

        // Play success sound
        this.playBeep();

      } else {
        // Scan was blocked (insufficient stock, overpicking, etc.)
        this.showScanMessage(result.message, 'error');
        
        // Play error sound
        this.playErrorBeep();
        
        // If there's a warning about inventory issues, show a prominent alert
        if (result.warning) {
          showToast(result.warning, 'error');
        }
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

    const confirmed = await orderModals.confirmCompleteSession(this.currentSession?.order_number);
    if (!confirmed) return;

    try {
      this.completeSessionBtn.disabled = true;
      this.completeSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';

      // For checking sessions, use force_complete since the checker is verifying, not re-scanning
      const isCheckingSession = this.currentSession?.session_type === 'check';
      
      const response = await fetch(`${getApiUrl()}/v1/magento/session/complete`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: this.currentSessionId,
          force_complete: isCheckingSession  // Checking sessions don't require re-scanning
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to complete session');
      }

      // Show success message
      await orderModals.alertSessionCompleted();

      // Clear global session tracking
      window.__currentMagentoSession = null;
      
      // Return to order lookup
      this.showOrderLookup();

    } catch (error) {
      console.error('Error completing session:', error);
      await orderModals.alertError('Error: ' + error.message);
    } finally {
      this.completeSessionBtn.disabled = false;
      this.completeSessionBtn.innerHTML = '<i class="fas fa-check"></i> Complete';
    }
  }

  async markReadyToCheck() {
    if (!this.currentSessionId) return;

    const confirmed = await orderModals.confirm(
      'Mark Ready to Check?',
      `Are you sure you want to mark order #${this.currentSession?.order_number} as ready to check? This will move it to the checking queue instead of completing it.`
    );
    
    if (!confirmed) return;

    // Cache button reference before async operations
    const btn = this.markReadyToCheckBtn;
    const resetButton = () => {
      if (btn && document.body.contains(btn)) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-clipboard-check"></i> Ready to Check';
      }
    };

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Marking...';
      }

      console.log('[markReadyToCheck] Calling API...');
      const response = await fetch(`${getApiUrl()}/v1/magento/tracking/mark-ready-to-check`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: this.currentSessionId
        })
      });

      console.log('[markReadyToCheck] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to mark as ready to check');
      }

      const result = await response.json();
      console.log('[markReadyToCheck] Success:', result);

      // Reset button before showing modal (since modal is blocking)
      resetButton();

      // Clear global session tracking FIRST before any UI changes
      // This prevents the auto-draft from re-drafting the session
      const orderNumber = this.currentSession?.order_number;
      window.__currentMagentoSession = null;
      this.currentSession = null;
      this.currentSessionId = null;

      // Wait a moment for the previous modal to fully clean up
      await new Promise(r => setTimeout(r, 350));

      // Show success message - modal will wait for user to click OK
      console.log('[markReadyToCheck] Showing success modal...');
      await orderModals.alert('Success', `Order #${orderNumber} has been marked as ready to check.`);
      console.log('[markReadyToCheck] Modal dismissed by user');
      
      // Also show a toast for extra visibility
      showToast(`Order #${orderNumber} marked ready to check`, 'success');
      
      // Return to order lookup and navigate back to order fulfillment page
      console.log('[markReadyToCheck] Navigating back to order fulfillment...');
      await this.showOrderLookup();
      console.log('[markReadyToCheck] Navigation complete');

    } catch (error) {
      console.error('[markReadyToCheck] Error:', error);
      resetButton();
      await orderModals.alertError('Error: ' + error.message);
    }
  }

  async saveAsDraft() {
    if (!this.currentSessionId) return;

    const isCheckingSession = this.currentSession?.session_type === 'check';
    const sessionPhase = isCheckingSession ? 'checking' : 'picking';

    // Build confirmation message
    const orderNumber = this.currentSession?.order_number;
    const message = `Save order #${orderNumber} as draft?\n\nYour ${sessionPhase} progress will be saved. You or another user can continue later from the tracking board.`;

    const confirmed = await orderModals.confirm('Save as Draft?', message);
    if (!confirmed) return;

    // Cache button reference before async operations
    const btn = this.saveAsDraftBtn;
    const resetButton = () => {
      if (btn && document.body.contains(btn)) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save as Draft';
      }
    };

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      }

      console.log('[saveAsDraft] Calling release API for session:', this.currentSessionId);
      const response = await fetch(`${getApiUrl()}/v1/magento/sessions/${this.currentSessionId}/release`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      console.log('[saveAsDraft] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save session as draft');
      }

      const result = await response.json();
      console.log('[saveAsDraft] Success:', result);

      // Clear global session tracking FIRST
      window.__currentMagentoSession = null;
      this.currentSession = null;
      this.currentSessionId = null;

      resetButton();

      // Wait a moment for modal cleanup
      await new Promise(r => setTimeout(r, 350));

      // Show success message
      await orderModals.alert('Draft Saved', `Order #${orderNumber} has been saved as draft. Progress has been preserved.`);
      
      // Also show a toast for extra visibility
      showToast(`Order #${orderNumber} saved as draft`, 'success');

      // Return to order lookup
      console.log('[saveAsDraft] Navigating back to order fulfillment...');
      await this.showOrderLookup();

    } catch (error) {
      console.error('[saveAsDraft] Error:', error);
      resetButton();
      await orderModals.alertError('Error: ' + error.message);
    }
  }

  async cancelSession() {
    if (!this.currentSessionId) return;

    // Calculate items scanned count for the modal
    const itemsScannedCount = this.currentSession?.items?.reduce((total, item) => {
      return total + (item.qty_scanned || 0);
    }, 0) || 0;

    const confirmed = await orderModals.confirmCancelSession(
      this.currentSession?.order_number,
      {
        status: this.currentSession?.status,
        items_scanned_count: Math.floor(itemsScannedCount)
      }
    );
    if (!confirmed) return;

    try {
      const response = await fetch(`${getApiUrl()}/v1/magento/session/${this.currentSessionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.detail || 'Failed to cancel session');
      }

      // Show message about items returned if any
      if (result.items_returned > 0) {
        await orderModals.alert(
          'Session Cancelled',
          `Session cancelled successfully.\n\n${result.items_returned} item(s) have been returned to inventory.`
        );
      }

      // Clear global session tracking
      window.__currentMagentoSession = null;
      
      // Return to order lookup
      this.showOrderLookup();

    } catch (error) {
      console.error('Error cancelling session:', error);
      await orderModals.alertError('Error: ' + error.message);
    }
  }

  async sendBackForPicking() {
    if (!this.currentSessionId) return;

    const confirmed = await orderModals.confirm(
      'Send Back for Picking?',
      `Are you sure you want to send order #${this.currentSession?.order_number} back for picking? The picker will need to complete the order before sending it back for checking.`
    );
    
    if (!confirmed) return;

    // Cache button reference before async operations
    const btn = this.sendBackForPickingBtn;
    const resetButton = () => {
      if (btn && document.body.contains(btn)) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-undo"></i> Send Back for Picking';
      }
    };

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      }

      // Build items_counted array from checkedQuantities
      let itemsCounted = null;
      if (this.checkedQuantities && Object.keys(this.checkedQuantities).length > 0) {
        itemsCounted = Object.entries(this.checkedQuantities).map(([sku, qty]) => ({
          sku: sku,
          qty_counted: qty
        }));
      }

      console.log('[sendBackForPicking] Calling API with counted items:', itemsCounted);
      const response = await fetch(`${getApiUrl()}/v1/magento/tracking/send-back-for-picking`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: this.currentSessionId,
          items_counted: itemsCounted
        })
      });

      console.log('[sendBackForPicking] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to send back for picking');
      }

      const result = await response.json();
      console.log('[sendBackForPicking] Success:', result);

      // Clear global session tracking FIRST
      const orderNumber = this.currentSession?.order_number;
      window.__currentMagentoSession = null;
      this.currentSession = null;
      this.currentSessionId = null;

      resetButton();

      // Wait a moment for modal cleanup
      await new Promise(r => setTimeout(r, 350));

      // Show success message
      await orderModals.alert('Sent Back', `Order #${orderNumber} has been sent back for picking.`);
      
      // Toast for visibility
      showToast(`Order #${orderNumber} sent back for picking`, 'success');
      
      // Return to order lookup
      await this.showOrderLookup();

    } catch (error) {
      console.error('[sendBackForPicking] Error:', error);
      resetButton();
      await orderModals.alertError('Error: ' + error.message);
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
          const resume = await orderModals.confirmResumeSession(session.order_number);
          
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
    // Play a beep sound for successful scans
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

  playErrorBeep() {
    // Play a lower, longer beep for errors/blocked scans
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 300; // Lower frequency for error
      oscillator.type = 'square'; // Harsher sound
      gainNode.gain.value = 0.15;

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3); // Longer duration
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
  console.log('[OrderFulfillment] init() called with path:', path);
  showToast('Initializing Order Fulfillment...', 'info');
  
  // First ensure tables exist
  try {
    const { ensureOrderTablesExist } = await import('../../services/api/ordersApi.js');
    await ensureOrderTablesExist();
  } catch (error) {
    console.error('[OrderFulfillment] Failed to check/initialize tables:', error);
    showToast('Warning: Could not verify database tables', 'warning');
  }
  
  // Always clean up any existing manager first (DOM elements are new after navigation)
  if (window.__magentoPickPackManager) {
    console.log('[OrderFulfillment] Cleaning up existing manager');
    try {
      window.__magentoPickPackManager.cleanupWebSocket();
    } catch (e) {
      console.warn('[OrderFulfillment] Error cleaning up previous manager:', e);
    }
    window.__magentoPickPackManager = null;
  }
  window.__magentoPickPackInitialized = false;
  
  // Wait for DOM to be ready - use requestAnimationFrame to ensure DOM is painted after innerHTML injection
  console.log('[OrderFulfillment] Waiting for DOM with double RAF...');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  console.log('[OrderFulfillment] DOM should be ready now');
  
  // Verify DOM elements exist
  const orderLookupSection = document.getElementById('orderLookupSection');
  const trackingBoard = document.getElementById('trackingBoard');
  console.log('[OrderFulfillment] DOM check - orderLookupSection:', !!orderLookupSection, 'trackingBoard:', !!trackingBoard);
  
  if (!orderLookupSection) {
    console.error('[OrderFulfillment] CRITICAL: orderLookupSection not found in DOM!');
    showToast('Error: Page structure not loaded correctly', 'error');
    return;
  }
  
  showToast('Setting up tracking board...', 'info');
  const manager = new MagentoPickPackManager(path);
  window.__magentoPickPackManager = manager;
  window.__magentoPickPackInitialized = true;
  
  console.log('[OrderFulfillment] Manager created, elements initialized:', {
    orderLookupSection: !!manager.orderLookupSection,
    activeSessionSection: !!manager.activeSessionSection,
    trackingBoard: !!document.getElementById('trackingBoard')
  });
  
  // Ensure WebSocket connection is established BEFORE loading data
  showToast('Connecting to WebSocket...', 'info');
  console.log('[OrderFulfillment] Calling ensureRealtimeConnection...');
  await manager.ensureRealtimeConnection();
  console.log('[OrderFulfillment] WebSocket connection attempt complete');
  
  // Now load the tracking board data
  showToast('Loading tracking data...', 'info');
  console.log('[OrderFulfillment] Calling checkSessionFromPath...');
  manager.initialLoadPromise = manager.checkSessionFromPath(path);
  await manager.initialLoadPromise;
  console.log('[OrderFulfillment] init() complete');
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
  console.log('[OrderFulfillment] cleanup() called');
  // Cleanup WebSocket listeners if manager exists
  if (window.__magentoPickPackManager) {
    console.log('[OrderFulfillment] Cleaning up WebSocket listeners');
    window.__magentoPickPackManager.cleanupWebSocket();
  }
  
  // NOTE: We do NOT clear window.__currentMagentoSession or call release here
  // The router-level auto-draft manager handles unload, navigation, connection
  // drops, and long-lived tab hides so that legitimate tab switches stay safe.
  // This cleanup is only for when navigating between inventory sub-modules.
  
  window.__magentoPickPackInitialized = false;
  window.__magentoPickPackManager = null;
  console.log('[OrderFulfillment] cleanup() complete');
}

// Also support direct script inclusion (fallback) - but this shouldn't run when using router
// REMOVED: Legacy auto-init code that bypassed proper init() function
// The router now always calls init() which handles DOM readiness and WebSocket connection
