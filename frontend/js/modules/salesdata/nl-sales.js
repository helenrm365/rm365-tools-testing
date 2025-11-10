// frontend/js/modules/salesdata/nl-sales.js
import { getNLSalesData, uploadNLSalesCSV, getNLCondensedData, refreshCondensedDataForRegion } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';

let currentPage = 0;
const pageSize = 100;
let currentSearch = '';
let viewMode = 'full'; // 'full' or 'condensed'
let allData = []; // Store all loaded data for client-side filtering
let filteredData = []; // Store filtered results
let totalAvailableRecords = 0; // Total records in database
let isSearchMode = false; // Whether we're in search mode (all data loaded) or pagination mode

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
  
  // Search functionality - completely rebuilt
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('searchInput');
  
  // Perform search function - loads ALL data when searching
  const performSearch = async () => {
    const inputElement = document.getElementById('searchInput');
    if (!inputElement) {
      console.warn('[NL Sales] Search input not found');
      return;
    }
    
    const searchValue = inputElement.value.trim();
    console.log('[NL Sales] Performing search:', searchValue);
    
    currentSearch = searchValue;
    currentPage = 0;
    
    // If there's a search term, load ALL data to search through
    if (searchValue.length > 0) {
      if (!isSearchMode) {
        console.log('[NL Sales] Entering search mode - loading all records...');
        await loadAllDataForSearch();
        isSearchMode = true;
      }
      // Apply filter after data is loaded
      applySearchFilter();
    } else {
      // No search - just apply filter to current data
      isSearchMode = false;
      applySearchFilter();
    }
  };
  
  // Clear search function - returns to pagination mode
  const clearSearch = () => {
    const inputElement = document.getElementById('searchInput');
    if (inputElement) {
      inputElement.value = '';
    }
    
    console.log('[NL Sales] Clearing search - returning to pagination mode');
    currentSearch = '';
    currentPage = 0;
    isSearchMode = false;
    
    // Reload just the first page of data
    loadSalesData();
  };
  
  // Add event listeners
  if (searchInput) {
    // Real-time search as user types
    searchInput.addEventListener('input', performSearch);
    
    // Enter key to search
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSearch();
      }
    });
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
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
          // In search mode, just re-filter existing data
          applySearchFilter();
        } else {
          // In pagination mode, load previous page from server
          loadSalesData();
        }
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (isSearchMode) {
        // In search mode, check against filtered data
        const totalPages = Math.ceil(filteredData.length / pageSize);
        if (currentPage < totalPages - 1) {
          currentPage++;
          applySearchFilter();
        }
      } else {
        // In pagination mode, load next page from server
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
 * Load sales data from the backend - pagination mode (1000 records at a time)
 */
async function loadSalesData() {
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Show loading state
  const colSpan = viewMode === 'condensed' ? '4' : '9';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading...</td></tr>`;
  
  try {
    console.log(`[NL Sales] Loading data - Mode: ${viewMode}, Page: ${currentPage + 1}`);
    
    // For condensed view, always load all data
    if (viewMode === 'condensed') {
      await loadAllDataForCondensed();
      return;
    }
    
    // For full view in pagination mode, load 1000 records at a time
    const batchSize = 1000;
    const offset = currentPage * batchSize;
    
    const result = await getNLSalesData(batchSize, offset, '');
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalAvailableRecords = result.total || allData.length;
      
      console.log(`[NL Sales] Loaded ${allData.length} records (offset: ${offset})`);
      
      // Display the data
      filteredData = allData.slice();
      applySearchFilter();
    } else {
      console.error('[NL Sales] Failed to load data:', result.message);
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
 * Load search results - queries ALL records matching the search term
 */
async function loadSearchResults(searchTerm) {
  const tbody = document.getElementById('salesTableBody');
  const colSpan = viewMode === 'condensed' ? '4' : '9';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Searching all records for "${searchTerm}"...</td></tr>`;
  
  try {
    console.log(`[NL Sales] Searching for: "${searchTerm}"`);
    
    // Load ALL records in batches with the search term
    allData = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      let result;
      if (viewMode === 'condensed') {
        result = await getNLCondensedData(batchSize, offset, searchTerm);
      } else {
        result = await getNLSalesData(batchSize, offset, searchTerm);
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
    
    console.log(`[NL Sales] Search complete: ${allData.length} records match "${searchTerm}"`);
    
    // Apply fuzzy matching on the results for better relevance
    if (allData.length > 0) {
      filteredData = fuzzyFilter(allData, searchTerm);
      console.log(`[NL Sales] After fuzzy filtering: ${filteredData.length} records`);
    } else {
      filteredData = [];
    }
    
    totalAvailableRecords = filteredData.length;
    currentPage = 0;
    applySearchFilter();
    
  } catch (error) {
    console.error('[NL Sales] Error searching data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${error.message}</td></tr>`;
    showToast('Search error: ' + error.message, 'error');
  }
}

/**
 * Fuzzy filter - scores and sorts results by relevance
 */
function fuzzyFilter(data, searchTerm) {
  if (!searchTerm || searchTerm.length === 0) return data;
  
  const searchLower = searchTerm.toLowerCase();
  const searchWords = searchLower.split(/\s+/).filter(w => w.length > 0);
  
  // Score each row based on how well it matches the search
  const scored = data.map(row => {
    let score = 0;
    const fields = [
      row.order_number,
      row.sku,
      row.name,
      row.status,
      row.customer_group,
      row.currency,
      row.created_at,
      row.price,
      row.qty,
      row.total_qty
    ];
    
    const rowText = fields.filter(Boolean).join(' ').toLowerCase();
    
    // Exact phrase match = highest score
    if (rowText.includes(searchLower)) {
      score += 100;
    }
    
    // All words present = high score
    const allWordsPresent = searchWords.every(word => rowText.includes(word));
    if (allWordsPresent) {
      score += 50;
    }
    
    // Count matching words
    searchWords.forEach(word => {
      if (rowText.includes(word)) {
        score += 10;
      }
      
      // Fuzzy match: check if field starts with search word
      fields.forEach(field => {
        if (field) {
          const fieldLower = String(field).toLowerCase();
          if (fieldLower.startsWith(word)) {
            score += 20;
          }
          // Partial match within word
          if (fieldLower.includes(word)) {
            score += 5;
          }
        }
      });
    });
    
    return { row, score };
  });
  
  // Filter out items with score 0, then sort by score descending
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.row);
}

/**
 * Load ALL data for search mode
 */
async function loadAllDataForSearch() {
  const tbody = document.getElementById('salesTableBody');
  const colSpan = viewMode === 'condensed' ? '4' : '9';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading all records for search...</td></tr>`;
  
  try {
    allData = [];
    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const result = await getNLSalesData(batchSize, offset, '');
      
      if (result.status === 'success' && result.data && result.data.length > 0) {
        allData = allData.concat(result.data);
        offset += batchSize;
        
        // Update loading message
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Loading all records for search... (${allData.length} loaded)</td></tr>`;
        
        // If we got less than batchSize, we've reached the end
        if (result.data.length < batchSize) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`[NL Sales] Loaded ALL ${allData.length} records for search`);
    totalAvailableRecords = allData.length;
  } catch (error) {
    console.error('[NL Sales] Error loading all data for search:', error);
    showToast('Error loading data for search: ' + error.message, 'error');
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
      const result = await getNLCondensedData(batchSize, offset, '');
      
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
    
    console.log(`[NL Sales] Loaded ${allData.length} condensed records`);
    
    // Reset to first page and apply filter
    currentPage = 0;
    isSearchMode = false; // Condensed always shows all
    filteredData = allData.slice();
    applySearchFilter();
  } catch (error) {
    console.error('[NL Sales] Error loading condensed data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Filter and display data based on current search term
 */
function applySearchFilter() {
  console.log('[NL Sales] Applying search filter:', currentSearch, '| Search mode:', isSearchMode);
  
  const tbody = document.getElementById('salesTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) {
    console.warn('[NL Sales] Table body not found');
    return;
  }
  
  // In search mode, filteredData is already prepared by loadSearchResults with fuzzy matching
  // Just use it directly without re-filtering
  if (isSearchMode) {
    console.log(`[NL Sales] Using pre-filtered search results: ${filteredData.length} rows`);
    // filteredData is already set by loadSearchResults, don't modify it
  } else {
    // Pagination mode - check if data is loaded
    if (!allData || allData.length === 0) {
      const colSpan = viewMode === 'condensed' ? '4' : '9';
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">No data available</td></tr>`;
      if (pageInfo) {
        pageInfo.textContent = 'No data loaded';
      }
      return;
    }
    
    // Pagination mode - show all loaded data
    filteredData = allData.slice();
    console.log(`[NL Sales] Pagination mode - showing ${allData.length} rows`);
  }
  
  // Calculate pagination
  const totalFiltered = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  
  // Ensure current page is valid
  if (currentPage >= totalPages) {
    currentPage = Math.max(0, totalPages - 1);
  }
  
  const startIdx = currentPage * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalFiltered);
  const pageData = filteredData.slice(startIdx, endIdx);
  
  console.log(`[NL Sales] Displaying page ${currentPage + 1} of ${totalPages} (rows ${startIdx + 1}-${endIdx} of ${totalFiltered})`);
  
  // Display the data
  if (viewMode === 'condensed') {
    displayCondensedData(pageData, totalFiltered);
  } else {
    displaySalesData(pageData, totalFiltered);
  }
  
  // Update pagination info
  if (pageInfo) {
    const viewLabel = viewMode === 'condensed' ? 'Condensed (6-Month)' : 'Full Sales';
    const modeLabel = isSearchMode ? ' [Searching all records]' : ' [Pagination mode]';
    const searchLabel = currentSearch ? ` (filtered by "${currentSearch}")` : '';
    pageInfo.textContent = `${viewLabel}${modeLabel}${searchLabel} - Page ${currentPage + 1} of ${totalPages} (${totalFiltered} total records)`;
  }
  
  // Update pagination buttons
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.disabled = currentPage === 0;
  }
  
  if (nextBtn) {
    if (isSearchMode || viewMode === 'condensed') {
      // In search mode or condensed view, disable if on last page of filtered results
      nextBtn.disabled = currentPage >= totalPages - 1 || totalFiltered === 0;
    } else {
      // In pagination mode, always allow next (will load more data)
      // Only disable if we got less than 1000 records (meaning no more data)
      nextBtn.disabled = allData.length < 1000;
    }
  }
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
