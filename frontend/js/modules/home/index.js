// frontend/js/modules/home/index.js
// Dashboard home page module
import { isAuthed } from '../../services/state/sessionStore.js';
import { getUserData } from '../../services/state/userStore.js';
import { isAllowed } from '../../utils/tabs.js';
import { get } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';

let clockInterval = null;

export async function init() {
  console.log('[Dashboard] init() called');
  showToast('Initializing Dashboard...', 'info');
  
  try {
    const authenticated = isAuthed();
    console.log('[Dashboard] isAuthed:', authenticated);
    
    const loginPrompt = document.getElementById('loginPrompt');
    const dashboardContent = document.getElementById('dashboardContent');

    // Setup date/time display
    updateDateTime();
    clockInterval = setInterval(updateDateTime, 1000);

    if (authenticated) {
      showToast('Checking user permissions...', 'info');
      
      // Hide login prompt, show dashboard
      if (loginPrompt) {
        loginPrompt.hidden = true;
        loginPrompt.style.display = 'none';
      }
      if (dashboardContent) {
        dashboardContent.hidden = false;
        dashboardContent.style.display = '';
      }

      // Filter modules based on permissions
      filterModulesByPermissions();

      // Setup quick actions
      setupQuickActions();

      // Setup stat card navigation
      setupStatCards();

      showToast('Loading dashboard metrics...', 'info');
      
      // Load dashboard data (don't await - let it run in background)
      loadDashboardData().catch(e => console.warn('[Dashboard] loadDashboardData failed:', e));

      // Check system status (don't await - let it run in background)
      checkSystemStatus().catch(e => console.warn('[Dashboard] checkSystemStatus failed:', e));

    } else {
      // Show login prompt for unauthenticated users
      if (loginPrompt) {
        loginPrompt.hidden = false;
        loginPrompt.style.display = '';
      }
      if (dashboardContent) {
        dashboardContent.hidden = true;
        dashboardContent.style.display = 'none';
      }

      // Setup login button
      const goToLoginBtn = document.getElementById('goToLoginBtn');
      if (goToLoginBtn) {
        goToLoginBtn.addEventListener('click', () => {
          if (window.navigate) {
            window.navigate('/login');
          } else {
            window.location.href = '/login';
          }
        });
      }
    }
  } catch (e) {
    console.error('[Dashboard] init() error:', e);
  }
}

export function cleanup() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

function updateDateTime() {
  const now = new Date();
  const dateEl = document.getElementById('currentDate');
  const timeEl = document.getElementById('currentTime');

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}

function filterModulesByPermissions() {
  // Filter stat cards
  document.querySelectorAll('.stat-card[data-module]').forEach(card => {
    const module = card.dataset.module;
    if (!isAllowed(module)) {
      card.style.display = 'none';
    }
  });

  // Filter quick action buttons
  document.querySelectorAll('.quick-action-btn[data-path]').forEach(btn => {
    const path = btn.dataset.path;
    const module = path.split('/')[1]; // Get module from path like /attendance/clocking
    if (!isAllowed(module)) {
      btn.style.display = 'none';
    }
  });

  // Filter module navigation cards
  document.querySelectorAll('.module-nav-card[data-module]').forEach(card => {
    const module = card.dataset.module;
    if (!isAllowed(module)) {
      card.style.display = 'none';
    }
  });
}

function setupQuickActions() {
  document.querySelectorAll('.quick-action-btn[data-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.path;
      if (window.navigate) {
        window.navigate(path);
      } else {
        window.location.href = path;
      }
    });
  });

  // Refresh activity button
  const refreshBtn = document.getElementById('refreshActivity');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadRecentActivity();
    });
  }
}

function setupStatCards() {
  document.querySelectorAll('.stat-card[data-module]').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      const module = card.dataset.module;
      if (window.navigate) {
        window.navigate(`/${module}`);
      }
    });
  });
}

async function loadDashboardData() {
  console.log('[Dashboard] loadDashboardData starting...');
  // Load stats in parallel - each handles its own errors
  await Promise.allSettled([
    loadAttendanceStats(),
    loadOrderStats(),
    loadInventoryStats(),
    loadLabelStats(),
    loadRecentActivity()
  ]);
  console.log('[Dashboard] loadDashboardData completed');
}

async function loadAttendanceStats() {
  const el = document.getElementById('statAttendance');
  if (!el) {
    console.warn('[Dashboard] statAttendance element not found');
    return;
  }
  if (!isAllowed('attendance')) {
    console.log('[Dashboard] attendance not allowed, skipping');
    return;
  }

  console.log('[Dashboard] Loading attendance stats...');
  try {
    const response = await get('/v1/attendance/daily-stats');
    console.log('[Dashboard] Attendance response:', response);
    if (response && typeof response.checked_in === 'number') {
      el.textContent = response.checked_in;
    } else if (response && typeof response.total_check_ins === 'number') {
      el.textContent = response.total_check_ins;
    } else {
      el.textContent = '0';
    }
  } catch (e) {
    console.warn('[Dashboard] Failed to load attendance stats:', e);
    el.textContent = '0';
  }
}

async function loadOrderStats() {
  const el = document.getElementById('statOrders');
  if (!el || !isAllowed('orders')) return;

  try {
    // Try to get orders count - endpoint may vary
    const response = await get('/v1/orders/pending-count');
    if (response && typeof response.count === 'number') {
      el.textContent = response.count;
    } else if (response && typeof response.pending === 'number') {
      el.textContent = response.pending;
    } else {
      el.textContent = '0';
    }
  } catch (e) {
    console.warn('[Dashboard] Failed to load order stats:', e);
    el.textContent = '0';
  }
}

async function loadInventoryStats() {
  const el = document.getElementById('statInventory');
  if (!el || !isAllowed('inventory')) return;

  try {
    const response = await get('/v1/inventory/low-stock-count');
    if (response && typeof response.count === 'number') {
      el.textContent = response.count;
    } else {
      el.textContent = '0';
    }
  } catch (e) {
    console.warn('[Dashboard] Failed to load inventory stats:', e);
    el.textContent = '0';
  }
}

async function loadLabelStats() {
  const el = document.getElementById('statLabels');
  if (!el || !isAllowed('labels')) return;

  try {
    const response = await get('/v1/labels/today-count');
    if (response && typeof response.count === 'number') {
      el.textContent = response.count;
    } else if (response && typeof response.generated === 'number') {
      el.textContent = response.generated;
    } else {
      el.textContent = '0';
    }
  } catch (e) {
    console.warn('[Dashboard] Failed to load label stats:', e);
    el.textContent = '0';
  }
}

async function loadRecentActivity() {
  const container = document.getElementById('activityList');
  if (!container) return;

  // Activity feed endpoint may not exist yet - show placeholder
  container.innerHTML = `
    <div class="activity-empty">
      <p>Activity tracking coming soon</p>
    </div>
  `;
  
  // Try to load if endpoint exists
  try {
    const response = await get('/v1/dashboard/activity?limit=10');
    
    if (response && Array.isArray(response.activities) && response.activities.length > 0) {
      container.innerHTML = response.activities.map(activity => `
        <div class="activity-item">
          <div class="activity-icon ${activity.type || 'default'}">
            ${getActivityIcon(activity.type)}
          </div>
          <div class="activity-details">
            <span class="activity-message">${escapeHtml(activity.message)}</span>
            <span class="activity-time">${formatRelativeTime(activity.timestamp)}</span>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    // Silently ignore - endpoint doesn't exist yet
    console.debug('[Dashboard] Activity endpoint not available');
  }
}

async function checkSystemStatus() {
  console.log('[Dashboard] checkSystemStatus starting...');
  
  // Check API Server - use /v1/auth/me which requires auth
  await checkStatus('statusApi', 'statusApiText', async () => {
    try {
      const response = await get('/v1/auth/me');
      console.log('[Dashboard] API check response:', response);
      return !!response;
    } catch (e) {
      console.warn('[Dashboard] API check failed:', e);
      return false;
    }
  });

  // Check Database (assume OK if API works)
  await checkStatus('statusDb', 'statusDbText', async () => {
    try {
      // If API server is up, DB is likely up too
      const apiIndicator = document.getElementById('statusApi');
      if (apiIndicator && apiIndicator.classList.contains('online')) {
        return true;
      }
      // Try a simple endpoint
      const response = await get('/v1/auth/me');
      return !!response;
    } catch {
      return false;
    }
  });

  // Check Hardware Bridge
  await checkStatus('statusHardware', 'statusHardwareText', async () => {
    try {
      const response = await fetch('https://127.0.0.1:8080/health', {
        method: 'GET',
        mode: 'cors',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  });

  // Check Magento Sync
  await checkStatus('statusMagento', 'statusMagentoText', async () => {
    try {
      const response = await get('/v1/magentodata/sync-status');
      return response && response.status !== 'error';
    } catch {
      return null; // Unknown
    }
  });
}

async function checkStatus(indicatorId, textId, checkFn) {
  const indicator = document.getElementById(indicatorId);
  const text = document.getElementById(textId);
  if (!indicator || !text) {
    console.warn(`[Dashboard] checkStatus: Elements not found - indicator: ${indicatorId}, text: ${textId}`);
    return;
  }

  console.log(`[Dashboard] Checking status for ${indicatorId}...`);
  try {
    const result = await checkFn();
    console.log(`[Dashboard] Status check ${indicatorId} result:`, result);
    if (result === true) {
      indicator.className = 'status-indicator online';
      text.textContent = 'Online';
    } else if (result === false) {
      indicator.className = 'status-indicator offline';
      text.textContent = 'Offline';
    } else {
      indicator.className = 'status-indicator unknown';
      text.textContent = 'Unknown';
    }
  } catch (e) {
    console.error(`[Dashboard] checkStatus ${indicatorId} error:`, e);
    indicator.className = 'status-indicator offline';
    text.textContent = 'Error';
  }
}

function getActivityIcon(type) {
  const icons = {
    'attendance': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    'order': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    'inventory': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    'label': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    'user': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    'default': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  return icons[type] || icons.default;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-GB');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
