// frontend/js/modules/enrollment/fingerprint.js
import {
  getEmployees,
  scanFingerprintBackend,
  saveFingerprint,
  deleteFingerprint,
} from '../../services/api/enrollmentApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';
import { confirmModal } from '../../ui/confirmationModal.js';

const state = { employees: [], templateB64: null, selectedFinger: "Right Thumb" };
const $ = (sel) => document.querySelector(sel);

function selectFinger(fingerName) {
    state.selectedFinger = fingerName;
    
    // Update UI
    document.querySelectorAll('.finger-dot').forEach(dot => {
        if (dot.dataset.finger === fingerName) {
            dot.classList.add('selected');
        } else {
            dot.classList.remove('selected');
        }
    });
    
    const label = $('#selectedFingerName');
    if (label) label.textContent = fingerName;
    
    // Update status message
    const status = $('#fpStatus');
    const statusText = status?.querySelector('.status-message');
    const empId = $('#fpEmployee')?.value;
    
    if (empId && statusText) {
        statusText.textContent = `${fingerName} selected. Place finger on scanner.`;
        // If we were showing a success message from previous scan, maybe we should reset it?
        // But if we just selected a new finger, we probably haven't scanned it yet.
        // Unless we are switching fingers after a scan but before save?
        // If we have a template, switching fingers is dangerous if we don't clear the template.
        // But the user might want to save the *current* template to the *newly selected* finger?
        // "then they can save to the finger they want to."
        // So if I scan (Right Thumb), then click "Left Index", then click "Save", it should save the scan as Left Index.
        // So I should NOT clear the template on finger selection change.
    }
}

function renderFingerprints(employee) {
    const section = $('#existingFingerprintsSection');
    const list = $('#fingerprintList');
    
    // Reset enrolled status on diagram
    document.querySelectorAll('.finger-dot').forEach(dot => dot.classList.remove('enrolled'));

    if (!section || !list) return;

    list.innerHTML = '';
    
    if (!employee || !employee.fingerprints || employee.fingerprints.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    
    employee.fingerprints.forEach(fp => {
        // Mark on diagram
        const dot = document.querySelector(`.finger-dot[data-finger="${fp.name}"]`);
        if (dot) dot.classList.add('enrolled');

        const li = document.createElement('li');
        li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--bg-secondary); border-radius: 0.5rem; border: 1px solid var(--border-color);';
        
        const info = document.createElement('div');
        info.style.display = 'flex; align-items: center; gap: 0.75rem;';
        info.innerHTML = `
            <i class="fas fa-fingerprint" style="color: var(--text-secondary);"></i>
            <span style="font-weight: 500; color: var(--text-primary);">${fp.name}</span>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">(${new Date(fp.created_at).toLocaleDateString()})</span>
        `;
        
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.style.cssText = 'background: none; border: none; color: #ef4444; cursor: pointer; padding: 0.5rem; border-radius: 0.25rem; transition: background 0.2s;';
        delBtn.onmouseover = () => delBtn.style.background = 'rgba(239, 68, 68, 0.1)';
        delBtn.onmouseout = () => delBtn.style.background = 'none';
        delBtn.onclick = async () => {
            if (confirm(`Delete fingerprint "${fp.name}"?`)) {
                try {
                    await deleteFingerprint(fp.id);
                    // Refresh employee data
                    state.employees = await getEmployees();
                    // Re-render (find updated employee)
                    const updatedEmp = state.employees.find(e => e.id === employee.id);
                    renderFingerprints(updatedEmp);
                    playSuccessSound();
                } catch (err) {
                    console.error(err);
                    playErrorSound();
                    alert('Failed to delete fingerprint');
                }
            }
        };
        
        li.appendChild(info);
        li.appendChild(delBtn);
        list.appendChild(li);
    });
}

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

  // Add change listener
  sel.addEventListener('change', (e) => {
      const empId = e.target.value;
      const emp = empId ? state.employees.find(e => String(e.id) === empId) : null;
      renderFingerprints(emp);
      
      // Update status when employee is selected/deselected
      const status = $('#fpStatus');
      const statusText = status?.querySelector('.status-message');
      if (emp) {
        if (statusText) statusText.textContent = `Employee selected: ${emp.name}. Place finger on scanner.`;
        if (status) status.setAttribute('data-status', 'ready');
        startScanningLoop();
      } else {
        if (statusText) statusText.textContent = 'Please select an employee to begin enrollment';
        if (status) status.setAttribute('data-status', 'ready');
        stopScanningLoop();
      }
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

async function tryLocalSecuGen(timeoutMs = 11000, signal = null) {
  // We are forcing HTTP in the local bridge to avoid SSL certificate issues.
  // Prioritize 127.0.0.1 as it is often treated more favorably by browsers for PNA.
  const endpoint = 'http://127.0.0.1:8080/SGIFPCapture';
  const payload = { Timeout: Math.max(1000, timeoutMs - 500), TemplateFormat: 'ANSI', FakeDetection: 1 };

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  
  if (signal) {
      signal.addEventListener('abort', () => ac.abort());
  }

  try {
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
  } finally {
    clearTimeout(timeoutId);
  }
}

let scanLoopActive = false;
let currentScanAbort = null;

async function startScanningLoop() {
    if (scanLoopActive) return;
    scanLoopActive = true;
    
    const status = $('#fpStatus');
    const statusText = status?.querySelector('.status-message');
    const scanBtn = $('#scanFpBtn');
    if (scanBtn) scanBtn.style.display = 'none';
    
    console.log('Starting scan loop...');

    while (scanLoopActive) {
        const empId = $('#fpEmployee')?.value;
        if (!empId) {
            stopScanningLoop();
            break;
        }

        if (statusText && !state.templateB64) {
             statusText.textContent = `Scanning ${state.selectedFinger}... Place finger on sensor.`;
             if (status) status.setAttribute('data-status', 'scanning');
        }

        try {
            currentScanAbort = new AbortController();
            const result = await tryLocalSecuGen(5000, currentScanAbort.signal);
            
            if (!scanLoopActive) break;

            if (result && result.ErrorCode === 0) {
                playScanSound();
                state.templateB64 = result.TemplateBase64;
                
                const templateBox = $('#fpTemplate');
                if (templateBox) templateBox.value = result.TemplateBase64;
                
                const preview = $('#fingerprintPreview');
                const placeholder = $('#fpPreviewPlaceholder');
                
                if (result.BMPBase64) {
                    if (preview) {
                        const cleanB64 = result.BMPBase64.replace(/[\r\n\s]+/g, '');
                        const prefix = cleanB64.startsWith('data:image') ? '' : 'data:image/bmp;base64,';
                        preview.src = `${prefix}${cleanB64}`;
                        preview.style.display = 'block';
                        preview.classList.add('visible');
                    }
                    if (placeholder) placeholder.style.display = 'none';
                }
                
                if (statusText) statusText.textContent = `Fingerprint captured! Place again to re-scan or click Save.`;
                if (status) status.setAttribute('data-status', 'success');
                
                await new Promise(r => setTimeout(r, 1000));
            } else {
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Scan loop error:', err);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
    
    if (scanBtn) scanBtn.style.display = 'inline-block';
}

function stopScanningLoop() {
    console.log('Stopping scan loop...');
    scanLoopActive = false;
    if (currentScanAbort) {
        currentScanAbort.abort();
        currentScanAbort = null;
    }
}

async function onScan() {
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  const preview = $('#fingerprintPreview');
  const placeholder = $('#fpPreviewPlaceholder');
  const templateBox = $('#fpTemplate');
  const scanBtn = $('#scanFpBtn');
  
  // Check if employee is selected
  const empId = $('#fpEmployee')?.value;
  if (!empId) {
    if (statusText) statusText.textContent = 'Please select an employee first';
    if (status) status.setAttribute('data-status', 'error');
    playErrorSound();
    return;
  }

  if (scanBtn) scanBtn.disabled = true;

  // Reset any previous scan data
  state.templateB64 = null;
  if (templateBox) templateBox.value = '';
  if (preview) {
    preview.style.display = 'none';
    preview.classList.remove('visible');
    preview.src = '';
  }
  if (placeholder) placeholder.style.display = 'flex';

  if (statusText) statusText.textContent = `Scanning ${state.selectedFinger}... Please place finger on scanner.`;
  if (status) status.setAttribute('data-status', 'scanning');

  try {
    const data = await tryLocalSecuGen(11000);
    if (data && data.ErrorCode === 0) {
      playScanSound();
      state.templateB64 = data.TemplateBase64;
      if (templateBox) templateBox.value = data.TemplateBase64;

      if (data.BMPBase64) {
        if (preview) {
          // Clean base64 string - remove newlines and whitespace
          const cleanB64 = data.BMPBase64.replace(/[\r\n\s]+/g, '');
          const prefix = cleanB64.startsWith('data:image') ? '' : 'data:image/bmp;base64,';
          preview.src = `${prefix}${cleanB64}`;
          preview.style.display = 'block';
          preview.classList.add('visible');
        }
        if (placeholder) placeholder.style.display = 'none';
      }

      if (statusText) statusText.textContent = `Fingerprint captured successfully! Click Save to assign to employee.`;
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
  } finally {
    if (scanBtn) scanBtn.disabled = false;
  }

  try {
    const fallback = await scanFingerprintBackend();
    if (fallback.status === 'scanned' && fallback.template_b64) {
      state.templateB64 = fallback.template_b64;
      if (templateBox) templateBox.value = fallback.template_b64;

      if (fallback.image_base64 && preview) {
        // Clean base64 string - remove newlines and whitespace
        const cleanB64 = fallback.image_base64.replace(/[\r\n\s]+/g, '');
        const prefix = cleanB64.startsWith('data:image') ? '' : 'data:image/png;base64,';
        preview.src = `${prefix}${cleanB64}`;
        preview.style.display = 'block';
        preview.classList.add('visible');
      }
      if (placeholder) placeholder.style.display = 'none';

      if (statusText) statusText.textContent = 'Fingerprint captured successfully! Click Save to assign to employee.';
      if (status) status.setAttribute('data-status', 'success');
    } else {
      if (statusText) statusText.textContent = fallback.detail || 'Backend fallback failed';
      if (status) status.setAttribute('data-status', 'error');
    }
  } catch (error) {
    if (statusText) statusText.textContent = error.message || String(error);
    if (status) status.setAttribute('data-status', 'error');
  }
}

async function onSave() {
  console.log('onSave called');
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  let empId = Number($('#fpEmployee')?.value || 0);
  console.log('Initial empId:', empId);

  // Fallback: check if c-select has a value if native is empty
  if (!empId) {
    const native = $('#fpEmployee');
    if (native) {
      const cSelect = native.closest('.c-select');
      if (cSelect) {
         const selectedItem = cSelect.querySelector('.c-select__item[aria-selected="true"]');
         if (selectedItem && selectedItem.dataset.value) {
           empId = Number(selectedItem.dataset.value);
           // Sync back to native
           native.value = empId;
           console.log('Recovered empId from c-select:', empId);
         }
      }
    }
  }

  if (!empId) {
    console.warn('No employee selected');
    if (statusText) statusText.textContent = 'Error: Please select an employee first';
    if (status) status.setAttribute('data-status', 'error');
    playErrorSound();
    return;
  }

  if (!state.templateB64) {
    console.warn('No template scanned');
    if (statusText) statusText.textContent = 'Error: Please scan a fingerprint first';
    if (status) status.setAttribute('data-status', 'error');
    playErrorSound();
    return;
  }

  // Check for existing fingerprint with the same name
  const employee = state.employees.find(e => e.id === empId);
  const name = state.selectedFinger;

  if (employee && employee.fingerprints) {
    const existingFp = employee.fingerprints.find(fp => fp.name === name);
    if (existingFp) {
      const confirmOverwrite = await confirmModal({
        title: 'Overwrite Fingerprint',
        message: `Employee "${employee.name}" already has a fingerprint for "${name}".\n\nDo you want to overwrite it?`,
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
  }

  if (statusText) statusText.textContent = `Saving ${state.selectedFinger} fingerprint to database...`;
  if (status) status.setAttribute('data-status', 'scanning');

  // Pause scanning
  const wasScanning = scanLoopActive;
  if (wasScanning) stopScanningLoop();

  try {
    console.log('Saving fingerprint for employee:', empId);
    
    await saveFingerprint(empId, state.templateB64, name);
    playSuccessSound();
    
    const employee = state.employees.find(e => e.id === empId);
    const empName = employee ? employee.name : 'employee';
    if (statusText) statusText.textContent = `Success! ${name} fingerprint saved for ${empName}.`;
    if (status) status.setAttribute('data-status', 'success');
    
    // Reset everything after successful save
    setTimeout(() => {
      resetForm(true);
      // Refresh employee list to update has_fingerprint status
      getEmployees().then(emps => {
        state.employees = emps;
        // Re-render fingerprints for the selected employee if still selected
        const sel = $('#fpEmployee');
        if (sel && sel.value) {
             const emp = state.employees.find(e => String(e.id) === sel.value);
             renderFingerprints(emp);
        }
      });
      
      // Restart scanning if it was active
      if (wasScanning) startScanningLoop();
    }, 2000);
  } catch (error) {
    console.error('Save failed:', error);
    playErrorSound();
    if (statusText) statusText.textContent = error.message || String(error);
    if (status) status.setAttribute('data-status', 'error');
    
    // Restart scanning if it was active
    if (wasScanning) startScanningLoop();
  }
}

function resetForm(keepEmployee = false) {
  const status = $('#fpStatus');
  const statusText = status?.querySelector('.status-message');
  const preview = $('#fingerprintPreview');
  const placeholder = $('#fpPreviewPlaceholder');
  const templateBox = $('#fpTemplate');
  const employeeSelect = $('#fpEmployee');

  // Clear state
  state.templateB64 = null;
  // selectFinger("Right Thumb"); // Don't reset finger selection, user might want to enroll same finger again or move to next manually

  // Reset preview
  if (preview) {
    preview.style.display = 'none';
    preview.classList.remove('visible');
    preview.src = '';
  }
  if (placeholder) placeholder.style.display = 'flex';
  if (templateBox) templateBox.value = '';

  // Reset employee selection
  if (!keepEmployee && employeeSelect) {
    employeeSelect.value = '';
    // Dispatch change event so c-select updates its UI
    employeeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Reset status
  if (!keepEmployee) {
      if (statusText) statusText.textContent = 'Please select an employee to begin enrollment';
      if (status) status.setAttribute('data-status', 'ready');
  } else {
      if (statusText) statusText.textContent = `Ready for next scan. Place finger on scanner.`;
      if (status) status.setAttribute('data-status', 'ready');
  }

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

  // Finger selection listeners
  document.querySelectorAll('.finger-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
          const fingerName = e.target.dataset.finger;
          if (fingerName) {
              selectFinger(fingerName);
          }
      });
  });
  
  // Initial selection
  selectFinger("Right Thumb");
}
