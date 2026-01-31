/**
 * Order Fulfillment Design Page
 * A clear, visual board showing order stages
 */

import { get } from '../../services/api/http.js';
import { wsService } from '../../services/websocket.js';
import { getUserData } from '../../services/state/userStore.js';
import { showToast } from '../../ui/toast.js';

let ordersData = { pick: [], check: [], done: [] };

export async function init() {
  console.log('[Fulfillment Design] Initializing...');
  setupEventListeners();
  await loadOrders();
  initializeWebSocket();
}

export function cleanup() {
  if (wsService.isConnected()) {
    wsService.leaveRoom('order-tracking');
  }
}

function setupEventListeners() {
  // Refresh button
  const refreshBtn = document.getElementById('fdRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      await loadOrders();
      setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
    });
  }

  // Modal close
  const modalClose = document.getElementById('fdModalCloseBtn');
  const modalCancel = document.getElementById('fdModalCancelBtn');
  const modalBackdrop = document.getElementById('fdOrderModal');
  
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }
}

async function loadOrders() {
  try {
    const response = await get('/v1/magento/tracking/board');
    
    ordersData.pick = response.ready_to_pick || [];
    ordersData.check = response.ready_to_check || [];
    ordersData.done = response.completed || [];
    
    renderBoard();
    
  } catch (error) {
    console.error('[Fulfillment Design] Error loading orders:', error);
    showToast('Failed to load orders', 'error');
  }
}

function renderBoard() {
  // Update counts
  document.getElementById('fdPickCount').textContent = ordersData.pick.length;
  document.getElementById('fdCheckCount').textContent = ordersData.check.length;
  document.getElementById('fdDoneCount').textContent = ordersData.done.length;
  
  // Render each column
  renderColumn('fdPickList', ordersData.pick, 'pick');
  renderColumn('fdCheckList', ordersData.check, 'check');
  renderColumn('fdDoneList', ordersData.done, 'done');
}

function renderColumn(containerId, orders, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  
  if (orders.length === 0) {
    container.innerHTML = `
      <div class="fd-empty">
        <i class="fas fa-inbox"></i>
        <span>No orders</span>
      </div>
    `;
    return;
  }
  
  // Group orders by shipping method
  const grouped = groupByShipping(orders);
  
  grouped.forEach(group => {
    // Add group header
    const header = document.createElement('div');
    header.className = 'fd-group-header';
    header.innerHTML = `
      <i class="fas fa-truck"></i>
      <span>${group.method}</span>
      <span class="fd-group-count">${group.orders.length}</span>
    `;
    container.appendChild(header);
    
    // Add order cards
    group.orders.forEach(order => {
      const card = createOrderCard(order, type);
      container.appendChild(card);
    });
  });
}

function groupByShipping(orders) {
  const groups = {};
  orders.forEach(order => {
    const method = order.shipping_method || 'Other';
    if (!groups[method]) groups[method] = [];
    groups[method].push(order);
  });
  
  return Object.entries(groups)
    .map(([method, orders]) => ({ method, orders }))
    .sort((a, b) => {
      // Priority shipping methods first
      if (a.method.toLowerCase().includes('express')) return -1;
      if (b.method.toLowerCase().includes('express')) return 1;
      if (a.method.toLowerCase().includes('standard')) return -1;
      if (b.method.toLowerCase().includes('standard')) return 1;
      return a.method.localeCompare(b.method);
    });
}

function createOrderCard(order, type) {
  const card = document.createElement('div');
  card.className = `fd-card fd-card-${type}`;
  
  const progressPercent = order.progress_percentage || 0;
  const completedItems = order.completed_items || 0;
  const totalItems = order.total_items || 0;
  
  // Progress ring
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progressPercent / 100) * circumference;
  
  card.innerHTML = `
    <div class="fd-card-main">
      <div class="fd-card-order">#${order.order_number}</div>
      <div class="fd-card-details">
        ${order.customer_name ? `<span><i class="fas fa-user"></i> ${order.customer_name}</span>` : ''}
        ${order.grand_total ? `<span><i class="fas fa-dollar-sign"></i> $${parseFloat(order.grand_total).toFixed(2)}</span>` : ''}
        <span><i class="fas fa-box"></i> ${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <div class="fd-card-progress">
      <svg viewBox="0 0 32 32">
        <circle class="ring-bg" cx="16" cy="16" r="${radius}"></circle>
        <circle class="ring-fill" cx="16" cy="16" r="${radius}" 
          stroke-dasharray="${circumference}" 
          stroke-dashoffset="${offset}"></circle>
      </svg>
      <span>${completedItems}/${totalItems}</span>
    </div>
    <i class="fas fa-chevron-right fd-card-arrow"></i>
  `;
  
  card.addEventListener('click', () => showOrderModal(order));
  
  return card;
}

function showOrderModal(order) {
  const modal = document.getElementById('fdOrderModal');
  const title = document.getElementById('fdModalTitle');
  const body = document.getElementById('fdModalBody');
  
  if (!modal || !title || !body) return;
  
  title.textContent = `Order #${order.order_number}`;
  
  body.innerHTML = `
    <div class="fd-modal-grid">
      <div class="fd-modal-item">
        <label>Customer</label>
        <span>${order.customer_name || 'N/A'}</span>
      </div>
      <div class="fd-modal-item">
        <label>Total</label>
        <span>$${parseFloat(order.grand_total || 0).toFixed(2)}</span>
      </div>
      <div class="fd-modal-item">
        <label>Items</label>
        <span>${order.completed_items || 0} / ${order.total_items || 0}</span>
      </div>
      <div class="fd-modal-item">
        <label>Status</label>
        <span>${order.status?.replace(/_/g, ' ').toUpperCase() || 'PENDING'}</span>
      </div>
      <div class="fd-modal-item fd-modal-item-full">
        <label>Shipping</label>
        <span>${order.shipping_method || 'N/A'}</span>
      </div>
    </div>
  `;
  
  modal.classList.add('active');
}

function closeModal() {
  const modal = document.getElementById('fdOrderModal');
  if (modal) modal.classList.remove('active');
}

function initializeWebSocket() {
  const statusEl = document.getElementById('fdLiveStatus');
  
  wsService.on('connected', () => {
    if (statusEl) statusEl.classList.add('connected');
  });
  
  wsService.on('disconnected', () => {
    if (statusEl) statusEl.classList.remove('connected');
  });
  
  wsService.on('order_status_changed', () => loadOrders());
  wsService.on('order_created', () => loadOrders());
  wsService.on('order_deleted', () => loadOrders());
  
  const currentUser = getUserData();
  if (currentUser?.username) {
    wsService.connect(currentUser).then(() => {
      wsService.joinRoom('order-tracking');
    }).catch(console.error);
  }
}
