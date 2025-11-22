// frontend/js/modules/enrollment/fingerprint.js
import {
  getEmployees,
  scanFingerprintBackend,
  saveFingerprint,
} from '../../services/api/enrollmentApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';
import { confirmModal } from '../../ui/confirmationModal.js';

const state = { employees: [], templateB64: null };
const $ = (sel) => document.querySelector(sel);

function fillEmployeeSelect() {
  const sel = $('#fpEmployee');
  if (!sel) return;

  sel.innerHTML = '<option value="">Select an employee...</option>';
  state.employees.forEach((employee) => {
    const opt = document.createElement('option');
    opt.value = String(employee.id);
    opt.textContent = `${employee.name} (${employee.employee_code || '-'})`;
    sel.appendChild(opt);
  });
}

function explain(code) {
  const map = {
    0: 'ok',
    54: 'timeout (no finger)',
    55: 'device not found',
    10001: 'license missing/invalid',
    10002: 'domain not licensed',
    10004: 'missing/invalid Origin',
  };
  return map[code] || `code ${code}`;
}

async function tryLocalSecuGen(timeoutMs = 11000) {
  // We are forcing HTTP in the local bridge to avoid SSL certificate issues.
  // Prioritize 127.0.0.1 as it is often treated more favorably by browsers for PNA.
  const endpoints = [
    'http://127.0.0.1:8080/SGIFPCapture',
    'http://localhost:8080/SGIFPCapture',
  ];
  const payload = { Timeout: 10000, TemplateFormat: 'ANSI', FakeDetection: 1 };

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const result = await Promise.any(
      endpoints.map((endpoint) => (async () => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();
        json.__endpoint = endpoint;
        return json;
      })()),
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function onScan() {
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  const preview = $('#fingerprintPreview');
  const placeholder = $('#fpPreviewPlaceholder');
  const templateBox = $('#fpTemplate');

  // Reset any previous scan data
  state.templateB64 = null;
  if (templateBox) templateBox.value = '';
  if (preview) {
    preview.style.display = 'none';
    preview.classList.remove('visible');
    preview.src = '';
  }
  if (placeholder) placeholder.style.display = 'flex';

  if (statusText) statusText.textContent = 'Scanning fingerprint...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    const data = await tryLocalSecuGen(11000);
    if (data && data.ErrorCode === 0) {
      playScanSound();
      state.templateB64 = data.TemplateBase64;
      if (templateBox) templateBox.value = data.TemplateBase64;

      if (data.BMPBase64) {
        if (preview) {
          preview.src = `data:image/bmp;base64,${data.BMPBase64}`;
          preview.style.display = 'block';
          preview.classList.add('visible');
        }
        if (placeholder) placeholder.style.display = 'none';
      }

      if (statusText) statusText.textContent = `Captured via ${data.__endpoint}`;
      if (status) status.setAttribute('data-status', 'success');
      return;
    }

    const code = data?.ErrorCode ?? 'unknown';
    if (statusText) {
      statusText.textContent = `Local capture failed (${explain(code)}). Falling back...`;
    }
    if (status) status.setAttribute('data-status', 'scanning');
  } catch {
    if (statusText) statusText.textContent = 'Local capture unavailable. Falling back...';
    if (status) status.setAttribute('data-status', 'scanning');
  }

  try {
    const fallback = await scanFingerprintBackend();
    if (fallback.status === 'scanned' && fallback.template_b64) {
      state.templateB64 = fallback.template_b64;
      if (templateBox) templateBox.value = fallback.template_b64;

      if (fallback.image_base64 && preview) {
        preview.src = `data:image/png;base64,${fallback.image_base64}`;
        preview.style.display = 'block';
        preview.classList.add('visible');
      }
      if (placeholder) placeholder.style.display = 'none';

      if (statusText) statusText.textContent = 'Captured via backend fallback';
      if (status) status.setAttribute('data-status', 'success');
    } else {
      if (statusText) statusText.textContent = fallback.detail || 'Backend fallback failed';
      if (status) status.setAttribute('data-status', 'error');
    }
  } catch (error) {
    if (statusText) statusText.textContent = error.message;
    if (status) status.setAttribute('data-status', 'error');
  }
}

async function onSave() {
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  const empId = Number($('#fpEmployee')?.value || 0);

  if (!empId) {
    if (statusText) statusText.textContent = 'Please select an employee first';
    if (status) status.setAttribute('data-status', 'error');
    return;
  }

  if (!state.templateB64) {
    if (statusText) statusText.textContent = 'Please scan a fingerprint first';
    if (status) status.setAttribute('data-status', 'error');
    playErrorSound();
    return;
  }

  // Check for existing fingerprint
  const employee = state.employees.find(e => e.id === empId);
  if (employee && employee.has_fingerprint) {
    const confirmOverwrite = await confirmModal({
      title: 'Overwrite Fingerprint',
      message: `Employee "${employee.name}" already has a fingerprint enrolled.\n\nDo you want to overwrite it?`,
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

  if (statusText) statusText.textContent = 'Saving fingerprint...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    await saveFingerprint(empId, state.templateB64);
    playSuccessSound();
    if (statusText) statusText.textContent = 'Fingerprint successfully assigned to employee';
    if (status) status.setAttribute('data-status', 'success');
    
    // Reset everything after successful save
    setTimeout(() => {
      resetForm();
    }, 2000);
  } catch (error) {
    playErrorSound();
    if (statusText) statusText.textContent = error.message;
    if (status) status.setAttribute('data-status', 'error');
  }
}

function resetForm() {
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  const preview = $('#fingerprintPreview');
  const placeholder = $('#fpPreviewPlaceholder');
  const templateBox = $('#fpTemplate');
  const employeeSelect = $('#fpEmployee');

  // Clear state
  state.templateB64 = null;

  // Reset preview
  if (preview) {
    preview.style.display = 'none';
    preview.classList.remove('visible');
    preview.src = '';
  }
  if (placeholder) placeholder.style.display = 'flex';
  if (templateBox) templateBox.value = '';

  // Reset employee selection
  if (employeeSelect) employeeSelect.value = '';

  // Reset status
  if (statusText) statusText.textContent = 'Ready to scan';
  if (status) status.setAttribute('data-status', 'ready');

  // Reload employees to update fingerprint status
  window.dispatchEvent(new Event('reloadEmployees'));
}

export async function init() {
  try {
    state.employees = await getEmployees();
    fillEmployeeSelect();
  } catch {
    /* ignore */
  }

  $('#scanFpBtn')?.addEventListener('click', onScan);
  $('#saveFpBtn')?.addEventListener('click', onSave);
}
