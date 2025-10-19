// js/modules/attendance/automaticReader.js
import { getReaderStatus, configureReader, processReaderEvent } from '../../services/api/attendanceApi.js';

let state = {
  readerConnected: false,
  readerConfig: {
    cardReader: { enabled: false, device: 'default' },
    fingerprintReader: { enabled: false, device: 'default' }
  },
  pollingInterval: null
};

function $(sel) { return document.querySelector(sel); }

function updateConnectionStatus() {
  const statusDiv = $('#readerStatus');
  const cardStatus = $('#cardReaderStatus');
  const fingerprintStatus = $('#fingerprintReaderStatus');
  
  if (state.readerConnected) {
    statusDiv.className = 'status-box connected';
    statusDiv.innerHTML = `
      <div class="status-indicator connected"></div>
      <div>
        <div class="status-title">Readers Connected</div>
        <div class="status-subtitle">Ready for automatic clocking</div>
      </div>
    `;
  } else {
    statusDiv.className = 'status-box disconnected';
    statusDiv.innerHTML = `
      <div class="status-indicator disconnected"></div>
      <div>
        <div class="status-title">Readers Disconnected</div>
        <div class="status-subtitle">Check device connections</div>
      </div>
    `;
  }

  cardStatus.innerHTML = `
    <div class="reader-status ${state.readerConfig.cardReader.enabled ? 'enabled' : 'disabled'}">
      <h4>💳 Card Reader</h4>
      <p>Status: ${state.readerConfig.cardReader.enabled ? 'Active' : 'Disabled'}</p>
      <p>Device: ${state.readerConfig.cardReader.device}</p>
    </div>
  `;
  
  fingerprintStatus.innerHTML = `
    <div class="reader-status ${state.readerConfig.fingerprintReader.enabled ? 'enabled' : 'disabled'}">
      <h4>👆 Fingerprint Reader</h4>
      <p>Status: ${state.readerConfig.fingerprintReader.enabled ? 'Active' : 'Disabled'}</p>
      <p>Device: ${state.readerConfig.fingerprintReader.device}</p>
    </div>
  `;
}

async function checkReaderStatus() {
  try {
    const status = await getReaderStatus();
    state.readerConnected = status.connected;
    state.readerConfig = status.config || state.readerConfig;
    updateConnectionStatus();
    
    return status;
  } catch (e) {
    console.error('Error checking reader status:', e);
    state.readerConnected = false;
    updateConnectionStatus();
  }
}

async function configureReaders() {
  const cardEnabled = $('#cardReaderEnabled').checked;
  const cardDevice = $('#cardReaderDevice').value;
  const fingerprintEnabled = $('#fingerprintReaderEnabled').checked;
  const fingerprintDevice = $('#fingerprintReaderDevice').value;

  const config = {
    cardReader: { enabled: cardEnabled, device: cardDevice },
    fingerprintReader: { enabled: fingerprintEnabled, device: fingerprintDevice }
  };

  const btn = $('#saveConfigBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await configureReader(config);
    state.readerConfig = config;
    updateConnectionStatus();
    notify('✅ Reader configuration saved successfully');
  } catch (e) {
    notify('❌ Failed to save configuration: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Configuration';
  }
}

function loadRecentEvents() {
  // Placeholder for recent events - would typically fetch from API
  const tableDiv = $('#recentEventsTable');
  tableDiv.innerHTML = `
    <table class="grid modern-table" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: rgba(0,0,0,0.05);">
          <th style="padding: 8px; text-align: left;">Time</th>
          <th style="padding: 8px; text-align: left;">Reader</th>
          <th style="padding: 8px; text-align: left;">Event</th>
          <th style="padding: 8px; text-align: left;">Employee</th>
          <th style="padding: 8px; text-align: left;">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="5" style="padding: 2rem; text-align: center; color: #666;">
            Reader events will appear here automatically
          </td>
        </tr>
      </tbody>
    </table>
  `;
}

function wireControls() {
  // Configuration form
  const saveConfigBtn = $('#saveConfigBtn');
  saveConfigBtn?.addEventListener('click', configureReaders);

  // Test connection button
  const testConnectionBtn = $('#testConnectionBtn');
  testConnectionBtn?.addEventListener('click', async () => {
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = 'Testing...';
    
    try {
      await checkReaderStatus();
      notify('✅ Connection test completed');
    } catch (e) {
      notify('❌ Connection test failed', true);
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = '🔍 Test Connection';
    }
  });

  // Refresh status button
  const refreshBtn = $('#refreshStatusBtn');
  refreshBtn?.addEventListener('click', () => {
    checkReaderStatus();
    loadRecentEvents();
    notify('🔄 Status refreshed');
  });
}

function startPolling() {
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
  }
  
  // Poll reader status every 10 seconds
  state.pollingInterval = setInterval(() => {
    checkReaderStatus();
  }, 10000);
}

function stopPolling() {
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
    state.pollingInterval = null;
  }
}

function populateConfigForm() {
  $('#cardReaderEnabled').checked = state.readerConfig.cardReader.enabled;
  $('#cardReaderDevice').value = state.readerConfig.cardReader.device;
  $('#fingerprintReaderEnabled').checked = state.readerConfig.fingerprintReader.enabled;
  $('#fingerprintReaderDevice').value = state.readerConfig.fingerprintReader.device;
}

function notify(msg, isErr = false) {
  let n = $('#notification');
  if (!n) {
    n = document.createElement('div');
    n.id = 'notification';
    n.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 10000;
      padding: 12px 20px; border-radius: 8px; color: white; font-weight: bold;
      transform: translateY(-100px); opacity: 0; transition: all 0.3s ease;
      max-width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(n);
  }
  
  n.textContent = msg;
  n.style.background = isErr ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 'linear-gradient(135deg, #27ae60, #2d3436)';
  n.style.transform = 'translateY(0)';
  n.style.opacity = '1';
  
  setTimeout(() => { 
    n.style.transform = 'translateY(-100px)';
    n.style.opacity = '0';
  }, 3000);
}

export async function init() {
  wireControls();
  await checkReaderStatus();
  populateConfigForm();
  loadRecentEvents();
  startPolling();
}

export function cleanup() {
  stopPolling();
}
