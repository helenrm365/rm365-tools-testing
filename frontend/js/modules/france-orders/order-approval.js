import { get, post } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';
import { wsService } from '../../services/websocket.js';
import { getUserData } from '../../services/state/userStore.js';

class OrderApprovalManager {
  constructor() {
    this.pendingOrders = [];
    this.approvedTodayOrders = [];
    this.currentOrderId = null;
    this.activeColumn = 'all-orders'; // 'all-orders', 'pending', 'approved-today'
    this.isMobileMode = false;
    this.resizeHandler = null;
  }

  async initialize() {
    this.setupEventListeners();
    this.setupMobileMode();
    await this.loadPendingOrders();
    await this.setupWebSocket();
  }

  setupMobileMode() {
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    
    // Function to check if we should be in mobile mode based on window size
    const checkMobileSize = () => {
      return window.innerWidth <= 768;
    };
    
    // Set initial state based on window size
    this.isMobileMode = checkMobileSize();
    this.toggleMobileMode(this.isMobileMode);
    
    // Create resize handler
    let resizeTimeout;
    this.resizeHandler = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const shouldBeMobile = checkMobileSize();
        if (this.isMobileMode !== shouldBeMobile) {
          this.isMobileMode = shouldBeMobile;
          this.toggleMobileMode(shouldBeMobile);
        }
      }, 100);
    };
    
    // Listen for window resize to automatically toggle mobile mode
    window.addEventListener('resize', this.resizeHandler);
    
    // Mobile tab listeners
    if (mobileColumnTabs) {
      const tabButtons = mobileColumnTabs.querySelectorAll('.mobile-tab-button');
      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          this.activeColumn = button.getAttribute('data-column');
          this.updateMobileTabs();
          this.updateMobileColumnVisibility();
          this.updateApproveAllButton();
        });
      });
    }
  }

  toggleMobileMode(enabled) {
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    const approvalBoard = document.getElementById('approvalBoard');
    const pageContainer = document.querySelector('.order-approval');
    
    if (enabled) {
      document.body.classList.add('mobile-mode');
      if (pageContainer) pageContainer.classList.add('mobile-mode-active');
      if (mobileColumnTabs) mobileColumnTabs.style.display = 'flex';
      this.updateMobileColumnVisibility();
    } else {
      document.body.classList.remove('mobile-mode');
      if (pageContainer) pageContainer.classList.remove('mobile-mode-active');
      if (mobileColumnTabs) mobileColumnTabs.style.display = 'none';
      // Show all columns
      if (approvalBoard) {
        const columns = approvalBoard.querySelectorAll('.ot-column');
        columns.forEach(col => col.style.display = 'flex');
      }
    }
    this.updateApproveAllButton();
  }

  updateMobileTabs() {
    const mobileColumnTabs = document.getElementById('mobileColumnTabs');
    if (!mobileColumnTabs) return;
    
    const tabButtons = mobileColumnTabs.querySelectorAll('.mobile-tab-button');
    tabButtons.forEach(button => {
      if (button.getAttribute('data-column') === this.activeColumn) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  }

  updateMobileColumnVisibility() {
    if (!this.isMobileMode) return;
    
    const columnMap = {
      'all-orders': 'allOrdersSection',
      'pending': 'pendingSection',
      'approved-today': 'approvedTodaySection'
    };
    
    Object.entries(columnMap).forEach(([key, sectionId]) => {
      const column = document.getElementById(sectionId);
      if (column) {
        column.style.display = key === this.activeColumn ? 'flex' : 'none';
      }
    });
  }

  updateApproveAllButton() {
    const approveAllBtn = document.getElementById('approveAllBtn');
    if (approveAllBtn) {
      // Show only when in mobile mode and on pending or all-orders column with pending orders
      const showButton = this.isMobileMode && 
                         this.activeColumn !== 'approved-today' && 
                         this.pendingOrders.length > 0;
      approveAllBtn.style.display = showButton ? 'inline-flex' : 'none';
    }
  }

  setupEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('refreshOrdersBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('spinning');
        await this.loadPendingOrders();
        setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
      });
    }

    // Approve all button
    document.getElementById('approveAllBtn')?.addEventListener('click', () => {
      this.approveAllOrders();
    });

    // Modal approve button
    document.getElementById('approveFromModalBtn')?.addEventListener('click', () => {
      if (this.currentOrderId) {
        this.approveOrder(this.currentOrderId);
      }
    });

    // Modal close buttons
    const orderDetailsModal = document.getElementById('orderDetailsModal');
    document.getElementById('closeOrderDetailsBtn')?.addEventListener('click', () => {
      orderDetailsModal?.classList.remove('active');
    });
    document.getElementById('cancelOrderDetailsBtn')?.addEventListener('click', () => {
      orderDetailsModal?.classList.remove('active');
    });
    
    // Close modal when clicking on overlay background
    orderDetailsModal?.addEventListener('click', (e) => {
      if (e.target === orderDetailsModal) {
        orderDetailsModal.classList.remove('active');
      }
    });
  }

  async loadPendingOrders() {
    try {
      console.log('[Order Approval] Loading pending orders...');
      
      const response = await get('/v1/magento/tracking/pending-orders?source=france');
      
      if (response && response.orders) {
        this.pendingOrders = response.orders;
        this.approvedTodayOrders = response.approved_today_orders || [];
        
        console.log(`[Order Approval] Loaded ${this.pendingOrders.length} pending orders`);
        console.log(`[Order Approval] Loaded ${this.approvedTodayOrders.length} approved orders today`);
        
        this.updateStatistics();
        this.renderAllColumns();

        // Update live status
        const liveStatus = document.getElementById('liveStatus');
        if (liveStatus) {
          liveStatus.classList.add('connected');
          liveStatus.querySelector('.status-text').textContent = 'Live';
        }

        // Show/hide approve all button
        const approveAllBtn = document.getElementById('approveAllBtn');
        if (approveAllBtn) {
          approveAllBtn.style.display = (this.activeColumn !== 'approved-today' && this.pendingOrders.length > 0) ? 'inline-flex' : 'none';
        }
      }
    } catch (error) {
      console.error('[Order Approval] Error loading pending orders:', error);
      showToast('Failed to load pending orders', 'error');
      
      const liveStatus = document.getElementById('liveStatus');
      if (liveStatus) {
        liveStatus.classList.remove('connected');
        liveStatus.querySelector('.status-text').textContent = 'Offline';
      }
    }
  }

  updateStatistics() {
    const allOrders = [...this.pendingOrders, ...this.approvedTodayOrders];
    
    // Update mobile tab counts
    const mobileAllCount = document.getElementById('mobileAllCount');
    if (mobileAllCount) mobileAllCount.textContent = allOrders.length;
    
    const mobilePendingCount = document.getElementById('mobilePendingCount');
    if (mobilePendingCount) mobilePendingCount.textContent = this.pendingOrders.length;
    
    const mobileApprovedTodayCount = document.getElementById('mobileApprovedTodayCount');
    if (mobileApprovedTodayCount) mobileApprovedTodayCount.textContent = this.approvedTodayOrders.length;
    
    // Update column header counts
    const allOrdersColumnCount = document.getElementById('allOrdersColumnCount');
    if (allOrdersColumnCount) allOrdersColumnCount.textContent = allOrders.length;
    
    const pendingColumnCount = document.getElementById('pendingColumnCount');
    if (pendingColumnCount) pendingColumnCount.textContent = this.pendingOrders.length;
    
    const approvedTodayColumnCount = document.getElementById('approvedTodayColumnCount');
    if (approvedTodayColumnCount) approvedTodayColumnCount.textContent = this.approvedTodayOrders.length;
  }

  renderAllColumns() {
    // All orders column
    const allOrders = [...this.pendingOrders, ...this.approvedTodayOrders];
    this.renderColumn('allOrdersColumn', allOrders, 'all');
    
    // Pending column
    this.renderColumn('pendingColumn', this.pendingOrders, 'pending');
    
    // Approved today column
    this.renderColumn('approvedTodayColumn', this.approvedTodayOrders, 'approved');
  }

  renderColumn(columnId, orders, type) {
    const columnEl = document.getElementById(columnId);
    if (!columnEl) return;
    
    columnEl.innerHTML = '';
    
    if (orders.length === 0) {
      const emptyMessages = {
        all: 'No orders to display',
        pending: 'No pending orders',
        approved: 'No orders approved today'
      };
      columnEl.innerHTML = `
        <div class="ot-empty">
          <i class="fas fa-inbox"></i>
          <span>${emptyMessages[type]}</span>
        </div>
      `;
      return;
    }
    
    // Group orders by shipping method
    const groupedOrders = this.groupOrdersByShippingMethod(orders);
    
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
        const card = this.createOrderCard(order, type);
        columnEl.appendChild(card);
      });
    });
  }

  groupOrdersByShippingMethod(orders) {
    const groups = {};
    
    orders.forEach(order => {
      const shippingMethod = order.shipping_method || 'Unknown Shipping Method';
      if (!groups[shippingMethod]) {
        groups[shippingMethod] = [];
      }
      groups[shippingMethod].push(order);
    });
    
    const groupArray = Object.entries(groups).map(([shippingMethod, orders]) => ({
      shippingMethod,
      orders
    }));
    
    groupArray.sort((a, b) => {
      if (a.shippingMethod === 'Shipping - Free Standard Delivery') return -1;
      if (b.shippingMethod === 'Shipping - Free Standard Delivery') return 1;
      return a.shippingMethod.localeCompare(b.shippingMethod);
    });
    
    return groupArray;
  }

  createOrderCard(order, type) {
    const card = document.createElement('div');
    const isApproved = order.is_approved === true;
    const cardType = isApproved ? 'approved' : 'pending';
    card.className = `ot-card ot-card-${cardType}`;
    card.dataset.orderId = order.order_id;
    card.dataset.orderNumber = order.order_number;
    
    const itemCount = order.total_qty_ordered || order.total_items || 0;
    const grandTotal = parseFloat(order.grand_total || 0).toFixed(2);
    const statusText = isApproved ? (order.session_status || 'approved') : 'pending';
    const statusClass = statusText.replace(/_/g, '-');
    
    card.innerHTML = `
      <div class="ot-card-main">
        <div class="ot-card-header">
          <span class="ot-card-order">#${order.order_number}</span>
          <span class="ot-card-status ${statusClass}">${statusText}</span>
        </div>
        <div class="ot-card-details">
          ${order.customer_name ? `<span><i class="fas fa-user"></i> ${order.customer_name}</span>` : ''}
          <span><i class="fas fa-dollar-sign"></i> $${grandTotal}</span>
          <span><i class="fas fa-box"></i> ${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      ${!isApproved ? `
        <button class="ot-card-approve-btn" title="Approve Order">
          <i class="fas fa-check"></i>
        </button>
      ` : ''}
      <i class="fas fa-chevron-right ot-card-arrow"></i>
    `;
    
    // Add click handler for approve button
    const approveBtn = card.querySelector('.ot-card-approve-btn');
    if (approveBtn) {
      approveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.approveOrder(order.order_id);
      });
    }
    
    // Add click handler for card (view details)
    card.addEventListener('click', () => {
      this.showOrderDetails(order);
    });
    
    return card;
  }

  async showOrderDetails(order) {
    this.currentOrderId = order.order_id;
    
    const modal = document.getElementById('orderDetailsModal');
    const title = document.getElementById('orderDetailsTitle');
    const body = document.getElementById('orderDetailsBody');
    const approveFromModalBtn = document.getElementById('approveFromModalBtn');
    const isApproved = order.is_approved === true;

    if (title) {
      title.textContent = `Order #${order.order_number}`;
    }

    if (approveFromModalBtn) {
      approveFromModalBtn.style.display = isApproved ? 'none' : 'inline-flex';
    }

    if (body) {
      const createdDate = new Date(order.created_at);
      const formattedDate = createdDate.toLocaleString();
      const statusText = isApproved ? (order.session_status || 'approved') : (order.status || 'processing');

      body.innerHTML = `
        <div class="order-details-grid">
          <div class="order-detail-item">
            <div class="order-detail-label">Order Number</div>
            <div class="order-detail-value">#${order.order_number}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Status</div>
            <div class="order-detail-value">${statusText}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Customer Name</div>
            <div class="order-detail-value">${order.customer_name || 'N/A'}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Customer Email</div>
            <div class="order-detail-value">${order.customer_email || 'N/A'}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Created Date</div>
            <div class="order-detail-value">${formattedDate}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Grand Total</div>
            <div class="order-detail-value">$${parseFloat(order.grand_total || 0).toFixed(2)}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Total Items</div>
            <div class="order-detail-value">${order.total_qty_ordered || order.total_items || 0}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Payment Method</div>
            <div class="order-detail-value">${order.payment_method || 'N/A'}</div>
          </div>
        </div>
        ${order.items && order.items.length > 0 ? `
          <div class="order-items-section">
            <div class="order-items-title">Order Items</div>
            <div class="order-items-list">
              ${order.items.map(item => `
                <div class="order-item">
                  <span class="order-item-name">${item.name}</span>
                  <span class="order-item-qty">Qty: ${item.qty_ordered}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;
    }

    if (modal) {
      modal.classList.add('active');
    }
  }

  async approveOrder(orderId) {
    try {
      const order = this.pendingOrders.find(o => o.order_id === orderId);
      if (!order) {
        showToast('Order not found', 'error');
        return;
      }

      // Optimistic UI update
      const orderIndex = this.pendingOrders.findIndex(o => o.order_id === orderId);
      if (orderIndex !== -1) {
        const [approvedOrder] = this.pendingOrders.splice(orderIndex, 1);
        
        const approvedOrderData = {
          ...approvedOrder,
          is_approved: true,
          session_status: 'approved',
          created_at: new Date().toISOString()
        };
        this.approvedTodayOrders.push(approvedOrderData);
        
        this.updateStatistics();
        this.renderAllColumns();
        
        const modal = document.getElementById('orderDetailsModal');
        if (modal) {
          modal.classList.remove('active');
        }
      }

      // Send API request in background
      post('/v1/magento/tracking/approve-order', {
        order_number: order.order_number
      }).then(response => {
        if (response && response.session_id) {
          showToast(`Order #${order.order_number} approved`, 'success');
        }
      }).catch(error => {
        console.error('[Order Approval] Error approving order:', error);
        showToast(error.detail || 'Failed to approve order', 'error');
        this.loadPendingOrders();
      });

    } catch (error) {
      console.error('[Order Approval] Error approving order:', error);
      showToast(error.detail || 'Failed to approve order', 'error');
    }
  }

  async approveAllOrders() {
    if (this.pendingOrders.length === 0) {
      showToast('No orders to approve', 'info');
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to approve all ${this.pendingOrders.length} pending orders?`
    );

    if (!confirmed) return;

    const approveAllBtn = document.getElementById('approveAllBtn');
    if (approveAllBtn) {
      approveAllBtn.disabled = true;
      approveAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...';
    }

    let successCount = 0;
    let failCount = 0;

    for (const order of this.pendingOrders) {
      try {
        await post('/v1/magento/tracking/approve-order', {
          order_number: order.order_number
        });
        successCount++;
      } catch (error) {
        console.error(`Failed to approve order ${order.order_number}:`, error);
        failCount++;
      }
    }

    if (successCount > 0) {
      showToast(`Successfully approved ${successCount} order${successCount !== 1 ? 's' : ''}`, 'success');
    }

    if (failCount > 0) {
      showToast(`Failed to approve ${failCount} order${failCount !== 1 ? 's' : ''}`, 'error');
    }

    await this.loadPendingOrders();

    if (approveAllBtn) {
      approveAllBtn.disabled = false;
      approveAllBtn.innerHTML = '<i class="fas fa-check-double"></i> Approve All';
    }
  }

  async setupWebSocket() {
    const currentUser = getUserData();
    if (currentUser && currentUser.username) {
      try {
        if (!wsService.isConnected()) {
          await wsService.connect(currentUser);
          console.log('[France Order Approval] WebSocket connected');
        }
        wsService.joinRoom('france_orders');
        console.log('[France Order Approval] Joined france_orders room');
        
        const liveStatus = document.getElementById('liveStatus');
        if (liveStatus) {
          liveStatus.classList.add('connected');
          liveStatus.querySelector('.status-text').textContent = 'Live';
        }
      } catch (error) {
        console.error('[France Order Approval] WebSocket connection failed:', error);
        const liveStatus = document.getElementById('liveStatus');
        if (liveStatus) {
          liveStatus.classList.remove('connected');
          liveStatus.querySelector('.status-text').textContent = 'Offline';
        }
      }
    }
    
    wsService.on('order_status_changed', this.handleOrderUpdate.bind(this));
    wsService.on('order_created', this.handleOrderUpdate.bind(this));
    wsService.on('order_deleted', this.handleOrderUpdate.bind(this));
    
    console.log('[France Order Approval] WebSocket listeners set up for real-time updates');
  }

  handleOrderUpdate(data) {
    console.log('[Order Approval] Order update received:', data);
    this.loadPendingOrders();
  }

  cleanup() {
    console.log('[France Order Approval] Cleaning up...');
    wsService.off('order_status_changed', this.handleOrderUpdate);
    wsService.off('order_created', this.handleOrderUpdate);
    wsService.off('order_deleted', this.handleOrderUpdate);
    
    if (wsService.isConnected()) {
      wsService.leaveRoom('france_orders');
    }
  }
}

let approvalManager;

export async function init() {
  console.log('[Order Approval] Initializing module...');
  showToast('Initializing approval system...', 'info');
  
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  
  try {
    const { ensureOrderTablesExist } = await import('../../services/api/ordersApi.js');
    await ensureOrderTablesExist();
  } catch (error) {
    console.error('[Order Approval] Failed to check/initialize tables:', error);
    showToast('Warning: Could not verify database tables', 'warning');
  }
  
  if (approvalManager) {
    approvalManager.cleanup();
  }
  
  showToast('Loading pending approvals...', 'info');
  approvalManager = new OrderApprovalManager();
  await approvalManager.initialize();
}

export function cleanup() {
  console.log('[Order Approval] Cleaning up module...');
  if (approvalManager) {
    approvalManager.cleanup();
    approvalManager = null;
  }
}

export default OrderApprovalManager;
