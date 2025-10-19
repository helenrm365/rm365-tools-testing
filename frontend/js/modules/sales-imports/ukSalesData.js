// js/modules/sales-imports/ukSalesData.js
import { getUKSalesData } from '../../services/api/salesImportsApi.js';

let currentPage = 1;
let pageSize = 50;
let searchTerm = '';
let totalRecords = 0;

export async function init() {
  console.log('[UK Sales Data] Initializing...');
  await loadUKSalesData();
  setupEventListeners();
}

async function loadUKSalesData() {
  try {
    const offset = (currentPage - 1) * pageSize;
    
    const result = await getUKSalesData(pageSize, offset, searchTerm);
    
    if (result.status === 'success') {
      displaySalesData(result.data);
      updateStats(result);
      totalRecords = result.total;
      updatePaginationControls();
    } else {
      showError(result.message || 'Failed to load sales data');
    }
  } catch (error) {
    console.error('[UK Sales Data] Error loading data:', error);
    showError('Error loading sales data: ' + error.message);
  }
}

function displaySalesData(data) {
  const tbody = document.getElementById('salesTableBody');
  
  if (!tbody) {
    console.error('[UK Sales Data] Table body not found');
    return;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-row">No sales data found</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(item => {
    const statusClass = getStatusClass(item.status);
    const formattedPrice = item.price ? `£${parseFloat(item.price).toFixed(2)}` : '-';
    const formattedDate = formatDate(item.created_at);
    
    return `
      <tr>
        <td><strong>${escapeHtml(item.order_number)}</strong></td>
        <td>${formattedDate}</td>
        <td><code>${escapeHtml(item.sku)}</code></td>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.qty}</td>
        <td>${formattedPrice}</td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(item.status || 'N/A')}</span></td>
      </tr>
    `;
  }).join('');
}

function updateStats(result) {
  const totalRecordsEl = document.getElementById('totalRecords');
  const totalQtyEl = document.getElementById('totalQty');
  const totalValueEl = document.getElementById('totalValue');
  
  if (totalRecordsEl) {
    totalRecordsEl.textContent = result.total.toLocaleString();
  }
  
  // Calculate totals from current page data
  let totalQty = 0;
  let totalValue = 0;
  
  result.data.forEach(item => {
    totalQty += item.qty || 0;
    totalValue += (item.qty || 0) * (item.price || 0);
  });
  
  if (totalQtyEl) {
    totalQtyEl.textContent = totalQty.toLocaleString();
  }
  
  if (totalValueEl) {
    totalValueEl.textContent = `£${totalValue.toFixed(2)}`;
  }
}

function updatePaginationControls() {
  const totalPages = Math.ceil(totalRecords / pageSize);
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const pageInfo = document.getElementById('pageInfo');
  
  if (prevBtn) {
    prevBtn.disabled = currentPage === 1;
  }
  
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages || totalRecords === 0;
  }
  
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
  }
}

function getStatusClass(status) {
  if (!status) return '';
  const statusLower = status.toLowerCase();
  if (statusLower.includes('complete')) return 'status-complete';
  if (statusLower.includes('pending')) return 'status-pending';
  if (statusLower.includes('processing')) return 'status-processing';
  if (statusLower.includes('cancel')) return 'status-canceled';
  return '';
}

function formatDate(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateString;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  const tbody = document.getElementById('salesTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="error-message">${escapeHtml(message)}</div>
        </td>
      </tr>
    `;
  }
}

function setupEventListeners() {
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      currentPage = 1;
      loadUKSalesData();
    });
  }

  const prevBtn = document.getElementById('prevBtn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadUKSalesData();
      }
    });
  }

  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(totalRecords / pageSize);
      if (currentPage < totalPages) {
        currentPage++;
        loadUKSalesData();
      }
    });
  }

  // Search with debounce
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchTerm = e.target.value;
        currentPage = 1;
        loadUKSalesData();
      }, 300);
    });
  }
}
