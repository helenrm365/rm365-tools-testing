// js/modules/enrollment/fingerprint.js// js/modules/enrollment/fingerprint.js// js/modules/enrollment/fingerprint.js



import { getEmployees, scanFingerprintBackend, saveFingerprint } from '../../services/api/enrollmentApi.js';import { getEmployees,import { getEmployees,



let state = { employees: [], templateB64: null };    scanFingerprintBackend,    scanFingerprintBackend,



function $(sel) { return document.querySelector(sel); }    saveFingerprint } from '../../services/api/enrollmentApi.js';    saveFingerprint } from '../../services/api/enrollmentApi.js';



function fillEmployeeSelect() {

  const sel = $('#fpEmployee');

  if (!sel) return;

  sel.innerHTML = '<option value="">Select an employee...</option>';

  state.employees.forEach(e => {let state = { employees: [], templateB64: null };let state = { employees: [], templateB64: null };

    const opt = document.createElement('option');

    opt.value = String(e.id);

    opt.textContent = `${e.name} (${e.employee_code || '—'})`;

    sel.appendChild(opt);function $(sel) { return document.querySelector(sel); }function $(sel) { return document.querySelector(sel); }

  });

}



function explain(code) {function fillEmployeeSelect() {function fillEmployeeSelect() {

  const map = {

    0: 'ok',  const sel = $('#fpEmployee');  const sel = $('#fpEmployee');

    54: 'timeout (no finger)',

    55: 'device not found',  if (!sel) return;  if (!sel) return;

    10001: 'license missing/invalid',

    10002: 'domain not licensed',  sel.innerHTML = '<option value="">Select an employee...</option>';  sel.innerHTML = '<option value="">Select an employee...</option>';

    10004: 'missing/invalid Origin',

  };  state.employees.forEach(e => {  state.employees.forEach(e => {

  return map[code] || `code ${code}`;

}    const opt = document.createElement('option');    const opt = document.createElement('option');



async function tryLocalSecuGen(timeoutMs = 6000) {    opt.value = String(e.id);    opt.value = String(e.id);

  const endpoints = [

    'https://localhost:8443/SGIFPCapture',    opt.textContent = `${e.name} (${e.employee_code || '—'})`;    opt.textContent = `${e.name} (${e.employee_code || '—'})`;

    'https://127.0.0.1:8443/SGIFPCapture',

    'https://localhost:8080/SGIFPCapture',    sel.appendChild(opt);    sel.appendChild(opt);

    'https://127.0.0.1:8080/SGIFPCapture',

  ];  });  });



  const payload = {}}

    Timeout: 5000,

    Quality: 60,

    licstr: '',

    templateFormat: 'ISO',function explain(code) {function explain(code) {

  };

  const map = {  const map = {

  const ac = new AbortController();

  const t = setTimeout(() => ac.abort(), timeoutMs);    0: 'ok',    0: 'ok',

  try {

    const results = await Promise.allSettled(endpoints.map(u => (async () => {    54: 'timeout (no finger)',    54: 'timeout (no finger)',

      const r = await fetch(u, {

        method: 'POST',    55: 'device not found',    55: 'device not found',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify(payload),    10001: 'license missing/invalid',    10001: 'license missing/invalid',

        signal: ac.signal,

        cache: 'no-store',    10002: 'domain not licensed',    10002: 'domain not licensed',

      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);    10004: 'missing/invalid Origin',    10004: 'missing/invalid Origin',

      const j = await r.json();

      j.__endpoint = u;  };  };

      return j;

    })()));  return map[code] || `code ${code}`;  return map[code] || `code ${code}`;

    

    // Find the first successful result}}

    for (const result of results) {

      if (result.status === 'fulfilled' && result.value?.ErrorCode === 0) {

        return result.value;

      }async function tryLocalSecuGen(timeoutMs = 6000) {async function tryLocalSecuGen(timeoutMs = 6000) {

    }

      const endpoints = [  const endpoints = [

    // If no success, return first fulfilled result (even if error)

    for (const result of results) {    'https://localhost:8443/SGIFPCapture',    'https://localhost:8443/SGIFPCapture',

      if (result.status === 'fulfilled') {

        return result.value;    'https://127.0.0.1:8443/SGIFPCapture',    'https://127.0.0.1:8443/SGIFPCapture',

      }

    }    'https://localhost:8080/SGIFPCapture',    'https://localhost:8080/SGIFPCapture',

    

    throw new Error('All endpoints failed');    'https://127.0.0.1:8080/SGIFPCapture',    'https://127.0.0.1:8080/SGIFPCapture',

  } finally {

    clearTimeout(t);    'http://localhost:8080/SGIFPCapture',    'http://localhost:8080/SGIFPCapture',

  }

}    'http://127.0.0.1:8080/SGIFPCapture',    'http://127.0.0.1:8080/SGIFPCapture',



async function onScan() {  ];  ];

  const status = $('#fpStatus');

  const statusText = status?.querySelector('.status-message');  const payload = { Timeout: 10000, TemplateFormat: 'ANSI', FakeDetection: 1 };  const payload = { Timeout: 10000, TemplateFormat: 'ANSI', FakeDetection: 1 };

  const preview = $('#fingerprintPreview');

  const previewContainer = $('#fpPreviewContainer');

  const placeholder = $('#fpPreviewPlaceholder');

  const ac = new AbortController();  const ac = new AbortController();

  if (statusText) statusText.textContent = 'Scanning via local WebAPI...';

  if (status) status.setAttribute('data-status', 'scanning');  const t = setTimeout(() => ac.abort(), timeoutMs);  const t = setTimeout(() => ac.abort(), timeoutMs);



  try {

    const data = await tryLocalSecuGen(6000);

    if (data && data.ErrorCode === 0) {  try {  try {

      state.templateB64 = data.TemplateBase64;

          const results = await Promise.any(endpoints.map(u => (async () => {    const results = await Promise.any(endpoints.map(u => (async () => {

      // Update preview

      if (preview && data.BMPBase64) {      const r = await fetch(u, {      const r = await fetch(u, {

        preview.src = 'data:image/bmp;base64,' + data.BMPBase64;

        preview.classList.add('visible');        method: 'POST',        method: 'POST',

      }

      if (placeholder) placeholder.style.display = 'none';        headers: { 'Content-Type': 'application/json' },        headers: { 'Content-Type': 'application/json' },

      if (previewContainer) previewContainer.classList.add('has-image');

              body: JSON.stringify(payload),        body: JSON.stringify(payload),

      if (statusText) statusText.textContent = `Captured via ${data.__endpoint?.replace(/^https?:\/\//, '')}`;

      if (status) status.setAttribute('data-status', 'success');        signal: ac.signal,        signal: ac.signal,

      return;

    }        cache: 'no-store',        cache: 'no-store',

    const code = data?.ErrorCode ?? 'unknown';

    if (statusText) statusText.textContent = `Local capture failed (${explain(code)}). Falling back...`;      });      });

    if (status) status.setAttribute('data-status', 'warning');

  } catch {      if (!r.ok) throw new Error(`HTTP ${r.status}`);      if (!r.ok) throw new Error(`HTTP ${r.status}`);

    if (statusText) statusText.textContent = 'Local capture unavailable. Falling back...';

    if (status) status.setAttribute('data-status', 'warning');      const j = await r.json();      const j = await r.json();

  }

      j.__endpoint = u;      j.__endpoint = u;

  // backend fallback

  try {      return j;      return j;

    const fb = await scanFingerprintBackend();

    if (fb.status === 'scanned' && fb.template_b64) {    })()));    })()));

      state.templateB64 = fb.template_b64;

          return results;    return results;

      // Backend doesn't provide BMP preview

      if (preview) {  } finally {  } finally {

        preview.src = '';

        preview.classList.remove('visible');    clearTimeout(t);    clearTimeout(t);

      }

      if (placeholder) placeholder.style.display = 'flex';  }  }

      if (previewContainer) previewContainer.classList.remove('has-image');

      }}

      if (statusText) statusText.textContent = 'Captured via backend fallback';

      if (status) status.setAttribute('data-status', 'success');

    } else {

      if (statusText) statusText.textContent = fb.detail || 'Backend fallback failed';async function onScan() {async function onScan() {

      if (status) status.setAttribute('data-status', 'error');

    }  const status = $('#fpStatus');  const status = $('#fpStatus');

  } catch (e) {

    if (statusText) statusText.textContent = e.message;  const statusText = status?.querySelector('.status-message');  status.value = '📡 Scanning via local WebAPI...';

    if (status) status.setAttribute('data-status', 'error');

  }  const preview = $('#fingerprintPreview');  const preview = document.getElementById('fingerprintPreview');

}

  const previewContainer = $('#fpPreviewContainer');

async function onSave() {

  const status = $('#fpStatus');  const placeholder = $('#fpPreviewPlaceholder');  try {

  const statusText = status?.querySelector('.status-message');

  const empId = $('#fpEmployee')?.value;    const data = await tryLocalSecuGen(6000);



  if (!state.templateB64) {  if (statusText) statusText.textContent = 'Scanning via local WebAPI...';    if (data && data.ErrorCode === 0) {

    alert('No fingerprint scanned yet.');

    return;  if (status) status.setAttribute('data-status', 'scanning');      state.templateB64 = data.TemplateBase64;

  }

  if (!empId) {      if (preview) preview.src = 'data:image/bmp;base64,' + data.BMPBase64;

    alert('Please select an employee.');

    return;  try {      status.value = `✅ Captured via ${data.__endpoint}`;

  }

    const data = await tryLocalSecuGen(6000);      return;

  if (statusText) statusText.textContent = 'Saving...';

  if (status) status.setAttribute('data-status', 'scanning');    if (data && data.ErrorCode === 0) {    }



  try {      state.templateB64 = data.TemplateBase64;    const code = data?.ErrorCode ?? 'unknown';

    await saveFingerprint(Number(empId), state.templateB64);

    if (statusText) statusText.textContent = 'Fingerprint saved successfully!';          status.value = `⚠️ Local capture failed (${explain(code)}). Falling back...`;

    if (status) status.setAttribute('data-status', 'success');

          // Update preview  } catch {

    // Reset after 2 seconds

    setTimeout(() => {      if (preview && data.BMPBase64) {    status.value = '⚠️ Local capture unavailable. Falling back...';

      state.templateB64 = null;

      $('#fpEmployee').value = '';        preview.src = 'data:image/bmp;base64,' + data.BMPBase64;  }

      const preview = $('#fingerprintPreview');

      const placeholder = $('#fpPreviewPlaceholder');        preview.classList.add('visible');

      const previewContainer = $('#fpPreviewContainer');

            }  // backend fallback

      if (preview) {

        preview.src = '';      if (placeholder) placeholder.style.display = 'none';  try {

        preview.classList.remove('visible');

      }      if (previewContainer) previewContainer.classList.add('has-image');    const fb = await scanFingerprintBackend();

      if (placeholder) placeholder.style.display = 'flex';

      if (previewContainer) previewContainer.classList.remove('has-image');          if (fb.status === 'scanned' && fb.template_b64) {

      

      if (statusText) statusText.textContent = 'Ready to scan';      if (statusText) statusText.textContent = `Captured via ${data.__endpoint?.replace(/^https?:\/\//, '')}`;      state.templateB64 = fb.template_b64;

      if (status) status.setAttribute('data-status', 'ready');

    }, 2000);      if (status) status.setAttribute('data-status', 'success');      if (preview) preview.src = ''; // backend doesn’t provide BMP

  } catch (e) {

    if (statusText) statusText.textContent = `Save failed: ${e.message}`;      return;      status.value = '✅ Captured via backend fallback';

    if (status) status.setAttribute('data-status', 'error');

  }    }    } else {

}

    const code = data?.ErrorCode ?? 'unknown';      status.value = `❌ ${fb.detail || 'Backend fallback failed'}`;

export async function init() {

  // load employees    if (statusText) statusText.textContent = `Local capture failed (${explain(code)}). Falling back...`;    }

  try {

    state.employees = await getEmployees();    if (status) status.setAttribute('data-status', 'warning');  } catch (e) {

    fillEmployeeSelect();

  } catch (err) {  } catch {    status.value = '❌ ' + e.message;

    console.error('Failed to load employees:', err);

  }    if (statusText) statusText.textContent = 'Local capture unavailable. Falling back...';  }



  $('#scanFpBtn')?.addEventListener('click', onScan);    if (status) status.setAttribute('data-status', 'warning');}

  $('#saveFpBtn')?.addEventListener('click', onSave);

    }

  // Initialize status

  const status = $('#fpStatus');async function onSave() {

  const statusText = status?.querySelector('.status-message');

  if (statusText) statusText.textContent = 'Ready to scan';  // backend fallback  const status = $('#fpStatus');

  if (status) status.setAttribute('data-status', 'ready');

}  try {  const empId = Number($('#fpEmployee')?.value || 0);


    const fb = await scanFingerprintBackend();  if (!empId) { status.value = '❌ Select an employee first'; return; }

    if (fb.status === 'scanned' && fb.template_b64) {  if (!state.templateB64) { status.value = '❌ No captured template'; return; }

      state.templateB64 = fb.template_b64;

        try {

      // Backend doesn't provide BMP, show success without image    await saveFingerprint(empId, state.templateB64);

      if (preview) preview.classList.remove('visible');    status.value = '✅ Fingerprint saved';

      if (placeholder) {    state.templateB64 = null;

        placeholder.style.display = 'flex';    $('#fpTemplate') && ($('#fpTemplate').value = '');

        const placeholderText = placeholder.querySelector('.preview-placeholder-text');    

        if (placeholderText) placeholderText.textContent = 'Captured via backend (no preview available)';    // Clear the preview

      }    const preview = document.getElementById('fingerprintPreview');

      if (previewContainer) previewContainer.classList.add('has-image');    const placeholder = document.getElementById('fpPreviewPlaceholder');

          if (preview) {

      if (statusText) statusText.textContent = 'Captured via backend fallback';      preview.style.display = 'none';

      if (status) status.setAttribute('data-status', 'success');      preview.src = '';

    } else {    }

      if (statusText) statusText.textContent = fb.detail || 'Backend fallback failed';    if (placeholder) {

      if (status) status.setAttribute('data-status', 'error');      placeholder.style.display = 'block';

    }      placeholder.textContent = 'Fingerprint image will appear here after scanning';

  } catch (e) {    }

    if (statusText) statusText.textContent = e.message || 'Scan failed';    

    if (status) status.setAttribute('data-status', 'error');    window.dispatchEvent(new Event('reloadEmployees'));

  }  } catch (e) {

}    status.value = '❌ ' + e.message;

  }

async function onSave() {}

  const status = $('#fpStatus');

  const statusText = status?.querySelector('.status-message');export async function init() {

  const empId = Number($('#fpEmployee')?.value || 0);  // load employees

    try {

  if (!empId) {     state.employees = await getEmployees();

    if (statusText) statusText.textContent = 'Please select an employee first';    fillEmployeeSelect();

    if (status) status.setAttribute('data-status', 'error');  } catch { /* ignore */ }

    return;

  }  $('#scanFpBtn')?.addEventListener('click', onScan);

  if (!state.templateB64) {   $('#saveFpBtn')?.addEventListener('click', onSave);

    if (statusText) statusText.textContent = 'No captured template';}

    if (status) status.setAttribute('data-status', 'error');
    return;
  }

  if (statusText) statusText.textContent = 'Saving fingerprint...';
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    await saveFingerprint(empId, state.templateB64);
    if (statusText) statusText.textContent = 'Fingerprint saved successfully';
    if (status) status.setAttribute('data-status', 'success');
    state.templateB64 = null;
    
    // Clear preview
    const preview = $('#fingerprintPreview');
    const previewContainer = $('#fpPreviewContainer');
    const placeholder = $('#fpPreviewPlaceholder');
    const fpTemplate = $('#fpTemplate');
    
    if (preview) {
      preview.classList.remove('visible');
      preview.src = '';
    }
    if (placeholder) {
      placeholder.style.display = 'flex';
      const placeholderText = placeholder.querySelector('.preview-placeholder-text');
      if (placeholderText) placeholderText.textContent = 'Fingerprint will appear here';
    }
    if (previewContainer) previewContainer.classList.remove('has-image');
    if (fpTemplate) fpTemplate.value = '';
    
    $('#fpEmployee').value = '';
    window.dispatchEvent(new Event('reloadEmployees'));
    
    // Reset to ready after 3 seconds
    setTimeout(() => {
      if (statusText) statusText.textContent = 'Ready to scan';
      if (status) status.setAttribute('data-status', 'ready');
    }, 3000);
  } catch (e) {
    if (statusText) statusText.textContent = e.message || 'Failed to save fingerprint';
    if (status) status.setAttribute('data-status', 'error');
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
  
  // Initialize status
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  if (statusText) statusText.textContent = 'Ready to scan';
  if (status) status.setAttribute('data-status', 'ready');
}
