// frontend/js/modules/salesdata/history.js

import { getImportHistory } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';

// State
let currentPage = 1;
let itemsPerPage = 50;
let totalCount = 0;
let filterRegion = null;

/**
 * Initialize the import history page
 */
export async function initSalesDataHistory() {
  console.log('[Sales Data History] Initializing import history page');
  
  // Set up region filter
  setupRegionFilter();
  
  // Set up pagination buttons
  setupPaginationButtons();
  
  // Set up refresh button
  setupRefreshButton();
  
  // Load initial data
  await loadHistoryData();
}

/**
 * Setup region filter dropdown
 */
function setupRegionFilter() {
  const filterSelect = document.querySelector('#regionFilter');
  
  if (filterSelect) {
    filterSelect.addEventListener('change', (e) => {
      const value = e.target.value;
      filterRegion = value === '' ? null : value;
      
      // Reset to page 1 and reload
      currentPage = 1;
      loadHistoryData();
    });
  }
}

/**
 * Setup refresh button
 */
function setupRefreshButton() {
  const refreshBtn = document.querySelector('#refreshBtn');
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadHistoryData();
    });
  }
}

/**
 * Setup pagination buttons
 */
function setupPaginationButtons() {
  const prevBtn = document.querySelector('#prevPageBtn');
  const nextBtn = document.querySelector('#nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadHistoryData();
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(totalCount / itemsPerPage);
      if (currentPage < totalPages) {
        currentPage++;
        loadHistoryData();
      }
    });
  }
}

/**
 * Load history data from API
 */
async function loadHistoryData() {
  try {
    const offset = (currentPage - 1) * itemsPerPage;
    const response = await getImportHistory(itemsPerPage, offset, filterRegion);
    
    if (response.status === 'success') {
      totalCount = response.total_count;
      renderHistoryTable(response.data);
      updatePagination();
    } else {
      showToast(response.message || 'Failed to load import history', 'error');
    }
  } catch (error) {
    console.error('[Import History] Error loading data:', error);
    showToast('Failed to load import history: ' + error.message, 'error');
  }
}

/**
 * Render the history table
 */
function renderHistoryTable(data) {
  const tbody = document.querySelector('#historyTableBody');
  
  if (!tbody) {
    console.error('[Import History] Table body not found');
    return;
  }
  
  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 2rem;">
          No import history found
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = data.map(record => {
    const timestamp = new Date(record.imported_at).toLocaleString();
    const hasErrors = record.errors && record.errors.length > 0;
    const errorCount = hasErrors ? record.errors.length : 0;
    
    return `
      <tr>
        <td>${record.id}</td>
        <td>${timestamp}</td>
        <td>${record.filename || 'N/A'}</td>
        <td><span class="region-badge">${record.region.toUpperCase()}</span></td>
        <td>${record.imported_by || 'Unknown'}</td>
        <td>-</td>
        <td>${record.rows_imported + record.rows_failed}</td>
        <td>${record.rows_imported}</td>
        <td>${record.rows_failed}</td>
        <td><span class="status-badge ${record.status === 'success' ? 'status-success' : 'status-error'}">${record.status}</span></td>
        <td>
          ${hasErrors ? `<button class="modern-button btn-small" onclick="window.showImportErrors(${record.id})">View ${errorCount} Error${errorCount > 1 ? 's' : ''}</button>` : '-'}
        </td>
      </tr>
    `;
  }).join('');
  
  // Store data globally for error viewing
  window.importHistoryData = data;
}

/**
 * Show errors in a modal
 */
window.showImportErrors = function(recordId) {
  const record = window.importHistoryData?.find(r => r.id === recordId);
  
  if (!record || !record.errors) return;
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div class="modal-content" style="
      background: white;
      border-radius: 12px;
      padding: 2rem;
      max-width: 800px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="margin: 0;">Import Errors - ${record.filename}</h3>
        <button class="modal-close" style="
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: #666;
        ">&times;</button>
      </div>
      <div class="modal-body">
        <p><strong>Import ID:</strong> ${record.id}</p>
        <p><strong>Region:</strong> ${record.region.toUpperCase()}</p>
        <p><strong>Rows Failed:</strong> ${record.rows_failed}</p>
        <div class="errors-list" style="
          background: #f8f9fa;
          border-radius: 8px;
          padding: 1rem;
          margin-top: 1rem;
          max-height: 400px;
          overflow-y: auto;
        ">
          <h4 style="margin-top: 0;">Error Details:</h4>
          <ul style="margin: 0; padding-left: 1.5rem;">
            ${record.errors.map(err => `<li style="margin-bottom: 0.5rem;">${err}</li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="modal-footer" style="margin-top: 1.5rem; text-align: right;">
        <button class="modern-button btn-close-modal">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close handlers
  modal.querySelector('.modal-close').addEventListener('click', () => {
    modal.remove();
  });
  modal.querySelector('.btn-close-modal').addEventListener('click', () => {
    modal.remove();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
};

/**
 * Update pagination controls
 */
function updatePagination() {
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const pageInfo = document.querySelector('#pageInfo');
  const prevBtn = document.querySelector('#prevPageBtn');
  const nextBtn = document.querySelector('#nextPageBtn');
  
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1} (${totalCount} total imports)`;
  }
  
  if (prevBtn) {
    prevBtn.disabled = currentPage === 1;
  }
  
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }
}
