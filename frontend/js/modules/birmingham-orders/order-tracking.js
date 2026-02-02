import { get, post } from '../../services/api/http.js';
import { navigate } from '../../router.js';
import { wsService } from '../../services/websocket.js';
import { getUserData } from '../../services/state/userStore.js';
import { showToast } from '../../ui/toast.js';

let isMinimalMode = false;

export async function init() {
  // Wait for DOM to be ready after SPA navigation
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  
  console.log('[Order Tracking] Initializing...');
  showToast('Setting up tracking interface...', 'info');
  
  // First ensure tables exist
  try {
    const { ensureOrderTablesExist } = await import('../../services/api/ordersApi.js');
    await ensureOrderTablesExist();
  } catch (error) {
    console.error('[Order Tracking] Failed to check/initialize tables:', error);
    showToast('Warning: Could not verify database tables', 'warning');
  }
  
  // Set up event listeners
  setupEventListeners();
  
  showToast('Loading order tracking board...', 'info');
  // Load the tracking board
  await loadTrackingBoard();
  
  showToast('Connecting to live updates...', 'info');
  // Initialize WebSocket for real-time updates
  initializeWebSocket();
}

export function cleanup() {
  console.log('[Order Tracking] Cleaning up...');
  
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
      refreshBtn.classList.add('spinning');
      await loadTrackingBoard();
      setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
    };
  }
  
  // Modal close buttons
  const modal = document.getElementById('orderDetailsModal');
  const closeBtn = document.getElementById('closeOrderDetailsBtn');
  const cancelBtn = document.getElementById('cancelOrderDetailsBtn');
  
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }
  
  if (cancelBtn && modal) {
    cancelBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }
  
  // Close modal on overlay click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
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
      liveStatus.classList.add('connected');
      liveStatus.querySelector('.status-text').textContent = 'Live';
    }
  });
  
  wsService.on('disconnected', () => {
    console.log('[Order Tracking] WebSocket disconnected');
    if (liveStatus) {
      liveStatus.classList.remove('connected');
      liveStatus.querySelector('.status-text').textContent = 'Offline';
    }
  });
  
  wsService.on('connection_error', () => {
    console.log('[Order Tracking] WebSocket connection error');
    if (liveStatus) {
      liveStatus.classList.remove('connected');
      liveStatus.querySelector('.status-text').textContent = 'Connecting';
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
        liveStatus.classList.add('connected');
        liveStatus.querySelector('.status-text').textContent = 'Live';
      }
    }).catch(error => {
      console.error('[Order Tracking] WebSocket connection failed:', error);
      if (liveStatus) {
        liveStatus.classList.remove('connected');
        liveStatus.querySelector('.status-text').textContent = 'Offline';
      }
    });
  } else {
    console.warn('[Order Tracking] No user found, WebSocket not initialized');
    if (liveStatus) {
      liveStatus.classList.remove('connected');
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
    readyToPick: { id: 'readyToPickColumn', count: 'readyToPickCount', type: 'pick' },
    readyToCheck: { id: 'readyToCheckColumn', count: 'readyToCheckCount', type: 'check' },
    completed: { id: 'completedColumn', count: 'completedCount', type: 'done' }
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
      <div class="ot-empty">
        <i class="fas fa-inbox"></i>
        <span>No orders</span>
      </div>
    `;
  } else {
    // Group orders by shipping method
    const groupedOrders = groupOrdersByShippingMethod(orders);
    
    // Render each shipping method group
    groupedOrders.forEach(group => {
      // Add shipping method header
      const headerDiv = document.createElement('div');
      headerDiv.className = 'ot-group-header';
      headerDiv.innerHTML = `
        <i class="fas fa-truck"></i>
        <span>${group.shippingMethod}</span>
        <span class="ot-group-count">${group.orders.length}</span>
      `;
      columnEl.appendChild(headerDiv);
      
      // Add orders in this group
      group.orders.forEach(order => {
        const card = createCompactCard(order, column.type);
        columnEl.appendChild(card);
      });
    });
  }
}

function createCompactCard(order, type) {
  const card = document.createElement('div');
  card.className = `ot-card ot-card-${type}`;
  card.dataset.orderId = order.order_id;
  card.dataset.orderNumber = order.order_number;
  
  const progressPercent = order.progress_percentage || 0;
  const completedItems = order.completed_items || 0;
  const totalItems = order.total_items || 0;
  
  // Progress ring
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progressPercent / 100) * circumference;
  
  card.innerHTML = `
    <div class="ot-card-main">
      <div class="ot-card-order">#${order.order_number}</div>
      <div class="ot-card-details">
        ${order.customer_name ? `<span><i class="fas fa-user"></i> ${order.customer_name}</span>` : ''}
        ${order.grand_total ? `<span><i class="fas fa-dollar-sign"></i> $${parseFloat(order.grand_total).toFixed(2)}</span>` : ''}
        <span><i class="fas fa-box"></i> ${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <div class="ot-card-progress">
      <svg viewBox="0 0 32 32">
        <circle class="ring-bg" cx="16" cy="16" r="${radius}" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3"></circle>
        <circle class="ring-fill" cx="16" cy="16" r="${radius}" fill="none" stroke-width="3" stroke-linecap="round"
          stroke-dasharray="${circumference}" 
          stroke-dashoffset="${offset}"></circle>
      </svg>
      <span>${completedItems}/${totalItems}</span>
    </div>
    <i class="fas fa-chevron-right ot-card-arrow"></i>
  `;
  
  card.addEventListener('click', () => showOrderDetails(order));
  
  return card;
}

function groupOrdersByShippingMethod(orders) {
  // Group orders by shipping method
  const groups = {};
  
  orders.forEach(order => {
    const shippingMethod = order.shipping_method || 'Unknown Shipping Method';
    if (!groups[shippingMethod]) {
      groups[shippingMethod] = [];
    }
    groups[shippingMethod].push(order);
  });
  
  // Convert to array and sort - "Shipping - Free Standard Delivery" first
  const groupArray = Object.entries(groups).map(([shippingMethod, orders]) => ({
    shippingMethod,
    orders
  }));
  
  groupArray.sort((a, b) => {
    // "Shipping - Free Standard Delivery" always first
    if (a.shippingMethod === 'Shipping - Free Standard Delivery') return -1;
    if (b.shippingMethod === 'Shipping - Free Standard Delivery') return 1;
    // Then alphabetically
    return a.shippingMethod.localeCompare(b.shippingMethod);
  });
  
  return groupArray;
}

function createOrderCard(order, columnName) {
  const card = document.createElement('div');
  card.className = 'order-card';
  card.dataset.orderId = order.order_id;
  card.dataset.orderNumber = order.order_number;
  
  const statusBadgeClass = order.status.replace(/_/g, '-');
  const statusLabel = order.status.replace(/_/g, ' ').toUpperCase();
  const progressPercentage = order.progress_percentage || 0;
  const completedItems = order.completed_items || 0;
  const totalItems = order.total_items || 0;
  
  // Order tracking only shows View Details - no start/continue actions
  // Use order-fulfillment page for starting picking sessions
  const actionButtonHtml = `
    <button class="card-action-btn view-btn" data-action="view">
      <i class="fas fa-eye"></i>
      <span>View Details</span>
    </button>
  `;
  
  card.innerHTML = `
    <div class="order-card-header">
      <div class="order-number">#${order.order_number}</div>
      <span class="order-status-badge ${statusBadgeClass}">${statusLabel}</span>
    </div>
    
    <div class="order-card-info">
      ${order.customer_name ? `
        <div class="order-info-row">
          <i class="fas fa-user"></i>
          <span>${order.customer_name}</span>
        </div>
      ` : ''}
      ${order.grand_total ? `
        <div class="order-info-row">
          <i class="fas fa-dollar-sign"></i>
          <span>$${parseFloat(order.grand_total).toFixed(2)}</span>
        </div>
      ` : ''}
      <div class="order-info-row">
        <i class="fas fa-box"></i>
        <span>${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
      </div>
      ${order.picker_name || order.created_by ? `
        <div class="order-info-row">
          <i class="fas fa-user-tag"></i>
          <span>${order.picker_name || order.created_by}</span>
        </div>
      ` : ''}
    </div>
    
    <div class="order-card-footer">
      <div class="card-progress">
        <div class="card-progress-bar">
          <div class="card-progress-fill" style="width: ${progressPercentage}%"></div>
        </div>
        <div class="card-progress-text">${completedItems} / ${totalItems} items</div>
      </div>
      <div class="order-card-actions">
        <button class="card-action-btn preview-btn" data-action="preview">
          <i class="fas fa-eye"></i>
          <span>Preview</span>
        </button>
        ${actionButtonHtml}
      </div>
    </div>
  `;
  
  // Add event listeners for buttons - order tracking only has view functionality
  const previewBtn = card.querySelector('[data-action="preview"]');
  if (previewBtn) {
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showOrderDetails(order);
    });
  }
  
  const viewBtn = card.querySelector('[data-action="view"]');
  if (viewBtn) {
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showOrderDetails(order);
    });
  }
  
  // Add click handler for the whole card
  card.addEventListener('click', () => {
    showOrderDetails(order);
  });
  
  return card;
}

/**
 * Creates the new V2 order card design - compact and optimized for mobile/tablet
 * No embedded buttons - entire card is clickable
 */
function createOrderCardV2(order, columnName) {
  const card = document.createElement('div');
  card.className = 'order-card-v2';
  card.dataset.orderId = order.order_id;
  card.dataset.orderNumber = order.order_number;
  
  const statusLabel = order.status.replace(/_/g, ' ').toUpperCase();
  const progressPercentage = order.progress_percentage || 0;
  const completedItems = order.completed_items || 0;
  const totalItems = order.total_items || 0;
  
  // Calculate SVG circle values for progress ring
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progressPercentage / 100) * circumference;
  
  card.innerHTML = `
    <div class="card-v2-left">
      <div class="card-v2-order-number">#${order.order_number}</div>
      <div class="card-v2-status">
        <span class="status-dot"></span>
        ${statusLabel}
      </div>
    </div>
    
    <div class="card-v2-center">
      ${order.customer_name ? `
        <div class="card-v2-info-item">
          <i class="fas fa-user"></i>
          <span>${order.customer_name}</span>
        </div>
      ` : ''}
      ${order.grand_total ? `
        <div class="card-v2-info-item">
          <i class="fas fa-dollar-sign"></i>
          <span>$${parseFloat(order.grand_total).toFixed(2)}</span>
        </div>
      ` : ''}
      <div class="card-v2-info-item">
        <i class="fas fa-box"></i>
        <span>${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
      </div>
    </div>
    
    <div class="card-v2-right">
      <div class="card-v2-progress-ring">
        <svg viewBox="0 0 36 36">
          <circle class="ring-bg" cx="18" cy="18" r="${radius}"></circle>
          <circle class="ring-fill" cx="18" cy="18" r="${radius}" 
            stroke-dasharray="${circumference}" 
            stroke-dashoffset="${offset}">
          </circle>
        </svg>
        <span class="card-v2-progress-text">${completedItems}/${totalItems}</span>
      </div>
      <i class="fas fa-chevron-right card-v2-arrow"></i>
    </div>
  `;
  
  // Add click handler for the whole card
  card.addEventListener('click', () => {
    showOrderDetails(order);
  });
  
  return card;
}

/**
 * Cancel a session (order) from the tracking board
 * For pick-phase drafts: Returns items to inventory
 * For check-phase drafts: Just resets checking
 */
async function cancelSession(sessionId, modal) {
  try {
    const result = await post(`/api/v1/magento/sessions/${sessionId}/cancel`, {});
    
    if (result.success) {
      showToast(result.message || 'Session cancelled successfully', 'success');
      modal.classList.remove('active');
      await loadTrackingBoard();
    } else {
      showToast(result.message || 'Failed to cancel session', 'error');
    }
  } catch (error) {
    console.error('[Order Tracking] Error cancelling session:', error);
    showToast('Failed to cancel session. Please try again.', 'error');
  }
}

/**
 * Release a session back to draft status
 * Removes user assignment so another user can pick it up
 */
async function releaseSession(sessionId, modal) {
  try {
    const result = await post(`/api/v1/magento/sessions/${sessionId}/release`, {});
    
    if (result.success) {
      showToast(result.message || 'Session released to draft', 'success');
      modal.classList.remove('active');
      await loadTrackingBoard();
    } else {
      showToast(result.message || 'Failed to release session', 'error');
    }
  } catch (error) {
    console.error('[Order Tracking] Error releasing session:', error);
    showToast('Failed to release session. Please try again.', 'error');
  }
}

async function showOrderDetails(order) {
  const modal = document.getElementById('orderDetailsModal');
  const titleEl = document.getElementById('orderDetailsTitle');
  const bodyEl = document.getElementById('orderDetailsBody');
  const actionBtn = document.getElementById('orderDetailsActionBtn');
  const cancelSessionBtn = document.getElementById('orderDetailsCancelSessionBtn');
  const releaseBtn = document.getElementById('orderDetailsReleaseBtn');
  
  if (!modal || !titleEl || !bodyEl || !actionBtn) return;
  
  // Set title
  titleEl.textContent = `Order #${order.order_number}`;
  
  // Show loading state
  bodyEl.innerHTML = `
    <div style="text-align: center; padding: 3rem;">
      <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent);"></i>
      <p style="margin-top: 1rem; color: var(--text-muted);">Loading order details...</p>
    </div>
  `;
  
  // Show modal immediately with loading
  modal.classList.add('active');
  
  // Fetch full invoice details
  let invoice = null;
  try {
    invoice = await get(`/v1/magento/invoice/lookup/${order.order_number}`);
  } catch (error) {
    console.error('[Order Tracking] Failed to fetch invoice details:', error);
  }
  
  // Format dates
  const createdDate = new Date(order.created_at);
  const formattedDate = createdDate.toLocaleDateString() + ' ' + createdDate.toLocaleTimeString();
  const statusLabel = order.status?.replace(/_/g, ' ').toUpperCase() || 'PENDING';
  const progressPercentage = order.progress_percentage || 0;
  const completedItems = order.completed_items || 0;
  const totalItems = order.total_items || 0;
  
  // Build items table
  let itemsHtml = '';
  if (invoice && invoice.items && invoice.items.length > 0) {
    itemsHtml = invoice.items.map(item => `
      <tr>
        <td>${item.sku}</td>
        <td>${item.name}</td>
        <td class="text-center">${item.qty_invoiced || item.qty_ordered || 0}</td>
        <td class="text-right">$${parseFloat(item.price || 0).toFixed(2)}</td>
        <td class="text-right">$${parseFloat(item.row_total || 0).toFixed(2)}</td>
      </tr>
    `).join('');
  } else {
    itemsHtml = '<tr><td colspan="5" class="text-center">No items available</td></tr>';
  }
  
  // Build detailed body content
  bodyEl.innerHTML = `
    <div class="order-preview-container">
      <!-- Order Summary -->
      <div class="preview-section">
        <h3><i class="fas fa-info-circle"></i> Order Information</h3>
        <div class="preview-grid">
          <div class="preview-item">
            <label>Order Number:</label>
            <span>#${order.order_number}</span>
          </div>
          <div class="preview-item">
            <label>Invoice Number:</label>
            <span>${invoice?.invoice_number || order.invoice_number || 'N/A'}</span>
          </div>
          <div class="preview-item">
            <label>Order Date:</label>
            <span>${invoice?.order_date || invoice?.created_at || formattedDate}</span>
          </div>
          <div class="preview-item">
            <label>Status:</label>
            <span class="status-badge">${statusLabel}</span>
          </div>
        </div>
      </div>
      
      <!-- Customer Information -->
      <div class="preview-section">
        <h3><i class="fas fa-user"></i> Customer Information</h3>
        <div class="preview-grid two-column">
          <div class="preview-column">
            <h4>Billing Address</h4>
            <div class="preview-address">
              <div class="address-name">${invoice?.billing_name || order.customer_name || 'N/A'}</div>
              <div class="address-line">${invoice?.billing_address || 'N/A'}</div>
              <div class="address-line">${invoice?.billing_postcode || ''}</div>
              <div class="address-line">${invoice?.billing_phone || ''}</div>
            </div>
          </div>
          <div class="preview-column">
            <h4>Shipping Address</h4>
            <div class="preview-address">
              <div class="address-name">${invoice?.shipping_name || 'N/A'}</div>
              <div class="address-line">${invoice?.shipping_address || 'N/A'}</div>
              <div class="address-line">${invoice?.shipping_postcode || ''}</div>
              <div class="address-line">${invoice?.shipping_phone || ''}</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Shipping & Payment -->
      <div class="preview-section">
        <h3><i class="fas fa-truck"></i> Shipping & Payment</h3>
        <div class="preview-grid">
          <div class="preview-item">
            <label>Shipping Method:</label>
            <span>${invoice?.shipping_method || order.shipping_method || 'N/A'}</span>
          </div>
          <div class="preview-item">
            <label>Payment Method:</label>
            <span>${invoice?.payment_method || 'N/A'}</span>
          </div>
        </div>
      </div>
      
      <!-- Order Items -->
      <div class="preview-section">
        <h3><i class="fas fa-box"></i> Order Items</h3>
        <div class="preview-items-table">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product Name</th>
                <th class="text-center">Qty</th>
                <th class="text-right">Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Order Totals -->
      <div class="preview-section">
        <div class="preview-totals">
          <div class="preview-total-row">
            <label>Subtotal:</label>
            <span>$${parseFloat(invoice?.subtotal || 0).toFixed(2)}</span>
          </div>
          <div class="preview-total-row">
            <label>Tax:</label>
            <span>$${parseFloat(invoice?.tax_amount || 0).toFixed(2)}</span>
          </div>
          <div class="preview-total-row grand-total">
            <label>Grand Total:</label>
            <span>$${parseFloat(invoice?.grand_total || order.grand_total || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>
      
      <!-- Progress Section -->
      <div class="preview-section">
        <h3><i class="fas fa-tasks"></i> Fulfillment Progress</h3>
        <div class="progress-display">
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${progressPercentage}%;"></div>
          </div>
          <div class="progress-stats">
            <span class="progress-count">${completedItems} / ${totalItems} items picked</span>
            <span class="progress-percent">${Math.round(progressPercentage)}%</span>
          </div>
        </div>
        <div class="preview-grid" style="margin-top: 1rem;">
          <div class="preview-item">
            <label>Session Type:</label>
            <span style="text-transform: capitalize;">${order.session_type || 'pick'}</span>
          </div>
          <div class="preview-item">
            <label>Created By:</label>
            <span>${order.created_by || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Set action button based on status
  // Hide all optional buttons by default
  if (cancelSessionBtn) cancelSessionBtn.style.display = 'none';
  if (releaseBtn) releaseBtn.style.display = 'none';
  
  if (order.status === 'ready_to_check') {
    actionBtn.innerHTML = '<i class="fas fa-clipboard-check"></i> Start Checking';
    actionBtn.onclick = () => {
      modal.classList.remove('active');
      navigate(`/birmingham-orders/order-fulfillment/session-${order.session_id}`);
    };
    actionBtn.style.display = 'block';
    
    // Show release button for ready_to_check sessions
    if (releaseBtn) {
      releaseBtn.style.display = 'inline-flex';
      releaseBtn.onclick = async () => {
        if (confirm('Release this session back to draft? Another user can then pick it up.')) {
          await releaseSession(order.session_id, modal);
        }
      };
    }
    
    // Show cancel button for ready_to_check sessions
    if (cancelSessionBtn) {
      cancelSessionBtn.style.display = 'inline-flex';
      cancelSessionBtn.onclick = async () => {
        const confirmMessage = '⚠️ Cancel this checking session?\n\nThe picking is complete - items will remain picked. To return items to inventory, send back to picking first.';
        if (confirm(confirmMessage)) {
          await cancelSession(order.session_id, modal);
        }
      };
    }
  } else if (order.status === 'approved' || order.status === 'draft' || order.status === 'cancelled') {
    // Determine if this is a check-phase draft or pick-phase draft
    const isCheckDraft = order.session_type === 'check';
    
    if (isCheckDraft) {
      actionBtn.innerHTML = '<i class="fas fa-clipboard-check"></i> Start Checking';
    } else {
      actionBtn.innerHTML = '<i class="fas fa-play"></i> Start Picking';
    }
    actionBtn.onclick = () => {
      modal.classList.remove('active');
      navigate(`/birmingham-orders/order-fulfillment/session-${order.session_id}`);
    };
    actionBtn.style.display = 'block';
    
    // Show cancel button for draft sessions
    if (cancelSessionBtn && order.status === 'draft') {
      cancelSessionBtn.style.display = 'inline-flex';
      
      if (isCheckDraft) {
        // Check-phase draft: Just reset checking, items stay picked
        cancelSessionBtn.onclick = async () => {
          const confirmMessage = '⚠️ Cancel this checking session?\n\nPicking is complete - items will remain picked. To return items to inventory, send back to picking first.';
          if (confirm(confirmMessage)) {
            await cancelSession(order.session_id, modal);
          }
        };
      } else {
        // Pick-phase draft: Return items to inventory
        cancelSessionBtn.onclick = async () => {
          const hasPickedItems = order.completed_items > 0;
          let confirmMessage = 'Are you sure you want to cancel this order?';
          if (hasPickedItems) {
            confirmMessage = `⚠️ WARNING: This order has ${order.completed_items} picked item(s).\n\nCancelling will return ALL picked items back to inventory.\n\nAre you sure you want to cancel?`;
          }
          if (confirm(confirmMessage)) {
            await cancelSession(order.session_id, modal);
          }
        };
      }
    }
  } else if (order.status === 'in_progress') {
    actionBtn.innerHTML = '<i class="fas fa-eye"></i> View Session';
    actionBtn.onclick = () => {
      modal.classList.remove('active');
      navigate(`/birmingham-orders/order-fulfillment/session-${order.session_id}`);
    };
    actionBtn.style.display = 'block';
    
    // Show release button for in_progress sessions (to release for another user)
    if (releaseBtn) {
      releaseBtn.style.display = 'inline-flex';
      releaseBtn.onclick = async () => {
        if (confirm('Release this session? Progress will be saved and another user can continue.')) {
          await releaseSession(order.session_id, modal);
        }
      };
    }
  } else if (order.status === 'completed') {
    actionBtn.style.display = 'none';
  } else {
    actionBtn.style.display = 'none';
  }
  
  // Show modal
  modal.classList.add('active');
}

function showSuccess(message) {
  // TODO: Implement proper toast notification system
  alert(message);
}

function showError(message) {
  // TODO: Implement proper toast notification system
  alert(message);
}
