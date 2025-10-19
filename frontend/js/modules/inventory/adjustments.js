import { get, post } from '../../services/api/http.js';
import { config } from '../../config.js';

const state = {
  recentAdjustments: [],
  selectedReason: 'pick_pack',
  selectedField: 'shelf_lt1_qty',
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
      
      // Load auto-sync preference  
      const autoSyncCheckbox = document.getElementById('autoSync');
      if (autoSyncCheckbox && prefs.autoSync !== undefined) {
        autoSyncCheckbox.checked = prefs.autoSync;
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
  const autoSyncCheckbox = document.getElementById('autoSync');
  
  const prefs = {
    autoSubmit: autoSubmitCheckbox?.checked || true,
    autoSync: autoSyncCheckbox?.checked || true,
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
    reasonToggle.innerHTML = `${reasonMap[state.selectedReason] || 'Pick/Pack'} <span class="arrow">▼</span>`;
  }
}

function updateFieldDisplay() {
  const fieldToggle = document.getElementById('fieldToggle');
  if (fieldToggle) {
    const fieldMap = {
      'shelf_lt1_qty': 'Shelf &lt; 1 Year',
      'shelf_gt1_qty': 'Shelf &gt; 1 Year',
      'top_floor_total': 'Top Floor'
    };
    
    fieldToggle.innerHTML = `${fieldMap[state.selectedField] || 'Shelf &lt; 1 Year'} <span class="arrow">▼</span>`;
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
  
  // Only try to load data if authenticated
  try {
    await loadRecentAdjustments();
    await checkZohoConnectionStatus();
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
      reasonToggle.innerHTML = `${text} <span class="arrow">▼</span>`;
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
      fieldToggle.innerHTML = `${text} <span class="arrow">▼</span>`;
    });
  }
}

function bindDropdown(container, toggle, callback) {
  const content = container.querySelector('.dropdown-content');
  
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = container.classList.contains('open');
    
    closeAllDropdowns();
    
    if (!isOpen) {
      container.classList.add('open');
      showBackdrop();
    }
  });
  
  content.addEventListener('click', (e) => {
    if (e.target.classList.contains('dropdown-item')) {
      e.stopPropagation();
      callback(e.target);
      closeAllDropdowns();
      savePreferences(); // Save when user makes selection
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-container').forEach(container => {
    container.classList.remove('open');
  });
  hideBackdrop();
}

function showBackdrop() {
  const backdrop = document.getElementById('globalDropdownBackdrop');
  if (backdrop) {
    backdrop.classList.add('show');
  }
}

function hideBackdrop() {
  const backdrop = document.getElementById('globalDropdownBackdrop');
  if (backdrop) {
    backdrop.classList.remove('show');
  }
}

function setupFormHandlers() {
  const submitBtn = document.getElementById('submitBtn');
  const syncBtn = document.getElementById('syncBtn');
  const viewPendingBtn = document.getElementById('viewPendingBtn');

  if (submitBtn) {
    submitBtn.addEventListener('click', submitAdjustment);
  }

  if (syncBtn) {
    syncBtn.addEventListener('click', syncToZoho);
  }

  if (viewPendingBtn) {
    viewPendingBtn.addEventListener('click', viewPendingAdjustments);
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
  const autoSyncCheckbox = document.getElementById('autoSync');
  
  if (autoSubmitCheckbox) {
    autoSubmitCheckbox.addEventListener('change', savePreferences);
  }
  
  if (autoSyncCheckbox) {
    autoSyncCheckbox.addEventListener('change', savePreferences);
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
  const autoSync = document.getElementById('autoSync')?.checked;
  
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

    showStatus(`✅ Adjustment logged successfully (ID: ${data.id})`, 'success');
    
    // Auto-clear barcode for next scan
    autoClearBarcode();
    
    // Auto-sync if enabled
    if (autoSync) {
      setTimeout(async () => {
        showStatus('⏳ Auto-syncing to Zoho...', 'info');
        await syncToZoho();
      }, 500); // Small delay to avoid overwhelming the system
    }
    
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

async function syncToZoho() {
  const syncBtn = document.getElementById('syncBtn');
  const syncStatus = document.getElementById('syncStatus');
  
  if (syncBtn) syncBtn.disabled = true;
  showSyncStatus('⏳ Checking connection...', 'info');
  
  // First check if Zoho is reachable
  try {
    const connectionCheck = await get(`/api/v1/inventory/adjustments/connection-status`);
    if (connectionCheck && !connectionCheck.connected) {
      showSyncStatus(`❌ Zoho connection failed: ${connectionCheck.message}`, 'error');
      if (syncBtn) syncBtn.disabled = false;
      return;
    }
  } catch (err) {
    console.warn('[Inventory Adjustments] Connection check failed, proceeding with sync:', err);
  }
  
  showSyncStatus('⏳ Syncing to Zoho...', 'info');

  try {
    const data = await post(`/api/v1/inventory/adjustments/sync`, {});
    showSyncStatus(`✅ Sync complete: ${data.success_count || 0} successful, ${data.error_count || 0} failed`, 'success');
    await loadRecentAdjustments(); // Refresh the list
  } catch (err) {
    console.error('[Inventory Adjustments] Sync error:', err);
    
    // Provide more specific error feedback for sync operations
    let syncErrorMessage = '❌ Network error during sync';
    if (err.message) {
      if (err.message.includes('timeout') || err.message.includes('Timeout')) {
        syncErrorMessage = '❌ Sync timed out. Some adjustments may not have been processed.';
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        syncErrorMessage = '❌ Connection lost during sync. Check connection and try again.';
      } else if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        syncErrorMessage = '❌ Authentication expired. Please refresh and try again.';
      } else if (err.message.includes('token') || err.message.includes('Token')) {
        syncErrorMessage = '❌ Zoho authentication failed. Contact administrator.';
      } else if (err.message.length > 10) {
        syncErrorMessage = `❌ Sync failed: ${err.message}`;
      }
    }
    
    showSyncStatus(syncErrorMessage, 'error');
  }

  if (syncBtn) syncBtn.disabled = false;
}

async function viewPendingAdjustments() {
  try {
    const response = await get(`/api/v1/inventory/adjustments/pending`);
    
    if (response.ok) {
      const data = await response.json();
      showPendingModal(data.adjustments || []);
    } else {
      showStatus('❌ Failed to load pending adjustments', 'error');
    }
  } catch (err) {
    console.error('[Inventory Adjustments] Error loading pending:', err);
    showStatus('❌ Network error loading pending adjustments', 'error');
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

    const data = await get(`/api/v1/inventory/adjustments/pending`);
    displayRecentAdjustments(data.adjustments || []);
  } catch (err) {
    console.error('[Inventory Adjustments] Error loading recent adjustments:', err);
    
    // Handle specific error types
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #dc3545;">🔐 Please log in to view adjustments</p>';
    } else if (err.message.includes('Failed to fetch')) {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #dc3545;">🌐 Network error - check connection</p>';
    } else {
      container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #999;">Failed to load adjustments</p>';
    }
  }
}

function displayRecentAdjustments(adjustments) {
  const container = document.getElementById('recentAdjustmentsTable');
  if (!container) return;

  if (!adjustments.length) {
    container.innerHTML = '<p class="muted" style="text-align: center; padding: 1rem; color: #999;">No recent adjustments</p>';
    return;
  }

  const table = `
    <table class="modern-table" style="width: 100%; font-size: 0.9rem;">
      <thead>
        <tr>
          <th>Time</th>
          <th>Barcode</th>
          <th>Qty</th>
          <th>Reason</th>
          <th>Field</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${adjustments.slice(0, 10).map(adj => {
          const createdAt = new Date(adj.created_at).toLocaleTimeString();
          const status = adj.status || 'Pending';
          const statusIcon = status === 'Success' ? '✅' : 
                           status === 'Error' ? '❌' : '⏳';
          
          return `
            <tr>
              <td>${createdAt}</td>
              <td style="font-family: monospace;">${adj.barcode}</td>
              <td style="text-align: center;">${adj.quantity}</td>
              <td>${adj.reason}</td>
              <td>${formatFieldName(adj.field)}</td>
              <td>${statusIcon} ${status}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = table;
}

function showPendingModal(adjustments) {
  // Simple alert for now - could be enhanced with a modal
  if (!adjustments.length) {
    alert('No pending adjustments');
    return;
  }
  
  const summary = adjustments.map(adj => 
    `${adj.barcode}: ${adj.quantity} (${adj.reason})`
  ).join('\n');
  
  alert(`Pending adjustments (${adjustments.length}):\n\n${summary}`);
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

function showSyncStatus(message, type) {
  const syncStatus = document.getElementById('syncStatus');
  if (!syncStatus) return;
  
  syncStatus.textContent = message;
  
  if (type === 'success') {
    syncStatus.style.color = '#28a745';
  } else if (type === 'error') {
    syncStatus.style.color = '#dc3545';
  } else {
    syncStatus.style.color = '#007bff';
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

async function checkZohoConnectionStatus() {
  /**
   * Check Zoho API connection status and display indicator
   */
  try {
    // Check if user is authenticated first
    const { isAuthed } = await import('../../services/state/sessionStore.js');
    if (!isAuthed()) {
      const indicator = document.getElementById('connectionIndicator');
      if (indicator) {
        indicator.innerHTML = '🔐 Login Required';
        indicator.className = 'connection-status unknown';
        indicator.title = 'Please log in to check Zoho connection';
      }
      return null;
    }

    const response = await get(`/api/v1/inventory/adjustments/connection-status`);
    
    const indicator = document.getElementById('connectionIndicator');
    if (indicator) {
      if (response.connected) {
        indicator.innerHTML = `🟢 Connected (${response.response_time_ms}ms)`;
        indicator.className = 'connection-status connected';
        indicator.title = `Zoho API connection successful at ${response.timestamp}`;
      } else {
        indicator.innerHTML = '🔴 Disconnected';
        indicator.className = 'connection-status disconnected';
        indicator.title = `Zoho API connection failed: ${response.message}`;
      }
    }
    
    return response;
    
  } catch (err) {
    console.error('[Inventory Adjustments] Connection status check failed:', err);
    
    const indicator = document.getElementById('connectionIndicator');
    if (indicator) {
      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        indicator.innerHTML = '🔐 Auth Required';
        indicator.className = 'connection-status unknown';
        indicator.title = 'Authentication required to check connection';
      } else if (err.message.includes('Failed to fetch')) {
        indicator.innerHTML = '🌐 Network Error';
        indicator.className = 'connection-status unknown';
        indicator.title = 'Network error - check internet connection';
      } else {
        indicator.innerHTML = '⚠️ Unknown';
        indicator.className = 'connection-status unknown';
        indicator.title = 'Unable to check Zoho API connection status';
      }
    }
    
    return { connected: false, message: 'Status check failed' };
  }
}

// Export the connection check function for external use
export { checkZohoConnectionStatus };

// Periodically check connection status (every 2 minutes)
setInterval(checkZohoConnectionStatus, 120000);

export function cleanup() {
  console.log('[Inventory Adjustments] Cleaning up');
  // Remove event listeners if needed
}
