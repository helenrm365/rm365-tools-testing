// js/modules/attendance/automaticClocking.js - Automatic clocking with fingerprint and card support
import { getEmployees, clockEmployee } from '../../services/api/attendanceApi.js';

// ====== State Management ======
let state = {
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

// ====== Constants ======
const SCAN_COOLDOWN_MS = 2000;
const FINGERPRINT_COOLDOWN_MS = 3000;
const MAX_RECENT_SCANS = 10;
const MAX_CONSECUTIVE_ERRORS = 5; // After this many errors, slow down polling

// SecuGen endpoints to probe for fingerprint scanning
const SGI_ENDPOINTS = [
  'https://localhost:8443/SGIFPCapture',
  'https://127.0.0.1:8443/SGIFPCapture', 
  'https://localhost:8080/SGIFPCapture',
  'https://127.0.0.1:8080/SGIFPCapture',
  'http://localhost:8080/SGIFPCapture',
  'http://127.0.0.1:8080/SGIFPCapture'
];

const CARD_HEALTH_ENDPOINTS = [
  'http://localhost:8080/health',
  'http://127.0.0.1:8080/health'
];

const CARD_SCAN_ENDPOINTS = [
  'http://localhost:8080/card/scan',
  'http://127.0.0.1:8080/card/scan'
];

const HARDWARE_CHECK_TIMEOUT_MS = 1500;
const FINGERPRINT_OK_CODES = new Set([0, 54]);

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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = HARDWARE_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectCardAvailability() {
  for (const endpoint of CARD_HEALTH_ENDPOINTS) {
    const data = await fetchJsonWithTimeout(endpoint, { cache: 'no-store' });
    if (data && typeof data.card_available === 'boolean') {
      return data.card_available;
    }
  }

  for (const endpoint of CARD_SCAN_ENDPOINTS) {
    const data = await fetchJsonWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout: 0 }),
      cache: 'no-store'
    }, 2000);

    if (!data) continue;
    if (data.status === 'success') return true;
    if (data.status === 'error') {
      if (data.error && /reader/i.test(data.error)) {
        return false;
      }
      return true;
    }
  }

  return false;
}

async function probeFingerprintEndpoint(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HARDWARE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Timeout: 500, TemplateFormat: 'ANSI', FakeDetection: 0 }),
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data.ErrorCode !== 'number') return null;

    if (FINGERPRINT_OK_CODES.has(data.ErrorCode)) {
      return { reachable: true, device: true };
    }

    if (data.ErrorCode === 55) {
      return { reachable: true, device: false };
    }

    return { reachable: true, device: false };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectFingerprintAvailability() {
  for (const endpoint of SGI_ENDPOINTS) {
    const result = await probeFingerprintEndpoint(endpoint);
    if (!result) continue;
    if (result.device) return true;
    if (result.reachable && !result.device) return false;
  }

  return false;
}

async function evaluateHardwareStatus({ showSpinner = false } = {}) {
  if (showSpinner) {
    updateStatus('Checking hardware...', 'scanning');
  }

  const [fingerprintReady, cardReady] = await Promise.all([
    detectFingerprintAvailability(),
    detectCardAvailability()
  ]);

  state.fingerprintServiceAvailable = fingerprintReady;
  state.cardServiceAvailable = cardReady;
  updateHardwareStatus();

  const missing = [];
  if (!fingerprintReady) missing.push('fingerprint scanner');
  if (!cardReady) missing.push('card reader');
  const allReady = missing.length === 0;

  if (!allReady) {
    setStartButtonState({ disabled: true, label: 'Connect scanners to start' });
    setStopButtonState({ disabled: true });
    setScannerDisplayState('Hardware Required', 'Connect both fingerprint and card devices before starting.', false);
    updateStatus(`Hardware unavailable: ${missing.join(' and ')}`, 'warning');
    return false;
  }

  setStartButtonState({ disabled: false, label: 'Start Scanning' });
  setStopButtonState({ disabled: true });
  setScannerDisplayState('Awaiting Start', 'Press "Start Scanning" once both scanners are connected.', false);
  updateStatus('All scanners detected. Press "Start Scanning" to begin.', 'info');
  return true;
}

// ====== Employee Data Loading ======
async function loadEmployees() {
  try {
    const employees = await getEmployees();
    state.employees = employees;
    
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

    console.log(`📋 Loaded ${employees.length} employees for automatic clocking`);
    
  } catch (error) {
    console.error('Failed to load employees:', error);
    updateStatus('Failed to load employees', 'error');
  }
}

// ====== Fingerprint Scanning ======
async function captureFingerprint(timeoutMs = 1800) {
  const payload = { 
    Timeout: 2000, 
    TemplateFormat: 'ANSI', 
    FakeDetection: 1 
  };
  
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  const promises = SGI_ENDPOINTS.map(url => (async () => {
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
  })());

  try {
    return await Promise.any(promises);
  } finally {
    clearTimeout(timeout);
  }
}

async function pollFingerprint() {
  if (state.isProcessingFingerprint || !state.isScanning) return;

  try {
    const data = await captureFingerprint(1800);

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

    updateStatus('Fingerprint detected - matching...', 'scanning');

    // Send fingerprint to backend for matching and clocking
    const response = await fetch('/api/v1/attendance/clock-by-fingerprint', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
      },
      body: JSON.stringify({ 
        template_b64: data.TemplateBase64, 
        threshold: 130, 
        template_format: 'ANSI' 
      })
    });

    const result = await response.json();
    
    if (response.ok && result?.status === 'success') {
      const employee = result.employee || {};
      updateStatus(`✅ ${employee.name || 'Employee'} clocked ${result.direction || 'in'} (score: ${employee.score || '-'})`, 'info');
      
      state.scanCount++;
      updateScanCount();
      updateLastScanTime();
      
      if (employee.name) {
        addRecentScan(employee, 'fingerprint', result.direction || 'in');
      }
      
    } else {
      updateStatus(`❌ No fingerprint match${result?.detail ? ` (${result.detail})` : ''}`, 'error');
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

      updateStatus(`Card scanned: ${uid}`, 'scanning');

      // Find employee by card UID
      const employee = state.cardUidToEmployee[uid];

      if (!employee) {
        updateStatus('⚠️ Card not registered to any employee', 'warning');
        return;
      }

      // Clock the employee
      try {
        const clockResult = await clockEmployee(employee.id);
        
        if (clockResult) {
          updateStatus(`✅ ${employee.name} clocked ${clockResult.direction || 'in'}`, 'info');
          
          state.scanCount++;
          updateScanCount();
          updateLastScanTime();
          addRecentScan(employee, 'card', clockResult.direction || 'in');
          
          state.cardScanErrorCount = 0;
          state.nextCardPollDelay = 3000;
        } else {
          updateStatus('❌ Clocking failed', 'error');
        }
      } catch (clockError) {
        console.error('Clock error:', clockError);
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
  } else if (!state.fingerprintServiceAvailable || !state.cardServiceAvailable) {
    return;
  }

  state.isScanning = true;
  updateStatus('Scanning for employees...', 'scanning');
  setScannerDisplayState('Scanning Active', 'Both methods will automatically clock employees in or out.', true);

  // Start card polling with backoff-aware logic
  const cardLoop = async () => {
    try {
      await pollCardScan();
    } finally {
      if (state.isScanning) {
        clearTimeout(state.cardPollingInterval);
        state.cardPollingInterval = setTimeout(cardLoop, state.nextCardPollDelay);
      }
    }
  };

  // Start immediately
  state.nextCardPollDelay = 3000;
  cardLoop();

  // Start fingerprint polling with dynamic interval based on errors
  const fingerprintLoop = async () => {
    try {
      await pollFingerprint();
    } finally {
      if (state.isScanning) {
        const interval = state.fingerprintScanErrorCount >= MAX_CONSECUTIVE_ERRORS ? 5000 : 1200;
        state.fingerprintPollingInterval = setTimeout(fingerprintLoop, interval);
      }
    }
  };
  fingerprintLoop();

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
  setScannerDisplayState('Scanning Paused', 'Press "Start Scanning" once both scanners are connected.', false);
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
  if (hardwareReady) {
    await startScanning({ skipHardwareCheck: true });
  } else {
    console.warn('Automatic clocking waiting for hardware before starting scans.');
  }
  
  console.log("✅ Automatic clocking module initialized");
  
  // Return cleanup function for module unloading
  return cleanup;
}
