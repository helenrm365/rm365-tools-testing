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
  const localEndpoints = [
    'http://localhost:8080/card/scan',
    'http://127.0.0.1:8080/card/scan'
  ];

  let response = null;
  
  // Try local endpoints first
  for (const endpoint of localEndpoints) {
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

  // Start fingerprint polling with dynamic interval based on errors
  const fingerprintLoop = async () => {
    try {
      await pollFingerprint();
    } finally {
      if (state.isScanning) {
        // Use longer interval if service is unavailable
        const interval = state.fingerprintScanErrorCount >= MAX_CONSECUTIVE_ERRORS ? 5000 : 1200;
        state.fingerprintPollingInterval = setTimeout(fingerprintLoop, interval);
      }
    }
  };
  fingerprintLoop();

  const startBtn = $('#startScanBtn');
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
    clearTimeout(state.fingerprintPollingInterval);
    state.fingerprintPollingInterval = null;
  }

  updateHardwareStatus();

  const startBtn = $('#startScanBtn');
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
  const startBtn = $('#startScanBtn');
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
  
  // Auto-start scanning
  startScanning();
  
  console.log("✅ Automatic clocking module initialized");
  
  // Return cleanup function for module unloading
  return cleanup;
}
