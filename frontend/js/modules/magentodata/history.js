// frontend/js/modules/magentodata/history.js

import { getImportHistory } from '../../services/api/magentoDataApi.js?v=5';
import { showToast } from '../../ui/toast.js';

// State
let currentPage = 1;
let itemsPerPage = 50;
let totalCount = 0;
let filterRegion = null;
let filterStatus = null;

/**
 * Initialize the import history page
 */
export async function initMagentoDataHistory() {
  showToast('Setting up history interface...', 'info');
  
  // Set up custom dropdown functionality
  setupCustomDropdowns();
  
  // Set up filters
  setupFilters();
  
  // Set up pagination buttons
  setupPaginationButtons();
  
  // Set up refresh button
  setupRefreshButton();
  
  showToast('Loading import history...', 'info');
  // Load initial data
  await loadHistoryData();
}

/**
 * Setup custom dropdown functionality
 */
function setupCustomDropdowns() {
  // Toggle dropdown on click
  window.toggleDropdown = function(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    // Close any other open dropdowns
    document.querySelectorAll('.custom-dropdown.open').forEach(d => {
      if (d.id !== dropdownId) {
        d.classList.remove('open');
      }
    });
    
    dropdown.classList.toggle('open');
  };
  
  // Select option handler
  window.selectOption = function(element, dropdownId, value, text) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    // Update selected display
    const selected = dropdown.querySelector('.dropdown-selected');
    if (selected) {
      selected.textContent = text;
    }
    
    // Update hidden input
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    if (hiddenInput) {
      hiddenInput.value = value;
      // Dispatch change event
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Update selected class
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    element.classList.add('selected');
    
    // Close dropdown
    dropdown.classList.remove('open');
  };
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
      document.querySelectorAll('.custom-dropdown.open').forEach(d => {
        d.classList.remove('open');
      });
    }
  });
}

/**
 * Setup filter event listeners
 */
function setupFilters() {
  // Region filter
  const regionInput = document.querySelector('#regionFilter');
  if (regionInput) {
    regionInput.addEventListener('change', (e) => {
      filterRegion = e.target.value === '' ? null : e.target.value;
    });
  }
  
  // Status filter
  const statusInput = document.querySelector('#statusFilter');
  if (statusInput) {
    statusInput.addEventListener('change', (e) => {
      filterStatus = e.target.value === '' ? null : e.target.value;
    });
  }
  
  // Apply filters button
  const applyBtn = document.querySelector('#applyFiltersBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      currentPage = 1;
      loadHistoryData();
    });
  }
  
  // Clear filters button
  const clearBtn = document.querySelector('#clearFiltersBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // Reset filters
      filterRegion = null;
      filterStatus = null;
      
      // Reset dropdown displays
      const regionDropdown = document.getElementById('region-dropdown');
      if (regionDropdown) {
        const selected = regionDropdown.querySelector('.dropdown-selected');
        if (selected) selected.textContent = 'All Regions';
        const hiddenInput = regionDropdown.querySelector('input[type="hidden"]');
        if (hiddenInput) hiddenInput.value = '';
        regionDropdown.querySelectorAll('.dropdown-option').forEach((opt, i) => {
          opt.classList.toggle('selected', i === 0);
        });
      }
      
      const statusDropdown = document.getElementById('status-dropdown');
      if (statusDropdown) {
        const selected = statusDropdown.querySelector('.dropdown-selected');
        if (selected) selected.textContent = 'All Statuses';
        const hiddenInput = statusDropdown.querySelector('input[type="hidden"]');
        if (hiddenInput) hiddenInput.value = '';
        statusDropdown.querySelectorAll('.dropdown-option').forEach((opt, i) => {
          opt.classList.toggle('selected', i === 0);
        });
      }
      
      // Reset date inputs
      const fromDate = document.querySelector('#fromDate');
      const toDate = document.querySelector('#toDate');
      if (fromDate) fromDate.value = '';
      if (toDate) toDate.value = '';
      
      // Reload data
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
 * Fallback demo data when connection fails
 */
function getFallbackHistoryData() {
  return [
    {
      id: 1,
      imported_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      filename: 'uk_orders_export_2024.csv',
      region: 'uk',
      rows_imported: 1250,
      rows_failed: 3,
      status: 'success',
      errors: null
    },
    {
      id: 2,
      imported_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      filename: 'fr_orders_export_2024.csv',
      region: 'fr',
      rows_imported: 890,
      rows_failed: 0,
      status: 'success',
      errors: null
    },
    {
      id: 3,
      imported_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      filename: 'nl_orders_export_2024.csv',
      region: 'nl',
      rows_imported: 0,
      rows_failed: 45,
      status: 'error',
      errors: [{ row: 1, message: 'Invalid SKU format' }, { row: 12, message: 'Missing required field' }]
    },
    {
      id: 4,
      imported_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      filename: 'uk_inventory_sync.csv',
      region: 'uk',
      rows_imported: 2100,
      rows_failed: 12,
      status: 'success',
      errors: null
    },
    {
      id: 5,
      imported_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      filename: 'fr_catalog_update.csv',
      region: 'fr',
      rows_imported: 567,
      rows_failed: 0,
      status: 'success',
      errors: null
    }
  ];
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
      console.error('[Import History] API returned error:', response.message);
      console.log('[Import History] Using fallback demo data');
      
      // Use fallback demo data when API returns error
      const fallbackData = getFallbackHistoryData();
      const filteredData = filterRegion 
        ? fallbackData.filter(d => d.region === filterRegion)
        : fallbackData;
      
      totalCount = filteredData.length;
      renderHistoryTable(filteredData);
      updatePagination();
      showToast('Using demo data - backend not connected', 'info');
    }
  } catch (error) {
    console.error('[Import History] Error loading data:', error);
    console.log('[Import History] Using fallback demo data');
    
    // Use fallback demo data when connection fails
    const fallbackData = getFallbackHistoryData();
    
    // Filter by region if needed
    const filteredData = filterRegion 
      ? fallbackData.filter(d => d.region === filterRegion)
      : fallbackData;
    
    totalCount = filteredData.length;
    renderHistoryTable(filteredData);
    updatePagination();
    showToast('Using demo data - backend not connected', 'info');
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
        <td colspan="6">
          <div class="empty-state-message">
            <i class="fas fa-folder-open"></i>
            <div class="empty-title">No import history found</div>
            <div class="empty-subtitle">Adjust your filters or check back later</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = data.map(record => {
    const timestamp = new Date(record.imported_at).toLocaleString();
    const hasErrors = record.errors && record.errors.length > 0;
    const errorCount = hasErrors ? record.errors.length : 0;
    const statusClass = record.status === 'success' ? 'status-success' : 
                       record.status === 'error' ? 'status-error' : 
                       record.status === 'processing' ? 'status-processing' : 'status-pending';
    
    return `
      <tr>
        <td>${timestamp}</td>
        <td>${record.filename || 'N/A'}</td>
        <td><span class="status-badge">${record.region.toUpperCase()}</span></td>
        <td>${record.rows_imported + record.rows_failed}</td>
        <td class="status-cell"><span class="status-badge ${statusClass}">${record.status}</span></td>
        <td class="action-cell">
          ${hasErrors ? `<button class="icon-btn" onclick="window.showImportErrors(${record.id})" title="View ${errorCount} errors"><i class="fas fa-exclamation-triangle"></i></button>` : '<span>-</span>'}
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
