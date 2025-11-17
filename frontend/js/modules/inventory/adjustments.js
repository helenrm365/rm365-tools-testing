import { get, post } from '../../services/api/http.js';
import { config } from '../../config.js';

const state = {
  recentAdjustments: [],
  selectedReason: 'pick_pack',
  selectedField: 'auto',
  adjustmentType: 'out' // Based on reason
};

// Load preferences from localStorage
function loadPreferences() {
  const saved = localStorage.getItem('inventory-adjustments-prefs');
  if (saved) {
    try {
      const prefs = JSON.parse(saved);
      
      // Load auto-submit preference
      const autoSubmitCheckbox = document.getElementById('autoSubmit');
      if (autoSubmitCheckbox && prefs.autoSubmit !== undefined) {
        autoSubmitCheckbox.checked = prefs.autoSubmit;
      }
      
      // Load selected reason
      if (prefs.selectedReason) {
        state.selectedReason = prefs.selectedReason;
        updateReasonDisplay();
      }
      
      // Load selected field
      if (prefs.selectedField) {
        state.selectedField = prefs.selectedField;
        updateFieldDisplay();
      }
      
      console.log('[Preferences] Loaded:', prefs);
    } catch (e) {
      console.warn('[Preferences] Failed to load:', e);
    }
  }
}

// Save preferences to localStorage
function savePreferences() {
  const autoSubmitCheckbox = document.getElementById('autoSubmit');
  
  const prefs = {
    autoSubmit: autoSubmitCheckbox?.checked || true,
    selectedReason: state.selectedReason,
    selectedField: state.selectedField
  };
  
  localStorage.setItem('inventory-adjustments-prefs', JSON.stringify(prefs));
  console.log('[Preferences] Saved:', prefs);
}

function updateReasonDisplay() {
  const reasonToggle = document.getElementById('reasonToggle');
  if (reasonToggle) {
    const reasonMap = {
      'pick_pack': 'Pick/Pack',
      'received': 'Received',
      'damaged': 'Damaged', 
      'returned': 'Returned',
      'lost': 'Lost',
      'found': 'Found',
      'correction': 'Correction'
    };
    
    const typeMap = {
      'pick_pack': 'out',
      'received': 'in',
      'damaged': 'out',
      'returned': 'in', 
      'lost': 'out',
      'found': 'in',
      'correction': 'correction'
    };
    
    state.adjustmentType = typeMap[state.selectedReason] || 'out';
    const label = reasonToggle.querySelector('.c-select__label');
    if (label) {
      label.textContent = reasonMap[state.selectedReason] || 'Pick/Pack';
    }
  }
}

function updateFieldDisplay() {
  const fieldToggle = document.getElementById('fieldToggle');
  if (fieldToggle) {
    const fieldMap = {
      'auto': 'Auto (Smart Logic)',
      'shelf_lt1_qty': 'Shelf < 1 Year',
      'shelf_gt1_qty': 'Shelf > 1 Year',
      'top_floor_total': 'Top Floor'
    };
    
    const label = fieldToggle.querySelector('.c-select__label');
    if (label) {
      label.textContent = fieldMap[state.selectedField] || 'Auto (Smart Logic)';
    }
  }
}

export async function init() {
  console.log('[Inventory Adjustments] Initializing scanner-ready adjustments module');
  
  try {
    // Always set up the scanner interface first
    await setupScannerInterface();
    
    // Check authentication 
    const { isAuthed } = await import('../../services/state/sessionStore.js');
    if (!isAuthed()) {
      showStatus('⚠️ Please log in to use inventory adjustments', 'warning');
      console.warn('[Inventory Adjustments] User not authenticated - some features will be limited');
      
      // Still show the interface but with login prompt
      const container = document.getElementById('recentAdjustmentsTable');
      if (container) {
        container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #ffc107;">🔐 Please log in to view and sync adjustments</p>';
      }
      return;
    }
    
  // Load user preferences
  loadPreferences();
  
  // Setup real-time updates for adjustments list
  setupRealtimeUpdates();
  
  // Only try to load data if authenticated
  try {
    await loadRecentAdjustments();
    showStatus('📱 Ready to scan barcodes', 'success');
  } catch (dataError) {
    console.warn('[Inventory Adjustments] Data loading failed, but interface is ready:', dataError);
    showStatus('⚠️ Ready to scan (some features may be limited)', 'warning');
  }  } catch (error) {
    console.error('[Inventory Adjustments] Failed to initialize:', error);
    
    // Handle specific error types
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      showStatus('🔐 Authentication required - please log in', 'error');
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      showStatus('🌐 Network error - interface ready but connection limited', 'warning');
    } else {
      showStatus('⚠️ Partial initialization - some features may not work', 'warning');
    }
  }
}

async function setupScannerInterface() {
  setupDropdowns();
  setupFormHandlers();
  setupAutoFocus();
  setupKeyboardHandlers();
  setDefaults();
}

function setupDropdowns() {
  // Reason dropdown
  const reasonDropdown = document.getElementById('reasonDropdown');
  const reasonToggle = document.getElementById('reasonToggle');
  if (reasonDropdown && reasonToggle) {
    bindDropdown(reasonDropdown, reasonToggle, (item) => {
      const value = item.dataset.value;
      const type = item.dataset.type;
      const text = item.textContent;
      
      state.selectedReason = value;
      state.adjustmentType = type;
      
      const label = reasonToggle.querySelector('.c-select__label');
      if (label) {
        label.textContent = text;
      }
    });
  }

  // Field dropdown
  const fieldDropdown = document.getElementById('fieldDropdown');
  const fieldToggle = document.getElementById('fieldToggle');
  if (fieldDropdown && fieldToggle) {
    bindDropdown(fieldDropdown, fieldToggle, (item) => {
      const value = item.dataset.value;
      const text = item.textContent;
      
      state.selectedField = value;
      
      const label = fieldToggle.querySelector('.c-select__label');
      if (label) {
        label.textContent = text;
      }
    });
  }
}

function bindDropdown(container, toggle, callback) {
  const list = container.querySelector('.c-select__list');
  
  // Prevent duplicate bindings
  if (toggle.hasAttribute('data-boundClick')) {
    return;
  }
  toggle.setAttribute('data-boundClick', 'true');
  
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = container.getAttribute('aria-expanded') === 'true';
    
    closeAllDropdowns();
    
    if (!isOpen) {
      container.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      // No backdrop - dropdowns should not darken the background
    }
  });
  
  list.addEventListener('click', (e) => {
    if (e.target.classList.contains('c-select__item')) {
      e.stopPropagation();
      callback(e.target);
      closeAllDropdowns();
      savePreferences();
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.c-select').forEach(container => {
    container.setAttribute('aria-expanded', 'false');
    const toggle = container.querySelector('.c-select__button');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  // No backdrop to remove
}

function getBackdrop() {
  let backdrop = document.getElementById('globalDropdownBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'globalDropdownBackdrop';
    backdrop.className = 'dropdown-backdrop';
    document.body.appendChild(backdrop);
    
    backdrop.addEventListener('click', closeAllDropdowns);
  }
  return backdrop;
}

function setupFormHandlers() {
  const submitBtn = document.getElementById('submitBtn');

  if (submitBtn) {
    submitBtn.addEventListener('click', submitAdjustment);
  }
}

function setupAutoFocus() {
  const barcodeInput = document.getElementById('barcodeInput');
  
  // Auto-focus on page load
  if (barcodeInput) {
    setTimeout(() => barcodeInput.focus(), 100);
  }

  // Click anywhere to focus barcode input
  document.addEventListener('click', (e) => {
    // Don't interfere with dropdown clicks or other inputs
    if (e.target.tagName === 'BUTTON' || 
        e.target.tagName === 'INPUT' || 
        e.target.closest('.dropdown-content')) {
      return;
    }
    
    if (barcodeInput && document.activeElement !== barcodeInput) {
      barcodeInput.focus();
    }
  });
  
  const autoSubmitCheckbox = document.getElementById('autoSubmit');
  
  if (autoSubmitCheckbox) {
    autoSubmitCheckbox.addEventListener('change', savePreferences);
  }
}

function setupKeyboardHandlers() {
  const barcodeInput = document.getElementById('barcodeInput');
  const quantityInput = document.getElementById('quantityInput');
  
  if (barcodeInput) {
    barcodeInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const autoSubmit = document.getElementById('autoSubmit')?.checked;
        
        if (autoSubmit && barcodeInput.value.trim()) {
          await submitAdjustment();
        }
      }
    });

    // Show scan status when typing
    barcodeInput.addEventListener('input', (e) => {
      const scanStatus = document.getElementById('scanStatus');
      if (scanStatus) {
        if (e.target.value.trim()) {
          scanStatus.textContent = '✅ Barcode detected';
          scanStatus.style.color = '#28a745';
        } else {
          scanStatus.textContent = '';
        }
      }
    });
  }

  // Allow Enter to submit from quantity input too
  if (quantityInput) {
    quantityInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await submitAdjustment();
      }
    });
  }
}

function setDefaults() {
  const quantityInput = document.getElementById('quantityInput');
  
  if (quantityInput) {
    quantityInput.value = '1';
  }

  updateReasonDisplay();
  updateFieldDisplay();
}

async function submitAdjustment() {
  const barcodeInput = document.getElementById('barcodeInput');
  const quantityInput = document.getElementById('quantityInput');
  const statusMessage = document.getElementById('statusMessage');
  
  if (!barcodeInput || !quantityInput || !statusMessage) {
    console.error('[Inventory Adjustments] Missing form elements');
    return;
  }

  const barcode = barcodeInput.value.trim();
  let quantity = parseInt(quantityInput.value) || 1;
  
  if (!barcode) {
    showStatus('❌ Please scan or enter a barcode', 'error');
    return;
  }

  // Adjust quantity based on adjustment type
  if (state.adjustmentType === 'out') {
    quantity = -Math.abs(quantity); // Make negative for stock out
  } else if (state.adjustmentType === 'in') {
    quantity = Math.abs(quantity); // Make positive for stock in
  }
  // For correction, use as-is

  showStatus('⏳ Submitting adjustment...', 'info');

  try {
    const data = await post(`/api/v1/inventory/adjustments/log`, {
      barcode: barcode,
      quantity: quantity,
      reason: state.selectedReason,
      field: state.selectedField
    });

    const adjustmentId = data.adjustment?.id || data.id || 'N/A';
    const message = data.message || 'Adjustment logged successfully';
    
    // Show success with smart shelf message if applicable
    showStatus(`✅ ${message} (ID: ${adjustmentId})`, 'success');
    
    // Trigger inventory data refresh event for management table
    try {
      const event = new CustomEvent('inventory-data-changed', {
        detail: {
          sku: data.adjustment?.barcode || barcode,
          field: state.selectedField === 'auto' ? 'shelf_lt1_qty' : state.selectedField,
          update_type: 'adjustment',
          new_value: quantity,
          reason: state.selectedReason
        }
      });
      window.dispatchEvent(event);
      console.log('[Adjustments] Dispatched inventory-data-changed event');
    } catch (e) {
      console.warn('[Adjustments] Failed to dispatch update event:', e);
    }
    
    // Auto-clear barcode for next scan
    autoClearBarcode();
    
    // Reload recent adjustments
    await loadRecentAdjustments();
    
  } catch (err) {
    console.error('[Inventory Adjustments] Submit error:', err);
    
    // Categorize the error for better user feedback
    let errorMessage = '❌ Network error. Please try again.';
    if (err.message) {
      if (err.message.includes('timeout') || err.message.includes('Timeout')) {
        errorMessage = '❌ Request timed out. Check your connection and try again.';
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        errorMessage = '❌ Connection failed. Check your internet connection.';
      } else if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        errorMessage = '❌ Authentication failed. Please refresh the page and log in again.';
      } else if (err.message.includes('5') && err.message.length === 3) { // 5xx errors
        errorMessage = '❌ Server error. Please try again later.';
      } else if (err.message.length > 10) { // More specific error from server
        errorMessage = `❌ ${err.message}`;
      }
    }
    
    showStatus(errorMessage, 'error');
  }
}
function autoClearBarcode() {
  const barcodeInput = document.getElementById('barcodeInput');
  const scanStatus = document.getElementById('scanStatus');
  
  if (barcodeInput) {
    barcodeInput.value = '';
    barcodeInput.focus(); // Keep focus for next scan
  }
  
  if (scanStatus) {
    scanStatus.textContent = '';
  }
}

async function loadRecentAdjustments() {
  const container = document.getElementById('recentAdjustmentsTable');
  if (!container) return;

  try {
    // Check authentication first
    const { isAuthed } = await import('../../services/state/sessionStore.js');
    if (!isAuthed()) {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #ffc107;">🔐 Please log in to view adjustments</p>';
      return;
    }

    // Try the pending endpoint, with multiple fallbacks
    let data;
    try {
      data = await get(`/api/v1/inventory/adjustments/pending`);
    } catch (err) {
      if (err.message.includes('404') || err.message.includes('Not Found')) {
        console.warn('[Inventory Adjustments] /pending endpoint returned 404, trying fallbacks...');
        
        // Try the status endpoint as fallback
        try {
          const statusData = await get(`/api/v1/inventory/adjustments/status`);
          data = { adjustments: statusData.recent_items || [], count: statusData.pending_count || 0 };
        } catch (statusErr) {
          console.warn('[Inventory Adjustments] /status endpoint also failed:', statusErr);
          
          // Last resort: try public test endpoint to verify routing
          try {
            const publicData = await get(`/api/v1/inventory/adjustments/pending-public`);
            console.log('[Inventory Adjustments] Public test endpoint works:', publicData);
            throw new Error('Routing works but authenticated endpoints are not accessible. Check backend logs.');
          } catch (publicErr) {
            console.error('[Inventory Adjustments] All endpoints failed, including public test');
            throw new Error('Inventory adjustments API is not responding. Check backend deployment.');
          }
        }
      } else {
        throw err;
      }
    }
    displayRecentAdjustments(data.adjustments || []);
  } catch (err) {
    console.error('[Inventory Adjustments] Error loading recent adjustments:', err);
    
    // Handle specific error types
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #dc3545;">🔐 Please log in to view adjustments</p>';
    } else if (err.message.includes('404') || err.message.includes('Not Found')) {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #ff9800;">⚠️ Adjustments endpoint not available. Please contact support.</p>';
    } else if (err.message.includes('Failed to fetch')) {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #dc3545;">🌐 Network error - check connection</p>';
    } else {
      container.innerHTML = `<p class="muted" style="text-align: center; padding: 1rem; color: #999;">Failed to load adjustments: ${err.message}</p>`;
    }
  }
}

function displayRecentAdjustments(adjustments) {
  const container = document.getElementById('recentAdjustmentsTable');
  if (!container) return;

  if (!adjustments.length) {
    container.innerHTML = '<p style="padding: 2rem; text-align: center; color: #999; margin: 0;">No recent adjustments</p>';
    return;
  }

  const table = `
    <table class="modern-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Barcode</th>
          <th>Qty</th>
          <th>Reason</th>
          <th>Location</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${adjustments.slice(0, 20).map(adj => {
          const createdAt = new Date(adj.created_at).toLocaleTimeString();
          const status = adj.status || 'Pending';
          const statusClass = status === 'Success' ? 'success' : 
                             status === 'Error' ? 'error' : 'pending';
          const statusIcon = status === 'Success' ? '✅' : 
                           status === 'Error' ? '❌' : '⏳';
          const qtyClass = adj.quantity > 0 ? 'positive' : 'negative';
          
          return `
            <tr>
              <td style="white-space: nowrap;">${createdAt}</td>
              <td style="font-family: 'Courier New', monospace; font-size: 0.9em;">${adj.barcode}</td>
              <td style="text-align: center; font-weight: 600; color: ${adj.quantity > 0 ? '#28a745' : '#dc3545'};">${adj.quantity > 0 ? '+' : ''}${adj.quantity}</td>
              <td>${adj.reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td>
              <td>${formatFieldName(adj.field)}</td>
              <td>${statusIcon} <span style="font-size: 0.85em;">${status}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = table;
}

function showStatus(message, type) {
  const statusMessage = document.getElementById('statusMessage');
  if (!statusMessage) return;
  
  statusMessage.textContent = message;
  statusMessage.className = '';
  
  if (type === 'success') {
    statusMessage.style.color = '#28a745';
  } else if (type === 'error') {
    statusMessage.style.color = '#dc3545';
  } else {
    statusMessage.style.color = '#007bff';
  }
  
  // Clear status after 5 seconds for non-error messages
  if (type !== 'error' && message) {
    setTimeout(() => {
      statusMessage.textContent = '';
    }, 5000);
  }
}

function formatFieldName(field) {
  const fieldMap = {
    'shelf_lt1_qty': 'Shelf < 1 Year',
    'shelf_gt1_qty': 'Shelf > 1 Year', 
    'top_floor_total': 'Top Floor'
  };
  return fieldMap[field] || field.replace(/_/g, ' ');
}

/**
 * Setup real-time updates for adjustments list
 */
function setupRealtimeUpdates() {
  // Listen for inventory changes from WebSocket or local events
  window.addEventListener('inventory-data-changed', async (event) => {
    const change = event.detail || {};
    
    // Only reload if it's an adjustment-type update
    if (change.update_type === 'adjustment') {
      console.log('[Adjustments] Received adjustment update:', change);
      
      // Reload the adjustments list to show the new entry
      try {
        await loadRecentAdjustments();
      } catch (error) {
        console.warn('[Adjustments] Failed to reload adjustments:', error);
      }
    }
  });

  console.log('[Adjustments] Real-time updates enabled');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  // Only close if clicking outside dropdown containers
  if (!e.target.closest('.dropdown-container')) {
    closeAllDropdowns();
  }
});

// Close dropdowns when clicking backdrop
document.addEventListener('DOMContentLoaded', () => {
  const backdrop = document.getElementById('globalDropdownBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeAllDropdowns);
  }
});

export function cleanup() {
  console.log('[Inventory Adjustments] Cleaning up');
  // Remove event listeners if needed
}
