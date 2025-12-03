// js/modules/enrollment/card.js
import { getEmployees, scanCard, saveCard } from '../../services/api/enrollmentApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';

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
      startScanningLoop();
    } else {
      console.log('ℹ️ Employee deselected');
      if (statusText) statusText.textContent = 'Please select an employee to begin enrollment';
      if (status) status.setAttribute('data-status', 'ready');
      stopScanningLoop();
      // Clear scanned NFC when deselecting employee
      resetCardDisplay();
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

async function tryLocalCardScan(timeoutSeconds = 1) {
  const localEndpoints = [
    'http://127.0.0.1:8080/card/scan',
    'http://localhost:8080/card/scan'
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

  if (statusText) statusText.textContent = 'Saving NFC assignment...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    const result = await saveCard(empId, cache.scannedUid);
    
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
    
    // Reset all fields
    cache.scannedUid = null;
    resetCardDisplay();
    $('#cardEmployee').value = '';
    
    // Reload employee data
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
