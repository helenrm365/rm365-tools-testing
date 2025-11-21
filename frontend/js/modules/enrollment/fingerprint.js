// frontend/js/modules/enrollment/fingerprint.js
import {
  getEmployees,
  scanFingerprintBackend,
  saveFingerprint,
} from '../../services/api/enrollmentApi.js';

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
  const endpoints = [
    'https://localhost:8080/SGIFPCapture',
    'https://127.0.0.1:8080/SGIFPCapture',
    'http://localhost:8080/SGIFPCapture',
    'http://127.0.0.1:8080/SGIFPCapture',
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

  if (statusText) statusText.textContent = 'Scanning via local WebAPI...';
  if (status) status.setAttribute('data-status', 'scanning');
  if (preview) preview.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';

  try {
    const data = await tryLocalSecuGen(11000);
    if (data && data.ErrorCode === 0) {
      state.templateB64 = data.TemplateBase64;
      if (templateBox) templateBox.value = data.TemplateBase64;

      if (data.BMPBase64) {
        if (preview) {
          preview.src = `data:image/bmp;base64,${data.BMPBase64}`;
          preview.style.display = 'block';
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
    return;
  }

  if (statusText) statusText.textContent = 'Saving fingerprint...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    await saveFingerprint(empId, state.templateB64);
    if (statusText) statusText.textContent = 'Fingerprint successfully assigned to employee';
    if (status) status.setAttribute('data-status', 'success');
    state.templateB64 = null;

    const preview = $('#fingerprintPreview');
    const placeholder = $('#fpPreviewPlaceholder');
    const templateBox = $('#fpTemplate');

    if (preview) {
      preview.style.display = 'none';
      preview.src = '';
    }
    if (placeholder) placeholder.style.display = 'flex';
    if (templateBox) templateBox.value = '';

    $('#fpEmployee').value = '';
    window.dispatchEvent(new Event('reloadEmployees'));

    setTimeout(() => {
      if (statusText) statusText.textContent = 'Ready to scan';
      if (status) status.setAttribute('data-status', 'ready');
    }, 3000);
  } catch (error) {
    if (statusText) statusText.textContent = error.message;
    if (status) status.setAttribute('data-status', 'error');
  }
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
