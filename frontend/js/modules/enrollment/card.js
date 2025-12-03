// js/modules/enrollment/card.js
import { getEmployees, scanCard, saveCard } from '../../services/api/enrollmentApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';

let cache = { employees: [], scannedUid: null };
let scanLoopActive = false;
let currentScanAbort = null;

function $(sel) { return document.querySelector(sel); }

function fillEmployeeSelect() {
  const sel = $('#cardEmployee');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select an employee...</option>';
  cache.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = String(e.id);
    opt.textContent = `${e.name} (${e.employee_code || '—'})`;
    sel.appendChild(opt);
  });
  
  // Add change listener to start/stop scanning loop
  sel.addEventListener('change', (e) => {
    const empId = e.target.value;
    const status = $('#cardStatus');
    const statusText = status?.querySelector('.status-message');
    
  if (!empId) {
      const emp = cache.employees.find(em => String(em.id) === empId);
      if (statusText) statusText.textContent = `Employee selected: ${emp?.name || 'Unknown'}. Waiting for NFC tap...`;
      if (status) status.setAttribute('data-status', 'ready');
      startScanningLoop();
    } else {
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
  if (scanLoopActive) return;
  scanLoopActive = true;
  
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  
  while (scanLoopActive) {
    const empId = $('#cardEmployee')?.value;
    if (!empId) {
      stopScanningLoop();
      break;
    }

    // Update status if we don't have an NFC yet
    if (!cache.scannedUid) {
      if (statusText) statusText.textContent = 'Waiting for NFC tap... Place NFC card/fob on reader.';
      if (status) status.setAttribute('data-status', 'scanning');
    }

    try {
      const result = await tryLocalCardScan(1);
      
      if (!scanLoopActive) break;

      if (result && result.status === 'success' && result.uid) {
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
      console.error('Card scan loop error:', err);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function stopScanningLoop() {
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
  // Load employees
  try {
    cache.employees = await getEmployees();
    fillEmployeeSelect();
  } catch (err) {
    console.error('Failed to load employees:', err);
  }
  
  // Only save button needed now (no manual scan button)
  $('#saveCardBtn')?.addEventListener('click', onSave);
  
  // Set initial status
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  if (statusText) statusText.textContent = 'Please select an employee to begin enrollment';
  if (status) status.setAttribute('data-status', 'ready');
}
