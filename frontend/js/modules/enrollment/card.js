// js/modules/enrollment/card.js
import { getEmployees, scanCard, saveCard } from '../../services/api/enrollmentApi.js';

let cache = { employees: [], scannedUid: null };

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
}

async function onScan() {
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  const uidDisplay = $('#cardUidDisplay');
  const uidBox = $('#cardUid');
  
  if (statusText) statusText.textContent = 'Waiting for card tap...';
  if (status) status.setAttribute('data-status', 'scanning');
  if (uidDisplay) {
    uidDisplay.innerHTML = '<span class="placeholder-text">Scanning...</span>';
    uidDisplay.classList.remove('has-value');
  }
  if (uidBox) uidBox.value = '';

  try {
    const res = await scanCard();
    if (res.status === 'scanned' && res.uid) {
      cache.scannedUid = res.uid;
      if (uidBox) uidBox.value = res.uid;
      if (uidDisplay) {
        uidDisplay.textContent = res.uid;
        uidDisplay.classList.add('has-value');
      }
      if (statusText) statusText.textContent = 'Card scanned successfully';
      if (status) status.setAttribute('data-status', 'success');
    } else {
      if (uidDisplay) {
        uidDisplay.innerHTML = '<span class="placeholder-text">No card scanned yet</span>';
        uidDisplay.classList.remove('has-value');
      }
      if (statusText) statusText.textContent = res.detail || 'Failed to read card UID';
      if (status) status.setAttribute('data-status', 'error');
    }
  } catch (e) {
    if (uidDisplay) {
      uidDisplay.innerHTML = '<span class="placeholder-text">No card scanned yet</span>';
      uidDisplay.classList.remove('has-value');
    }
    if (statusText) statusText.textContent = e.message;
    if (status) status.setAttribute('data-status', 'error');
  }
}

async function onSave() {
  const status = $('#cardStatus');
  const statusText = status?.querySelector('.status-message');
  const empId = Number($('#cardEmployee')?.value || 0);
  
  if (!empId) { 
    if (statusText) statusText.textContent = 'Please select an employee first';
    if (status) status.setAttribute('data-status', 'error');
    return;
  }
  if (!cache.scannedUid) { 
    if (statusText) statusText.textContent = 'Please scan a card first';
    if (status) status.setAttribute('data-status', 'error');
    return;
  }

  if (statusText) statusText.textContent = 'Saving assignment...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    await saveCard(empId, cache.scannedUid);
    if (statusText) statusText.textContent = 'Card successfully assigned to employee';
    if (status) status.setAttribute('data-status', 'success');
    cache.scannedUid = null;
    
    const uidDisplay = $('#cardUidDisplay');
    const uidBox = $('#cardUid');
    if (uidDisplay) {
      uidDisplay.innerHTML = '<span class="placeholder-text">No card scanned yet</span>';
      uidDisplay.classList.remove('has-value');
    }
    if (uidBox) uidBox.value = '';
    
    $('#cardEmployee').value = '';
    window.dispatchEvent(new Event('reloadEmployees'));
    
    // Reset to ready after 3 seconds
    setTimeout(() => {
      if (statusText) statusText.textContent = 'Ready to scan';
      if (status) status.setAttribute('data-status', 'ready');
    }, 3000);
  } catch (e) {
    if (statusText) statusText.textContent = e.message;
    if (status) status.setAttribute('data-status', 'error');
  }
}

export async function init() {
  // load employees
  try {
    cache.employees = await getEmployees();
    fillEmployeeSelect();
  } catch {
    // ignore
  }
  $('#scanCardBtn')?.addEventListener('click', onScan);
  $('#saveCardBtn')?.addEventListener('click', onSave);
}
