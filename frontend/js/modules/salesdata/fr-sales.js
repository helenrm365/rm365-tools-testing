// frontend/js/modules/salesdata/fr-sales.js
import { getFRSalesData, uploadFRSalesCSV, getFRCondensedData, refreshCondensedDataForRegion } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';
import { showFiltersModal } from './condensed-filters.js';

let currentPage = 0;
const pageSize = 100; // Display 100 records per page
let currentSearch = '';
let viewMode = 'full'; // 'full' or 'condensed'
let allData = []; // Store loaded data
let totalRecords = 0; // Total records available (from server count)
let isSearchMode = false; // Whether we're in search mode (all matching results loaded) or pagination mode

/**
 * Initialize FR sales page
 */
export async function initFRSalesData() {
  console.log('[FR Sales] Initializing page...');
  
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
      
      // Check if there's an active search and preserve it
      const searchInput = document.getElementById('salesSearchInput');
      if (searchInput && searchInput.value.trim()) {
        // Keep search active and reload with search term
        loadSearchResults(searchInput.value.trim());
      } else {
        // No search, just load data normally
        loadSalesData();
      }
    });
  }
  
  if (viewCondensedBtn) {
    viewCondensedBtn.addEventListener('click', () => {
      viewMode = 'condensed';
      viewCondensedBtn.classList.add('active');
      viewFullBtn?.classList.remove('active');
      currentPage = 0;
      
      // Check if there's an active search and preserve it
      const searchInput = document.getElementById('salesSearchInput');
      if (searchInput && searchInput.value.trim()) {
        // Keep search active and reload with search term
        loadSearchResults(searchInput.value.trim());
      } else {
        // No search, just load data normally
        loadSalesData();
      }
    });
  }
  
  // Search functionality - completely rebuilt
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('salesSearchInput');
  
  let searchTimeout = null;
  
  // Perform search function - queries server for ALL matching records
  const performSearch = async () => {
    const inputElement = document.getElementById('salesSearchInput');
    if (!inputElement) {
      console.warn('[FR Sales] Search input not found');
      return;
    }
    
    const searchValue = inputElement.value.trim();
    console.log('[FR Sales] Performing search:', searchValue, '| Length:', searchValue.length);
    
    currentSearch = searchValue;
    currentPage = 0;
    
    if (searchValue.length > 0) {
      // Enter search mode - load ALL matching records from server
      console.log('[FR Sales] Entering search mode for:', searchValue);
      isSearchMode = true;
      await loadSearchResults(searchValue);
    } else {
      // No search - return to pagination mode
      console.log('[FR Sales] Empty search, returning to pagination mode');
      isSearchMode = false;
      await loadSalesData();
    }
  };
  
  // Debounced search for real-time filtering
  const debouncedSearch = () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch();
    }, 400); // Wait 400ms after user stops typing
  };
  
  // Clear search function - returns to pagination mode
  const clearSearch = () => {
    const inputElement = document.getElementById('salesSearchInput');
    if (inputElement) {
      inputElement.value = '';
    }
    
    console.log('[FR Sales] Clearing search - returning to pagination mode');
    currentSearch = '';
    currentPage = 0;
    isSearchMode = false;
    
    // Reload just the first page of data
    loadSalesData();
  };
  
  // Add event listeners
  if (searchInput) {
    // Debounced real-time search as user types
    searchInput.addEventListener('input', debouncedSearch);
    
    // Enter key to search immediately
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchTimeout) clearTimeout(searchTimeout);
        performSearch();
      }
    });
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (searchTimeout) clearTimeout(searchTimeout);
      performSearch();
    });
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      clearSearch();
    });
  }
  
  // Pagination
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        if (isSearchMode) {
          // In search mode, load previous page of search results from server
          loadSearchResults(currentSearch);
        } else {
          // In pagination mode, load previous 100 records from server
          loadSalesData();
        }
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(totalRecords / pageSize);
      if (currentPage < totalPages - 1) {
        currentPage++;
        if (isSearchMode) {
          // In search mode, load next page of search results from server
          loadSearchResults(currentSearch);
        } else {
          // In pagination mode, load next page from server
          loadSalesData();
        }
      }
    });
  }
  
  // Refresh condensed data button
  const refreshCondensedBtn = document.getElementById('refreshCondensedBtn');
  if (refreshCondensedBtn) {
    refreshCondensedBtn.addEventListener('click', handleRefreshCondensedData);
  }
  
  // Filters button
  const filtersBtn = document.getElementById('filtersBtn');
  if (filtersBtn) {
    filtersBtn.addEventListener('click', () => {
      showFiltersModal('fr');
    });
  }
  
  // Listen for condensed data refresh events from filter modal
  document.addEventListener('condensed-data-refreshed', (e) => {
    if (e.detail.region === 'fr' && viewMode === 'condensed') {
      // Reload the table data if currently viewing condensed data
      const searchInput = document.getElementById('salesSearchInput');
      if (searchInput && searchInput.value.trim()) {
        // Reload with current search
        loadSearchResults(searchInput.value.trim());
      } else {
        // Reload normal paginated data
        currentPage = 0; // Reset to first page
        loadSalesData();
      }
    }
  });
}

/**
 * Load sales data from the backend - pagination mode (100 records at a time)
 */
async function loadSalesData() {
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Show loading state
  const colSpan = viewMode === 'condensed' ? '4' : '14';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px;">
      <div class="loader" style="margin: 0;">
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
      </div>
    </div>
  </td></tr>`;
  
  try {
    console.log(`[FR Sales] Loading data - Mode: ${viewMode}, Page: ${currentPage + 1}`);
    
    // Both full and condensed views now use server-side pagination (100 records at a time)
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'condensed') {
      result = await getFRCondensedData(pageSize, offset, '');
    } else {
      result = await getFRSalesData(pageSize, offset, '');
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      console.log(`[FR Sales] Loaded ${allData.length} records (offset: ${offset}, total: ${totalRecords})`);
      
      // Display the data
      displayCurrentPage();
    } else {
      console.error('[FR Sales] Failed to load data:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${result.message}</td></tr>`;
      showToast('Failed to load sales data: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[FR Sales] Error loading data:', error);
    const colSpan = viewMode === 'condensed' ? '4' : '14';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Load search results - queries ALL records matching the search term from server
 */
/**
 * Load search results from server - pagination mode (100 records at a time with search term)
 */
async function loadSearchResults(searchTerm) {
  const tbody = document.getElementById('salesTableBody');
  const colSpan = viewMode === 'condensed' ? '4' : '14';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Searching for "${searchTerm}"...</td></tr>`;
  
  try {
    console.log(`[FR Sales] Searching for: "${searchTerm}" - Page: ${currentPage + 1}`);
    
    // Fetch 100 matching records at a time, just like regular pagination
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'condensed') {
      result = await getFRCondensedData(pageSize, offset, searchTerm);
    } else {
      result = await getFRSalesData(pageSize, offset, searchTerm);
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      console.log(`[FR Sales] Search results: ${allData.length} records on this page (offset: ${offset}, total matches: ${totalRecords})`);
      
      displayCurrentPage();
    } else {
      console.error('[FR Sales] Search failed:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${result.message}</td></tr>`;
    }
    
  } catch (error) {
    console.error('[FR Sales] Error searching data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${error.message}</td></tr>`;
    showToast('Search error: ' + error.message, 'error');
  }
}

/**
 * Load ALL data for condensed view
 */
async function loadAllDataForCondensed() {
  const tbody = document.getElementById('salesTableBody');
  const colSpan = '4';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px; flex-direction: column;">
      <div style="margin-bottom: 1rem; color: var(--text-secondary);">Loading condensed data...</div>
      <div class="loader" style="margin: 0;">
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
      </div>
    </div>
  </td></tr>`;
  
  try {
    allData = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const result = await getFRCondensedData(batchSize, offset, '');
      
      if (result.status === 'success' && result.data && result.data.length > 0) {
        allData = allData.concat(result.data);
        offset += batchSize;
        
        // Update loading message
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
          <div style="display: flex; justify-content: center; align-items: center; gap: 10px; flex-direction: column;">
            <div style="margin-bottom: 1rem; color: var(--text-secondary);">Loading condensed data... (${allData.length} SKUs loaded)</div>
            <div class="loader" style="margin: 0;">
              <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
              <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
              <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
            </div>
          </div>
        </td></tr>`;
        
        if (result.data.length < batchSize) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`[FR Sales] Loaded ${allData.length} condensed records`);
    
    // Reset to first page and display
    currentPage = 0;
    totalRecords = allData.length;
    displayCurrentPage();
  } catch (error) {
    console.error('[FR Sales] Error loading condensed data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Display current page of data (works for both pagination and search modes)
 */
function displayCurrentPage() {
  console.log('[FR Sales] Displaying current page:', currentPage + 1, '| Search mode:', isSearchMode);
  
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) {
    console.warn('[FR Sales] Table body not found');
    return;
  }
  
  // Check if data is loaded
  if (!allData || allData.length === 0) {
    const colSpan = viewMode === 'condensed' ? '4' : '14';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">No data available</td></tr>`;
    if (pageInfo) {
      pageInfo.textContent = 'No data loaded';
    }
    updatePaginationButtons();
    return;
  }
  
  // All views now use server-side pagination (100 records at a time)
  // Display all data from the current page load
  const pageData = allData;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  
  console.log(`[FR Sales] Server-side pagination - Page ${currentPage + 1} of ${totalPages} (showing ${allData.length} of ${totalRecords} total)`);
  
  // Display the data
  if (viewMode === 'condensed') {
    displayCondensedData(pageData);
  } else {
    displaySalesData(pageData);
  }
  
  // Update pagination info
  if (pageInfo) {
    const viewLabel = viewMode === 'condensed' ? 'Condensed (6-Month)' : 'Full Sales';
    const searchLabel = currentSearch ? ` (search: "${currentSearch}")` : '';
    
    if (isSearchMode) {
      pageInfo.textContent = `${viewLabel}${searchLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} matching records)`;
    } else if (viewMode === 'condensed') {
      pageInfo.textContent = `${viewLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} total SKUs)`;
    } else {
      pageInfo.textContent = `${viewLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} total records)`;
    }
  }
  
  updatePaginationButtons();
}

/**
 * Update pagination button states
 */
function updatePaginationButtons() {
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.disabled = currentPage === 0;
  }
  
  if (nextBtn) {
    // All views use server-side pagination now, check against total records from server
    const totalPages = Math.ceil(totalRecords / pageSize);
    nextBtn.disabled = currentPage >= totalPages - 1 || totalRecords === 0;
  }
}

/**
 * Display sales data in the table
 */
function displaySalesData(data) {
  const tbody = document.getElementById('salesTableBody');
  const thead = document.querySelector('#salesTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for full view (matching the 14 columns in HTML)
  if (thead) {
    thead.innerHTML = `
      <th><i class="fas fa-hashtag"></i> Order Number</th>
      <th><i class="fas fa-calendar"></i> Created At</th>
      <th><i class="fas fa-barcode"></i> Product SKU</th>
      <th><i class="fas fa-box"></i> Product Name</th>
      <th><i class="fas fa-sort-numeric-up"></i> Product Qty</th>
      <th><i class="fas fa-euro-sign"></i> Product Price</th>
      <th><i class="fas fa-info-circle"></i> Status</th>
      <th><i class="fas fa-money-bill"></i> Currency</th>
      <th><i class="fas fa-calculator"></i> Grand Total</th>
      <th><i class="fas fa-envelope"></i> Customer Email</th>
      <th><i class="fas fa-user"></i> Customer Full Name</th>
      <th><i class="fas fa-map-marker-alt"></i> Billing Address</th>
      <th><i class="fas fa-shipping-fast"></i> Shipping Address</th>
      <th><i class="fas fa-users"></i> Customer Group Code</th>
    `;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" style="text-align: center; padding: 2rem;">No data found</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.order_number || '')}</td>
      <td>${escapeHtml(row.created_at || '')}</td>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${row.qty || 0}</td>
      <td>${getCurrencySymbol(row.currency)}${parseFloat(row.price || 0).toFixed(2)}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${row.grand_total ? getCurrencySymbol(row.currency) + parseFloat(row.grand_total).toFixed(2) : ''}</td>
      <td>${escapeHtml(row.customer_email || '')}</td>
      <td>${escapeHtml(row.customer_full_name || '')}</td>
      <td>${escapeHtml(row.billing_address || '')}</td>
      <td>${escapeHtml(row.shipping_address || '')}</td>
      <td>${escapeHtml(row.customer_group_code || '')}</td>
    </tr>
  `).join('');
}

/**
 * Display condensed sales data in the table
 */
function displayCondensedData(data) {
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
    
    const result = await uploadFRSalesCSV(file);
    
    if (result.status === 'success') {
      showToast(`Successfully imported ${result.rows_imported} rows!`, 'success');
      
      // Show any errors that occurred during import
      if (result.errors && result.errors.length > 0) {
        console.warn('[FR Sales] Import errors:', result.errors);
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
    console.error('[FR Sales] Upload error:', error);
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
 * Get currency symbol from currency code
 */
function getCurrencySymbol(currencyCode) {
  const symbols = {
    'GBP': '£',
    'EUR': '€',
    'USD': '$',
    'CAD': 'C$',
    'AUD': 'A$',
    'JPY': '¥',
    'CNY': '¥',
    'CHF': 'Fr',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'PLN': 'zł',
    'CZK': 'Kč',
    'HUF': 'Ft'
  };
  
  return symbols[currencyCode?.toUpperCase()] || currencyCode || '';
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
    
    const result = await refreshCondensedDataForRegion('fr');
    
    if (result.status === 'success') {
      showToast(`Successfully refreshed condensed data! ${result.rows_aggregated} SKUs processed.`, 'success');
      
      // Reload the data if currently viewing condensed view
      if (viewMode === 'condensed') {
        // Check if there's an active search and reload with it
        if (currentSearch) {
          await loadSearchResults(currentSearch);
        } else {
          await loadSalesData();
        }
      }
    } else {
      showToast('Refresh failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[FR Sales] Refresh error:', error);
    showToast('Refresh error: ' + error.message, 'error');
  }
}






