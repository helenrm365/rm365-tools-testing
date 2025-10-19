// js/modules/sales-imports/history.js
import { getImportHistory, getSalesOrders, deleteSalesOrder } from '../../services/api/salesImportsApi.js';

export async function init() {
  console.log('[Sales Imports History] Module initialized');
  
  // State
  let currentLimit = 100;
  let currentSearch = '';
  
  const historyLimit = document.getElementById('historyLimit');
  const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
  const historyTableContent = document.getElementById('historyTableContent');
  const ordersTable = document.getElementById('ordersTable');
  const ordersSearch = document.getElementById('ordersSearch');
  const searchOrdersBtn = document.getElementById('searchOrdersBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const exportOrdersBtn = document.getElementById('exportOrdersBtn');

  if (!historyTableContent || !ordersTable) {
    console.error('[History] Required elements not found in DOM');
    return;
  }

  // Load import history
  async function loadHistory() {
    const limit = parseInt(historyLimit?.value || '20');
    
    try {
      historyTableContent.innerHTML = '<p style="text-align: center; padding: 2rem; color: #999;">Loading...</p>';
      
      const data = await getImportHistory(limit);
      console.log('[History] Import history:', data);
      
      if (!data.history || data.history.length === 0) {
        historyTableContent.innerHTML = '<p style="text-align: center; padding: 2rem; color: #999;">No import history found.</p>';
        return;
      }
      
      // Build table
      let html = `
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Import ID</th>
              <th>Filename</th>
              <th>Date</th>
              <th>Records</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      data.history.forEach(item => {
        const date = item.import_date ? new Date(item.import_date).toLocaleString() : 'N/A';
        const status = item.status || 'completed';
        const statusColor = status === 'completed' ? '#28a745' : '#ffc107';
        
        html += `
          <tr>
            <td>${item.id || 'N/A'}</td>
            <td>${item.filename || 'N/A'}</td>
            <td>${date}</td>
            <td>${item.total_rows || 0}</td>
            <td><span style="color: ${statusColor}; font-weight: 500;">${status}</span></td>
          </tr>
        `;
      });
      
      html += `
          </tbody>
        </table>
      `;
      
      historyTableContent.innerHTML = html;
      
    } catch (error) {
      console.error('[History] Error loading history:', error);
      historyTableContent.innerHTML = `
        <div style="color: #dc3545; text-align: center; padding: 2rem;">
          <p>❌ Error loading import history</p>
          <p style="font-size: 0.9rem;">${error.message}</p>
        </div>
      `;
    }
  }

  // Load sales orders
  async function loadOrders() {
    try {
      ordersTable.innerHTML = '<p style="text-align: center; padding: 2rem; color: #999;">Loading orders...</p>';
      
      const data = await getSalesOrders(currentLimit, currentSearch);
      console.log('[History] Sales orders:', data);
      
      if (!data.orders || data.orders.length === 0) {
        ordersTable.innerHTML = '<p style="text-align: center; padding: 2rem; color: #999;">No orders found.</p>';
        return;
      }
      
      // Build table
      let html = `
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Product SKU</th>
              <th>Product Name</th>
              <th>Quantity</th>
              <th>Order Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      data.orders.forEach(order => {
        const orderDate = order.order_date ? new Date(order.order_date).toLocaleDateString() : 'N/A';
        
        html += `
          <tr>
            <td>${order.order_number || 'N/A'}</td>
            <td>${order.customer_name || 'N/A'}</td>
            <td>${order.product_sku || 'N/A'}</td>
            <td>${order.product_name || 'N/A'}</td>
            <td>${order.quantity || 1}</td>
            <td>${orderDate}</td>
            <td>
              <button class="btn-delete modern-button" data-id="${order.id}" style="background: linear-gradient(to bottom right, #dc3545, #c82333); padding: 0.25rem 0.75rem; font-size: 0.85rem;">
                🗑️ Delete
              </button>
            </td>
          </tr>
        `;
      });
      
      html += `
          </tbody>
        </table>
      `;
      
      ordersTable.innerHTML = html;
      
      // Attach delete handlers
      document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const orderId = e.target.closest('.btn-delete').dataset.id;
          if (confirm('Are you sure you want to delete this order?')) {
            await deleteOrder(orderId);
          }
        });
      });
      
    } catch (error) {
      console.error('[History] Error loading orders:', error);
      ordersTable.innerHTML = `
        <div style="color: #dc3545; text-align: center; padding: 2rem;">
          <p>❌ Error loading orders</p>
          <p style="font-size: 0.9rem;">${error.message}</p>
        </div>
      `;
    }
  }

  async function deleteOrder(orderId) {
    try {
      console.log('[History] Deleting order:', orderId);
      await deleteSalesOrder(orderId);
      alert('Order deleted successfully');
      await loadOrders(); // Reload the list
    } catch (error) {
      console.error('[History] Error deleting order:', error);
      alert('Error deleting order: ' + error.message);
    }
  }

  // Search orders
  function searchOrders() {
    currentSearch = ordersSearch?.value || '';
    console.log('[History] Searching for:', currentSearch);
    loadOrders();
  }

  // Export orders
  function exportOrders() {
    const table = ordersTable.querySelector('table');
    if (!table) {
      alert('No data to export');
      return;
    }
    
    // Convert table to CSV
    let csv = [];
    const rows = table.querySelectorAll('tr');
    
    rows.forEach(row => {
      const cols = row.querySelectorAll('td, th');
      const rowData = [];
      cols.forEach((col, idx) => {
        // Skip the actions column (last column)
        if (idx < cols.length - 1) {
          rowData.push('"' + col.textContent.trim().replace(/"/g, '""') + '"');
        }
      });
      csv.push(rowData.join(','));
    });
    
    // Download CSV
    const csvContent = csv.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales_orders_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // Event listeners
  historyLimit?.addEventListener('change', loadHistory);
  refreshHistoryBtn?.addEventListener('click', loadHistory);
  searchOrdersBtn?.addEventListener('click', searchOrders);
  ordersSearch?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchOrders();
    }
  });
  loadMoreBtn?.addEventListener('click', () => {
    currentLimit += 50;
    loadOrders();
  });
  exportOrdersBtn?.addEventListener('click', exportOrders);

  // Initial load
  await loadHistory();
  await loadOrders();
  
  console.log('[History] Page initialized');
}
