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
};

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

// ===== Custom Dropdown Functions =====
// Exposed on window so onclick attributes in HTML can access them

window.toggleDropdown = function(id) {
  const dropdown = document.getElementById(id);
  if (!dropdown) return;
  
  // Close other dropdowns
  document.querySelectorAll('.custom-dropdown').forEach(d => {
    if (d.id !== id) d.classList.remove('open');
  });
  dropdown.classList.toggle('open');
};

window.selectOption = function(element, dropdownId, value, text) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = text;
  if (hiddenInput) hiddenInput.value = value;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
  
  // Trigger filter update for status dropdown
  if (dropdownId === 'status-dropdown') {
    filterEmployees();
  }
};

// ===== Linked Filter Dropdown Functions =====

/**
 * Select a country code filter - clears location and city code filters
 */
window.selectCountryFilter = async function(element, countryCode) {
  const dropdown = document.getElementById('country-dropdown');
  if (!dropdown) return;
  
  // Update dropdown display
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = countryCode || 'All Countries';
  if (hiddenInput) hiddenInput.value = countryCode;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
  
  // When selecting a country, clear the other linked filters
  resetLocationDropdown();
  resetCityCodeDropdown();
  
  state.countryCode = countryCode;
  state.location = '';
  state.cityCode = '';
  
  filterEmployees();
};

/**
 * Select a location filter - auto-fills city code and country code
 */
window.selectLocationFilter = async function(element, locationName) {
  const dropdown = document.getElementById('location-dropdown');
  if (!dropdown) return;
  
  // Update dropdown display
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = locationName || 'All Locations';
  if (hiddenInput) hiddenInput.value = locationName;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
  
  if (locationName) {
    // Find the location and auto-fill the other filters
    const location = state.locations.find(l => l.name === locationName);
    if (location) {
      // Auto-fill country code dropdown
      setCountryDropdownValue(location.country_code);
      // Auto-fill city code dropdown
      setCityCodeDropdownValue(location.city_code);
      
      state.location = locationName;
      state.cityCode = location.city_code;
      state.countryCode = location.country_code;
    }
  } else {
    // Clearing location - clear other filters too
    resetCountryDropdown();
    resetCityCodeDropdown();
    
    state.location = '';
    state.cityCode = '';
    state.countryCode = '';
  }
  
  filterEmployees();
};

/**
 * Select a city code filter - auto-fills location and country code
 */
window.selectCityCodeFilter = async function(element, cityCode) {
  const dropdown = document.getElementById('citycode-dropdown');
  if (!dropdown) return;
  
  // Update dropdown display
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = cityCode || 'All City Codes';
  if (hiddenInput) hiddenInput.value = cityCode;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
  
  if (cityCode) {
    // Find the location by city code and auto-fill the other filters
    const location = state.locations.find(l => l.city_code === cityCode);
    if (location) {
      // Auto-fill country code dropdown
      setCountryDropdownValue(location.country_code);
      // Auto-fill location dropdown
      setLocationDropdownValue(location.name);
      
      state.cityCode = cityCode;
      state.location = location.name;
      state.countryCode = location.country_code;
    }
  } else {
    // Clearing city code - clear other filters too
    resetCountryDropdown();
    resetLocationDropdown();
    
    state.location = '';
    state.cityCode = '';
    state.countryCode = '';
  }
  
  filterEmployees();
};

// Helper functions to set dropdown values without triggering filters
function setCountryDropdownValue(countryCode) {
  const dropdown = document.getElementById('country-dropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = countryCode;
  if (hiddenInput) hiddenInput.value = countryCode;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === countryCode);
  });
}

function setLocationDropdownValue(locationName) {
  const dropdown = document.getElementById('location-dropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = locationName;
  if (hiddenInput) hiddenInput.value = locationName;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === locationName);
  });
}

function setCityCodeDropdownValue(cityCode) {
  const dropdown = document.getElementById('citycode-dropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = cityCode;
  if (hiddenInput) hiddenInput.value = cityCode;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === cityCode);
  });
}

function resetCountryDropdown() {
  const dropdown = document.getElementById('country-dropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = 'All Countries';
  if (hiddenInput) hiddenInput.value = '';
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === '');
  });
}

function resetLocationDropdown() {
  const dropdown = document.getElementById('location-dropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = 'All Locations';
  if (hiddenInput) hiddenInput.value = '';
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === '');
  });
}

function resetCityCodeDropdown() {
  const dropdown = document.getElementById('citycode-dropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = 'All City Codes';
  if (hiddenInput) hiddenInput.value = '';
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === '');
  });
}

// Filter employees based on current dropdown values
function filterEmployees() {
  const statusInput = document.querySelector('#status-dropdown input[type="hidden"]');
  const locationInput = document.querySelector('#location-dropdown input[type="hidden"]');
  const cityCodeInput = document.querySelector('#citycode-dropdown input[type="hidden"]');
  const countryCodeInput = document.querySelector('#country-dropdown input[type="hidden"]');
  
  state.status = statusInput?.value || '';
  state.location = locationInput?.value || '';
  state.cityCode = cityCodeInput?.value || '';
  state.countryCode = countryCodeInput?.value || '';
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
    const clockBtnClass = isClockedIn ? 'clock-out-btn' : 'clock-in-btn';
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
      <button class="clock-toggle-btn ${clockBtnClass}" 
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
  
  // Reset NFC state
  const nfcUid = cardEl.dataset.nfc || '';
  nfcState.scanning = false;
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
  
  // Update custom dropdown displays - use selectLocationByName for location dropdown
  selectLocationByName('edit-location-dropdown', cardEl.dataset.location);
  updateDropdownDisplay('edit-status-dropdown', cardEl.dataset.status);
  
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

// Helper to update custom dropdown display
function updateDropdownDisplay(dropdownId, value) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const options = dropdown.querySelectorAll('.dropdown-option');
  const selected = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  options.forEach(opt => {
    // Check if this option matches the value
    const onclick = opt.getAttribute('onclick') || '';
    const isMatch = onclick.includes(`'${value}'`);
    
    if (isMatch) {
      opt.classList.add('selected');
      if (selected) selected.textContent = opt.textContent;
      if (hiddenInput) hiddenInput.value = value;
    } else {
      opt.classList.remove('selected');
    }
  });
}

// Helper to reset custom dropdown to default
function resetDropdownDisplay(dropdownId, value, displayText) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const options = dropdown.querySelectorAll('.dropdown-option');
  const selected = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  // Reset display
  if (selected) selected.textContent = displayText;
  if (hiddenInput) hiddenInput.value = value;
  
  // Reset selected state
  options.forEach(opt => {
    const onclick = opt.getAttribute('onclick') || '';
    if (onclick.includes(`'${value}'`)) {
      opt.classList.add('selected');
    } else {
      opt.classList.remove('selected');
    }
  });
  
  // Close dropdown if open
  dropdown.classList.remove('open');
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

async function startNfcScanning() {
  if (nfcState.scanning) return;
  
  nfcState.scanning = true;
  setNfcScanningUI(true);
  showNfcStatus('Place NFC card on reader...', 'info');
  
  while (nfcState.scanning) {
    try {
      const result = await tryNfcScan(1);
      
      if (!nfcState.scanning) break;
      
      if (result && result.status === 'success' && result.uid) {
        playScanSound();
        nfcState.scannedUid = result.uid;
        
        // Update the display with scanned UID
        updateNfcDisplay(result.uid);
        updateNfcDeleteButton(result.uid);
        
        showNfcStatus(`Card detected: ${result.uid}`, 'success');
        
        // Brief pause after successful scan
        await new Promise(r => setTimeout(r, 1000));
        showNfcStatus('Tap another card or click Save', 'info');
      } else {
        // No card detected, continue polling
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('NFC scan error:', err);
      showNfcStatus('Scanner not connected', 'error');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function stopNfcScanning() {
  nfcState.scanning = false;
  setNfcScanningUI(false);
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

  createBtn?.addEventListener('click', () => {
    showCreateEmployeeModal();
  });

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
    locationInput.value = defaultLocation?.code || '';
  }
  
  // Reset custom dropdowns to defaults
  if (defaultLocation) {
    selectLocationByCode('create-location-dropdown', defaultLocation.code);
  } else {
    const dropdown = $('#create-location-dropdown');
    const selectedDisplay = dropdown?.querySelector('.dropdown-selected');
    if (selectedDisplay) selectedDisplay.textContent = 'Select Location';
    if (locationInput) locationInput.value = '';
  }
  resetDropdownDisplay('create-status-dropdown', 'active', 'Active');
  
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
  
  // Load locations for dropdowns
  await loadLocations();
  
  wireToolbar();
  wireEditModalEvents();
  wireCreateLocationModal();
  wireGuideModal();
  wireDropdownClose();
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

// Close dropdowns when clicking outside
function wireDropdownClose() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
      document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
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
  // Populate filter country dropdown
  const filterCountryOptions = $('#filter-country-options');
  if (filterCountryOptions) {
    filterCountryOptions.innerHTML = `
      <div class="dropdown-option selected" data-value="" onclick="window.selectCountryFilter(this, '')">All Countries</div>
      ${state.countryCodes.map(code => `
        <div class="dropdown-option" data-value="${code}" onclick="window.selectCountryFilter(this, '${code}')">${code}</div>
      `).join('')}
    `;
  }
  
  // Populate filter location dropdown
  const filterLocationOptions = $('#filter-location-options');
  if (filterLocationOptions) {
    filterLocationOptions.innerHTML = `
      <div class="dropdown-option selected" data-value="" onclick="window.selectLocationFilter(this, '')">All Locations</div>
      ${state.locations.map(loc => `
        <div class="dropdown-option" data-value="${loc.name}" onclick="window.selectLocationFilter(this, '${loc.name}')">${loc.name}</div>
      `).join('')}
    `;
  }
  
  // Populate filter city code dropdown
  const filterCityCodeOptions = $('#filter-citycode-options');
  if (filterCityCodeOptions) {
    filterCityCodeOptions.innerHTML = `
      <div class="dropdown-option selected" data-value="" onclick="window.selectCityCodeFilter(this, '')">All City Codes</div>
      ${state.locations.map(loc => `
        <div class="dropdown-option" data-value="${loc.city_code}" onclick="window.selectCityCodeFilter(this, '${loc.city_code}')">${loc.city_code}</div>
      `).join('')}
    `;
  }
  
  // Populate create employee dropdown
  populateLocationDropdown('create-location-dropdown', 'create-location-options', 'employeeLocation');
  
  // Populate edit employee dropdown
  populateLocationDropdown('edit-location-dropdown', 'edit-location-options', 'editEmployeeLocation');
}

/**
 * Populate a specific location dropdown (for create/edit employee modals)
 */
function populateLocationDropdown(dropdownId, optionsId, hiddenInputId) {
  const optionsContainer = $(`#${optionsId}`);
  if (!optionsContainer) return;
  
  const currentValue = $(`#${hiddenInputId}`)?.value || '';
  
  optionsContainer.innerHTML = `
    ${state.locations.map(loc => {
      const displayText = `${loc.country_code} | ${loc.name} | ${loc.city_code}`;
      return `
        <div class="dropdown-option${loc.name === currentValue ? ' selected' : ''}" 
             onclick="selectOption(this, '${dropdownId}', '${loc.name}', '${displayText}')">${displayText}</div>
      `;
    }).join('')}
    <div class="dropdown-option create-new-option" onclick="window.openCreateLocationModal('${dropdownId.includes('create') ? 'create' : 'edit'}')">
      <i class="fas fa-plus-circle"></i> Create New Location
    </div>
  `;
  
  // Update the selected display if there's a current value
  const dropdown = $(`#${dropdownId}`);
  const selectedDisplay = dropdown?.querySelector('.dropdown-selected');
  if (currentValue && selectedDisplay) {
    const location = state.locations.find(l => l.name === currentValue);
    if (location) {
      selectedDisplay.textContent = `${location.country_code} | ${location.name} | ${location.city_code}`;
    }
  }
}

/**
 * Select a location in a dropdown by name
 */
function selectLocationByName(dropdownId, name) {
  const dropdown = $(`#${dropdownId}`);
  if (!dropdown) return;
  
  const location = state.locations.find(l => l.name === name);
  if (!location) return;
  
  const displayText = `${location.country_code} | ${location.name} | ${location.city_code}`;
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  const options = dropdown.querySelectorAll('.dropdown-option');
  
  if (selectedDisplay) selectedDisplay.textContent = displayText;
  if (hiddenInput) hiddenInput.value = location.name;
  
  options.forEach(opt => {
    const isMatch = opt.textContent.trim() === displayText;
    opt.classList.toggle('selected', isMatch);
  });
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
      selectLocationByName('create-location-dropdown', newLocationName);
    }
  } else if (returnTo === 'edit') {
    $('#editEmployeeModal')?.classList.add('active');
    if (newLocationName) {
      selectLocationByName('edit-location-dropdown', newLocationName);
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
