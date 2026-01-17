// js/modules/attendance-system/employees.js
// Employee management with clock in/out functionality
import { getEmployees,
    createEmployee, updateEmployee, deleteEmployee,
    bulkDeleteEmployees, saveNFC, deleteNFC } from '../../services/api/enrollmentApi.js';
import { checkAttendanceTablesStatus, initializeAttendanceTables, clockEmployee, getEmployeesWithStatus } from '../../services/api/attendanceApi.js';
import { confirmModal } from '../../ui/confirmationModal.js';
import { showToast } from '../../ui/toast.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';


let state = {
  employees: [],
  clockStatus: {}, // Map of employee_id -> 'in' | 'out' | 'unknown'
  query: '',
  status: '',
  location: '',
  selectedIds: new Set(),
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
  
  // Trigger filter update for filter dropdowns
  if (dropdownId === 'status-dropdown' || dropdownId === 'location-dropdown') {
    filterEmployees();
  }
};

// Filter employees based on current dropdown values
function filterEmployees() {
  const statusInput = document.querySelector('#status-dropdown input[type="hidden"]');
  const locationInput = document.querySelector('#location-dropdown input[type="hidden"]');
  
  state.status = statusInput?.value || '';
  state.location = locationInput?.value || '';
  renderTable();
}

// Expose for potential external use
window.filterEmployees = filterEmployees;

function renderTable() {
  const grid = $('#enrEmployeeGrid');
  if (!grid) return;

  const rows = state.employees
    .filter(e => !state.status || (e.status || 'active').toLowerCase() === state.status)
    .filter(e => !state.location || (e.location || '').toUpperCase() === state.location)
    .filter(e => {
      const q = state.query.trim().toLowerCase();
      if (!q) return true;
      const hay = `${e.name} ${e.employee_code} ${e.location || ''} ${e.nfc_uid || ''}`.toLowerCase();
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
    
    return `
    <div class="employee-card clickable" 
         data-id="${e.id}"
         data-name="${e.name || ''}"
         data-code="${e.employee_code || ''}"
         data-location="${e.location || 'UK'}"
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
          <span class="location-badge">${e.location || 'N/A'}</span>
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
  
  // Update custom dropdown displays
  updateDropdownDisplay('edit-location-dropdown', cardEl.dataset.location);
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
  if (locationInput) locationInput.value = 'UK';
  if (statusInput) statusInput.value = 'active';
  
  // Reset custom dropdowns to defaults
  resetDropdownDisplay('create-location-dropdown', 'UK', 'United Kingdom (UK)');
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
  
  wireToolbar();
  wireEditModalEvents();
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
