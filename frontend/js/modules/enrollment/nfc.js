// js/modules/enrollment/nfc.js
import { getEmployees, scanNFC, saveNFC, deleteNFC } from '../../services/api/enrollmentApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';
import { confirmModal } from '../../ui/confirmationModal.js';

let cache = { employees: [], scannedUid: null };
let scanLoopActive = false;
let currentScanAbort = null;

function $(sel) { return document.querySelector(sel); }

function fillEmployeeSelect() {
  const sel = $('#cardEmployee');
  if (!sel) {
    console.error('❌ Employee select element not found (#cardEmployee)');
    return;
  }
  
  console.log('📋 Filling employee select with', cache.employees.length, 'employees');
  sel.innerHTML = '<option value="">Select an employee...</option>';
  cache.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = String(e.id);
    opt.textContent = `${e.name} (${e.employee_code || '—'})`;
    sel.appendChild(opt);
  });
  
  // Remove any existing listener to prevent duplicates
  const newSelect = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSelect, sel);
  
  // Add change listener to start/stop scanning loop
  newSelect.addEventListener('change', (e) => {
    const empId = e.target.value;
    const status = $('#cardStatus');
    const statusText = status?.querySelector('.status-message');
    
    console.log('👤 Employee selection changed:', empId);
    
    if (empId) {
      const emp = cache.employees.find(em => String(em.id) === empId);
      console.log('✅ Employee selected:', emp?.name);
      if (statusText) statusText.textContent = `Employee selected: ${emp?.name || 'Unknown'}. Waiting for NFC tap...`;
      if (status) status.setAttribute('data-status', 'ready');
      
      // Show existing card section if employee has a card
      showExistingCard(emp);
      
      startScanningLoop();
    } else {
      console.log('ℹ️ Employee deselected');
      if (statusText) statusText.textContent = 'Please select an employee to begin enrollment';
      if (status) status.setAttribute('data-status', 'ready');
      stopScanningLoop();
      // Clear scanned NFC when deselecting employee
      resetCardDisplay();
      // Hide existing card section
      hideExistingCard();
    }
  });
}

function resetCardDisplay() {
  cache.scannedUid = null;
  const uidDisplay = $('#cardUidDisplay');
  const uidBox = $('#cardUid');
  if (uidDisplay) {
    uidDisplay.innerHTML = '<span class="placeholder-text">No NFC scanned yet</span>';
    uidDisplay.classList.remove('has-value');
  }
  if (uidBox) uidBox.value = '';
}

function showExistingCard(employee) {
  const section = $('#existingCardSection');
  const uidDisplay = $('#currentCardUid');
  
  if (employee && employee.nfc_uid) {
    if (uidDisplay) uidDisplay.textContent = employee.nfc_uid;
    if (section) section.style.display = 'block';
  } else {
    hideExistingCard();
  }
}

function hideExistingCard() {
  const section = $('#existingCardSection');
  if (section) section.style.display = 'none';
}

async function onDeleteCard() {
  const empId = Number($('#cardEmployee')?.value || 0);
  if (!empId) return;
  
  const employee = cache.employees.find(e => e.id === empId);
  if (!employee || !employee.nfc_uid) return;
  
  const confirmDelete = await confirmModal({
    title: 'Delete NFC Card',
    message: `Are you sure you want to remove the NFC card from "${employee.name}"?\n\nUID: ${employee.nfc_uid}\n\nThis action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
  
  if (!confirmDelete) return;
  
  try {
    await deleteNFC(empId);
    playSuccessSound();
    
    // Reload employee data
    cache.employees = await getEmployees();
    
    // Update display
    hideExistingCard();
    
    const status = $('#cardStatus');
    const statusText = status?.querySelector('.status-message');
    if (statusText) statusText.textContent = 'NFC card successfully deleted!';
    if (status) status.setAttribute('data-status', 'success');
    
    setTimeout(() => {
      if (statusText) statusText.textContent = `Employee selected: ${employee.name}. Waiting for NFC tap...`;
      if (status) status.setAttribute('data-status', 'ready');
    }, 2000);
  } catch (err) {
    console.error('Failed to delete card:', err);
    playErrorSound();
    const status = $('#cardStatus');
    const statusText = status?.querySelector('.status-message');
    if (statusText) statusText.textContent = `Error: ${err.message}`;
    if (status) status.setAttribute('data-status', 'error');
  }
}

async function tryLocalCardScan(timeoutSeconds = 1) {
  // Determine protocol for hardware bridge based on current page protocol
  const bridgeProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  
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
        cache: 'no-store'
      });
      
      if (response.ok) {
        const res = await response.json();
        return res;
      }
    } catch (e) {
      // Try next endpoint
      continue;
    }
  }
  
  return null;
}

async function startScanningLoop() {
  if (scanLoopActive) {
    console.log('⚠️ NFC scan loop already active');
    return;
  }
  scanLoopActive = true;
  console.log('🔄 Starting NFC scan loop');
  
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  
  while (scanLoopActive) {
    const empId = $('#cardEmployee')?.value;
    if (!empId) {
      console.log('⚠️ No employee selected, stopping scan loop');
      stopScanningLoop();
      break;
    }

    // Update status if we don't have an NFC yet
    if (!cache.scannedUid) {
      if (statusText) statusText.textContent = 'Waiting for NFC tap... Place NFC card/fob on reader.';
      if (status) status.setAttribute('data-status', 'scanning');
    }

    try {
      console.log('🎫 Attempting NFC scan...');
      const result = await tryLocalCardScan(1);
      console.log('📡 NFC scan result:', result);
      
      if (!scanLoopActive) break;

      if (result && result.status === 'success' && result.uid) {
        console.log('✅ NFC card detected:', result.uid);
        playScanSound();
        cache.scannedUid = result.uid;
        
        const uidBox = $('#cardUid');
        const uidDisplay = $('#cardUidDisplay');
        
        if (uidBox) uidBox.value = result.uid;
        if (uidDisplay) {
          uidDisplay.textContent = result.uid;
          uidDisplay.classList.add('has-value');
        }
        
        if (statusText) statusText.textContent = 'NFC scanned! Tap again to re-scan or click Save.';
        if (status) status.setAttribute('data-status', 'success');
        
        // Brief pause after successful scan
        await new Promise(r => setTimeout(r, 1000));
      } else {
        // No card detected or error - continue polling
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('❌ Card scan loop error:', err);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('⏹️ NFC scan loop stopped');
}

function stopScanningLoop() {
  console.log('🛑 Stopping NFC scan loop');
  scanLoopActive = false;
  if (currentScanAbort) {
    currentScanAbort.abort();
    currentScanAbort = null;
  }
}

async function onSave() {
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  const empId = Number($('#cardEmployee')?.value || 0);
  
  if (!empId) { 
    if (statusText) statusText.textContent = 'Error: Please select an employee first';
    if (status) status.setAttribute('data-status', 'error');
    playErrorSound();
    return;
  }
  if (!cache.scannedUid) { 
    if (statusText) statusText.textContent = 'Error: Please scan NFC first';
    if (status) status.setAttribute('data-status', 'error');
    playErrorSound();
    return;
  }

  // Check if employee already has an NFC card assigned
  const employee = cache.employees.find(e => e.id === empId);
  
  // Check if this NFC card is already assigned to a different employee
  const existingEmployee = cache.employees.find(e => e.nfc_uid === cache.scannedUid && e.id !== empId);
  
  // Scenario 1: Both selected employee has a card AND scanned card belongs to another employee
  if (employee && employee.nfc_uid && existingEmployee) {
    const confirmBothOverwrite = await confirmModal({
      title: 'Overwrite & Reassign NFC Card',
      message: `"${employee.name}" already has an NFC card (UID: ${employee.nfc_uid}).\n\nThe scanned card is currently assigned to "${existingEmployee.name}" (${existingEmployee.employee_code || 'No code'}).\n\nDo you want to:\n• Remove the current card from "${employee.name}"\n• Reassign the scanned card from "${existingEmployee.name}" to "${employee.name}"?`,
      confirmText: 'Overwrite & Reassign',
      cancelText: 'Cancel',
      confirmVariant: 'warning',
      icon: '⚠️'
    });
    if (!confirmBothOverwrite) {
      if (statusText) statusText.textContent = 'Enrollment cancelled';
      if (status) status.setAttribute('data-status', 'ready');
      return;
    }
  }
  // Scenario 2: Only selected employee has a different card
  else if (employee && employee.nfc_uid) {
    const confirmOverwrite = await confirmModal({
      title: 'Overwrite NFC Card',
      message: `Employee "${employee.name}" already has an NFC card assigned (UID: ${employee.nfc_uid}).\n\nDo you want to overwrite it with the new card?`,
      confirmText: 'Overwrite',
      cancelText: 'Cancel',
      confirmVariant: 'warning',
      icon: '⚠️'
    });
    if (!confirmOverwrite) {
      if (statusText) statusText.textContent = 'Enrollment cancelled';
      if (status) status.setAttribute('data-status', 'ready');
      return;
    }
  }
  // Scenario 3: Only the scanned card belongs to another employee
  else if (existingEmployee) {
    const confirmReassign = await confirmModal({
      title: 'NFC Card Already Assigned',
      message: `This NFC card is currently assigned to "${existingEmployee.name}" (${existingEmployee.employee_code || 'No code'}).\n\nDo you want to reassign it to "${employee.name}"?\n\nThis will remove it from ${existingEmployee.name}.`,
      confirmText: 'Reassign',
      cancelText: 'Cancel',
      confirmVariant: 'warning',
      icon: '⚠️'
    });
    if (!confirmReassign) {
      if (statusText) statusText.textContent = 'Enrollment cancelled';
      if (status) status.setAttribute('data-status', 'ready');
      return;
    }
  }

  if (statusText) statusText.textContent = 'Saving NFC assignment...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    const result = await saveNFC(empId, cache.scannedUid);
    
    // Check if the backend returned an error
    if (result && result.status === 'error') {
      playErrorSound();
      if (statusText) statusText.textContent = `Error: ${result.detail || 'Failed to save NFC'}`;
      if (status) status.setAttribute('data-status', 'error');
      return;
    }
    
    playSuccessSound();
    if (statusText) statusText.textContent = 'NFC successfully assigned to employee!';
    if (status) status.setAttribute('data-status', 'success');
    
    // Stop scanning loop
    stopScanningLoop();
    
    // Reload employee data from server to get fresh data (removes cached stale data)
    try {
      cache.employees = await getEmployees();
      console.log('✅ Reloaded employees after save');
    } catch (err) {
      console.error('❌ Failed to reload employees:', err);
    }
    
    // Reset all fields
    cache.scannedUid = null;
    resetCardDisplay();
    
    // Reset employee dropdown
    const empSelect = $('#cardEmployee');
    if (empSelect) {
      empSelect.value = '';
      // Trigger change event to update UI properly
      empSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Notify other modules to reload
    window.dispatchEvent(new Event('reloadEmployees'));
    
    // Reset to ready state after brief delay
    setTimeout(() => {
      if (statusText) statusText.textContent = 'Please select an employee to begin enrollment';
      if (status) status.setAttribute('data-status', 'ready');
    }, 2000);
  } catch (e) {
    playErrorSound();
    if (statusText) statusText.textContent = `Error: ${e.message}`;
    if (status) status.setAttribute('data-status', 'error');
  }
}

export async function init() {
  console.log('🎫 Initializing NFC enrollment page');
  
  // Load employees
  try {
    console.log('📡 Fetching employees...');
    cache.employees = await getEmployees();
    console.log('✅ Loaded', cache.employees.length, 'employees');
    fillEmployeeSelect();
  } catch (err) {
    console.error('❌ Failed to load employees:', err);
  }
  
  // Only save button needed now (no manual scan button)
  const saveBtn = $('#saveCardBtn');
  if (saveBtn) {
    console.log('✅ Save button found, attaching listener');
    saveBtn.addEventListener('click', onSave);
  } else {
    console.error('❌ Save button not found (#saveCardBtn)');
  }
  
  // Delete button for existing card
  const deleteBtn = $('#deleteCardBtn');
  if (deleteBtn) {
    console.log('✅ Delete button found, attaching listener');
    deleteBtn.addEventListener('click', onDeleteCard);
  } else {
    console.error('❌ Delete button not found (#deleteCardBtn)');
  }
  
  // Set initial status
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  if (statusText) {
    statusText.textContent = 'Please select an employee to begin enrollment';
    console.log('✅ Initial status set');
  } else {
    console.error('❌ Status elements not found');
  }
  if (status) status.setAttribute('data-status', 'ready');
  
  console.log('✅ NFC enrollment page initialization complete');
}
