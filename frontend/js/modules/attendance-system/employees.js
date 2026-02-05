// js/modules/attendance-system/employees.js
// Employee management with clock in/out functionality
import { getEmployees,
    createEmployee, updateEmployee, deleteEmployee,
    bulkDeleteEmployees, saveNFC, deleteNFC } from '../../services/api/enrollmentApi.js';
import { checkAttendanceTablesStatus, initializeAttendanceTables, clockEmployee, getEmployeesWithStatus } from '../../services/api/attendanceApi.js';
import { getLocations, createLocation, initLocations, getCountryCodes, getLocationsByCountry, getLocationByName, getLocationByCityCode } from '../../services/api/locationsApi.js';
import { confirmModal } from '../../ui/confirmationModal.js';
import { showToast } from '../../ui/toast.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';


let state = {
  employees: [],
  locations: [], // Array of {id, name, city_code, country_code}
  countryCodes: [], // Array of unique country codes
  clockStatus: {}, // Map of employee_id -> 'in' | 'out' | 'unknown'
  query: '',
  status: '',
  location: '',
  cityCode: '',
  countryCode: '',
  selectedIds: new Set(),
  returnToModal: null, // 'create' | 'edit' | null - tracks which modal to return to after location creation
  pendingLocationId: null, // Location ID to select after returning
};

// NFC Scanning state
let nfcState = {
  scanning: false,
  scannedUid: null,
  originalUid: null,  // Original UID when modal opened
  currentEmployeeId: null,
  websocket: null,  // WebSocket connection for NFC scanning
  isProcessingCard: false,  // Prevent duplicate processing
};

// WebSocket configuration for NFC hardware bridge (same as automatic.js)
const IS_HTTPS = window.location.protocol === 'https:';
const WS_PROTOCOL = IS_HTTPS ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//127.0.0.1:8080/ws/nfc`;

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

// ===== Native Select Filter Functions =====

/**
 * Initialize filter select event listeners
 */
function initFilterSelects() {
  // Status filter
  const statusSelect = $('#statusFilter');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      state.status = e.target.value;
      filterEmployees();
    });
  }
  
  // Country filter - linked
  const countrySelect = $('#countryFilter');
  if (countrySelect) {
    countrySelect.addEventListener('change', async (e) => {
      const countryCode = e.target.value;
      state.countryCode = countryCode;
      
      // When selecting a country, clear the other linked filters
      resetLocationSelect();
      resetCityCodeSelect();
      
      state.location = '';
      state.cityCode = '';
      
      filterEmployees();
    });
  }
  
  // Location filter - linked
  const locationSelect = $('#locationFilter');
  if (locationSelect) {
    locationSelect.addEventListener('change', async (e) => {
      const locationName = e.target.value;
      state.location = locationName;
      
      if (locationName) {
        // Find the location and auto-fill the other filters
        const location = state.locations.find(l => l.name === locationName);
        if (location) {
          setCountrySelectValue(location.country_code);
          setCityCodeSelectValue(location.city_code);
          
          state.cityCode = location.city_code;
          state.countryCode = location.country_code;
        }
      } else {
        // Clearing location - clear other filters too
        resetCountrySelect();
        resetCityCodeSelect();
        
        state.cityCode = '';
        state.countryCode = '';
      }
      
      filterEmployees();
    });
  }
  
  // City code filter - linked
  const cityCodeSelect = $('#citycodeFilter');
  if (cityCodeSelect) {
    cityCodeSelect.addEventListener('change', async (e) => {
      const cityCode = e.target.value;
      state.cityCode = cityCode;
      
      if (cityCode) {
        // Find the location by city code and auto-fill the other filters
        const location = state.locations.find(l => l.city_code === cityCode);
        if (location) {
          setCountrySelectValue(location.country_code);
          setLocationSelectValue(location.name);
          
          state.location = location.name;
          state.countryCode = location.country_code;
        }
      } else {
        // Clearing city code - clear other filters too
        resetCountrySelect();
        resetLocationSelect();
        
        state.location = '';
        state.countryCode = '';
      }
      
      filterEmployees();
    });
  }
}

// Helper functions to set select values without triggering filters
function setCountrySelectValue(countryCode) {
  const select = $('#countryFilter');
  if (select) select.value = countryCode;
}

function setLocationSelectValue(locationName) {
  const select = $('#locationFilter');
  if (select) select.value = locationName;
}

function setCityCodeSelectValue(cityCode) {
  const select = $('#citycodeFilter');
  if (select) select.value = cityCode;
}

function resetCountrySelect() {
  const select = $('#countryFilter');
  if (select) select.value = '';
}

function resetLocationSelect() {
  const select = $('#locationFilter');
  if (select) select.value = '';
}

function resetCityCodeSelect() {
  const select = $('#citycodeFilter');
  if (select) select.value = '';
}

// Filter employees based on current select values
function filterEmployees() {
  state.status = $('#statusFilter')?.value || '';
  state.location = $('#locationFilter')?.value || '';
  state.cityCode = $('#citycodeFilter')?.value || '';
  state.countryCode = $('#countryFilter')?.value || '';
  renderTable();
}

// Expose for potential external use
window.filterEmployees = filterEmployees;

function renderTable() {
  const grid = $('#enrEmployeeGrid');
  if (!grid) return;

  const rows = state.employees
    .filter(e => !state.status || (e.status || 'active').toLowerCase() === state.status)
    .filter(e => {
      // Filter by location name
      if (state.location && (e.location || '') !== state.location) return false;
      
      // Filter by city code - look up the location to match
      if (state.cityCode) {
        const loc = state.locations.find(l => l.name === e.location);
        if (!loc || loc.city_code !== state.cityCode) return false;
      }
      
      // Filter by country code - look up the location to match
      if (state.countryCode) {
        const loc = state.locations.find(l => l.name === e.location);
        if (!loc || loc.country_code !== state.countryCode) return false;
      }
      
      return true;
    })
    .filter(e => {
      const q = state.query.trim().toLowerCase();
      if (!q) return true;
      const loc = state.locations.find(l => l.name === e.location);
      const hay = `${e.name} ${e.employee_code} ${e.location || ''} ${loc?.city_code || ''} ${loc?.country_code || ''} ${e.nfc_uid || ''}`.toLowerCase();
      return hay.includes(q);
    });

  // Update employee count
  const countEl = $('#employeeCount');
  if (countEl) {
    const total = state.employees.length;
    const shown = rows.length;
    if (shown === total) {
      countEl.textContent = `${total} employee${total !== 1 ? 's' : ''} total`;
    } else {
      countEl.textContent = `Showing ${shown} of ${total} employee${total !== 1 ? 's' : ''}`;
    }
  }

  if (!rows.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No employees found</h3>
        <p>Try adjusting your filters or create a new employee</p>
      </div>`;
    return;
  }

  // Render simplified clickable cards with clock button
  grid.innerHTML = rows.map(e => {
    const statusClass = (e.status || 'active').toLowerCase();
    const statusLabel = (e.status || 'active').charAt(0).toUpperCase() + (e.status || 'active').slice(1);
    const clockStatus = state.clockStatus[e.id] || 'unknown';
    const isClockedIn = clockStatus === 'in';
    // Use standard color classes: success-btn for clock in, warning-btn for clock out (orange)
    const clockBtnClass = isClockedIn ? 'warning-btn' : 'success-btn';
    const clockBtnIcon = isClockedIn ? 'fa-sign-out-alt' : 'fa-sign-in-alt';
    const clockBtnText = isClockedIn ? 'Clock Out' : 'Clock In';
    const clockBtnTitle = isClockedIn ? 'Clock out this employee' : 'Clock in this employee';
    
    // Format location as "Country Code | Location Name | City Code"
    const loc = state.locations.find(l => l.name === e.location);
    const locationDisplay = loc 
      ? `${loc.country_code} | ${loc.name} | ${loc.city_code}`
      : (e.location || 'N/A');
    
    return `
    <div class="employee-card clickable" 
         data-id="${e.id}"
         data-name="${e.name || ''}"
         data-code="${e.employee_code || ''}"
         data-location="${e.location || ''}"
         data-status="${e.status || 'active'}"
         data-nfc="${e.nfc_uid || ''}"
         data-clock-status="${clockStatus}"
         onclick="window.openEmployeeEditModal(this)">
      <label class="card-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="employee-checkbox" data-id="${e.id}" ${state.selectedIds.has(e.id) ? 'checked' : ''}>
        <span class="checkbox-custom"></span>
      </label>
      <div class="employee-avatar">
        <i class="fas fa-user"></i>
      </div>
      <div class="employee-info">
        <h4 class="employee-name">${e.name || 'Unnamed'}</h4>
        <p class="employee-code">#${e.employee_code || 'N/A'}</p>
        <div class="employee-badges">
          <span class="location-badge">${locationDisplay}</span>
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
        </div>
      </div>
      <button class="btn btn-sm secondary-btn clock-toggle-btn ${clockBtnClass}" 
              data-id="${e.id}" 
              data-name="${e.name || 'Employee'}"
              data-clock-status="${clockStatus}"
              title="${clockBtnTitle}"
              onclick="event.stopPropagation(); window.handleClockToggle(this);">
        <i class="fas ${clockBtnIcon}"></i>
        <span>${clockBtnText}</span>
      </button>
    </div>
  `}).join('');

  // Wire up event listeners
  wireCardEvents();
}

// Handle Clock In/Out Toggle
window.handleClockToggle = async function(btnEl) {
  const employeeId = parseInt(btnEl.dataset.id);
  const employeeName = btnEl.dataset.name;
  const currentStatus = btnEl.dataset.clockStatus;
  const isClockedIn = currentStatus === 'in';
  const action = isClockedIn ? 'clock out' : 'clock in';
  const actionPast = isClockedIn ? 'clocked out' : 'clocked in';
  
  // Show confirmation modal
  const confirmed = await confirmModal({
    title: isClockedIn ? 'Clock Out Employee' : 'Clock In Employee',
    message: `Are you sure you want to ${action} <strong>${employeeName}</strong>?`,
    confirmText: isClockedIn ? 'Clock Out' : 'Clock In',
    cancelText: 'Cancel',
    confirmVariant: isClockedIn ? 'warning' : 'primary',
    icon: isClockedIn ? 'fa-sign-out-alt' : 'fa-sign-in-alt'
  });
  
  if (!confirmed) return;
  
  // Disable button while processing
  btnEl.disabled = true;
  const originalHtml = btnEl.innerHTML;
  btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Processing...</span>';
  
  try {
    const result = await clockEmployee(employeeId);
    
    // Update local state
    state.clockStatus[employeeId] = result.direction;
    
    // Show success toast
    showToast(`✅ ${employeeName} has been ${result.direction === 'in' ? 'clocked in' : 'clocked out'}`, 'success');
    
    // Re-render to update button state
    renderTable();
    
  } catch (error) {
    console.error('Clock toggle error:', error);
    showToast(`❌ Failed to ${action} ${employeeName}: ${error.message}`, 'error');
    
    // Restore button
    btnEl.disabled = false;
    btnEl.innerHTML = originalHtml;
  }
};

// Open Employee Edit Modal
window.openEmployeeEditModal = function(cardEl) {
  const modal = $('#editEmployeeModal');
  if (!modal) return;
  
  // Reset NFC state and disconnect any existing websocket
  const nfcUid = cardEl.dataset.nfc || '';
  stopNfcScanning();  // Ensure clean state - stops scanning and disconnects websocket
  nfcState.scannedUid = null;
  nfcState.originalUid = nfcUid;
  nfcState.currentEmployeeId = Number(cardEl.dataset.id);
  
  // Populate modal with card data
  $('#editEmployeeId').value = cardEl.dataset.id;
  $('#editEmployeeName').value = cardEl.dataset.name;
  $('#editEmployeeCode').value = cardEl.dataset.code ? `#${cardEl.dataset.code}` : 'N/A';
  $('#editEmployeeLocation').value = cardEl.dataset.location;
  $('#editEmployeeStatusSelect').value = cardEl.dataset.status;
  $('#editEmployeeNfc').value = nfcUid;
  
  // Update NFC display
  updateNfcDisplay(nfcUid);
  updateNfcDeleteButton(nfcUid);
  resetNfcScanButton();
  hideNfcStatus();
  
  // Reset save and delete buttons to default state
  resetEditModalButtons();
  
  // Location and status are already set above via .value assignment
  // Native selects handle display automatically

  // Update modal header
  const title = $('#editModalTitle');
  const statusBadge = $('#editModalStatus');
  if (title) title.textContent = cardEl.dataset.name || 'Edit Employee';
  if (statusBadge) {
    const status = cardEl.dataset.status || 'active';
    statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    statusBadge.className = `status-badge status-${status.toLowerCase()}`;
  }
  
  // Show modal
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

// Helper to set a native select value
function setSelectValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.value = value;
}

function hideEditEmployeeModal() {
  // Stop NFC scanning when closing modal
  stopNfcScanning();
  
  const modal = $('#editEmployeeModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function wireEditModalEvents() {
  // Close buttons
  $('#closeEditModal')?.addEventListener('click', hideEditEmployeeModal);
  $('#cancelEdit')?.addEventListener('click', hideEditEmployeeModal);
  
  // Click overlay to close
  $('#editEmployeeModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      hideEditEmployeeModal();
    }
  });
  
  // NFC Scan button
  $('#startNfcScanBtn')?.addEventListener('click', toggleNfcScanning);
  
  // NFC Delete button
  $('#deleteNfcBtn')?.addEventListener('click', handleDeleteNfc);
  
  // Save changes
  $('#confirmEdit')?.addEventListener('click', async () => {
    const id = Number($('#editEmployeeId').value);
    const name = $('#editEmployeeName').value.trim();
    const location = $('#editEmployeeLocation').value;
    const status = $('#editEmployeeStatusSelect').value;
    // Get NFC UID from hidden input (updated by NFC scanning)
    const nfc_uid = $('#editEmployeeNfc').value.trim() || null;
    
    if (!name) {
      notify('❌ Employee name is required', true);
      return;
    }
    
    // Stop NFC scanning before saving
    stopNfcScanning();
    
    const btn = $('#confirmEdit');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Saving...</span>';
    
    try {
      // Check if NFC UID changed and needs special handling
      const hasNfcChange = nfc_uid !== nfcState.originalUid;
      
      if (hasNfcChange && nfc_uid) {
        // Use saveNFC for NFC assignments (handles conflict detection)
        await saveNfcWithConflictHandling(id, nfc_uid, name);
      }
      
      // Update other employee details (without nfc_uid if we already handled it)
      await updateEmployee(id, { name, location, status, nfc_uid });
      notify('✅ Changes saved successfully');
      btn.innerHTML = originalText;
      btn.disabled = false;
      hideEditEmployeeModal();
      await refresh();
    } catch (e) {
      notify('❌ Save failed: ' + e.message, true);
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });
  
  // Delete from modal
  $('#deleteFromEdit')?.addEventListener('click', async () => {
    const id = Number($('#editEmployeeId').value);
    const name = $('#editEmployeeName').value.trim();
    
    const confirmed = await confirmDelete(name, 'employee');
    if (!confirmed) return;
    
    const btn = $('#deleteFromEdit');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Deleting...</span>';
    
    try {
      await deleteEmployee(id);
      notify('✅ Employee deleted successfully');
      state.selectedIds.delete(id);
      hideEditEmployeeModal();
      await refresh();
    } catch (e) {
      notify('❌ Delete failed: ' + e.message, true);
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });
}

// ===== NFC Scanning Functions =====

function updateNfcDisplay(uid) {
  const display = $('#editEmployeeNfcDisplay');
  const text = $('#editEmployeeNfcText');
  const hiddenInput = $('#editEmployeeNfc');
  
  if (uid) {
    if (text) text.textContent = uid;
    if (display) {
      display.classList.add('has-uid');
      display.classList.remove('no-uid');
    }
  } else {
    if (text) text.textContent = 'No NFC card assigned';
    if (display) {
      display.classList.remove('has-uid');
      display.classList.add('no-uid');
    }
  }
  if (hiddenInput) hiddenInput.value = uid || '';
}

function updateNfcDeleteButton(uid) {
  const btn = $('#deleteNfcBtn');
  if (btn) {
    btn.disabled = !uid;
  }
}

function resetNfcScanButton() {
  const btn = $('#startNfcScanBtn');
  const icon = $('#nfcScanIcon');
  const text = $('#nfcScanBtnText');
  
  if (btn) btn.classList.remove('scanning');
  if (icon) {
    icon.classList.remove('fa-spinner', 'fa-spin');
    icon.classList.add('fa-wifi');
  }
  if (text) text.textContent = 'Scan Card';
}

/**
 * Reset the edit modal buttons (Save and Delete) to their default state
 */
function resetEditModalButtons() {
  const saveBtn = $('#confirmEdit');
  const deleteBtn = $('#deleteFromEdit');
  
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-save"></i><span>Save Changes</span>';
  }
  
  if (deleteBtn) {
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i><span>Delete</span>';
  }
}

function setNfcScanningUI(scanning) {
  const btn = $('#startNfcScanBtn');
  const icon = $('#nfcScanIcon');
  const text = $('#nfcScanBtnText');
  const display = $('#editEmployeeNfcDisplay');
  
  if (scanning) {
    if (btn) btn.classList.add('scanning');
    if (icon) {
      icon.classList.remove('fa-wifi');
      icon.classList.add('fa-spinner', 'fa-spin');
    }
    if (text) text.textContent = 'Scanning...';
    if (display) display.classList.add('scanning');
  } else {
    if (btn) btn.classList.remove('scanning');
    if (icon) {
      icon.classList.remove('fa-spinner', 'fa-spin');
      icon.classList.add('fa-wifi');
    }
    if (text) text.textContent = 'Scan Card';
    if (display) display.classList.remove('scanning');
  }
}

function showNfcStatus(message, type = 'info') {
  const container = $('#nfcStatusMessage');
  const text = container?.querySelector('.status-text');
  if (container && text) {
    text.textContent = message;
    container.className = `nfc-status-message visible ${type}`;
  }
}

function hideNfcStatus() {
  const container = $('#nfcStatusMessage');
  if (container) {
    container.classList.remove('visible');
  }
}

async function tryNfcScan(timeoutSeconds = 1) {
  const bridgeProtocol = 'https:';
  const localEndpoints = [
    `${bridgeProtocol}//127.0.0.1:8080/nfc/scan`,
    `${bridgeProtocol}//localhost:8080/nfc/scan`
  ];

  for (const endpoint of localEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: timeoutSeconds }),
        cache: 'no-store',
        keepalive: false,
        mode: 'cors',
        credentials: 'omit'
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function toggleNfcScanning() {
  if (nfcState.scanning) {
    stopNfcScanning();
    showNfcStatus('Scanning stopped', 'info');
    setTimeout(hideNfcStatus, 2000);
  } else {
    startNfcScanning();
  }
}

/**
 * Disconnect WebSocket cleanly, checking readyState to avoid errors
 */
function disconnectNfcWebSocket() {
  if (nfcState.websocket) {
    // Only close if open or connecting (not already closing/closed)
    if (nfcState.websocket.readyState === WebSocket.OPEN || 
        nfcState.websocket.readyState === WebSocket.CONNECTING) {
      nfcState.websocket.close(1000, 'Scan completed');
    }
    nfcState.websocket = null;
  }
}

/**
 * Start NFC scanning using WebSocket (same approach as automatic.js)
 * This provides instant card detection instead of HTTP polling
 */
async function startNfcScanning() {
  // Don't restart if already scanning
  if (nfcState.scanning) return;
  
  // Don't connect if already connected or connecting
  if (nfcState.websocket && 
      (nfcState.websocket.readyState === WebSocket.OPEN || 
       nfcState.websocket.readyState === WebSocket.CONNECTING)) {
    console.log('WebSocket already connected or connecting');
    return;
  }
  
  nfcState.scanning = true;
  nfcState.isProcessingCard = false;
  setNfcScanningUI(true);
  showNfcStatus('Connecting to card reader...', 'info');
  
  try {
    // Clean up any existing websocket first
    disconnectNfcWebSocket();
    
    // Connect via WebSocket for instant card detection
    console.log('🔌 Connecting to NFC WebSocket (employees modal)...');
    nfcState.websocket = new WebSocket(WS_URL);
    
    nfcState.websocket.onopen = () => {
      console.log('✅ NFC WebSocket connected (employees modal)');
      if (nfcState.scanning) {
        showNfcStatus('Place NFC card on reader...', 'info');
      }
    };
    
    nfcState.websocket.onmessage = async (event) => {
      // Ignore messages if not scanning or already processing
      if (!nfcState.scanning || nfcState.isProcessingCard) return;
      
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'card_scanned' && data.uid) {
          // Set processing flag to prevent duplicate handling
          nfcState.isProcessingCard = true;
          
          const uid = String(data.uid).toUpperCase();
          console.log('📇 Card scanned in employees modal:', uid);
          
          playScanSound();
          nfcState.scannedUid = uid;
          
          // Update the display with scanned UID
          updateNfcDisplay(uid);
          updateNfcDeleteButton(uid);
          
          showNfcStatus(`Card detected: ${uid}`, 'success');
          
          // Stop scanning and disconnect WebSocket after successful scan
          stopNfcScanning();
          
          // Show hint after a brief pause
          setTimeout(() => {
            if (!nfcState.scanning) {
              showNfcStatus('Click Save to assign this card', 'info');
            }
          }, 1500);
          
        } else if (data.type === 'connected') {
          console.log('📡 NFC Scanner ready:', data.message);
          if (data.nfc_available) {
            showNfcStatus('Place NFC card on reader...', 'info');
          } else {
            showNfcStatus('Card reader not available', 'warning');
            stopNfcScanning();
          }
        } else if (data.type === 'error') {
          console.error('NFC Error:', data.error);
          showNfcStatus('Scanner error: ' + data.error, 'error');
        }
      } catch (e) {
        console.error('Failed to parse NFC WebSocket message:', e);
      }
    };
    
    nfcState.websocket.onclose = (event) => {
      console.log('🔌 NFC WebSocket disconnected:', event.code, event.reason);
      // Only show warning if we were expecting to be scanning
      if (nfcState.scanning && !nfcState.isProcessingCard) {
        showNfcStatus('Connection lost. Click Scan to retry.', 'warning');
        nfcState.scanning = false;
        setNfcScanningUI(false);
      }
      nfcState.websocket = null;
    };
    
    nfcState.websocket.onerror = (error) => {
      console.error('NFC WebSocket error:', error);
      if (nfcState.scanning) {
        showNfcStatus('Cannot connect to card reader', 'error');
        nfcState.scanning = false;
        setNfcScanningUI(false);
      }
    };
    
  } catch (err) {
    console.error('NFC WebSocket connection error:', err);
    showNfcStatus('Scanner not connected', 'error');
    nfcState.scanning = false;
    nfcState.isProcessingCard = false;
    setNfcScanningUI(false);
  }
}

/**
 * Stop NFC scanning and disconnect WebSocket
 */
function stopNfcScanning() {
  nfcState.scanning = false;
  nfcState.isProcessingCard = false;
  setNfcScanningUI(false);
  
  // Disconnect WebSocket cleanly
  disconnectNfcWebSocket();
}

async function handleDeleteNfc() {
  const empId = nfcState.currentEmployeeId;
  const currentUid = $('#editEmployeeNfc').value;
  const empName = $('#editEmployeeName').value;
  
  if (!currentUid) {
    showNfcStatus('No NFC card to remove', 'warning');
    setTimeout(hideNfcStatus, 2000);
    return;
  }
  
  const confirmed = await confirmModal({
    title: 'Remove NFC Card',
    message: `Are you sure you want to remove the NFC card from "${empName}"?\n\nUID: ${currentUid}\n\nThis action cannot be undone.`,
    confirmText: 'Remove',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
  
  if (!confirmed) return;
  
  const btn = $('#deleteNfcBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  
  try {
    await deleteNFC(empId);
    playSuccessSound();
    
    // Update display
    updateNfcDisplay('');
    updateNfcDeleteButton('');
    nfcState.scannedUid = null;
    
    showNfcStatus('NFC card removed successfully', 'success');
    
    // Refresh employee list in background
    await refresh();
    
    setTimeout(() => hideNfcStatus(), 2000);
  } catch (err) {
    playErrorSound();
    showNfcStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = !$('#editEmployeeNfc').value;
  }
}

async function saveNfcWithConflictHandling(empId, uid, empName) {
  // Check if this NFC card is already assigned to a different employee
  const existingEmployee = state.employees.find(e => e.nfc_uid === uid && e.id !== empId);
  
  if (existingEmployee) {
    const confirmReassign = await confirmModal({
      title: 'NFC Card Already Assigned',
      message: `This NFC card is currently assigned to "${existingEmployee.name}".\n\nDo you want to reassign it to "${empName}"?\n\nThis will remove it from ${existingEmployee.name}.`,
      confirmText: 'Reassign',
      cancelText: 'Cancel',
      confirmVariant: 'warning',
      icon: '⚠️'
    });
    
    if (!confirmReassign) {
      throw new Error('Cancelled by user');
    }
  }
  
  // Check if current employee already has a different card
  const currentEmployee = state.employees.find(e => e.id === empId);
  if (currentEmployee && currentEmployee.nfc_uid && currentEmployee.nfc_uid !== uid) {
    const confirmOverwrite = await confirmModal({
      title: 'Overwrite Existing Card',
      message: `"${empName}" already has an NFC card (UID: ${currentEmployee.nfc_uid}).\n\nDo you want to replace it with the new card?`,
      confirmText: 'Overwrite',
      cancelText: 'Cancel',
      confirmVariant: 'warning',
      icon: '⚠️'
    });
    
    if (!confirmOverwrite) {
      throw new Error('Cancelled by user');
    }
  }
  
  // Save the NFC assignment
  await saveNFC(empId, uid);
}

function wireCardEvents() {
  // Checkbox selection
  $all('.employee-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      updateBulkDeleteButton();
    });
  });
}

function updateBulkDeleteButton() {
  const bulkBtn = $('#enrBulkDeleteBtn');
  if (!bulkBtn) return;
  
  const count = state.selectedIds.size;
  if (count > 0) {
    bulkBtn.innerHTML = `<i class="fas fa-trash-alt"></i><span>Delete Selected (${count})</span>`;
    bulkBtn.disabled = false;
  } else {
    bulkBtn.innerHTML = '<i class="fas fa-trash-alt"></i><span>Delete Selected</span>';
    bulkBtn.disabled = true;
  }
}

function wireToolbar() {
  const createBtn = $('#enrCreateBtn');
  const bulkBtn = $('#enrBulkDeleteBtn');
  const searchBox = $('#employeeSearch');
  const statusFilter = $('#statusFilter');
  const locationFilter = $('#locationFilter');

  // Search functionality
  searchBox?.addEventListener('input', () => {
    state.query = searchBox.value;
    renderTable();
  });

  // Status filter
  statusFilter?.addEventListener('change', () => {
    state.status = statusFilter.value;
    renderTable();
  });

  // Location filter
  locationFilter?.addEventListener('change', () => {
    state.location = locationFilter.value;
    renderTable();
  });

  // Wire up the modern modal
  wireCreateEmployeeModal();

  if (createBtn) {
    createBtn.addEventListener('click', () => {
      showCreateEmployeeModal();
    });
  }

  bulkBtn?.addEventListener('click', async () => {
    const ids = Array.from(state.selectedIds);
    
    if (!ids.length) { 
      notify('❌ Select at least one employee', true); 
      return; 
    }
    
    const confirmed = await confirmBulkDelete(ids.length, 'employees');
    if (!confirmed) return;
    
    const originalText = bulkBtn.innerHTML;
    bulkBtn.disabled = true;
    bulkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Deleting...</span>';
    
    try {
      const result = await bulkDeleteEmployees(ids);
      notify(`✅ Successfully deleted ${result.deleted} employee(s)`);
      state.selectedIds.clear();
      await refresh();
    } catch (e) {
      console.error('Bulk delete failed:', e);
      notify('❌ Bulk delete failed: ' + e.message, true);
    } finally {
      bulkBtn.innerHTML = originalText;
      updateBulkDeleteButton();
    }
  });
  
  updateBulkDeleteButton();
}

function showCreateEmployeeModal() {
  const modal = $('#createEmployeeModal');
  const nameInput = $('#employeeName');
  const locationInput = $('#employeeLocation');
  const statusInput = $('#employeeStatus');
  
  if (!modal || !nameInput) {
    console.warn('[Enrollment] Create modal elements not found, trying to wire again');
    wireCreateEmployeeModal();
    return;
  }
  
  // Reset form
  nameInput.value = '';
  if (statusInput) statusInput.value = 'active';
  
  // Set default location (first available or empty)
  const defaultLocation = state.locations.length > 0 ? state.locations[0] : null;
  if (locationInput) {
    locationInput.value = defaultLocation?.name || '';
  }
  // Native selects handle display automatically - no need for separate dropdown update
  
  // Show modal using class (matches CSS)
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  
  // Focus the name input after a small delay to ensure the modal is visible
  setTimeout(() => {
    nameInput.focus();
  }, 100);
}

function hideCreateEmployeeModal() {
  const modal = $('#createEmployeeModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Confirmation modal functions (following the same pattern as create employee modal)
function confirmBulkDelete(count, itemType = 'items') {
  return confirmModal({
    title: 'Bulk Delete Confirmation',
    message: `You are about to permanently delete ${count} ${itemType} and all their related attendance logs. This action cannot be undone.`,
    confirmText: `Delete ${count} ${itemType}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: 'fa-trash-alt'
  });
}

function confirmDelete(itemName, itemType = 'item') {
  return confirmModal({
    title: 'Delete Confirmation',
    message: `Are you sure you want to delete ${itemType} "${itemName}" and all related attendance logs? This action cannot be undone.`,
    confirmText: `Delete ${itemType}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: 'fa-trash-alt'
  });
}

function wireCreateEmployeeModal() {
  const modal = $('#createEmployeeModal');
  const closeBtn = $('#closeModal');
  const cancelBtn = $('#cancelCreate');
  const confirmBtn = $('#confirmCreate');
  const nameInput = $('#employeeName');
  
  // Silently return if modal elements aren't ready yet
  if (!modal || !closeBtn || !cancelBtn || !confirmBtn || !nameInput) {
    return;
  }
  
  // Close modal events
  closeBtn.addEventListener('click', hideCreateEmployeeModal);
  cancelBtn.addEventListener('click', hideCreateEmployeeModal);
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideCreateEmployeeModal();
  });
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      hideCreateEmployeeModal();
    }
  });
  
  // Handle form submission
  confirmBtn.addEventListener('click', async () => {
    const name = $('#employeeName').value.trim();
    const location = $('#employeeLocation').value;
    const status = $('#employeeStatus').value;
    
    if (!name) {
      notify('❌ Please enter an employee name', true);
      nameInput.focus();
      return;
    }
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Creating...';
    
    try {
      await createEmployee({ name, location, status });
      notify('✅ Employee created successfully');
      hideCreateEmployeeModal();
      await refresh();
    } catch (e) {
      console.error('Create employee failed:', e);
      notify('❌ Create failed: ' + e.message, true);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Create Employee';
    }
  });
  
  // Handle Enter key in name input
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      confirmBtn.click();
    }
  });
}

function notify(msg, isErr = false) {
  let n = document.getElementById('enrToast');
  if (!n) {
    n = document.createElement('div');
    n.id = 'enrToast';
    n.style.position = 'fixed';
    n.style.right = '20px';
    n.style.bottom = '20px';
    n.style.padding = '12px 18px';
    n.style.borderRadius = '10px';
    n.style.background = 'var(--toast-bg, #2d3436)';
    n.style.color = 'white';
    n.style.zIndex = '10000';
    n.style.fontWeight = '500';
    n.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    n.style.transition = 'all 0.3s ease';
    n.style.transform = 'translateY(100px)';
    n.style.opacity = '0';
    document.body.appendChild(n);
  }
  n.textContent = msg;
  n.style.background = isErr ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 'linear-gradient(135deg, #27ae60, #2d3436)';
  n.style.transform = 'translateY(0)';
  n.style.opacity = '1';
  
  // Auto-hide after 3 seconds
  setTimeout(() => { 
    n.style.transform = 'translateY(100px)';
    n.style.opacity = '0';
  }, 3000);
}

export async function refresh() {
  let useSampleData = false;
  
  try {
    // Fetch employees and their clock status in parallel
    const [employeeData, statusData] = await Promise.all([
      getEmployees(),
      getEmployeesWithStatus().catch(() => []) // Don't fail if status fetch fails
    ]);
    
    // Check if we got valid employee data
    if (!employeeData || (Array.isArray(employeeData) && employeeData.length === 0)) {
      console.warn('[Enrollment] No employees found or connection issue');
      useSampleData = true;
    } else {
      state.employees = Array.isArray(employeeData) ? employeeData : [];
      
      // Build clock status map from status data
      state.clockStatus = {};
      if (Array.isArray(statusData)) {
        statusData.forEach(emp => {
          state.clockStatus[emp.id] = emp.status || 'unknown';
        });
      }
    }
  } catch (error) {
    console.error('[Enrollment] Failed to load employees:', error);
    useSampleData = true;
  }
  
  // Use sample data if needed
  if (useSampleData) {
    notify('⚠️ Connection failed - Using sample data', true);
    
    state.employees = [
      {
        id: 1,
        name: 'Sample Employee 1',
        employee_code: 'EMP001',
        location: 'UK',
        status: 'active',
        nfc_uid: 'SAMPLE001'
      },
      {
        id: 2,
        name: 'Sample Employee 2',
        employee_code: 'EMP002',
        location: 'FR',
        status: 'active',
        nfc_uid: 'SAMPLE002'
      },
      {
        id: 3,
        name: 'Sample Employee 3 (Inactive)',
        employee_code: 'EMP003',
        location: 'UK',
        status: 'inactive',
        nfc_uid: ''
      }
    ];
  }
  
  renderTable();
}

export async function init() {
  showToast('Preparing employee interface...', 'info');
  
  // Wait for DOM to be ready
  await new Promise(resolve => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  });
  
  // Add a small delay to ensure the DOM elements are fully rendered
  // This is needed because the HTML is dynamically loaded by the router
  await new Promise(resolve => setTimeout(resolve, 100));
  
  showToast('Checking database status...', 'info');
  // Check if tables exist (quick status check)
  try {
    const status = await checkAttendanceTablesStatus();
    if (!status.all_tables_exist) {
      console.warn('Attendance tables do not exist, initializing...', status.tables_status);
      showToast('Initializing database tables...', 'info');
      const initResult = await initializeAttendanceTables();
      if (initResult.status === 'success') {
        showToast(`✅ Tables ready: ${initResult.tables.join(', ')}`, 'success');
      } else {
        showToast('❌ Failed to initialize tables: ' + initResult.message, 'error');
      }
    }
  } catch (error) {
    console.error('Error checking/initializing tables:', error);
    // Continue loading - tables may still work
  }
  
  showToast('Loading work locations...', 'info');
  // Load locations for dropdowns
  await loadLocations();
  
  wireToolbar();
  wireEditModalEvents();
  wireCreateLocationModal();
  wireGuideModal();
  initFilterSelects();
  
  showToast('Loading employee records...', 'info');
  await refresh();
}

// Wire guide modal open/close
function wireGuideModal() {
  const guideModal = $('#guideModal');
  const openGuideBtn = $('#openGuideBtn');
  const closeGuideBtn = $('#closeGuideBtn');

  openGuideBtn?.addEventListener('click', () => {
    if (guideModal) {
      guideModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  });

  closeGuideBtn?.addEventListener('click', () => {
    if (guideModal) {
      guideModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Close on overlay click
  guideModal?.addEventListener('click', (e) => {
    if (e.target === guideModal) {
      guideModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
}

// ===== Location Management Functions =====

/**
 * Load locations from the API and populate all location dropdowns
 */
async function loadLocations() {
  try {
    // First ensure the locations table exists
    await initLocations();
    
    // Then fetch all locations
    const locations = await getLocations();
    state.locations = Array.isArray(locations) ? locations : [];
    
    // Get unique country codes
    state.countryCodes = [...new Set(state.locations.map(l => l.country_code))].sort();
    
    // Populate all location dropdowns
    populateLocationDropdowns();
  } catch (error) {
    console.error('[Locations] Failed to load locations:', error);
    // Use default locations as fallback
    state.locations = [
      { id: 1, name: 'Birmingham', city_code: 'BHX', country_code: 'UK' },
      { id: 2, name: 'Paris', city_code: 'CDG', country_code: 'FR' }
    ];
    state.countryCodes = ['FR', 'UK'];
    populateLocationDropdowns();
  }
}

/**
 * Populate all location dropdowns with current locations
 */
function populateLocationDropdowns() {
  // Populate filter country select
  const countrySelect = $('#countryFilter');
  if (countrySelect) {
    const currentValue = countrySelect.value;
    countrySelect.innerHTML = `
      <option value="">All Countries</option>
      ${state.countryCodes.map(code => `
        <option value="${code}">${code}</option>
      `).join('')}
    `;
    if (currentValue) countrySelect.value = currentValue;
  }
  
  // Populate filter location select
  const locationSelect = $('#locationFilter');
  if (locationSelect) {
    const currentValue = locationSelect.value;
    locationSelect.innerHTML = `
      <option value="">All Locations</option>
      ${state.locations.map(loc => `
        <option value="${loc.name}">${loc.name}</option>
      `).join('')}
    `;
    if (currentValue) locationSelect.value = currentValue;
  }
  
  // Populate filter city code select
  const cityCodeSelect = $('#citycodeFilter');
  if (cityCodeSelect) {
    const currentValue = cityCodeSelect.value;
    cityCodeSelect.innerHTML = `
      <option value="">All City Codes</option>
      ${state.locations.map(loc => `
        <option value="${loc.city_code}">${loc.city_code}</option>
      `).join('')}
    `;
    if (currentValue) cityCodeSelect.value = currentValue;
  }
  
  // Populate create employee location select
  populateLocationSelect('employeeLocation');
  
  // Populate edit employee location select
  populateLocationSelect('editEmployeeLocation');
}

/**
 * Populate a specific location select (for create/edit employee modals)
 */
function populateLocationSelect(selectId) {
  const selectEl = $(`#${selectId}`);
  if (!selectEl) return;
  
  const currentValue = selectEl.value || '';
  
  selectEl.innerHTML = `
    <option value="" disabled>Select Location</option>
    ${state.locations.map(loc => {
      const displayText = `${loc.country_code} | ${loc.name} | ${loc.city_code}`;
      return `<option value="${loc.name}"${loc.name === currentValue ? ' selected' : ''}>${displayText}</option>`;
    }).join('')}
  `;
}

/**
 * Select a location in a native select by location name
 * @param {string} selectId - The ID of the native select element
 * @param {string} name - The location name to select
 */
function selectLocationByName(selectId, name) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  const location = state.locations.find(l => l.name === name);
  if (!location) return;
  
  select.value = location.name;
}

/**
 * Open the create location modal
 * @param {string} returnTo - 'create' or 'edit' - which employee modal to return to
 */
window.openCreateLocationModal = function(returnTo) {
  state.returnToModal = returnTo;
  
  // Close the employee modal temporarily
  if (returnTo === 'create') {
    $('#createEmployeeModal')?.classList.remove('active');
  } else if (returnTo === 'edit') {
    $('#editEmployeeModal')?.classList.remove('active');
  }
  
  // Reset and show the location modal
  $('#newLocationName').value = '';
  $('#newLocationCityCode').value = '';
  $('#newLocationCountryCode').value = '';
  $('#createLocationModal')?.classList.add('active');
  
  // Focus the name input
  setTimeout(() => $('#newLocationName')?.focus(), 100);
};

/**
 * Close the location modal and return to the previous modal
 */
function closeLocationModal(newLocationName = null) {
  $('#createLocationModal')?.classList.remove('active');
  
  const returnTo = state.returnToModal;
  state.returnToModal = null;
  
  if (returnTo === 'create') {
    $('#createEmployeeModal')?.classList.add('active');
    if (newLocationName) {
      selectLocationByName('employeeLocation', newLocationName);
    }
  } else if (returnTo === 'edit') {
    $('#editEmployeeModal')?.classList.add('active');
    if (newLocationName) {
      selectLocationByName('editEmployeeLocation', newLocationName);
    }
  }
}

/**
 * Wire up the create location modal events
 */
function wireCreateLocationModal() {
  const modal = $('#createLocationModal');
  const closeBtn = $('#closeLocationModal');
  const cancelBtn = $('#cancelLocationModal');
  const confirmBtn = $('#confirmLocationCreate');
  const nameInput = $('#newLocationName');
  const cityCodeInput = $('#newLocationCityCode');
  const countryCodeInput = $('#newLocationCountryCode');
  
  if (!modal) return;
  
  // Close modal events
  closeBtn?.addEventListener('click', () => closeLocationModal());
  cancelBtn?.addEventListener('click', () => closeLocationModal());
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLocationModal();
  });
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeLocationModal();
    }
  });
  
  // Handle form submission
  confirmBtn?.addEventListener('click', async () => {
    const name = nameInput?.value.trim();
    const cityCode = cityCodeInput?.value.trim().toUpperCase();
    const countryCode = countryCodeInput?.value.trim().toUpperCase();
    
    if (!name) {
      notify('❌ Please enter a location name', true);
      nameInput?.focus();
      return;
    }
    
    if (!cityCode) {
      notify('❌ Please enter a city code', true);
      cityCodeInput?.focus();
      return;
    }
    
    if (cityCode.length < 2 || cityCode.length > 10) {
      notify('❌ City code must be 2-10 characters', true);
      cityCodeInput?.focus();
      return;
    }
    
    if (!countryCode) {
      notify('❌ Please enter a country code', true);
      countryCodeInput?.focus();
      return;
    }
    
    if (countryCode.length < 2 || countryCode.length > 5) {
      notify('❌ Country code must be 2-5 characters', true);
      countryCodeInput?.focus();
      return;
    }
    
    // Check if location name already exists
    if (state.locations.some(l => l.name.toLowerCase() === name.toLowerCase())) {
      notify('❌ A location with this name already exists', true);
      nameInput?.focus();
      return;
    }
    
    // Check if city code already exists
    if (state.locations.some(l => l.city_code === cityCode)) {
      notify('❌ A location with this city code already exists', true);
      cityCodeInput?.focus();
      return;
    }
    
    confirmBtn.disabled = true;
    const originalHTML = confirmBtn.innerHTML;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Creating...</span>';
    
    try {
      const newLocation = await createLocation({ 
        name, 
        city_code: cityCode, 
        country_code: countryCode 
      });
      
      // Add to state
      state.locations.push(newLocation);
      
      // Update country codes if this is a new country
      if (!state.countryCodes.includes(countryCode)) {
        state.countryCodes.push(countryCode);
        state.countryCodes.sort();
      }
      
      // Refresh all dropdowns
      populateLocationDropdowns();
      
      notify(`✅ Location "${name}" created successfully`);
      
      // Close and return to previous modal with new location selected
      closeLocationModal(name);
      
    } catch (error) {
      console.error('[Locations] Failed to create location:', error);
      notify('❌ Failed to create location: ' + error.message, true);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHTML;
    }
  });
  
  // Handle Enter key in inputs
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      cityCodeInput?.focus();
    }
  });
  
  cityCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      countryCodeInput?.focus();
    }
  });
  
  countryCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn?.click();
    }
  });
}
