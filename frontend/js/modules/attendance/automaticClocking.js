// js/modules/attendance/automaticClocking.js - Automatic clocking with NFC card support
import { getEmployees, clockEmployee } from '../../services/api/attendanceApi.js';
import { playSuccessSound, playErrorSound, playScanSound } from '../../utils/sound.js';

// ====== State Management ======
let state = {
  employees: [],
  cardUidToEmployee: {},
  isScanning: false,
  cardPollingInterval: null,
  isProcessingCard: false,
  lastScannedUid: null,
  lastScanTime: 0,
  cardScanErrorCount: 0,
  nextCardPollDelay: 500,
  scanCount: 0,
  recentScans: [],
  cardServiceAvailable: false
};

// ====== Constants ======
const SCAN_COOLDOWN_MS = 1000;
const MAX_RECENT_SCANS = 10;
const MAX_CONSECUTIVE_ERRORS = 5;

// Hardware bridge always runs on HTTPS
const BRIDGE_PROTOCOL = 'https:';
const BRIDGE_BASE = `${BRIDGE_PROTOCOL}//127.0.0.1:8080`;

const CARD_SCAN_ENDPOINTS = [
  `${BRIDGE_BASE}/card/scan`
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
    tableEl.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <p>No recent scans available</p>
      </div>
    `;
    return;
  }

  const table = `
    <div class="scans-table-wrapper">
      <table class="scans-table">
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
                  <i class="fas fa-credit-card"></i> Card
                </span>
              </td>
              <td>
                <span class="status-badge ${scan.direction === 'in' ? 'status-in' : 'status-out'}">
                  ${scan.direction === 'in' ? '<i class="fas fa-sign-in-alt"></i> Clock In' : '<i class="fas fa-sign-out-alt"></i> Clock Out'}
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
    const response = await fetch(`${BRIDGE_BASE}/health`);
    if (!response.ok) return { card: false };
    const data = await response.json();
    return {
      card: data.nfc_available === true
    };
  } catch (e) {
    return { card: false };
  }
}

async function evaluateHardwareStatus({ showSpinner = false } = {}) {
  if (showSpinner) {
    updateStatus('Checking hardware...', 'scanning');
  }

  const status = await checkBridgeHealth();
  const cardReady = status.card;

  state.cardServiceAvailable = cardReady;
  updateHardwareStatus();

  if (!cardReady) {
    setStartButtonState({ disabled: true, label: 'Connect reader to start' });
    setStopButtonState({ disabled: true });
    setScannerDisplayState('Hardware Required', 'Connect card reader to begin scanning.', false);
    updateStatus('No card reader detected. Please connect card reader.', 'warning');
    return false;
  }

  setStartButtonState({ disabled: false, label: 'Start Scanning' });
  setStopButtonState({ disabled: true });

  setScannerDisplayState('Awaiting Start', 'Press Start Scanning to begin.', false);
  updateStatus('Card reader detected. Press Start Scanning to begin.', 'info');
  return true;
}

// ====== Employee Data Loading ======
async function loadEmployees() {
  try {
    const employees = await getEmployees();
    
    // Handle cases where API returns wrapped data
    state.employees = Array.isArray(employees) ? employees : (employees?.employees || []);
    
    // Reset mapping objects
    state.cardUidToEmployee = {};

    // Build lookup maps
    state.employees.forEach(emp => {
      if (emp.nfc_uid) {
        state.cardUidToEmployee[emp.nfc_uid.toUpperCase()] = emp;
      }
    });
  } catch (error) {
    console.error('Failed to load employees:', error);
    updateStatus('Failed to load employees', 'error');
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
        body: JSON.stringify({ timeout: 1 }), // 1 second timeout for card check
        cache: 'no-store',
        keepalive: false, // Prevent connection pooling interference with main API
        mode: 'cors',
        credentials: 'omit'
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

    // Local bridge returns: { status: 'success', uid: '...' } or { status: 'waiting', error: '...' } or { status: 'error', error: '...' }
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
          state.nextCardPollDelay = 500;
        } else {
          playErrorSound();
          updateStatus('❌ Clocking failed', 'error');
        }
      } catch (clockError) {
        console.error('Clock error:', clockError);
        playErrorSound();
        updateStatus('❌ Clocking failed', 'error');
      }

    } else if (data && data.status === 'waiting') {
      // No card present - this is normal during polling
      state.cardScanErrorCount = 0;
      state.nextCardPollDelay = 500;
    } else {
      // Actual error (reader not found, etc.)
      state.cardScanErrorCount++;
      const backoffMs = Math.min(10000, 1000 * Math.pow(1.5, Math.min(state.cardScanErrorCount, 3)));
      state.nextCardPollDelay = backoffMs;
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

  if (!usingCard) {
    updateStatus('No scanners available to start scanning.', 'warning');
    return;
  }

  state.isScanning = true;
  updateStatus('Scanning via card reader', 'scanning');
  setScannerDisplayState('Scanning Active', 'Card reader will clock employees.', true);

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

    state.nextCardPollDelay = 500;
    cardLoop();
  }

  setStartButtonState({ disabled: true, label: 'Scanning...' });
  setStopButtonState({ disabled: false });
}

function stopScanning() {
  if (!state.isScanning) return;

  state.isScanning = false;
  state.isProcessingCard = false;

  // Clear intervals
  if (state.cardPollingInterval) {
    clearTimeout(state.cardPollingInterval);
    state.cardPollingInterval = null;
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
    cardUidToEmployee: {},
    isScanning: false,
    cardPollingInterval: null,
    isProcessingCard: false,
    lastScannedUid: null,
    lastScanTime: 0,
    cardScanErrorCount: 0,
    nextCardPollDelay: 500,
    scanCount: 0,
    recentScans: [],
    cardServiceAvailable: false
  };
}

// ====== Main Init Function ======
export async function init() {
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
  // Return cleanup function for module unloading
  return cleanup;
}
