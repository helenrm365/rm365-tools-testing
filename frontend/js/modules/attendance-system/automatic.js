// js/modules/attendance-system/automatic.js - Automatic clocking with NFC card support
// Now uses WebSockets for instant card scan notifications (no polling!)
import { getEmployees, clockEmployee, checkAttendanceTablesStatus, initializeAttendanceTables } from '../../services/api/attendanceApi.js';
import { getLocations as getLocationObjects } from '../../services/api/locationsApi.js';
import { playSuccessSound, playErrorSound, playScanSound, unlockAudio, isAudioUnlocked, onAudioUnlock } from '../../utils/sound.js';
import { showToast } from '../../ui/toast.js';
import { getUserData } from '../../services/state/userStore.js';

// ====== State Management ======
let state = {
  employees: [],
  cardUidToEmployee: {},
  isScanning: false,
  websocket: null,
  connectionCountdownInterval: null,
  isProcessingCard: false,
  lastScannedUid: null,
  lastScanTime: 0,
  cardScanErrorCount: 0,
  scanCount: 0,
  recentScans: [],
  cardServiceAvailable: false,
  scannerTimezone: null // IANA timezone string for the scanner's location
};

// ====== Constants ======
const SCAN_COOLDOWN_MS = 1000;
const MAX_RECENT_SCANS = 10;
const DISCONNECT_COUNTDOWN_SECS = 10;

// Hardware bridge always runs on localhost (client machine)
// We detect if the current page is HTTPS or HTTP to decide between wss:// and ws://
const IS_HTTPS = window.location.protocol === 'https:';
const BRIDGE_PROTOCOL = IS_HTTPS ? 'https:' : 'http:';
const WS_PROTOCOL = IS_HTTPS ? 'wss:' : 'ws:';

const BRIDGE_BASE = `${BRIDGE_PROTOCOL}//127.0.0.1:8080`;
const WS_URL = `${WS_PROTOCOL}//127.0.0.1:8080/ws/nfc`;

// ====== Utility Functions ======
function $(sel) { return document.querySelector(sel); }

function updateStatus(message, type = 'info') {
  const statusEl = $('#scannerStatus');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = 'scanner-status-line';
  
  if (type === 'error') {
    statusEl.classList.add('status-error');
  } else if (type === 'warning') {
    statusEl.classList.add('status-warning');
  } else if (type === 'scanning') {
    statusEl.classList.add('status-scanning');
  } else {
    statusEl.classList.add('status-ready');
  }
}

function updateLastScanTime(localTime) {
  const lastScanEl = $('#lastScanTime');
  if (lastScanEl) {
    // Use the API-provided local time if available, otherwise format in scanner timezone
    if (localTime) {
      lastScanEl.textContent = localTime;
    } else if (state.scannerTimezone) {
      lastScanEl.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: state.scannerTimezone });
    } else {
      lastScanEl.textContent = new Date().toLocaleTimeString('en-GB');
    }
  }
}

function updateScanCount() {
  const scanCountEl = $('#totalScansToday');
  if (scanCountEl) {
    scanCountEl.textContent = state.scanCount.toString();
  }
}

function addRecentScan(employee, method, direction, localTime) {
  // Use API-provided local time, or format in scanner timezone, or fall back to browser time
  let displayTime;
  if (localTime) {
    displayTime = localTime;
  } else if (state.scannerTimezone) {
    displayTime = new Date().toLocaleTimeString('en-GB', { timeZone: state.scannerTimezone });
  } else {
    displayTime = new Date().toLocaleTimeString('en-GB');
  }

  const scan = {
    employee: employee.name,
    method,
    direction,
    time: displayTime,
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
  const cardStatusEl = $('#cardStatus');
  if (cardStatusEl) {
    const iconEl = cardStatusEl.querySelector('i');
    const textEl = cardStatusEl.querySelector('span');
    
    if (state.cardServiceAvailable) {
      if (iconEl) iconEl.className = 'fas fa-check-circle';
      if (textEl) textEl.textContent = 'Ready';
      cardStatusEl.classList.remove('status-error', 'status-connecting', 'status-available');
      cardStatusEl.classList.add('status-ready');
    } else {
      if (iconEl) iconEl.className = 'fas fa-exclamation-triangle';
      if (textEl) textEl.textContent = 'Unavailable';
      cardStatusEl.classList.remove('status-ready', 'status-connecting', 'status-available');
      cardStatusEl.classList.add('status-error');
    }
  }
}

function setHardwareConnecting() {
  const cardStatusEl = $('#cardStatus');
  if (cardStatusEl) {
    const iconEl = cardStatusEl.querySelector('i');
    const textEl = cardStatusEl.querySelector('span');
    if (iconEl) iconEl.className = 'fas fa-spinner fa-spin';
    if (textEl) textEl.textContent = 'Connecting';
    cardStatusEl.classList.remove('status-ready', 'status-error', 'status-available');
    cardStatusEl.classList.add('status-connecting');
  }
}

function setHardwareAvailable() {
  const cardStatusEl = $('#cardStatus');
  if (cardStatusEl) {
    const iconEl = cardStatusEl.querySelector('i');
    const textEl = cardStatusEl.querySelector('span');
    if (iconEl) iconEl.className = 'fas fa-plug';
    if (textEl) textEl.textContent = 'Available';
    cardStatusEl.classList.remove('status-ready', 'status-error', 'status-connecting');
    cardStatusEl.classList.add('status-available');
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

function setScannerActive(isActive) {
  const animationEl = $('#scannerAnimation');
  if (animationEl) {
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
    setScannerActive(false);
    updateStatus('No card reader detected, please connect card reader and try again.', 'error');
    return false;
  }

  setStartButtonState({ disabled: false, label: 'Start Scanning' });
  setStopButtonState({ disabled: true });

  setScannerActive(false);
  setHardwareAvailable();
  updateStatus('Card reader detected. Press Start Scanning to begin.', 'warning');
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
    state.cardServiceAvailable = false;
    updateHardwareStatus();
    stopScanning();
    updateStatus('Failed to load employees', 'error');
  }
}

// ====== Card Scanning via WebSocket ======
function connectWebSocket() {
  // Don't reconnect if already connected or connecting
  if (state.websocket && (state.websocket.readyState === WebSocket.OPEN || state.websocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  
  // Start connection timeout countdown
  startConnectionCountdown();
  
  try {
    console.log('🔌 Connecting to NFC WebSocket...');
    state.websocket = new WebSocket(WS_URL);
    
    state.websocket.onopen = () => {
      console.log('✅ WebSocket connected to hardware bridge');
      clearConnectionCountdown();
      state.cardServiceAvailable = true;
      state.cardScanErrorCount = 0;
      updateHardwareStatus();
      
      if (state.isScanning) {
        updateStatus('Scanner is ready', 'info');
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
      
      // If connection countdown is running, let it handle the timeout — don't override badge
      if (state.connectionCountdownInterval) return;
      
      // Connection dropped unexpectedly while scanning — try to reconnect
      if (state.isScanning) {
        state.websocket = null;
        connectWebSocket();
      } else {
        updateHardwareStatus();
      }
    };
    
    state.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      state.cardScanErrorCount++;
      // Will trigger onclose
    };
    
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    // Countdown is already running, it will handle the timeout
  }
}

function startConnectionCountdown() {
  clearConnectionCountdown();
  
  let remaining = DISCONNECT_COUNTDOWN_SECS;
  setHardwareConnecting();
  updateStatus(`Please wait patiently while the system attempts to connect... (${remaining}s)`, 'scanning');
  
  state.connectionCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      updateStatus(`Please wait patiently while the system attempts to connect... (${remaining}s)`, 'scanning');
    } else {
      // Timed out — give up
      clearConnectionCountdown();
      
      // Close the stale socket attempt
      if (state.websocket) {
        state.websocket.onclose = null; // prevent onclose from firing stopScanning again
        state.websocket.close();
        state.websocket = null;
      }
      
      state.cardServiceAvailable = false;
      updateHardwareStatus();
      
      if (state.isScanning) {
        stopScanning();
      }
      updateStatus('No card reader detected, please connect card reader and try again.', 'error');
    }
  }, 1000);
}

function clearConnectionCountdown() {
  if (state.connectionCountdownInterval) {
    clearInterval(state.connectionCountdownInterval);
    state.connectionCountdownInterval = null;
  }
}

function disconnectWebSocket() {
  clearConnectionCountdown();
  
  if (state.websocket) {
    state.websocket.onclose = null; // prevent onclose side effects
    state.websocket.close(1000, 'User stopped scanning');
    state.websocket = null;
  }
}

function playTerminalSound(soundName) {
  // 1. Play browser sound
  try {
    if (soundName === 'scan') playScanSound();
    else if (soundName === 'success') playSuccessSound();
    else if (soundName === 'error') playErrorSound();
  } catch (e) {
    console.warn('Failed to play browser audio:', e);
  }
  
  // 2. Send play_sound command to bridge for success/error only (bridge auto-plays scan sound on read)
  if (soundName !== 'scan' && state.websocket && state.websocket.readyState === WebSocket.OPEN) {
    try {
      state.websocket.send(JSON.stringify({
        type: 'play_sound',
        sound: soundName
      }));
    } catch (e) {
      console.warn('Failed to send play_sound command to bridge:', e);
    }
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
    playTerminalSound('scan');
    updateStatus(`Card scanned: ${normalizedUid}`, 'scanning');
    
    // Find employee by card UID
    const employee = state.cardUidToEmployee[normalizedUid];
    
    if (!employee) {
      playTerminalSound('error');
      updateStatus('Card not registered to any employee', 'warning');
      return;
    }
    
    // Clock the employee
    try {
      const clockResult = await clockEmployee(employee.id);
      
      if (clockResult) {
        playTerminalSound('success');
        updateStatus(`${employee.name} clocked ${clockResult.direction || 'in'}`, 'info');
        
        state.scanCount++;
        updateScanCount();
        updateLastScanTime(clockResult.local_time || null);
        addRecentScan(employee, 'card', clockResult.direction || 'in', clockResult.local_time || null);
        
        state.cardScanErrorCount = 0;
      } else {
        playTerminalSound('error');
        updateStatus('Clocking failed', 'error');
      }
    } catch (clockError) {
      console.error('Clock error:', clockError);
      playTerminalSound('error');
      updateStatus('Clocking failed', 'error');
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
  setScannerActive(true);

  // Connect to WebSocket — starts connection countdown automatically
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
  setScannerActive(false);
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
    connectionCountdownInterval: null,
    isProcessingCard: false,
    lastScannedUid: null,
    lastScanTime: 0,
    cardScanErrorCount: 0,
    scanCount: 0,
    recentScans: [],
    cardServiceAvailable: false,
    scannerTimezone: null
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
  
  // Load scanner's location timezone from the current user's location_id
  try {
    const locations = await getLocationObjects();
    const userData = getUserData();
    const locationId = userData?.location_id;
    if (locationId && Array.isArray(locations)) {
      const loc = locations.find(l => l.id === locationId);
      if (loc && loc.timezone) {
        state.scannerTimezone = loc.timezone;
        console.log(`🌍 Scanner timezone: ${state.scannerTimezone}`);
      }
    }
  } catch (tzErr) {
    console.warn('Could not load scanner timezone:', tzErr);
  }
  
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
