// frontend/js/modules/magentodata/fr-magento.js
import { getFRMagentoData, syncFRMagentoData, getFRCondensedData, refreshCondensedDataForRegion, initializeTables } from '../../services/api/magentoDataApi.js';
import { showToast } from '../../ui/toast.js';
import { showFiltersModal, showCustomRangeModal } from './condensed-filters.js';
import { exportToPDF } from '../../utils/pdfExport.js';

let currentPage = 0;
const pageSize = 100; // Display 100 records per page
let currentSearch = '';
let viewMode = 'full'; // 'full', 'condensed', or 'custom'
let allData = []; // Store loaded data
let totalRecords = 0; // Total records available (from server count)
let isSearchMode = false; // Whether we're in search mode (all matching results loaded) or pagination mode
let customRangeLabel = ''; // Label for custom range (e.g., "Last 30 Days")
let syncAbortController = null; // AbortController for cancelling ongoing sync
let isSyncing = false; // Track if sync is in progress

/**
 * Initialize FR magento page
 */
export async function initFRMagentoData() {
  // Wait for DOM to be ready before setting up event listeners
  await new Promise(resolve => setTimeout(resolve, 0));
  
  // Initialize tables first (creates tables if they don't exist)
  try {
    await initializeTables();
  } catch (error) {
    console.error('Error initializing tables:', error);
    showToast('Failed to initialize database tables. Please check your connection.', 'error');
  }
  
  // Set up event listeners
  setupEventListeners();
  
  // Add beforeunload handler to warn about losing sync progress
  setupBeforeUnloadHandler();
  
  // Load initial data
  await loadMagentoData();
}

/**
 * Set up beforeunload handler to prevent accidental navigation during sync
 */
function setupBeforeUnloadHandler() {
  window.addEventListener('beforeunload', (e) => {
    if (isSyncing) {
      e.preventDefault();
      e.returnValue = 'Sync in progress. Progress has been saved, but leaving now will stop the sync. Continue?';
      return e.returnValue;
    }
  });
}

/**
 * Set up event listeners for the page
 */
function setupEventListeners() {
  // Sync button - unified handler that checks state
  const syncDataBtn = document.getElementById('syncDataBtn');
  if (syncDataBtn) {
    syncDataBtn.addEventListener('click', () => {
      if (isSyncing) {
        handleCancelSync();
      } else {
        handleSync();
      }
    });
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
      customRangeLabel = ''; // Clear custom range
      
      // Check if there's an active search and preserve it
      const searchInput = document.getElementById('magentoSearchInput');
      if (searchInput && searchInput.value.trim()) {
        // Keep search active and reload with search term
        loadSearchResults(searchInput.value.trim());
      } else {
        // No search, just load data normally
        loadMagentoData();
      }
    });
  }
  
  if (viewCondensedBtn) {
    viewCondensedBtn.addEventListener('click', () => {
      viewMode = 'condensed';
      viewCondensedBtn.classList.add('active');
      viewFullBtn?.classList.remove('active');
      currentPage = 0;
      customRangeLabel = ''; // Clear custom range
      
      // Check if there's an active search and preserve it
      const searchInput = document.getElementById('magentoSearchInput');
      if (searchInput && searchInput.value.trim()) {
        // Keep search active and reload with search term
        loadSearchResults(searchInput.value.trim());
      } else {
        // No search, just load data normally
        loadMagentoData();
      }
    });
  }
  
  // Search functionality - completely rebuilt
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('magentoSearchInput');
  
  let searchTimeout = null;
  
  // Perform search function - queries server for ALL matching records
  const performSearch = async () => {
    const inputElement = document.getElementById('magentoSearchInput');
    if (!inputElement) {
      console.warn('[FR Magento] Search input not found');
      return;
    }
    
    const searchValue = inputElement.value.trim();
    currentSearch = searchValue;
    currentPage = 0;
    
    if (searchValue.length > 0) {
      // Enter search mode - load ALL matching records from server
      isSearchMode = true;
      await loadSearchResults(searchValue);
    } else {
      // No search - return to pagination mode
      isSearchMode = false;
      await loadMagentoData();
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
    const inputElement = document.getElementById('magentoSearchInput');
    if (inputElement) {
      inputElement.value = '';
    }
    currentSearch = '';
    currentPage = 0;
    isSearchMode = false;
    
    // Reload just the first page of data
    loadMagentoData();
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
          loadMagentoData();
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
          loadMagentoData();
        }
      }
    });
  }
  
  // Refresh condensed data button
  const refreshCondensedBtn = document.getElementById('refreshCondensedBtn');
  if (refreshCondensedBtn) {
    refreshCondensedBtn.addEventListener('click', handleRefreshCondensedData);
  }
  
  // Custom Range button
  let retryCount = 0;
  const setupCustomRangeButton = () => {
    const customRangeBtn = document.getElementById('customRangeBtn');
    if (customRangeBtn) {
      // Remove any existing listener
      const newBtn = customRangeBtn.cloneNode(true);
      customRangeBtn.parentNode.replaceChild(newBtn, customRangeBtn);
      
      newBtn.addEventListener('click', () => {
        try {
          showCustomRangeModal('fr');
        } catch (error) {
          console.error('[FR Magento] Error calling showCustomRangeModal:', error);
        }
      });
    } else {
      console.error('[FR Magento] Custom Range Button NOT found');
      // Try again after a short delay (max 5 retries)
      if (retryCount < 5) {
        retryCount++;
        setTimeout(setupCustomRangeButton, 100);
      }
    }
  };
  
  setupCustomRangeButton();

  // Filters button
  const filtersBtn = document.getElementById('filtersBtn');
  if (filtersBtn) {
    filtersBtn.addEventListener('click', () => {
      showFiltersModal('fr');
    });
  }
  
  // Export PDF button
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
      await handleExportPDF();
    });
  }
  
  // Listen for condensed data refresh events from filter modal
  document.addEventListener('condensed-data-refreshed', (e) => {
    if (e.detail.region === 'fr' && viewMode === 'condensed') {
      // Reload the table data if currently viewing condensed data
      const searchInput = document.getElementById('magentoSearchInput');
      if (searchInput && searchInput.value.trim()) {
        // Reload with current search
        loadSearchResults(searchInput.value.trim());
      } else {
        // Reload normal paginated data
        currentPage = 0; // Reset to first page
        loadMagentoData();
      }
    }
  });
  
  // Listen for custom range applied event
  window.addEventListener('customRangeApplied', (e) => {
    if (e.detail.region === 'fr') {
      // Switch to custom view mode
      viewMode = 'custom';
      customRangeLabel = e.detail.rangeLabel;
      
      // Update view buttons
      const viewFullBtn = document.getElementById('viewFullBtn');
      const viewCondensedBtn = document.getElementById('viewCondensedBtn');
      viewFullBtn?.classList.remove('active');
      viewCondensedBtn?.classList.remove('active');
      
      // Load the custom range data
      allData = e.detail.data;
      totalRecords = e.detail.totalCount;
      currentPage = 0;
      isSearchMode = false;
      currentSearch = '';
      
      // Clear search input
      const searchInput = document.getElementById('magentoSearchInput');
      if (searchInput) searchInput.value = '';
      
      // Render the data
      renderData();
    }
  });
}

/**
 * Load magento data from the backend - pagination mode (100 records at a time)
 */
async function loadMagentoData() {
  const tbody = document.getElementById('magentoTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Show loading state
  const colSpan = viewMode === 'condensed' || viewMode === 'custom' ? '4' : '14';
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
    // Custom mode doesn't reload from server - data is already loaded
    if (viewMode === 'custom') {
      displayCurrentPage();
      return;
    }
    
    // Both full and condensed views now use server-side pagination (100 records at a time)
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'condensed') {
      result = await getFRCondensedData(pageSize, offset, '');
    } else {
      result = await getFRMagentoData(pageSize, offset, '');
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      
      // Display the data
      displayCurrentPage();
    } else {
      console.error('[FR Magento] Failed to load data:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${result.message}</td></tr>`;
      showToast('Failed to load magento data: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[FR Magento] Error loading data:', error);
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
  const tbody = document.getElementById('magentoTableBody');
  const colSpan = viewMode === 'condensed' ? '4' : '14';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Searching for "${searchTerm}"...</td></tr>`;
  
  try {
    // Fetch 100 matching records at a time, just like regular pagination
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'condensed') {
      result = await getFRCondensedData(pageSize, offset, searchTerm);
    } else {
      result = await getFRMagentoData(pageSize, offset, searchTerm);
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      
      displayCurrentPage();
    } else {
      console.error('[FR Magento] Search failed:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${result.message}</td></tr>`;
    }
    
  } catch (error) {
    console.error('[FR Magento] Error searching data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${error.message}</td></tr>`;
    showToast('Search error: ' + error.message, 'error');
  }
}

/**
 * Load ALL data for condensed view
 */
async function loadAllDataForCondensed() {
  const tbody = document.getElementById('magentoTableBody');
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
    // Reset to first page and display
    currentPage = 0;
    totalRecords = allData.length;
    displayCurrentPage();
  } catch (error) {
    console.error('[FR Magento] Error loading condensed data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Error: ${error.message}</td></tr>`;
    showToast('Error loading data: ' + error.message, 'error');
  }
}

/**
 * Display current page of data (works for both pagination and search modes)
 */
function displayCurrentPage() {
  const tbody = document.getElementById('magentoTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) {
    console.warn('[FR Magento] Table body not found');
    return;
  }
  
  // Check if data is loaded
  if (!allData || allData.length === 0) {
    const colSpan = viewMode === 'condensed' || viewMode === 'custom' ? '4' : '14';
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
  
  
  // Display the data
  if (viewMode === 'condensed' || viewMode === 'custom') {
    displayCondensedData(pageData);
  } else {
    displayMagentoData(pageData);
  }
  
  // Show/hide export PDF button based on view mode
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) {
    if (viewMode === 'condensed' || viewMode === 'custom') {
      exportPdfBtn.style.display = '';
    } else {
      exportPdfBtn.style.display = 'none';
    }
  }
  
  // Update pagination info
  if (pageInfo) {
    let viewLabel;
    if (viewMode === 'custom') {
      viewLabel = `Custom Range (${customRangeLabel})`;
    } else if (viewMode === 'condensed') {
      viewLabel = 'Condensed (6-Month)';
    } else {
      viewLabel = 'Full Magento';
    }
    const searchLabel = currentSearch ? ` (search: "${currentSearch}")` : '';
    
    if (isSearchMode) {
      pageInfo.textContent = `${viewLabel}${searchLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} matching records)`;
    } else if (viewMode === 'condensed' || viewMode === 'custom') {
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
 * Display magento data in the table
 */
function displayMagentoData(data) {
  const tbody = document.getElementById('magentoTableBody');
  const thead = document.querySelector('#magentoTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for full view (matching the 15 columns in HTML)
  if (thead) {
    thead.innerHTML = `
      <th><i class="fas fa-hashtag"></i> Order Number</th>
      <th><i class="fas fa-calendar"></i> Created At</th>
      <th><i class="fas fa-barcode"></i> Product SKU</th>
      <th><i class="fas fa-box"></i> Product Name</th>
      <th><i class="fas fa-sort-numeric-up"></i> Product Qty</th>
      <th><i class="fas fa-euro-sign"></i> Original Price</th>
      <th><i class="fas fa-tag"></i> Special Price</th>
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
    tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 2rem;">No data found</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.order_number || '')}</td>
      <td>${escapeHtml(row.created_at || '')}</td>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${row.qty || 0}</td>
      <td>${row.original_price ? getCurrencySymbol(row.currency) + parseFloat(row.original_price).toFixed(2) : ''}</td>
      <td>${row.special_price ? getCurrencySymbol(row.currency) + parseFloat(row.special_price).toFixed(2) : ''}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${row.grand_total ? getCurrencySymbol(row.currency) + parseFloat(row.grand_total).toFixed(2) : ''}</td>
      <td>${escapeHtml(row.customer_email || '')}</td>
      <td>${escapeHtml(row.customer_full_name || '')}</td>
      <td>${escapeHtml(row.billing_address || '')}</td>
      <td>${escapeHtml(row.shipping_address || '')}</td>
      <td>${escapeHtml(row.customer_group_code || '')}</td></td>
    </tr>
  `).join('');
}

/**
 * Display condensed magento data in the table
 */
function displayCondensedData(data) {
  const tbody = document.getElementById('magentoTableBody');
  const thead = document.querySelector('#magentoTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for condensed view
  if (thead) {
    const headerLabel = viewMode === 'custom' ? customRangeLabel : '6 Months';
    thead.innerHTML = `
      <th>SKU</th>
      <th>Product Name</th>
      <th>Total Quantity (${headerLabel})</th>
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
 * Handle Magento data sync with progress tracking
 */
async function handleSync() {
  const syncBtn = document.getElementById('syncDataBtn');
  
  if (!syncBtn) {
    return;
  }
  
  // If this is the very first call (no abort controller exists), initialize everything
  if (!syncAbortController) {
    console.log('[FR Magento] Initializing new sync session');
    syncAbortController = new AbortController();
    isSyncing = true;
    
    // Change button to cancel mode
    syncBtn.classList.add('syncing');
    syncBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Sync';
    syncBtn.style.background = '#f44336';
  }
  
  // Early exit if sync was cancelled
  if (!isSyncing) {
    console.log('[FR Magento] Sync is not active, not starting');
    return;
  }
  
  // Check if abort signal is active (user cancelled)
  if (syncAbortController.signal.aborted) {
    console.log('[FR Magento] Sync was cancelled, exiting');
    return;
  }
  
  try {
    // Change button to cancel mode
    syncBtn.classList.add('syncing');
    syncBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Sync';
    syncBtn.style.background = '#f44336';
    
    showToast('Starting Magento sync... Progress is saved after each batch.', 'info');
    
    const result = await syncFRMagentoData(syncAbortController.signal);
    
    if (result.status === 'success') {
      showToast(
        `✅ Successfully synced ${result.rows_synced} product rows from ${result.orders_processed} orders!`, 
        'success',
        5000
      );
      
      // Show any errors that occurred during sync
      if (result.errors && result.errors.length > 0) {
        console.warn('[FR Magento] Sync errors:', result.errors);
        showToast(`⚠️ Sync completed with ${result.errors.length} errors. Check console for details.`, 'warning');
      }
      
      // Reload the data
      currentPage = 0;
      await loadMagentoData();
    } else if (result.status === 'cancelled') {
      showToast('⚠️ Sync cancelled. Progress has been saved - next sync will resume from where it left off.', 'warning', 5000);
    } else if (result.status === 'error') {
      // Show error with any partial progress info
      const errorMsg = result.message || 'Sync failed';
      if (result.orders_processed > 0) {
        showToast(`❌ ${errorMsg} (${result.rows_synced} rows from ${result.orders_processed} orders were saved)`, 'error', 7000);
      } else {
        showToast(`❌ ${errorMsg}`, 'error');
      }
    } else {
      showToast('❌ Sync failed: ' + (result.message || 'Unknown error'), 'error');
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[FR Magento] Sync cancelled by user');
      showToast('⚠️ Sync cancelled. Progress has been saved.', 'warning', 5000);
    } else {
      console.error('[FR Magento] Sync error:', error);
      // Check if it's a network error
      const isNetworkError = error.message.includes('timeout') || error.message.includes('fetch') || error.message.includes('network');
      if (isNetworkError) {
        showToast('❌ Network error during sync. Any progress made has been saved - next sync will resume.', 'error', 7000);
      } else {
        showToast('❌ Sync error: ' + error.message + '. Any progress made has been saved.', 'error', 7000);
      }
    }
  } finally {
    // Restore button to sync mode
    isSyncing = false;
    syncAbortController = null;
    if (syncBtn) {
      syncBtn.classList.remove('syncing');
      syncBtn.style.background = '';
      syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Sync from Magento';
    }
  }
}

function handleCancelSync() {
  if (syncAbortController) {
    console.log('[FR Magento] Cancelling sync... Progress will be saved.');
    // Immediately set isSyncing to false to prevent auto-restart
    isSyncing = false;
    syncAbortController.abort();
    showToast('Cancelling sync... Your progress has been saved.', 'info');
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
 * Handle PDF export
 */
async function handleExportPDF() {
  if (viewMode !== 'condensed' && viewMode !== 'custom') {
    showToast('PDF export is only available for condensed and custom range views', 'warning');
    return;
  }
  
  if (!allData || allData.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }
  
  try {
    showToast('Generating PDF...', 'info');
    
    const viewLabel = viewMode === 'custom' ? customRangeLabel : '6-Month';
    await exportToPDF(allData, 'fr', viewLabel, currentSearch);
    
    showToast('PDF exported successfully!', 'success');
  } catch (error) {
    console.error('Error exporting PDF:', error);
    showToast(`Failed to export PDF: ${error.message}`, 'error');
  }
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
          await loadMagentoData();
        }
      }
    } else {
      showToast('Refresh failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[FR Magento] Refresh error:', error);
    showToast('Refresh error: ' + error.message, 'error');
  }
}






