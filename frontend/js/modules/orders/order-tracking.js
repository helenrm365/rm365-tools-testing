import { get, post } from '../../services/api/http.js';
import { navigate } from '../../router.js';
import { wsService } from '../../services/websocket.js';
import { getUserData } from '../../services/state/userStore.js';

let refreshInterval = null;
let isMinimalMode = false;

export async function init() {
  console.log('[Order Tracking] Initializing...');
  
  // Set up event listeners
  setupEventListeners();
  
  // Load the tracking board
  await loadTrackingBoard();
  
  // Initialize WebSocket for real-time updates
  initializeWebSocket();
  
  // Set up auto-refresh every 30 seconds (as backup to WebSocket)
  refreshInterval = setInterval(loadTrackingBoard, 30000);
}

export function cleanup() {
  console.log('[Order Tracking] Cleaning up...');
  
  // Clear refresh interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  
  // Leave WebSocket room (if connected)
  if (wsService.isConnected()) {
    wsService.leaveRoom('order-tracking');
  }
}

function setupEventListeners() {
  // Refresh button
  const refreshBtn = document.getElementById('refreshBoardBtn');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Refreshing...';
      await loadTrackingBoard();
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    };
  }
  
  // Minimal mode toggle
  const minimalModeToggle = document.getElementById('minimalModeToggle');
  if (minimalModeToggle) {
    // Restore saved preference
    const savedMode = localStorage.getItem('orderTrackingMinimalMode');
    if (savedMode === 'true') {
      minimalModeToggle.checked = true;
      toggleMinimalMode(true);
    }
    
    minimalModeToggle.onchange = (e) => {
      const enabled = e.target.checked;
      toggleMinimalMode(enabled);
      localStorage.setItem('orderTrackingMinimalMode', enabled);
    };
  }
}

function toggleMinimalMode(enabled) {
  isMinimalMode = enabled;
  if (enabled) {
    document.body.classList.add('minimal-mode');
  } else {
    document.body.classList.remove('minimal-mode');
  }
}

function initializeWebSocket() {
  const liveStatus = document.getElementById('liveStatus');
  
  // Update status indicator on connection state changes
  wsService.on('connected', () => {
    console.log('[Order Tracking] WebSocket connected');
    if (liveStatus) {
      liveStatus.className = 'live-status connected';
      liveStatus.querySelector('.status-text').textContent = 'Live';
    }
  });
  
  wsService.on('disconnected', () => {
    console.log('[Order Tracking] WebSocket disconnected');
    if (liveStatus) {
      liveStatus.className = 'live-status disconnected';
      liveStatus.querySelector('.status-text').textContent = 'Disconnected';
    }
  });
  
  wsService.on('connection_error', () => {
    console.log('[Order Tracking] WebSocket connection error');
    if (liveStatus) {
      liveStatus.className = 'live-status connecting';
      liveStatus.querySelector('.status-text').textContent = 'Connecting...';
    }
  });
  
  // Listen for order status changes
  wsService.on('order_status_changed', async (data) => {
    console.log('[Order Tracking] Order status changed:', data);
    // Refresh the board to show the updated order
    await loadTrackingBoard();
  });
  
  // Listen for new orders
  wsService.on('order_created', async (data) => {
    console.log('[Order Tracking] New order created:', data);
    await loadTrackingBoard();
  });
  
  // Listen for deleted orders
  wsService.on('order_deleted', async (data) => {
    console.log('[Order Tracking] Order deleted:', data);
    await loadTrackingBoard();
  });
  
  // Connect to WebSocket and join room
  const currentUser = getUserData();
  if (currentUser && currentUser.username) {
    wsService.connect(currentUser).then(() => {
      console.log('[Order Tracking] WebSocket connected, joining room');
      wsService.joinRoom('order-tracking');
      
      // Update status indicator
      if (liveStatus) {
        liveStatus.className = 'live-status connected';
        liveStatus.querySelector('.status-text').textContent = 'Live';
      }
    }).catch(error => {
      console.error('[Order Tracking] WebSocket connection failed:', error);
      if (liveStatus) {
        liveStatus.className = 'live-status disconnected';
        liveStatus.querySelector('.status-text').textContent = 'Offline';
      }
    });
  } else {
    console.warn('[Order Tracking] No user found, WebSocket not initialized');
    if (liveStatus) {
      liveStatus.className = 'live-status disconnected';
      liveStatus.querySelector('.status-text').textContent = 'Offline';
    }
  }
}

async function loadTrackingBoard() {
  try {
    const response = await get('/v1/magento/tracking/board');
    
    // Update each column
    updateColumn('readyToPick', response.ready_to_pick || []);
    updateColumn('readyToCheck', response.ready_to_check || []);
    updateColumn('completed', response.completed || []);
    
  } catch (error) {
    console.error('[Order Tracking] Error loading board:', error);
    showError('Failed to load tracking board: ' + error.message);
  }
}

function updateColumn(columnName, orders) {
  const columnMap = {
    readyToPick: { id: 'readyToPickColumn', count: 'readyToPickCount' },
    readyToCheck: { id: 'readyToCheckColumn', count: 'readyToCheckCount' },
    completed: { id: 'completedColumn', count: 'completedCount' }
  };
  
  const column = columnMap[columnName];
  const columnEl = document.getElementById(column.id);
  const countEl = document.getElementById(column.count);
  
  if (!columnEl || !countEl) return;
  
  // Update count
  countEl.textContent = orders.length;
  
  // Clear column
  columnEl.innerHTML = '';
  
  // Add orders
  if (orders.length === 0) {
    columnEl.innerHTML = `
      <div class="column-empty">
        <i class="fas fa-inbox"></i>
        <p>No orders in this column</p>
      </div>
    `;
  } else {
    orders.forEach(order => {
      const card = createOrderCard(order);
      columnEl.appendChild(card);
    });
  }
}

function createOrderCard(order) {
  const card = document.createElement('div');
  card.className = 'order-card';
  card.onclick = () => showOrderDetails(order);
  
  const statusBadgeClass = order.status.replace('_', '-');
  const statusLabel = order.status.replace(/_/g, ' ').toUpperCase();
  
  const createdDate = new Date(order.created_at);
  const formattedDate = createdDate.toLocaleDateString() + ' ' + createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  card.innerHTML = `
    <div class="order-card-header">
      <div class="order-number">#${order.order_number}</div>
      <span class="order-status-badge ${statusBadgeClass}">${statusLabel}</span>
    </div>
    
    <div class="order-card-info">
      <div class="order-info-row">
        <i class="fas fa-receipt"></i>
        <span>Invoice: ${order.invoice_number}</span>
      </div>
      ${order.customer_name ? `
        <div class="order-info-row">
          <i class="fas fa-user"></i>
          <span>${order.customer_name}</span>
        </div>
      ` : ''}
      ${order.grand_total ? `
        <div class="order-info-row">
          <i class="fas fa-dollar-sign"></i>
          <span>$${order.grand_total.toFixed(2)}</span>
        </div>
      ` : ''}
      <div class="order-info-row">
        <i class="fas fa-user-circle"></i>
        <span>${order.created_by}</span>
      </div>
    </div>
    
    <div class="order-card-footer">
      <div class="order-progress">
        <div>${order.completed_items} / ${order.total_items} items</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${order.progress_percentage}%"></div>
        </div>
      </div>
      <div class="order-timestamp">${formattedDate}</div>
    </div>
  `;
  
  return card;
}

function showOrderDetails(order) {
  const modal = document.getElementById('orderDetailsModal');
  const titleEl = document.getElementById('orderDetailsTitle');
  const bodyEl = document.getElementById('orderDetailsBody');
  const actionBtn = document.getElementById('orderDetailsActionBtn');
  
  if (!modal || !titleEl || !bodyEl || !actionBtn) return;
  
  // Set title
  titleEl.innerHTML = `
    <i class="fas fa-box"></i>
    Order #${order.order_number}
  `;
  
  // Set body
  const createdDate = new Date(order.created_at);
  const formattedDate = createdDate.toLocaleDateString() + ' ' + createdDate.toLocaleTimeString();
  
  bodyEl.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
      <div>
        <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Order Number</label>
        <p style="margin: 0.25rem 0 0 0; font-size: 1rem;">#${order.order_number}</p>
      </div>
      <div>
        <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Invoice Number</label>
        <p style="margin: 0.25rem 0 0 0; font-size: 1rem;">${order.invoice_number}</p>
      </div>
      <div>
        <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Status</label>
        <p style="margin: 0.25rem 0 0 0; font-size: 1rem; text-transform: capitalize;">${order.status.replace(/_/g, ' ')}</p>
      </div>
      <div>
        <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Session Type</label>
        <p style="margin: 0.25rem 0 0 0; font-size: 1rem; text-transform: capitalize;">${order.session_type}</p>
      </div>
      ${order.customer_name ? `
        <div>
          <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Customer</label>
          <p style="margin: 0.25rem 0 0 0; font-size: 1rem;">${order.customer_name}</p>
        </div>
      ` : ''}
      ${order.grand_total ? `
        <div>
          <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Total</label>
          <p style="margin: 0.25rem 0 0 0; font-size: 1rem;">$${order.grand_total.toFixed(2)}</p>
        </div>
      ` : ''}
      <div>
        <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Created By</label>
        <p style="margin: 0.25rem 0 0 0; font-size: 1rem;">${order.created_by}</p>
      </div>
      <div>
        <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem;">Created</label>
        <p style="margin: 0.25rem 0 0 0; font-size: 1rem;">${formattedDate}</p>
      </div>
    </div>
    
    <div style="background: var(--background); padding: 1rem; border-radius: 8px;">
      <label style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem; display: block; margin-bottom: 0.5rem;">Progress</label>
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div style="flex: 1;">
          <div style="height: 8px; background: var(--border-color); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; background: var(--primary); width: ${order.progress_percentage}%; transition: width 0.3s ease;"></div>
          </div>
        </div>
        <div style="font-size: 0.875rem; color: var(--text-secondary); white-space: nowrap;">
          ${order.completed_items} / ${order.total_items} items (${Math.round(order.progress_percentage)}%)
        </div>
      </div>
    </div>
  `;
  
  // Set action button based on status
  if (order.status === 'ready_to_check') {
    actionBtn.innerHTML = '<i class="fas fa-clipboard-check"></i> Start Checking';
    actionBtn.onclick = () => {
      modal.style.display = 'none';
      navigate(`/orders/order-fulfillment/session-${order.session_id}`);
    };
    actionBtn.style.display = 'block';
  } else if (order.status === 'approved' || order.status === 'draft' || order.status === 'cancelled') {
    actionBtn.innerHTML = '<i class="fas fa-play"></i> Start Picking';
    actionBtn.onclick = () => {
      modal.style.display = 'none';
      navigate(`/orders/order-fulfillment/session-${order.session_id}`);
    };
    actionBtn.style.display = 'block';
  } else if (order.status === 'in_progress') {
    actionBtn.innerHTML = '<i class="fas fa-eye"></i> View Session';
    actionBtn.onclick = () => {
      modal.style.display = 'none';
      navigate(`/orders/order-fulfillment/session-${order.session_id}`);
    };
    actionBtn.style.display = 'block';
  } else if (order.status === 'completed') {
    actionBtn.style.display = 'none';
  } else {
    actionBtn.style.display = 'none';
  }
  
  // Show modal
  modal.style.display = 'flex';
}

function showSuccess(message) {
  // TODO: Implement proper toast notification system
  alert(message);
}

function showError(message) {
  // TODO: Implement proper toast notification system
  alert(message);
}
