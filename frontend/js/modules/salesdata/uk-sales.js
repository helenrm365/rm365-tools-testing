// frontend/js/modules/salesdata/uk-sales.js
import { getUKSalesData, uploadUKSalesCSV, getUKCondensedData } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';

let currentPage = 0;
const pageSize = 100;
let currentSearch = '';
let viewMode = 'full'; // 'full' or 'condensed'

/**
 * Initialize UK sales page
 */
export async function initUKSalesData() {
  console.log('[UK Sales] Initializing page...');
  
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
  
  // Search functionality
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('searchInput');
  
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      currentSearch = searchInput?.value || '';
      currentPage = 0;
      loadSalesData();
    });
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      currentSearch = '';
      currentPage = 0;
      loadSalesData();
    });
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        currentSearch = searchInput.value;
        currentPage = 0;
        loadSalesData();
      }
    });
  }
  
  // Pagination
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        loadSalesData();
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage++;
      loadSalesData();
    });
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
  const colSpan = viewMode === 'condensed' ? '4' : '10';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading...</td></tr>`;
  
  try {
    const offset = currentPage * pageSize;
    let result;
    
    if (viewMode === 'condensed') {
      result = await getUKCondensedData(pageSize, offset, currentSearch);
      displayCondensedData(result.data, result.total_count);
    } else {
      result = await getUKSalesData(pageSize, offset, currentSearch);
      displaySalesData(result.data, result.total_count);
    }
    
    if (result.status === 'success') {
      // Update pagination info
      if (pageInfo) {
        const totalPages = Math.ceil(result.total_count / pageSize);
        const viewLabel = viewMode === 'condensed' ? 'Condensed (6-Month)' : 'Full Sales';
        pageInfo.textContent = `${viewLabel} - Page ${currentPage + 1} of ${totalPages} (${result.total_count} total records)`;
      }
      
      // Update pagination buttons
      const prevBtn = document.getElementById('prevPageBtn');
      const nextBtn = document.getElementById('nextPageBtn');
      if (prevBtn) prevBtn.disabled = currentPage === 0;
      if (nextBtn) nextBtn.disabled = (currentPage + 1) * pageSize >= result.total_count;
      
    } else {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${result.message}</td></tr>`;
      showToast('Failed to load sales data: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[UK Sales] Error loading data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Display sales data in the table
 */
function displaySalesData(data, totalCount) {
  const tbody = document.getElementById('salesTableBody');
  const thead = document.querySelector('#salesTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for full view
  if (thead) {
    thead.innerHTML = `
      <th>ID</th>
      <th>Order Number</th>
      <th>Created At</th>
      <th>SKU</th>
      <th>Name</th>
      <th>Quantity</th>
      <th>Price</th>
      <th>Status</th>
      <th>Imported At</th>
      <th>Updated At</th>
    `;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem;">No data found</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${row.id || ''}</td>
      <td>${escapeHtml(row.order_number || '')}</td>
      <td>${escapeHtml(row.created_at || '')}</td>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${row.qty || 0}</td>
      <td>£${parseFloat(row.price || 0).toFixed(2)}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${formatDateTime(row.imported_at)}</td>
      <td>${formatDateTime(row.updated_at)}</td>
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
    
    const result = await uploadUKSalesCSV(file);
    
    if (result.status === 'success') {
      showToast(`Successfully imported ${result.rows_imported} rows!`, 'success');
      
      // Show any errors that occurred during import
      if (result.errors && result.errors.length > 0) {
        console.warn('[UK Sales] Import errors:', result.errors);
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
    console.error('[UK Sales] Upload error:', error);
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
