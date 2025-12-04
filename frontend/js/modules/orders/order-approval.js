import { get, post } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';

class OrderApprovalManager {
  constructor() {
    this.pendingOrders = [];
    this.approvedToday = 0;
    this.currentOrderId = null;
    this.searchTerm = '';
    this.sortBy = 'date-desc';
    this.autoRefreshInterval = null;
  }

  async initialize() {
    this.setupEventListeners();
    await this.loadPendingOrders();
    this.startAutoRefresh();
  }

  setupEventListeners() {
    // Refresh button
    document.getElementById('refreshOrdersBtn')?.addEventListener('click', () => {
      this.loadPendingOrders();
    });

    // Approve all button
    document.getElementById('approveAllBtn')?.addEventListener('click', () => {
      this.approveAllOrders();
    });

    // Search input
    document.getElementById('searchOrders')?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.filterAndRenderOrders();
    });

    // Sort select
    document.getElementById('sortOrders')?.addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.filterAndRenderOrders();
    });

    // Modal approve button
    document.getElementById('approveFromModalBtn')?.addEventListener('click', () => {
      if (this.currentOrderId) {
        this.approveOrder(this.currentOrderId);
      }
    });
  }

  async loadPendingOrders() {
    try {
      console.log('[Order Approval] Loading pending orders...');
      console.log('[Order Approval] API endpoint: /v1/magento/tracking/pending-orders');
      
      const refreshBtn = document.getElementById('refreshOrdersBtn');
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
      }

      const response = await get('/v1/magento/tracking/pending-orders');
      console.log('[Order Approval] API Response:', response);
      console.log('[Order Approval] Response type:', typeof response);
      
      if (response && response.orders) {
        this.pendingOrders = response.orders;
        console.log(`[Order Approval] Loaded ${this.pendingOrders.length} pending orders`);
        
        if (this.pendingOrders.length === 0) {
          console.warn('[Order Approval] No pending orders found. Check backend logs for details.');
        } else {
          const orderNumbers = this.pendingOrders.map(o => o.order_number);
          console.log('[Order Approval] Order numbers:', orderNumbers);
        }
        
        this.approvedToday = response.approved_today || 0;
        this.updateStatistics();
        this.filterAndRenderOrders();

        // Show/hide approve all button
        const approveAllBtn = document.getElementById('approveAllBtn');
        if (approveAllBtn) {
          approveAllBtn.style.display = this.pendingOrders.length > 0 ? 'inline-flex' : 'none';
        }
      }
    } catch (error) {
      console.error('[Order Approval] Error loading pending orders:', error);
      showToast('Failed to load pending orders', 'error');
      this.renderEmptyState('Failed to load orders. Please try again.');
    } finally {
      const refreshBtn = document.getElementById('refreshOrdersBtn');
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Orders';
      }
    }
  }

  updateStatistics() {
    // Pending count
    const pendingCount = document.getElementById('pendingCount');
    if (pendingCount) {
      pendingCount.textContent = this.pendingOrders.length;
    }

    // Approved today count
    const approvedTodayCount = document.getElementById('approvedTodayCount');
    if (approvedTodayCount) {
      approvedTodayCount.textContent = this.approvedToday;
    }
  }

  filterAndRenderOrders() {
    let filteredOrders = [...this.pendingOrders];

    // Apply search filter
    if (this.searchTerm) {
      filteredOrders = filteredOrders.filter(order => {
        return (
          order.order_number.toLowerCase().includes(this.searchTerm) ||
          (order.customer_name && order.customer_name.toLowerCase().includes(this.searchTerm)) ||
          (order.customer_email && order.customer_email.toLowerCase().includes(this.searchTerm))
        );
      });
    }

    // Apply sorting
    filteredOrders.sort((a, b) => {
      switch (this.sortBy) {
        case 'date-desc':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'date-asc':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'value-desc':
          return parseFloat(b.grand_total) - parseFloat(a.grand_total);
        case 'value-asc':
          return parseFloat(a.grand_total) - parseFloat(b.grand_total);
        default:
          return 0;
      }
    });

    this.renderOrders(filteredOrders);
  }

  renderOrders(orders) {
    const container = document.getElementById('pendingOrdersList');
    if (!container) return;

    if (orders.length === 0) {
      this.renderEmptyState(
        this.searchTerm 
          ? 'No orders match your search criteria.' 
          : 'No pending orders to approve.'
      );
      return;
    }

    // Group orders by shipping method
    const groupedOrders = this.groupOrdersByShippingMethod(orders);
    
    // Build HTML with shipping method sections
    let html = '';
    groupedOrders.forEach(group => {
      // Add shipping method header
      html += `
        <div class="shipping-method-header">
          <div class="shipping-method-title">
            <i class="fas fa-shipping-fast"></i>
            <span>${group.shippingMethod}</span>
          </div>
          <span class="shipping-method-count">${group.orders.length}</span>
        </div>
      `;
      
      // Add orders in this group
      html += group.orders.map(order => this.createOrderCard(order)).join('');
    });
    
    container.innerHTML = html;

    // Add event listeners to approve buttons
    orders.forEach(order => {
      const approveBtn = document.getElementById(`approve-${order.order_id}`);
      if (approveBtn) {
        approveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.approveOrder(order.order_id);
        });
      }

      const viewBtn = document.getElementById(`view-${order.order_id}`);
      if (viewBtn) {
        viewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showOrderDetails(order);
        });
      }

      const card = document.getElementById(`card-${order.order_id}`);
      if (card) {
        card.addEventListener('click', () => {
          this.showOrderDetails(order);
        });
      }
    });
  }

  groupOrdersByShippingMethod(orders) {
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

  createOrderCard(order) {
    const createdDate = new Date(order.created_at);
    const formattedDate = createdDate.toLocaleDateString();
    const formattedTime = createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const itemCount = order.total_qty_ordered || 0;
    const grandTotal = parseFloat(order.grand_total || 0).toFixed(2);

    return `
      <div class="pending-order-card" id="card-${order.order_id}">
        <div class="pending-order-info">
          <div class="pending-order-header">
            <span class="pending-order-number">#${order.order_number}</span>
            <span class="order-status-badge">${order.status || 'processing'}</span>
          </div>
          <div class="pending-order-details">
            ${order.customer_name ? `
              <div class="pending-order-detail">
                <i class="fas fa-user"></i>
                <span>${order.customer_name}</span>
              </div>
            ` : ''}
            <div class="pending-order-detail">
              <i class="fas fa-box"></i>
              <span>${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="pending-order-detail">
              <i class="fas fa-dollar-sign"></i>
              <span>$${grandTotal}</span>
            </div>
          </div>
          <div class="pending-order-meta">
            <span><i class="fas fa-calendar"></i> ${formattedDate}</span>
            <span><i class="fas fa-clock"></i> ${formattedTime}</span>
            ${order.customer_email ? `<span><i class="fas fa-envelope"></i> ${order.customer_email}</span>` : ''}
          </div>
        </div>
        <div class="pending-order-actions">
          <button class="view-details-btn" id="view-${order.order_id}">
            <i class="fas fa-eye"></i>
            View Details
          </button>
          <button class="approve-btn" id="approve-${order.order_id}">
            <i class="fas fa-check"></i>
            Approve
          </button>
        </div>
      </div>
    `;
  }

  renderEmptyState(message) {
    const container = document.getElementById('pendingOrdersList');
    if (!container) return;

    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <h3>No Orders Found</h3>
        <p>${message}</p>
      </div>
    `;
  }

  async showOrderDetails(order) {
    this.currentOrderId = order.order_id;
    
    const modal = document.getElementById('orderDetailsModal');
    const title = document.getElementById('orderDetailsTitle');
    const body = document.getElementById('orderDetailsBody');

    if (title) {
      title.innerHTML = `
        <i class="fas fa-box"></i>
        Order #${order.order_number}
      `;
    }

    if (body) {
      const createdDate = new Date(order.created_at);
      const formattedDate = createdDate.toLocaleString();

      body.innerHTML = `
        <div class="order-details-grid">
          <div class="order-detail-item">
            <div class="order-detail-label">Order Number</div>
            <div class="order-detail-value">#${order.order_number}</div>
          </div>
          <div class="order-detail-item">
            <div class="order-detail-label">Status</div>
            <div class="order-detail-value">${order.status || 'processing'}</div>
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
            <div class="order-detail-value">${order.total_qty_ordered || 0}</div>
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
      modal.style.display = 'flex';
    }
  }

  async approveOrder(orderId) {
    try {
      // Find the order to get its order_number
      const order = this.pendingOrders.find(o => o.order_id === orderId);
      if (!order) {
        showToast('Order not found', 'error');
        return;
      }

      const response = await post('/v1/magento/tracking/approve-order', {
        order_number: order.order_number
      });

      if (response && response.session_id) {
        showToast('Order approved successfully', 'success');
        
        // Close modal if open
        const modal = document.getElementById('orderDetailsModal');
        if (modal) {
          modal.style.display = 'none';
        }

        // Reload orders
        await this.loadPendingOrders();
      }
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

    // Reload orders
    await this.loadPendingOrders();

    if (approveAllBtn) {
      approveAllBtn.disabled = false;
      approveAllBtn.innerHTML = '<i class="fas fa-check-double"></i> Approve All';
    }
  }

  startAutoRefresh() {
    // Refresh every 60 seconds
    this.autoRefreshInterval = setInterval(() => {
      this.loadPendingOrders();
    }, 60000);
  }

  cleanup() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }
  }
}

// Module instance
let approvalManager;

// Initialize the module
export async function init() {
  console.log('[Order Approval] Initializing module...');
  
  // Clean up previous instance if exists
  if (approvalManager) {
    approvalManager.cleanup();
  }
  
  approvalManager = new OrderApprovalManager();
  await approvalManager.initialize();
}

// Cleanup function
export function cleanup() {
  console.log('[Order Approval] Cleaning up module...');
  if (approvalManager) {
    approvalManager.cleanup();
    approvalManager = null;
  }
}

export default OrderApprovalManager;
