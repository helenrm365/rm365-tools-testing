// js/modules/labels/printHistory.js
import { getPrintHistory, deletePrintRecord, reprintLabel } from '../../services/api/labelsApi.js';
import { formatDateTime } from '../../utils/formatters.js';

let state = {
  history: [],
  filteredHistory: [],
  currentPage: 1,
  itemsPerPage: 25,
  filters: {
    labelName: '',
    dateFrom: '',
    dateTo: '',
    status: ''
  }
};

function $(sel) { return document.querySelector(sel); }

async function loadHistory() {
  try {
    const params = {};
    
    // Add filters to API request
    if (state.filters.labelName) params.label_name = state.filters.labelName;
    if (state.filters.dateFrom) params.date_from = state.filters.dateFrom;
    if (state.filters.dateTo) params.date_to = state.filters.dateTo;
    if (state.filters.status) params.status = state.filters.status;
    
    state.history = await getPrintHistory(params);
    state.filteredHistory = [...state.history];
    state.currentPage = 1;
    
    renderHistoryTable();
    updatePagination();
    updateSummaryStats();
    
  } catch (e) {
    console.error('Error loading print history:', e);
    notify('❌ Failed to load print history', true);
    renderErrorState();
  }
}

function renderHistoryTable() {
  const tableDiv = $('#historyTable');
  
  if (state.filteredHistory.length === 0) {
    tableDiv.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: #666;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">🖨️</div>
        <h3>No print history found</h3>
        <p>Try adjusting your search filters or date range.</p>
      </div>
    `;
    return;
  }

  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const pageData = state.filteredHistory.slice(startIndex, endIndex);

  tableDiv.innerHTML = `
    <div class="table-container">
    <table class="modern-table">
      <thead>
        <tr>
          <th style="text-align: left;">Print Details</th>
          <th style="text-align: left;">Label Info</th>
          <th style="text-align: center;">Quantity</th>
          <th style="text-align: center;">Status</th>
          <th style="text-align: center;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pageData.map(record => `
          <tr>
            <td>
              <div style="font-weight: 500;">${formatDateTime(record.printed_at)}</div>
              <div style="font-size: 0.85em; color: #666;">
                ID: ${record.id} | ${record.printer_name || 'Default Printer'}
              </div>
              ${record.error_message ? `
                <div style="font-size: 0.8em; color: #e74c3c; margin-top: 4px;">
                  Error: ${record.error_message}
                </div>
              ` : ''}
            </td>
            <td>
              <div style="font-weight: 500;">${record.label_name}</div>
              <div style="font-size: 0.85em; color: #666;">
                Size: ${record.label_width}" × ${record.label_height}"
              </div>
              ${record.data_fields ? `
                <div style="font-size: 0.8em; color: #888; margin-top: 4px;">
                  Fields: ${Object.keys(JSON.parse(record.data_fields)).length} items
                </div>
              ` : ''}
            </td>
            <td style="text-align: center;">
              <span style="font-weight: 500; font-size: 1.1em;">${record.quantity}</span>
            </td>
            <td style="text-align: center;">
              <span class="status-badge ${getStatusClass(record.status)}">
                ${getStatusIcon(record.status)} ${record.status}
              </span>
            </td>
            <td style="text-align: center;">
              <div class="btn-group">
                ${record.status === 'success' ? `
                  <button class="btn-icon primary" onclick="reprintRecord(${record.id})" title="Reprint this label">
                    🖨️
                  </button>
                ` : ''}
                <button class="btn-icon info" onclick="viewRecordDetails(${record.id})" title="View details">
                  👁️
                </button>
                <button class="btn-icon danger" onclick="deleteRecord(${record.id})" title="Delete record">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function getStatusClass(status) {
  const classes = {
    'success': 'success',
    'failed': 'danger',
    'pending': 'warning',
    'cancelled': 'secondary'
  };
  return classes[status] || 'secondary';
}

function getStatusIcon(status) {
  const icons = {
    'success': '✅',
    'failed': '❌',
    'pending': '⏳',
    'cancelled': '⏹️'
  };
  return icons[status] || '❓';
}

function renderErrorState() {
  const tableDiv = $('#historyTable');
  tableDiv.innerHTML = `
    <div style="text-align: center; padding: 3rem; color: #e74c3c;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
      <h3>Failed to load history</h3>
      <p>There was an error loading the print history. Please try again.</p>
      <button class="btn primary" onclick="location.reload()">🔄 Retry</button>
    </div>
  `;
}

function updatePagination() {
  const paginationDiv = $('#pagination');
  const totalPages = Math.ceil(state.filteredHistory.length / state.itemsPerPage);
  
  if (totalPages <= 1) {
    paginationDiv.innerHTML = '';
    return;
  }

  let paginationHTML = '<div class="pagination">';
  
  // Previous button
  if (state.currentPage > 1) {
    paginationHTML += `<button class="page-btn" onclick="goToPage(${state.currentPage - 1})">← Previous</button>`;
  }
  
  // Page numbers
  const startPage = Math.max(1, state.currentPage - 2);
  const endPage = Math.min(totalPages, state.currentPage + 2);
  
  if (startPage > 1) {
    paginationHTML += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) paginationHTML += '<span class="page-ellipsis">...</span>';
  }
  
  for (let i = startPage; i <= endPage; i++) {
    paginationHTML += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationHTML += '<span class="page-ellipsis">...</span>';
    paginationHTML += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }
  
  // Next button
  if (state.currentPage < totalPages) {
    paginationHTML += `<button class="page-btn" onclick="goToPage(${state.currentPage + 1})">Next →</button>`;
  }
  
  paginationHTML += '</div>';
  paginationDiv.innerHTML = paginationHTML;
}

function updateSummaryStats() {
  const summaryDiv = $('#summaryStats');
  
  const totalPrints = state.filteredHistory.reduce((sum, record) => sum + record.quantity, 0);
  const successfulPrints = state.filteredHistory.filter(record => record.status === 'success').length;
  const failedPrints = state.filteredHistory.filter(record => record.status === 'failed').length;
  const totalRecords = state.filteredHistory.length;
  
  summaryDiv.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalRecords}</div>
        <div class="stat-label">Print Jobs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalPrints}</div>
        <div class="stat-label">Labels Printed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${successfulPrints}</div>
        <div class="stat-label">Successful</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${failedPrints}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>
  `;
}

function applyFilters() {
  state.filters.labelName = $('#labelNameFilter').value;
  state.filters.dateFrom = $('#dateFromFilter').value;
  state.filters.dateTo = $('#dateToFilter').value;
  state.filters.status = $('#statusFilter').value;
  
  // Apply filters to history
  state.filteredHistory = state.history.filter(record => {
    if (state.filters.labelName && !record.label_name.toLowerCase().includes(state.filters.labelName.toLowerCase())) {
      return false;
    }
    
    if (state.filters.dateFrom && new Date(record.printed_at) < new Date(state.filters.dateFrom)) {
      return false;
    }
    
    if (state.filters.dateTo && new Date(record.printed_at) > new Date(state.filters.dateTo + 'T23:59:59')) {
      return false;
    }
    
    if (state.filters.status && record.status !== state.filters.status) {
      return false;
    }
    
    return true;
  });
  
  state.currentPage = 1;
  renderHistoryTable();
  updatePagination();
  updateSummaryStats();
}

function clearFilters() {
  // Reset filter form
  $('#labelNameFilter').value = '';
  $('#dateFromFilter').value = '';
  $('#dateToFilter').value = '';
  $('#statusFilter').value = '';
  
  // Reset filters and reload
  state.filters = { labelName: '', dateFrom: '', dateTo: '', status: '' };
  state.filteredHistory = [...state.history];
  state.currentPage = 1;
  
  renderHistoryTable();
  updatePagination();
  updateSummaryStats();
}

function wireControls() {
  // Filter controls
  $('#applyFiltersBtn')?.addEventListener('click', applyFilters);
  $('#clearFiltersBtn')?.addEventListener('click', clearFilters);
  $('#refreshBtn')?.addEventListener('click', loadHistory);
  
  // Quick filter buttons
  $('#filterTodayBtn')?.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    $('#dateFromFilter').value = today;
    $('#dateToFilter').value = today;
    applyFilters();
  });
  
  $('#filterThisWeekBtn')?.addEventListener('click', () => {
    const today = new Date();
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const endOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + 6));
    
    $('#dateFromFilter').value = startOfWeek.toISOString().split('T')[0];
    $('#dateToFilter').value = endOfWeek.toISOString().split('T')[0];
    applyFilters();
  });
}

// Global functions
window.goToPage = function(page) {
  state.currentPage = page;
  renderHistoryTable();
  updatePagination();
};

window.reprintRecord = async function(recordId) {
  if (!confirm('Are you sure you want to reprint this label?')) {
    return;
  }
  
  try {
    await reprintLabel(recordId);
    notify('✅ Label sent to printer successfully');
    await loadHistory(); // Reload history to show new print job
  } catch (e) {
    notify('❌ Failed to reprint label: ' + e.message, true);
  }
};

window.viewRecordDetails = function(recordId) {
  const record = state.history.find(r => r.id === recordId);
  if (!record) return;
  
  const details = `
    Print Job Details:
    
    ID: ${record.id}
    Label: ${record.label_name}
    Date: ${formatDateTime(record.printed_at)}
    Quantity: ${record.quantity}
    Status: ${record.status}
    Printer: ${record.printer_name || 'Default'}
    
    ${record.data_fields ? 'Data Fields:\n' + JSON.stringify(JSON.parse(record.data_fields), null, 2) : 'No custom data'}
    
    ${record.error_message ? 'Error: ' + record.error_message : ''}
  `;
  
  alert(details);
};

window.deleteRecord = async function(recordId) {
  if (!confirm('Are you sure you want to delete this print record? This action cannot be undone.')) {
    return;
  }
  
  try {
    await deletePrintRecord(recordId);
    notify('✅ Print record deleted successfully');
    await loadHistory(); // Reload history
  } catch (e) {
    notify('❌ Failed to delete record: ' + e.message, true);
  }
};

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
  await loadHistory();
}
