// js/modules/attendance/automaticClocking.js - Automatic clocking with fingerprint and card support
import { getEmployees, clockEmployee, getEmployeeTemplates } from '../../services/api/attendanceApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';

// ====== State Management ======
let state = {
  employees: [],
  fingerprintTemplates: [],
  employeeNameToIdMap: {},
  cardUidToEmployee: {},
  isScanning: false,
  cardPollingInterval: null,
  fingerprintPollingInterval: null,
  isProcessingCard: false,
  isProcessingFingerprint: false,
  lastScannedUid: null,
  lastScanTime: 0,
  lastFingerprintTime: 0,
  cardScanErrorCount: 0,
  fingerprintScanErrorCount: 0,
  nextCardPollDelay: 3000,
  scanCount: 0,
  recentScans: [],
  cardServiceAvailable: false,
  fingerprintServiceAvailable: false
};

// ====== Constants ======
const SCAN_COOLDOWN_MS = 2000;
const FINGERPRINT_COOLDOWN_MS = 3000;
const MAX_RECENT_SCANS = 10;
const MAX_CONSECUTIVE_ERRORS = 5; // After this many errors, slow down polling

// Determine protocol based on current page
const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

// SecuGen endpoints to probe for fingerprint scanning
const SGI_ENDPOINTS = [
  `${protocol}//127.0.0.1:8080/SGIFPCapture`
];

const CARD_SCAN_ENDPOINTS = [
  `${protocol}//127.0.0.1:8080/card/scan`
];

// ====== Utility Functions ======
function $(sel) { return document.querySelector(sel); }

function updateStatus(message, type = 'info') {
  const statusEl = $('#scannerStatus');
  if (!statusEl) return;

  let icon = '🟢';
  let color = '#28a745';
  
  if (type === 'error') {
    icon = '🔴';
    color = '#dc3545';
  } else if (type === 'warning') {
    icon = '🟡';
    color = '#ffc107';
  } else if (type === 'scanning') {
    icon = '🔄';
    color = '#007bff';
  }

  statusEl.innerHTML = `${icon} ${message}`;
  statusEl.style.color = color;
}

function updateLastScanTime() {
  const lastScanEl = $('#lastScanTime');
  if (lastScanEl) {
    lastScanEl.textContent = new Date().toLocaleTimeString();
  }
}

function updateScanCount() {
  const scanCountEl = $('#totalScansToday');
  if (scanCountEl) {
    scanCountEl.textContent = state.scanCount.toString();
  }
}

function addRecentScan(employee, method, direction) {
  const scan = {
    employee: employee.name,
    method,
    direction,
    time: new Date().toLocaleTimeString(),
    timestamp: new Date()
  };

  state.recentScans.unshift(scan);
  if (state.recentScans.length > MAX_RECENT_SCANS) {
    state.recentScans = state.recentScans.slice(0, MAX_RECENT_SCANS);
  }

  updateRecentScansTable();
}

function updateRecentScansTable() {
  const tableEl = $('#recentScansTable');
  if (!tableEl) return;

  if (state.recentScans.length === 0) {
    tableEl.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem; color: #999;">No recent scans.</p>';
    return;
  }

  const table = `
    <div class="table-container">
    <table class="modern-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Method</th>
          <th>Action</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${state.recentScans.map(scan => `
          <tr>
            <td>${scan.employee}</td>
            <td>
              <span class="method-badge">
                ${scan.method === 'fingerprint' ? '👆 Fingerprint' : '💳 Card'}
              </span>
            </td>
            <td>
              <span class="status-badge ${scan.direction === 'in' ? 'status-in' : 'status-out'}">
                ${scan.direction === 'in' ? '✅ Clock In' : '❌ Clock Out'}
              </span>
            </td>
            <td>${scan.time}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;

  tableEl.innerHTML = table;
}

function updateHardwareStatus() {
  // Update fingerprint status
  const fpStatusEl = $('#fingerprintStatus');
  if (fpStatusEl) {
    const iconEl = fpStatusEl.querySelector('i');
    const textEl = fpStatusEl.querySelector('span');
    
    if (state.fingerprintServiceAvailable) {
      if (iconEl) iconEl.className = 'fas fa-check-circle';
      if (textEl) textEl.textContent = 'Ready';
      fpStatusEl.style.color = '#28a745';
    } else {
      if (iconEl) iconEl.className = 'fas fa-exclamation-triangle';
      if (textEl) textEl.textContent = 'Service Unavailable';
      fpStatusEl.style.color = '#dc3545';
    }
  }
  
  // Update card status
  const cardStatusEl = $('#cardStatus');
  if (cardStatusEl) {
    const iconEl = cardStatusEl.querySelector('i');
    const textEl = cardStatusEl.querySelector('span');
    
    if (state.cardServiceAvailable) {
      if (iconEl) iconEl.className = 'fas fa-check-circle';
      if (textEl) textEl.textContent = 'Ready';
      cardStatusEl.style.color = '#28a745';
    } else {
      if (iconEl) iconEl.className = 'fas fa-exclamation-triangle';
      if (textEl) textEl.textContent = 'Service Unavailable';
      cardStatusEl.style.color = '#dc3545';
    }
  }
}

function setScannerDisplayState(title, message, isActive) {
  const titleEl = document.querySelector('.scanner-title');
  const messageEl = document.querySelector('.scanner-message');
  const animationEl = $('#scannerAnimation');

  if (titleEl && title) titleEl.textContent = title;
  if (messageEl && message) messageEl.textContent = message;
  if (animationEl) {
    animationEl.style.opacity = isActive ? '1' : '0.35';
    animationEl.classList.toggle('scanner-active', Boolean(isActive));
  }
}

function setStartButtonState({ disabled, label }) {
  const btn = $('#startScanBtn');
  if (!btn) return;
  if (typeof disabled === 'boolean') {
    btn.disabled = disabled;
  }
  if (label) {
    const labelEl = btn.querySelector('span');
    if (labelEl) labelEl.textContent = label;
  }
}

function setStopButtonState({ disabled }) {
  const btn = $('#stopScanBtn');
  if (!btn) return;
  if (typeof disabled === 'boolean') {
    btn.disabled = disabled;
  }
}



async function checkBridgeHealth() {
  try {
    const response = await fetch(`${protocol}//127.0.0.1:8080/health`);
    if (!response.ok) return { fingerprint: false, card: false };
    const data = await response.json();
    return {
      fingerprint: data.fingerprint_available === true,
      card: data.card_available === true
    };
  } catch (e) {
    return { fingerprint: false, card: false };
  }
}



async function evaluateHardwareStatus({ showSpinner = false } = {}) {
  if (showSpinner) {
    updateStatus('Checking hardware...', 'scanning');
  }

  const status = await checkBridgeHealth();
  const fingerprintReady = status.fingerprint;
  const cardReady = status.card;

  state.fingerprintServiceAvailable = fingerprintReady;
  state.cardServiceAvailable = cardReady;
  updateHardwareStatus();

  const missing = [];
  if (!fingerprintReady) missing.push('fingerprint scanner');
  if (!cardReady) missing.push('card reader');
  const availableCount = 2 - missing.length;

  if (availableCount === 0) {
    setStartButtonState({ disabled: true, label: 'Connect scanners to start' });
    setStopButtonState({ disabled: true });
    setScannerDisplayState('Hardware Required', 'Connect at least one fingerprint or card device to begin scanning.', false);
    updateStatus('No scanners detected. Please connect a fingerprint scanner or card reader.', 'warning');
    return false;
  }

  setStartButtonState({ disabled: false, label: 'Start Scanning' });
  setStopButtonState({ disabled: true });

  if (availableCount === 2) {
    setScannerDisplayState('Awaiting Start', 'Press Start Scanning once both scanners are connected.', false);
    updateStatus('Both scanners detected. Press Start Scanning to begin.', 'info');
  } else {
    const online = fingerprintReady ? 'Fingerprint scanner online; card reader offline.' : 'Card reader online; fingerprint scanner offline.';
    setScannerDisplayState('Partial hardware ready', `${online} Scanning will continue with the available method.`, false);
    updateStatus(`Partial availability: ${online}`, 'warning');
  }

  return true;
}

// ====== Employee Data Loading ======
async function loadEmployees() {
  try {
    const [employees, templates] = await Promise.all([
      getEmployees(),
      getEmployeeTemplates()
    ]);
    
    state.employees = employees;
    state.fingerprintTemplates = templates;
    
    // Reset mapping objects
    state.employeeNameToIdMap = {};
    state.cardUidToEmployee = {};

    // Build lookup maps
    employees.forEach(emp => {
      state.employeeNameToIdMap[emp.name] = emp.id;
      if (emp.card_uid) {
        state.cardUidToEmployee[emp.card_uid.toUpperCase()] = emp;
      }
    });

    console.log(`📋 Loaded ${employees.length} employees and ${templates.length} fingerprint templates`);
    
  } catch (error) {
    console.error('Failed to load employees:', error);
    updateStatus('Failed to load employees', 'error');
  }
}

// ====== Fingerprint Scanning ======
async function captureFingerprint(timeoutMs = 3000) {
  const payload = { 
    Timeout: 2000, 
    TemplateFormat: 'ANSI', 
    FakeDetection: 1 
  };
  
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  const promises = SGI_ENDPOINTS.map(url => (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} @ ${url}`);
      }
      
      const data = await response.json();
      data.__endpoint = url;
      return data;
    } catch (e) {
      throw e;
    }
  })());

  try {
    return await Promise.any(promises);
  } finally {
    clearTimeout(timeout);
    abortController.abort(); // Ensure all other requests are cancelled
  }
}

async function pollFingerprint() {
  if (state.isProcessingFingerprint || !state.isScanning) return;

  try {
    const data = await captureFingerprint(3000);

    // Reset error count on successful connection
    state.fingerprintScanErrorCount = 0;
    state.fingerprintServiceAvailable = true;
    updateHardwareStatus();

    // No finger detected or timeout (ErrorCode 54)
    if (!data || typeof data.ErrorCode !== 'number') return;
    if (data.ErrorCode === 54) return;

    // Handle local errors
    if (data.ErrorCode !== 0) {
      if (data.ErrorCode === 10004) {
        console.warn('Fingerprint: Service access error');
      }
      return;
    }

    const now = Date.now();
    if (now - state.lastFingerprintTime < FINGERPRINT_COOLDOWN_MS) return;
    
    state.lastFingerprintTime = now;
    state.isProcessingFingerprint = true;

    playScanSound(); // Sound feedback for scan
    updateStatus('Fingerprint detected - matching...', 'scanning');

    // Perform client-side matching via local bridge
    let bestMatch = null;
    let bestScore = 0;
    const MATCH_THRESHOLD = 80;

    try {
      // Try batch matching first (much faster)
      const candidates = state.fingerprintTemplates.map(t => ({
        id: String(t.id),
        template_b64: t.template_b64,
        name: t.name
      }));

      const matchResponse = await fetch(`${protocol}//127.0.0.1:8080/fingerprint/match_batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          probe_template_b64: data.TemplateBase64,
          candidates: candidates,
          threshold: MATCH_THRESHOLD
        })
      });
      
      if (matchResponse.ok) {
        const matchData = await matchResponse.json();
        if (matchData.status === 'success') {
          bestScore = matchData.best_score;
          if (matchData.matched && matchData.match) {
             bestMatch = state.fingerprintTemplates.find(t => String(t.id) === matchData.match.id);
          }
        }
      } else {
        throw new Error('Batch matching endpoint not available');
      }
    } catch (e) {
      console.warn('Batch matching failed, falling back to individual matching:', e);
      
      // Fallback to individual matching
      for (const tmpl of state.fingerprintTemplates) {
        try {
          const matchResponse = await fetch(`${protocol}//127.0.0.1:8080/fingerprint/match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              template1_b64: data.TemplateBase64,
              template2_b64: tmpl.template_b64
            })
          });
          
          if (!matchResponse.ok) continue;
          const matchData = await matchResponse.json();
          
          // Log scores for debugging
          if (matchData.score > 0) {
              console.log(`Match score for ${tmpl.name}: ${matchData.score}`);
          }
          
          if (matchData.status === 'success' && matchData.score > bestScore) {
            bestScore = matchData.score;
            bestMatch = tmpl;
          }
        } catch (e) {
          console.warn('Error matching template:', e);
        }
      }
    }

    if (bestMatch && bestScore >= MATCH_THRESHOLD) {
      // Clock the employee
      const result = await clockEmployee(bestMatch.id);
      
      if (result?.status === 'success') {
        playSuccessSound();
        updateStatus(`✅ ${bestMatch.name} clocked ${result.direction || 'in'} (score: ${bestScore})`, 'info');
        
        state.scanCount++;
        updateScanCount();
        updateLastScanTime();
        
        addRecentScan({ name: bestMatch.name }, 'fingerprint', result.direction || 'in');
      } else {
        playErrorSound();
        updateStatus(`❌ Clock failed for ${bestMatch.name}`, 'error');
      }
    } else {
      playErrorSound();
      updateStatus(`❌ No fingerprint match (Best score: ${bestScore})`, 'error');
    }

  } catch (error) {
    // Track consecutive errors
    state.fingerprintScanErrorCount++;
    
    // Only log errors periodically to avoid spam
    if (state.fingerprintScanErrorCount === 1 || state.fingerprintScanErrorCount % 10 === 0) {
      console.warn('Fingerprint service unavailable (attempt ' + state.fingerprintScanErrorCount + ')');
    }
    
    // Update service status
    if (state.fingerprintScanErrorCount >= MAX_CONSECUTIVE_ERRORS) {
      state.fingerprintServiceAvailable = false;
      updateHardwareStatus();
    }
  } finally {
    state.isProcessingFingerprint = false;
  }
}

// ====== Card Scanning ======
async function pollCardScan() {
  if (state.isProcessingCard || !state.isScanning) return;

  // Use local hardware bridge for card scanning
  let response = null;
  
  // Try local endpoints first
  for (const endpoint of CARD_SCAN_ENDPOINTS) {
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: 1 }), // Short timeout for polling
        cache: 'no-store'
      });
      if (response.ok) break;
    } catch (e) {
      continue;
    }
  }
  
  if (!response) return; // No local bridge available

  try {
    // Reset error count on successful connection
    state.cardScanErrorCount = 0;
    state.cardServiceAvailable = true;
    updateHardwareStatus();

    // Treat non-OK responses as "idle" (no card present)
    if (!response.ok) {
      state.nextCardPollDelay = 3000;
      return;
    }

    const data = await response.json();

    // Local bridge returns: { status: 'success', uid: '...' } or { status: 'error', error: '...' }
    if (data && data.status === 'success' && data.uid) {
      const uid = String(data.uid).toUpperCase();
      const now = Date.now();

      // Cooldown check to prevent duplicate scans
      if (uid === state.lastScannedUid && now - state.lastScanTime < SCAN_COOLDOWN_MS) {
        return;
      }

      state.lastScannedUid = uid;
      state.lastScanTime = now;
      state.isProcessingCard = true;

      playScanSound();
      updateStatus(`Card scanned: ${uid}`, 'scanning');

      // Find employee by card UID
      const employee = state.cardUidToEmployee[uid];

      if (!employee) {
        playErrorSound();
        updateStatus('⚠️ Card not registered to any employee', 'warning');
        return;
      }

      // Clock the employee
      try {
        const clockResult = await clockEmployee(employee.id);
        
        if (clockResult) {
          playSuccessSound();
          updateStatus(`✅ ${employee.name} clocked ${clockResult.direction || 'in'}`, 'info');
          
          state.scanCount++;
          updateScanCount();
          updateLastScanTime();
          addRecentScan(employee, 'card', clockResult.direction || 'in');
          
          state.cardScanErrorCount = 0;
          state.nextCardPollDelay = 3000;
        } else {
          playErrorSound();
          updateStatus('❌ Clocking failed', 'error');
        }
      } catch (clockError) {
        console.error('Clock error:', clockError);
        playErrorSound();
        updateStatus('❌ Clocking failed', 'error');
      }

    } else {
      // No card present - this is normal
      state.cardScanErrorCount = 0;
      state.nextCardPollDelay = 3000;
    }

  } catch (error) {
    // Network/service errors - use exponential backoff
    state.cardScanErrorCount++;
    const backoffMs = Math.min(30000, 3000 * Math.pow(1.5, Math.min(state.cardScanErrorCount, 5)));
    state.nextCardPollDelay = backoffMs;
    
    // Only log errors periodically to avoid spam
    if (state.cardScanErrorCount === 1 || state.cardScanErrorCount % 10 === 0) {
      console.warn('Card service unavailable (attempt ' + state.cardScanErrorCount + ')');
    }
    
    // Update service status
    if (state.cardScanErrorCount >= MAX_CONSECUTIVE_ERRORS) {
      state.cardServiceAvailable = false;
      updateHardwareStatus();
    }
  } finally {
    state.isProcessingCard = false;
  }
}

// ====== Scanning Control ======
async function startScanning(options = {}) {
  if (state.isScanning) return;

  if (!options.skipHardwareCheck) {
    const hardwareReady = await evaluateHardwareStatus({ showSpinner: true });
    if (!hardwareReady) {
      return;
    }
  }

  const usingCard = state.cardServiceAvailable;
  const usingFingerprint = state.fingerprintServiceAvailable;

  if (!usingCard && !usingFingerprint) {
    updateStatus('No scanners available to start scanning.', 'warning');
    return;
  }

  state.isScanning = true;
  const activeMessage = usingCard && usingFingerprint
    ? 'Both methods will automatically clock employees in or out.'
    : usingCard
      ? 'Card reader will clock employees; fingerprint scanner offline.'
      : 'Fingerprint scanner will clock employees; card reader offline.';
  const scanningStatus = usingCard && usingFingerprint
    ? 'Scanning via fingerprint and card readers...'
    : usingCard
      ? 'Scanning via card reader'
      : 'Scanning via fingerprint reader';
  updateStatus(scanningStatus, 'scanning');
  setScannerDisplayState('Scanning Active', activeMessage, true);

  // Start card polling with backoff-aware logic
  if (usingCard) {
    const cardLoop = async () => {
      try {
        await pollCardScan();
      } finally {
        if (state.isScanning && state.cardServiceAvailable) {
          clearTimeout(state.cardPollingInterval);
          state.cardPollingInterval = setTimeout(cardLoop, state.nextCardPollDelay);
        }
      }
    };

    state.nextCardPollDelay = 3000;
    cardLoop();
  }

  // Start fingerprint polling with dynamic interval based on errors
  if (usingFingerprint) {
    const fingerprintLoop = async () => {
      try {
        await pollFingerprint();
      } finally {
        if (state.isScanning && state.fingerprintServiceAvailable) {
          const interval = state.fingerprintScanErrorCount >= MAX_CONSECUTIVE_ERRORS ? 5000 : 1200;
          state.fingerprintPollingInterval = setTimeout(fingerprintLoop, interval);
        }
      }
    };
    fingerprintLoop();
  }

  setStartButtonState({ disabled: true, label: 'Scanning...' });
  setStopButtonState({ disabled: false });
}

function stopScanning() {
  if (!state.isScanning) return;

  state.isScanning = false;
  state.isProcessingCard = false;
  state.isProcessingFingerprint = false;

  // Clear intervals
  if (state.cardPollingInterval) {
    clearTimeout(state.cardPollingInterval);
    state.cardPollingInterval = null;
  }
  
  if (state.fingerprintPollingInterval) {
    clearTimeout(state.fingerprintPollingInterval);
    state.fingerprintPollingInterval = null;
  }

  updateHardwareStatus();
  setScannerDisplayState('Scanning Paused', 'Press Start Scanning when you are ready.', false);
  setStartButtonState({ disabled: false, label: 'Start Scanning' });
  setStopButtonState({ disabled: true });
  evaluateHardwareStatus({ showSpinner: false });
}

// ====== Event Handlers ======
function setupEventHandlers() {
  const startBtn = $('#startScanBtn');
  const stopBtn = $('#stopScanBtn');

  if (startBtn) {
    startBtn.addEventListener('click', () => startScanning());
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', stopScanning);
  }
}

// ====== Module Cleanup ======
function cleanup() {
  stopScanning();
  state = {
    employees: [],
    employeeNameToIdMap: {},
    cardUidToEmployee: {},
    isScanning: false,
    cardPollingInterval: null,
    fingerprintPollingInterval: null,
    isProcessingCard: false,
    isProcessingFingerprint: false,
    lastScannedUid: null,
    lastScanTime: 0,
    lastFingerprintTime: 0,
    cardScanErrorCount: 0,
    fingerprintScanErrorCount: 0,
    nextCardPollDelay: 3000,
    scanCount: 0,
    recentScans: [],
    cardServiceAvailable: false,
    fingerprintServiceAvailable: false
  };
}

// ====== Main Init Function ======
export async function init() {
  console.log("🔍 Initializing automatic clocking module");
  
  // Cleanup any previous instances
  cleanup();
  
  // Load employee data
  await loadEmployees();
  
  setupEventHandlers();
  
  updateStatus('Checking hardware...', 'scanning');
  updateScanCount();
  updateRecentScansTable();
  updateHardwareStatus();
  
  const hardwareReady = await evaluateHardwareStatus({ showSpinner: false });
  // Always start scanning if hardware is ready OR if we want to poll for it
  // The polling loop handles the "waiting for hardware" logic gracefully now
  await startScanning({ skipHardwareCheck: true });
  
  console.log("✅ Automatic clocking module initialized");
  
  // Return cleanup function for module unloading
  return cleanup;
}
