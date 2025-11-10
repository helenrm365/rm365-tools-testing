// frontend/js/modules/salesdata/uk-sales.js
import { getUKSalesData, uploadUKSalesCSV, getUKCondensedData, refreshCondensedDataForRegion } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';

let currentPage = 0;
const pageSize = 100; // Display 100 records per page
let currentSearch = '';
let viewMode = 'full'; // 'full' or 'condensed'
let allData = []; // Store loaded data
let totalRecords = 0; // Total records available (from server count)
let isSearchMode = false; // Whether we're in search mode (all matching results loaded) or pagination mode

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
  
  // Search functionality - server-side query with fuzzy matching
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('salesSearchInput');
  
  // Check for duplicate elements with same ID
  const allSearchInputs = document.querySelectorAll('#salesSearchInput');
  const allSearchInputsByClass = document.querySelectorAll('.search-input');
  
  console.log('[UK Sales] Search elements:', {
    searchInput: searchInput ? 'FOUND' : 'NOT FOUND',
    searchBtn: searchBtn ? 'FOUND' : 'NOT FOUND',
    clearSearchBtn: clearSearchBtn ? 'FOUND' : 'NOT FOUND'
  });
  console.log('[UK Sales] DUPLICATE CHECK - Elements with id="salesSearchInput":', allSearchInputs.length);
  console.log('[UK Sales] DUPLICATE CHECK - Elements with class="search-input":', allSearchInputsByClass.length);
  allSearchInputs.forEach((el, idx) => {
    console.log(`[UK Sales] searchInput #${idx}:`, el, 'Parent:', el.parentElement);
  });
  
  let searchTimeout = null;
  
  // Perform search function - queries server for ALL matching records
  const performSearch = async () => {
    const inputElement = document.getElementById('salesSearchInput');
    if (!inputElement) {
      console.warn('[UK Sales] Search input not found');
      return;
    }
    
    console.log('[UK Sales] performSearch called. Input element:', inputElement);
    console.log('[UK Sales] Input element value attribute:', inputElement.value);
    console.log('[UK Sales] Input element actual value:', inputElement.getAttribute('value'));
    
    const searchValue = inputElement.value.trim();
    console.log('[UK Sales] Performing search:', searchValue, '| Length:', searchValue.length);
    
    currentSearch = searchValue;
    currentPage = 0;
    
    if (searchValue.length > 0) {
      // Enter search mode - load ALL matching records from server
      console.log('[UK Sales] Entering search mode for:', searchValue);
      isSearchMode = true;
      await loadSearchResults(searchValue);
    } else {
      // No search - return to pagination mode
      console.log('[UK Sales] Empty search, returning to pagination mode');
      isSearchMode = false;
      await loadSalesData();
    }
  };
  
  // Debounced search for real-time filtering
  const debouncedSearch = () => {
    console.log('[UK Sales] Debounced search triggered, will execute in 400ms');
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      console.log('[UK Sales] Debounced search executing now...');
      performSearch();
    }, 400); // Wait 400ms after user stops typing
  };
  
  // Clear search function - returns to pagination mode
  const clearSearch = () => {
    const inputElement = document.getElementById('salesSearchInput');
    if (inputElement) {
      inputElement.value = '';
    }
    
    console.log('[UK Sales] Clearing search - returning to pagination mode');
    currentSearch = '';
    currentPage = 0;
    isSearchMode = false;
    
    // Clear any pending debounced search
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    
    // Reload just the first page of data
    loadSalesData();
  };
  
  // Add event listeners
  if (searchInput) {
    console.log('[UK Sales] Adding input event listener to search field');
    console.log('[UK Sales] Search input element ID:', searchInput.id);
    console.log('[UK Sales] Search input initial value:', searchInput.value);
    
    // Test: Can we set the value programmatically?
    searchInput.value = 'TEST';
    console.log('[UK Sales] After setting to TEST, value is:', searchInput.value);
    searchInput.value = '';
    
    // Debounced real-time search as user types
    searchInput.addEventListener('input', (e) => {
      console.log('[UK Sales] Input event fired! Current value:', e.target.value);
      console.log('[UK Sales] Input event - searchInput.value:', searchInput.value);
      debouncedSearch();
    });
    
    // Enter key to search immediately
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        console.log('[UK Sales] Enter key pressed in search');
        e.preventDefault();
        if (searchTimeout) clearTimeout(searchTimeout);
        performSearch();
      }
    });
  } else {
    console.error('[UK Sales] Search input element not found! Cannot attach event listeners.');
  }
  
  if (searchBtn) {
    console.log('[UK Sales] Adding click event listener to search button');
    searchBtn.addEventListener('click', (e) => {
      console.log('[UK Sales] Search button clicked');
      console.log('[UK Sales] At button click, searchInput.value is:', document.getElementById('salesSearchInput').value);
      e.preventDefault();
      if (searchTimeout) clearTimeout(searchTimeout);
      performSearch();
    });
  } else {
    console.error('[UK Sales] Search button not found!');
  }
  
  if (clearSearchBtn) {
    console.log('[UK Sales] Adding click event listener to clear button');
    clearSearchBtn.addEventListener('click', (e) => {
      console.log('[UK Sales] Clear button clicked');
      e.preventDefault();
      clearSearch();
    });
  } else {
    console.error('[UK Sales] Clear search button not found!');
  }
  
  // Pagination
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        if (isSearchMode) {
          // In search mode, navigate through client-side pages
          displayCurrentPage();
        } else {
          // In pagination mode, load previous 100 records from server
          loadSalesData();
        }
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (isSearchMode) {
        // In search mode, navigate through client-side pages of all search results
        const totalPages = Math.ceil(allData.length / pageSize);
        if (currentPage < totalPages - 1) {
          currentPage++;
          displayCurrentPage();
        }
      } else {
        // In pagination mode, load next 100 records from server
        currentPage++;
        loadSalesData();
      }
    });
  }
  
  // Refresh condensed data button
  const refreshCondensedBtn = document.getElementById('refreshCondensedBtn');
  if (refreshCondensedBtn) {
    refreshCondensedBtn.addEventListener('click', handleRefreshCondensedData);
  }
}

/**
 * Load sales data from the backend - pagination mode (100 records at a time)
 */
async function loadSalesData() {
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Show loading state
  const colSpan = viewMode === 'condensed' ? '4' : '9';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading...</td></tr>`;
  
  try {
    console.log(`[UK Sales] Loading data - Mode: ${viewMode}, Page: ${currentPage + 1}`);
    
    // For condensed view, always load all data
    if (viewMode === 'condensed') {
      await loadAllDataForCondensed();
      return;
    }
    
    // For full view in pagination mode, load 100 records at a time
    const offset = currentPage * pageSize;
    
    const result = await getUKSalesData(pageSize, offset, '');
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      console.log(`[UK Sales] Loaded ${allData.length} records (offset: ${offset}, total: ${totalRecords})`);
      
      // Display the data
      displayCurrentPage();
    } else {
      console.error('[UK Sales] Failed to load data:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${result.message}</td></tr>`;
      showToast('Failed to load sales data: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[UK Sales] Error loading data:', error);
    const colSpan = viewMode === 'condensed' ? '4' : '9';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Load search results - queries ALL records matching the search term from server
 */
async function loadSearchResults(searchTerm) {
  const tbody = document.getElementById('salesTableBody');
  const colSpan = viewMode === 'condensed' ? '4' : '9';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Searching for "${searchTerm}"...</td></tr>`;
  
  try {
    console.log(`[UK Sales] Searching for: "${searchTerm}"`);
    
    // Load ALL matching records from server in batches
    allData = [];
    const batchSize = 1000; // Fetch in larger batches for search
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      let result;
      if (viewMode === 'condensed') {
        result = await getUKCondensedData(batchSize, offset, searchTerm);
      } else {
        result = await getUKSalesData(batchSize, offset, searchTerm);
      }
      
      if (result.status === 'success' && result.data && result.data.length > 0) {
        allData = allData.concat(result.data);
        offset += batchSize;
        
        // Update loading message with progress
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Searching... (${allData.length} matching records found)</td></tr>`;
        
        // If we got less than batchSize, we've reached the end
        if (result.data.length < batchSize) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`[UK Sales] Search complete: ${allData.length} records match "${searchTerm}"`);
    
    totalRecords = allData.length;
    currentPage = 0;
    displayCurrentPage();
    
  } catch (error) {
    console.error('[UK Sales] Error searching data:', error);
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
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading condensed data...</td></tr>`;
  
  try {
    allData = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const result = await getUKCondensedData(batchSize, offset, '');
      
      if (result.status === 'success' && result.data && result.data.length > 0) {
        allData = allData.concat(result.data);
        offset += batchSize;
        
        // Update loading message
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading condensed data... (${allData.length} SKUs loaded)</td></tr>`;
        
        if (result.data.length < batchSize) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`[UK Sales] Loaded ${allData.length} condensed records`);
    
    // Reset to first page and display
    currentPage = 0;
    totalRecords = allData.length;
    displayCurrentPage();
  } catch (error) {
    console.error('[UK Sales] Error loading condensed data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Display current page of data (works for both pagination and search modes)
 */
function displayCurrentPage() {
  console.log('[UK Sales] Displaying current page:', currentPage + 1, '| Search mode:', isSearchMode);
  
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) {
    console.warn('[UK Sales] Table body not found');
    return;
  }
  
  // Check if data is loaded
  if (!allData || allData.length === 0) {
    const colSpan = viewMode === 'condensed' ? '4' : '9';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">No data available</td></tr>`;
    if (pageInfo) {
      pageInfo.textContent = 'No data loaded';
    }
    updatePaginationButtons();
    return;
  }
  
  // In pagination mode (not search), we only have one page of data loaded
  // In search mode or condensed view, we have all data and paginate client-side
  let pageData;
  let totalPages;
  
  if (isSearchMode || viewMode === 'condensed') {
    // Client-side pagination of all loaded data
    totalPages = Math.max(1, Math.ceil(allData.length / pageSize));
    
    // Ensure current page is valid
    if (currentPage >= totalPages) {
      currentPage = Math.max(0, totalPages - 1);
    }
    
    const startIdx = currentPage * pageSize;
    const endIdx = Math.min(startIdx + pageSize, allData.length);
    pageData = allData.slice(startIdx, endIdx);
    
    console.log(`[UK Sales] Client-side pagination - Page ${currentPage + 1} of ${totalPages} (rows ${startIdx + 1}-${endIdx} of ${allData.length})`);
  } else {
    // Server-side pagination - display all data from current page
    pageData = allData;
    totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    
    console.log(`[UK Sales] Server-side pagination - Page ${currentPage + 1} of ${totalPages} (showing ${allData.length} of ${totalRecords} total)`);
  }
  
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
      pageInfo.textContent = `${viewLabel}${searchLabel} - Page ${currentPage + 1} of ${totalPages} (${allData.length} matching records)`;
    } else if (viewMode === 'condensed') {
      pageInfo.textContent = `${viewLabel} - Page ${currentPage + 1} of ${totalPages} (${allData.length} total SKUs)`;
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
    if (isSearchMode || viewMode === 'condensed') {
      // In search mode or condensed view, check against total pages of loaded data
      const totalPages = Math.ceil(allData.length / pageSize);
      nextBtn.disabled = currentPage >= totalPages - 1 || allData.length === 0;
    } else {
      // In pagination mode, check against total records from server
      const totalPages = Math.ceil(totalRecords / pageSize);
      nextBtn.disabled = currentPage >= totalPages - 1 || totalRecords === 0;
    }
  }
}

/**
 * Display sales data in the table
 */
function displaySalesData(data) {
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
      <th><i class="fas fa-pound-sign"></i> Price</th>
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
      <td>£${parseFloat(row.price || 0).toFixed(2)}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.customer_group || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
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

/**
 * Handle refresh condensed data
 */
async function handleRefreshCondensedData() {
  try {
    showToast('Refreshing condensed data...', 'info');
    
    const result = await refreshCondensedDataForRegion('uk');
    
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
    console.error('[UK Sales] Refresh error:', error);
    showToast('Refresh error: ' + error.message, 'error');
  }
}
