// js/modules/enrollment/fingerprint.js
import { getEmployees,
    scanFingerprintBackend,
    saveFingerprint } from '../../services/api/enrollmentApi.js';


let state = { employees: [], templateB64: null };

function $(sel) { return document.querySelector(sel); }

function fillEmployeeSelect() {
  const sel = $('#fpEmployee');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select an employee...</option>';
  state.employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = String(e.id);
    opt.textContent = `${e.name} (${e.employee_code || '—'})`;
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

async function tryLocalSecuGen(timeoutMs = 6000) {
  const endpoints = [
    'https://localhost:8443/SGIFPCapture',
    'https://127.0.0.1:8443/SGIFPCapture',
    'https://localhost:8080/SGIFPCapture',
    'https://127.0.0.1:8080/SGIFPCapture',
    'http://localhost:8080/SGIFPCapture',
    'http://127.0.0.1:8080/SGIFPCapture',
  ];
  const payload = { Timeout: 10000, TemplateFormat: 'ANSI', FakeDetection: 1 };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const results = await Promise.any(endpoints.map(u => (async () => {
      const r = await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      j.__endpoint = u;
      return j;
    })()));
    return results;
  } finally {
    clearTimeout(t);
  }
}

async function onScan() {
  const status = $('#fpStatus');
  status.value = '📡 Scanning via local WebAPI...';
  const preview = document.getElementById('fingerprintPreview');

  try {
    const data = await tryLocalSecuGen(6000);
    if (data && data.ErrorCode === 0) {
      state.templateB64 = data.TemplateBase64;
      if (preview) preview.src = 'data:image/bmp;base64,' + data.BMPBase64;
      status.value = `✅ Captured via ${data.__endpoint}`;
      return;
    }
    const code = data?.ErrorCode ?? 'unknown';
    status.value = `⚠️ Local capture failed (${explain(code)}). Falling back...`;
  } catch {
    status.value = '⚠️ Local capture unavailable. Falling back...';
  }

  // backend fallback
  try {
    const fb = await scanFingerprintBackend();
    if (fb.status === 'scanned' && fb.template_b64) {
      state.templateB64 = fb.template_b64;
      if (preview) preview.src = ''; // backend doesn’t provide BMP
      status.value = '✅ Captured via backend fallback';
    } else {
      status.value = `❌ ${fb.detail || 'Backend fallback failed'}`;
    }
  } catch (e) {
    status.value = '❌ ' + e.message;
  }
}

async function onSave() {
  const status = $('#fpStatus');
  const empId = Number($('#fpEmployee')?.value || 0);
  if (!empId) { status.value = '❌ Select an employee first'; return; }
  if (!state.templateB64) { status.value = '❌ No captured template'; return; }

  try {
    await saveFingerprint(empId, state.templateB64);
    status.value = '✅ Fingerprint saved';
    state.templateB64 = null;
    $('#fpTemplate') && ($('#fpTemplate').value = '');
    
    // Clear the preview
    const preview = document.getElementById('fingerprintPreview');
    const placeholder = document.getElementById('fpPreviewPlaceholder');
    if (preview) {
      preview.style.display = 'none';
      preview.src = '';
    }
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.textContent = 'Fingerprint image will appear here after scanning';
    }
    
    window.dispatchEvent(new Event('reloadEmployees'));
  } catch (e) {
    status.value = '❌ ' + e.message;
  }
}

export async function init() {
  // load employees
  try {
    state.employees = await getEmployees();
    fillEmployeeSelect();
  } catch { /* ignore */ }

  $('#scanFpBtn')?.addEventListener('click', onScan);
  $('#saveFpBtn')?.addEventListener('click', onSave);
}
