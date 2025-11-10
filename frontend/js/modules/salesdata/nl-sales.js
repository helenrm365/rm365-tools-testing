// frontend/js/modules/salesdata/nl-sales.js
import { getNLSalesData, uploadNLSalesCSV, getNLCondensedData, refreshCondensedDataForRegion } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';

let currentPage = 0;
const pageSize = 100;
let currentSearch = '';
let viewMode = 'full'; // 'full' or 'condensed'
let allData = []; // Store all loaded data for client-side filtering
let filteredData = []; // Store filtered results

/**
 * Initialize NL sales page
 */
export async function initNLSalesData() {
  console.log('[NL Sales] Initializing page...');
  
  // Set up event listeners
  setupEventListeners();
  
  // Load initial data
  await loadSalesData();
}

/**
 * Set up event listeners for the page
 */
function setupEventListeners() {
  // Upload form
  const uploadForm = document.getElementById('uploadForm');
  if (uploadForm) {
    uploadForm.addEventListener('submit', handleUpload);
  }
  
  // View toggle buttons
  const viewFullBtn = document.getElementById('viewFullBtn');
  const viewCondensedBtn = document.getElementById('viewCondensedBtn');
  
  if (viewFullBtn) {
    viewFullBtn.addEventListener('click', () => {
      viewMode = 'full';
      viewFullBtn.classList.add('active');
      viewCondensedBtn?.classList.remove('active');
      currentPage = 0;
      loadSalesData();
    });
  }
  
  if (viewCondensedBtn) {
    viewCondensedBtn.addEventListener('click', () => {
      viewMode = 'condensed';
      viewCondensedBtn.classList.add('active');
      viewFullBtn?.classList.remove('active');
      currentPage = 0;
      loadSalesData();
    });
  }
  
  // Search functionality - client-side filtering
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('searchInput');
  
  if (searchInput) {
    // Real-time search as user types
    searchInput.addEventListener('input', (e) => {
      const searchValue = e.target?.value?.trim() || '';
      currentSearch = searchValue;
      currentPage = 0;
      filterAndDisplayData();
    });
    
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const searchValue = e.target?.value?.trim() || '';
        currentSearch = searchValue;
        currentPage = 0;
        filterAndDisplayData();
      }
    });
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const searchValue = searchInput?.value?.trim() || '';
      currentSearch = searchValue;
      currentPage = 0;
      filterAndDisplayData();
    });
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (searchInput) searchInput.value = '';
      currentSearch = '';
      currentPage = 0;
      filterAndDisplayData();
    });
  }
  
  // Pagination
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        filterAndDisplayData();
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage++;
      filterAndDisplayData();
    });
  }
  
  // Refresh condensed data button
  const refreshCondensedBtn = document.getElementById('refreshCondensedBtn');
  if (refreshCondensedBtn) {
    refreshCondensedBtn.addEventListener('click', handleRefreshCondensedData);
  }
}

/**
 * Load sales data from the backend
 */
async function loadSalesData() {
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Show loading state
  const colSpan = viewMode === 'condensed' ? '4' : '9';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading...</td></tr>`;
  
  try {
    console.log(`[NL Sales] Loading data - Mode: ${viewMode}`);
    
    // Load data from backend with reasonable limit
    let result;
    if (viewMode === 'condensed') {
      result = await getNLCondensedData(1000, 0, ''); // Load up to 1k records
    } else {
      result = await getNLSalesData(1000, 0, ''); // Load up to 1k records
    }
    
    if (result.status === 'success') {
      allData = result.data || [];
      console.log(`[NL Sales] Loaded ${allData.length} total records`);
      
      // Reset to first page and apply any current search
      currentPage = 0;
      filterAndDisplayData();
    } else {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${result.message}</td></tr>`;
      showToast('Failed to load sales data: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[NL Sales] Error loading data:', error);
    const colSpan = viewMode === 'condensed' ? '4' : '9';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Filter and display data based on current search term
 */
function filterAndDisplayData() {
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Don't filter if no data has been loaded yet
  if (!allData || allData.length === 0) {
    const colSpan = viewMode === 'condensed' ? '4' : '9';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">No data available</td></tr>`;
    return;
  }
  
  // Filter data based on search term
  if (currentSearch) {
    const searchLower = currentSearch.toLowerCase();
    filteredData = allData.filter(row => {
      // Search across all relevant fields
      const searchableText = [
        row.order_number,
        row.sku,
        row.name,
        row.status,
        row.customer_group,
        row.currency,
        row.created_at
      ].filter(Boolean).join(' ').toLowerCase();
      
      return searchableText.includes(searchLower);
    });
    console.log(`[NL Sales] Filtered to ${filteredData.length} records (search: "${currentSearch}")`);
  } else {
    filteredData = [...allData];
  }
  
  // Calculate pagination
  const totalFiltered = filteredData.length;
  const totalPages = Math.ceil(totalFiltered / pageSize);
  const startIdx = currentPage * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalFiltered);
  const pageData = filteredData.slice(startIdx, endIdx);
  
  // Display current page of data
  if (viewMode === 'condensed') {
    displayCondensedData(pageData, totalFiltered);
  } else {
    displaySalesData(pageData, totalFiltered);
  }
  
  // Update pagination info
  if (pageInfo) {
    const viewLabel = viewMode === 'condensed' ? 'Condensed (6-Month)' : 'Full Sales';
    const searchLabel = currentSearch ? ` (filtered by "${currentSearch}")` : '';
    pageInfo.textContent = `${viewLabel}${searchLabel} - Page ${currentPage + 1} of ${totalPages || 1} (${totalFiltered} total records)`;
  }
  
  // Update pagination buttons
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1;
}

/**
 * Display sales data in the table
 */
function displaySalesData(data, totalCount) {
  const tbody = document.getElementById('salesTableBody');
  const thead = document.querySelector('#salesTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for full view (matching the 9 columns in HTML)
  if (thead) {
    thead.innerHTML = `
      <th><i class="fas fa-hashtag"></i> Order ID</th>
      <th><i class="fas fa-calendar"></i> Date</th>
      <th><i class="fas fa-barcode"></i> SKU</th>
      <th><i class="fas fa-box"></i> Product</th>
      <th><i class="fas fa-sort-numeric-up"></i> Quantity</th>
      <th><i class="fas fa-euro-sign"></i> Price</th>
      <th><i class="fas fa-info-circle"></i> Status</th>
      <th><i class="fas fa-users"></i> Customer Group</th>
      <th><i class="fas fa-money-bill"></i> Currency</th>
    `;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">No data found</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.order_number || '')}</td>
      <td>${escapeHtml(row.created_at || '')}</td>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${row.qty || 0}</td>
      <td>€${parseFloat(row.price || 0).toFixed(2)}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.customer_group || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
    </tr>
  `).join('');
}

/**
 * Display condensed sales data in the table
 */
function displayCondensedData(data, totalCount) {
  const tbody = document.getElementById('salesTableBody');
  const thead = document.querySelector('#salesTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for condensed view
  if (thead) {
    thead.innerHTML = `
      <th>SKU</th>
      <th>Product Name</th>
      <th>Total Quantity (6 Months)</th>
      <th>Last Updated</th>
    `;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No data found</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td><strong>${row.total_qty || 0}</strong></td>
      <td>${formatDateTime(row.last_updated)}</td>
    </tr>
  `).join('');
}

/**
 * Handle CSV file upload
 */
async function handleUpload(event) {
  event.preventDefault();
  
  const fileInput = document.getElementById('csvFile');
  const file = fileInput?.files[0];
  
  if (!file) {
    showToast('Please select a file', 'error');
    return;
  }
  
  if (!file.name.endsWith('.csv')) {
    showToast('Please select a CSV file', 'error');
    return;
  }
  
  try {
    showToast('Uploading...', 'info');
    
    const result = await uploadNLSalesCSV(file);
    
    if (result.status === 'success') {
      showToast(`Successfully imported ${result.rows_imported} rows!`, 'success');
      
      // Show any errors that occurred during import
      if (result.errors && result.errors.length > 0) {
        console.warn('[NL Sales] Import errors:', result.errors);
        showToast(`Import completed with ${result.errors.length} errors. Check console for details.`, 'warning');
      }
      
      // Clear the file input
      if (fileInput) fileInput.value = '';
      
      // Reload the data
      currentPage = 0;
      await loadSalesData();
    } else {
      showToast('Upload failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[NL Sales] Upload error:', error);
    showToast('Upload error: ' + error.message, 'error');
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format datetime string
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

/**
 * Handle refresh condensed data
 */
async function handleRefreshCondensedData() {
  try {
    showToast('Refreshing condensed data...', 'info');
    
    const result = await refreshCondensedDataForRegion('nl');
    
    if (result.status === 'success') {
      showToast(`Successfully refreshed condensed data! ${result.rows_aggregated} SKUs processed.`, 'success');
      
      // Reload the data if currently viewing condensed view
      if (viewMode === 'condensed') {
        await loadSalesData();
      }
    } else {
      showToast('Refresh failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[NL Sales] Refresh error:', error);
    showToast('Refresh error: ' + error.message, 'error');
  }
}
