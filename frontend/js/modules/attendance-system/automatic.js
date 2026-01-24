// js/modules/attendance-system/automatic.js - Automatic clocking with NFC card support
// Now uses WebSockets for instant card scan notifications (no polling!)
import { getEmployees, clockEmployee, checkAttendanceTablesStatus, initializeAttendanceTables } from '../../services/api/attendanceApi.js';
import { playSuccessSound, playErrorSound, playScanSound, unlockAudio, isAudioUnlocked, onAudioUnlock } from '../../utils/sound.js';
import { showToast } from '../../ui/toast.js';

// ====== State Management ======
let state = {
  employees: [],
  cardUidToEmployee: {},
  isScanning: false,
  websocket: null,
  websocketReconnectTimer: null,
  isProcessingCard: false,
  lastScannedUid: null,
  lastScanTime: 0,
  cardScanErrorCount: 0,
  scanCount: 0,
  recentScans: [],
  cardServiceAvailable: false
};

// ====== Constants ======
const SCAN_COOLDOWN_MS = 1000;
const MAX_RECENT_SCANS = 10;
const WEBSOCKET_RECONNECT_DELAY = 3000;

// Hardware bridge always runs on HTTPS (wss for WebSocket)
const BRIDGE_PROTOCOL = 'https:';
const WS_PROTOCOL = 'wss:';
const BRIDGE_BASE = `${BRIDGE_PROTOCOL}//127.0.0.1:8080`;
const WS_URL = `${WS_PROTOCOL}//127.0.0.1:8080/ws/nfc`;

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

// ====== Sound Prompt Banner ======
function showSoundPrompt() {
  // Don't create duplicate
  if (document.getElementById('soundPromptBanner')) return;
  
  const banner = document.createElement('div');
  banner.id = 'soundPromptBanner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      font-size: 14px;
      font-weight: 500;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      cursor: pointer;
    " onclick="this.parentElement.remove()">
      <i class="fas fa-volume-up" style="font-size: 18px;"></i>
      <span>🔊 Click anywhere to enable scan sounds</span>
      <i class="fas fa-times" style="margin-left: 10px; opacity: 0.7;"></i>
    </div>
  `;
  document.body.prepend(banner);
}

function hideSoundPrompt() {
  const banner = document.getElementById('soundPromptBanner');
  if (banner) {
    banner.style.transition = 'opacity 0.3s, transform 0.3s';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-100%)';
    setTimeout(() => banner.remove(), 300);
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

// ====== Card Scanning via WebSocket ======
function connectWebSocket() {
  // Don't reconnect if already connected or connecting
  if (state.websocket && (state.websocket.readyState === WebSocket.OPEN || state.websocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  
  try {
    console.log('🔌 Connecting to NFC WebSocket...');
    state.websocket = new WebSocket(WS_URL);
    
    state.websocket.onopen = () => {
      console.log('✅ WebSocket connected to hardware bridge');
      state.cardServiceAvailable = true;
      state.cardScanErrorCount = 0;
      updateHardwareStatus();
      
      if (state.isScanning) {
        updateStatus('Scanning via card reader (WebSocket)', 'scanning');
      }
    };
    
    state.websocket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'card_scanned' && data.uid) {
          await handleCardScan(data.uid);
        } else if (data.type === 'connected') {
          console.log('📡 NFC Scanner ready:', data.message);
          state.cardServiceAvailable = data.nfc_available;
          updateHardwareStatus();
        } else if (data.type === 'error') {
          console.error('NFC Error:', data.error);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
    
    state.websocket.onclose = (event) => {
      console.log('🔌 WebSocket disconnected:', event.code, event.reason);
      state.cardServiceAvailable = false;
      updateHardwareStatus();
      
      // Auto-reconnect if we're supposed to be scanning
      if (state.isScanning) {
        scheduleReconnect();
      }
    };
    
    state.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      state.cardScanErrorCount++;
      
      // Will trigger onclose which handles reconnection
    };
    
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    state.cardServiceAvailable = false;
    updateHardwareStatus();
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (state.websocketReconnectTimer) {
    clearTimeout(state.websocketReconnectTimer);
  }
  
  if (state.isScanning) {
    state.websocketReconnectTimer = setTimeout(() => {
      console.log('🔄 Attempting WebSocket reconnection...');
      connectWebSocket();
    }, WEBSOCKET_RECONNECT_DELAY);
  }
}

function disconnectWebSocket() {
  if (state.websocketReconnectTimer) {
    clearTimeout(state.websocketReconnectTimer);
    state.websocketReconnectTimer = null;
  }
  
  if (state.websocket) {
    state.websocket.close(1000, 'User stopped scanning');
    state.websocket = null;
  }
}

async function handleCardScan(uid) {
  if (state.isProcessingCard || !state.isScanning) return;
  
  const normalizedUid = String(uid).toUpperCase();
  const now = Date.now();
  
  // Cooldown check to prevent duplicate scans
  if (normalizedUid === state.lastScannedUid && now - state.lastScanTime < SCAN_COOLDOWN_MS) {
    return;
  }
  
  state.lastScannedUid = normalizedUid;
  state.lastScanTime = now;
  state.isProcessingCard = true;
  
  try {
    playScanSound();
    updateStatus(`Card scanned: ${normalizedUid}`, 'scanning');
    
    // Find employee by card UID
    const employee = state.cardUidToEmployee[normalizedUid];
    
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
      } else {
        playErrorSound();
        updateStatus('❌ Clocking failed', 'error');
      }
    } catch (clockError) {
      console.error('Clock error:', clockError);
      playErrorSound();
      updateStatus('❌ Clocking failed', 'error');
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

  state.isScanning = true;
  updateStatus('Connecting to card reader...', 'scanning');
  setScannerDisplayState('Scanning Active', 'Card reader will clock employees instantly.', true);

  // Connect to WebSocket for instant card scan notifications
  connectWebSocket();

  setStartButtonState({ disabled: true, label: 'Scanning...' });
  setStopButtonState({ disabled: false });
}

function stopScanning() {
  if (!state.isScanning) return;

  state.isScanning = false;
  state.isProcessingCard = false;

  // Disconnect WebSocket
  disconnectWebSocket();

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
    startBtn.addEventListener('click', () => {
      // Unlock audio on user gesture (required for sound to work)
      unlockAudio();
      startScanning();
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', stopScanning);
  }
}

// ====== Module Cleanup ======
function cleanup() {
  stopScanning();
  disconnectWebSocket();
  state = {
    employees: [],
    cardUidToEmployee: {},
    isScanning: false,
    websocket: null,
    websocketReconnectTimer: null,
    isProcessingCard: false,
    lastScannedUid: null,
    lastScanTime: 0,
    cardScanErrorCount: 0,
    scanCount: 0,
    recentScans: [],
    cardServiceAvailable: false
  };
}

// ====== Main Init Function ======
export async function init() {
  showToast('Initializing NFC scanner...', 'info');
  
  // Cleanup any previous instances
  cleanup();
  
  showToast('Checking database status...', 'info');
  // Check if tables exist (quick status check)
  try {
    const status = await checkAttendanceTablesStatus();
    if (!status.all_tables_exist) {
      console.warn('Attendance tables do not exist, initializing...', status.tables_status);
      showToast('Initializing database tables...', 'info');
      const initResult = await initializeAttendanceTables();
      if (initResult.status === 'success') {
        showToast(`✅ Tables ready: ${initResult.tables.join(', ')}`, 'success');
      } else {
        showToast('❌ Failed to initialize tables: ' + initResult.message, 'error');
      }
    }
  } catch (error) {
    console.error('Error checking/initializing tables:', error);
    // Continue loading - tables may still work
  }
  
  showToast('Loading employee data...', 'info');
  // Load employee data
  await loadEmployees();
  
  setupEventHandlers();
  
  showToast('Connecting to hardware bridge...', 'info');
  updateStatus('Checking hardware...', 'scanning');
  updateScanCount();
  updateRecentScansTable();
  updateHardwareStatus();
  
  const hardwareReady = await evaluateHardwareStatus({ showSpinner: false });
  
  // Show sound prompt if audio isn't unlocked yet
  if (!isAudioUnlocked()) {
    showSoundPrompt();
    onAudioUnlock(() => hideSoundPrompt());
  }
  
  showToast('Starting NFC listener...', 'info');
  // Auto-start scanning - sounds will work after user clicks anywhere
  await startScanning({ skipHardwareCheck: true });
  // Return cleanup function for module unloading
  return cleanup;
}
