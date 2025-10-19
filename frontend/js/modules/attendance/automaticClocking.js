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
  nextCardPollDelay: 3000,
  scanCount: 0,
  recentScans: []
};

// ====== Constants ======
const SCAN_COOLDOWN_MS = 2000;
const FINGERPRINT_COOLDOWN_MS = 3000;
const MAX_RECENT_SCANS = 10;

// SecuGen endpoints to probe for fingerprint scanning
const SGI_ENDPOINTS = [
  'https://localhost:8443/SGIFPCapture',
  'https://127.0.0.1:8443/SGIFPCapture', 
  'https://localhost:8080/SGIFPCapture',
  'https://127.0.0.1:8080/SGIFPCapture',
  'http://localhost:8080/SGIFPCapture',
  'http://127.0.0.1:8080/SGIFPCapture'
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
    <table class="modern-table" style="width: 100%;">
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
  `;

  tableEl.innerHTML = table;
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

    // No finger detected or timeout (ErrorCode 54)
    if (!data || typeof data.ErrorCode !== 'number') return;
    if (data.ErrorCode === 54) return;

    // Handle local errors
    if (data.ErrorCode !== 0) {
      if (data.ErrorCode === 10004) {
        updateStatus('Fingerprint: Service access error', 'error');
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
    // Service might be unavailable - don't spam errors
    console.debug('Fingerprint scan error:', error);
  } finally {
    state.isProcessingFingerprint = false;
  }
}

// ====== Card Scanning ======
async function pollCardScan() {
  if (state.isProcessingCard || !state.isScanning) return;

  try {
    const response = await fetch('/api/v1/enrollment/scan/card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
      },
      cache: 'no-store'
    });

    // Treat non-OK responses as "idle" (no card present)
    if (!response.ok) {
      if (response.status !== 204 && response.status !== 404) {
        state.cardScanErrorCount++;
        if (state.cardScanErrorCount > 5) {
          updateStatus('Card scanner unavailable', 'warning');
        }
      } else {
        state.cardScanErrorCount = 0;
      }
      state.nextCardPollDelay = 3000;
      return;
    }

    const data = await response.json();

    if (data && data.uid) {
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
    // Network/service errors
    state.cardScanErrorCount++;
    const backoffMs = Math.min(15000, 3000 * state.cardScanErrorCount);
    state.nextCardPollDelay = backoffMs;
    
    if (state.cardScanErrorCount > 3) {
      updateStatus('⚠️ Card service unavailable - retrying...', 'warning');
    }
    console.error('Card scan error:', error);
  } finally {
    state.isProcessingCard = false;
  }
}

// ====== Scanning Control ======
function startScanning() {
  if (state.isScanning) return;

  state.isScanning = true;
  updateStatus('Ready to scan...', 'scanning');

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

  // Start fingerprint polling
  pollFingerprint();
  state.fingerprintPollingInterval = setInterval(pollFingerprint, 1200);

  const startBtn = $('#scanFingerprintBtn');
  const stopBtn = $('#stopScanBtn');
  
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = '🔄 Scanning...';
  }
  
  if (stopBtn) {
    stopBtn.disabled = false;
  }
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
    clearInterval(state.fingerprintPollingInterval);
    state.fingerprintPollingInterval = null;
  }

  updateStatus('Scanning stopped', 'warning');

  const startBtn = $('#scanFingerprintBtn');
  const stopBtn = $('#stopScanBtn');
  
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = '🔍 Start Scanning';
  }
  
  if (stopBtn) {
    stopBtn.disabled = true;
  }
}

// ====== Event Handlers ======
function setupEventHandlers() {
  const startBtn = $('#scanFingerprintBtn');
  const stopBtn = $('#stopScanBtn');

  if (startBtn) {
    startBtn.addEventListener('click', startScanning);
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
    nextCardPollDelay: 3000,
    scanCount: 0,
    recentScans: []
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
  
  updateStatus('Ready to scan', 'info');
  updateScanCount();
  updateRecentScansTable();
  
  // Auto-start scanning
  startScanning();
  
  console.log("✅ Automatic clocking module initialized");
  
  // Return cleanup function for module unloading
  return cleanup;
}
