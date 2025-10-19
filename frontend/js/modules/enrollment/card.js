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
  const uidBox = $('#cardUid');
  status.textContent = '🕐 Waiting for card tap...';
  uidBox.value = '';

  try {
    const res = await scanCard();
    if (res.status === 'scanned' && res.uid) {
      cache.scannedUid = res.uid;
      uidBox.value = res.uid;
      status.textContent = '✅ UID scanned';
    } else {
      status.textContent = `❌ ${res.detail || 'Failed to read card UID'}`;
    }
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  }
}

async function onSave() {
  const status = $('#cardStatus');
  const empId = Number($('#cardEmployee')?.value || 0);
  if (!empId) { status.textContent = '❌ Select an employee first'; return; }
  if (!cache.scannedUid) { status.textContent = '❌ Scan a card first'; return; }

  try {
    await saveCard(empId, cache.scannedUid);
    status.textContent = '✅ UID saved to employee';
    cache.scannedUid = null;
    $('#cardUid').value = '';
    window.dispatchEvent(new Event('reloadEmployees'));
  } catch (e) {
    status.textContent = '❌ ' + e.message;
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
