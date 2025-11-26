// frontend/js/modules/magento-pickpack.js
// Magento Pick & Pack / Returns Module

import { getApiUrl } from '../config.js';
import { getToken } from '../services/state/sessionStore.js';

// Helper to get auth headers
function getAuthHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

class MagentoPickPackManager {
  constructor() {
    this.currentSession = null;
    this.currentSessionId = null;
    this.initializeElements();
    this.attachEventListeners();
    // TODO: Implement active sessions endpoint on backend
    // this.loadActiveSessions();
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
      this.startSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

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

    const confirmed = confirm('Are you sure you want to complete this session?');
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
      alert('Session completed successfully!');

      // Return to order lookup
      this.showOrderLookup();

    } catch (error) {
      console.error('Error completing session:', error);
      alert('Error: ' + error.message);
    } finally {
      this.completeSessionBtn.disabled = false;
      this.completeSessionBtn.innerHTML = '<i class="fas fa-check"></i> Complete';
    }
  }

  async cancelSession() {
    if (!this.currentSessionId) return;

    const confirmed = confirm('Are you sure you want to cancel this session? All progress will be lost.');
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

      // Return to order lookup
      this.showOrderLookup();

    } catch (error) {
      console.error('Error cancelling session:', error);
      alert('Error: ' + error.message);
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
          const resume = confirm(`You have an active session for order ${session.order_number}. Resume?`);
          
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

// Export init function for router integration
export function init() {
  console.log('[MagentoPickPack] Init function called');
  // Prevent double initialization
  if (window.__magentoPickPackInitialized) {
    console.log('[MagentoPickPack] Already initialized, skipping');
    return;
  }
  window.__magentoPickPackInitialized = true;
  
  // Ensure the Pick & Pack tab is highlighted
  ensureTabHighlighted();
  
  new MagentoPickPackManager();
}

// Helper function to ensure tab highlighting
function ensureTabHighlighted() {
  // Find all tab buttons in the inner-tabs
  const tabButtons = document.querySelectorAll('.inner-tabs .tab-button');
  tabButtons.forEach(btn => {
    // Remove active class from all tabs
    btn.classList.remove('active');
    
    // Add active to the Pick & Pack tab
    if (btn.textContent.includes('Pick & Pack')) {
      btn.classList.add('active');
    }
  });
}

// Cleanup on navigation away
export function cleanup() {
  console.log('[MagentoPickPack] Cleanup called');
  window.__magentoPickPackInitialized = false;
}

// Also support direct script inclusion (fallback) - but this shouldn't run when using router
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[MagentoPickPack] DOMContentLoaded - checking if already initialized');
    // Only init if not already initialized by router
    if (!window.__magentoPickPackInitialized) {
      window.__magentoPickPackInitialized = true;
      new MagentoPickPackManager();
    }
  });
} else {
  console.log('[MagentoPickPack] Document already loaded - checking if already initialized');
  if (!window.__magentoPickPackInitialized) {
    window.__magentoPickPackInitialized = true;
    new MagentoPickPackManager();
  }
}
