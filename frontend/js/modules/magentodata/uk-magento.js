// frontend/js/modules/magentodata/uk-magento.js
import { getUKMagentoData, getUKAggregatedData, refreshAggregatedDataForRegion, checkTablesStatus, initializeTables, syncUKMagentoData } from '../../services/api/magentoDataApi.js?v=5';
import { showToast } from '../../ui/toast.js';
import { showFiltersModal, showCustomRangeModal } from './aggregated-filters.js';
import { exportToPDF } from '../../utils/pdfExport.js';

let currentPage = 0;
const pageSize = 100; // Display 100 records per page
let currentSearch = '';
let viewMode = 'full'; // 'full', 'aggregated', or 'custom'
let allData = []; // Store loaded data
let totalRecords = 0; // Total records available (from server count)
let isSearchMode = false; // Whether we're in search mode (all matching results loaded) or pagination mode
let customRangeLabel = ''; // Label for custom range (e.g., "Last 30 Days")
let syncAbortController = null; // AbortController for cancelling ongoing sync
let isSyncing = false; // Track if sync is in progress
let currentSortColumn = null; // Currently sorted column
let currentSortDirection = 'asc'; // 'asc' or 'desc'

/**
 * Initialize UK magento page
 */
export async function initUKMagentoData(path = '/magentodata/uk-magento') {
  console.log('[UK Magento] initUKMagentoData called with path:', path);
  
  // Reset state for new page load
  currentPage = 0;
  currentSearch = '';
  isSearchMode = false;
  currentSortColumn = null;
  currentSortDirection = 'asc';
  allData = [];
  totalRecords = 0;
  
  // Determine initial view mode from URL
  if (path.includes('/full-data')) {
    viewMode = 'full';
    customRangeLabel = '';
    console.log('[UK Magento] Setting view mode to: full');
  } else if (path.includes('/6-month')) {
    viewMode = 'aggregated';
    customRangeLabel = '';
    console.log('[UK Magento] Setting view mode to: aggregated');
  } else if (path.includes('/custom-range')) {
    viewMode = 'custom';
    console.log('[UK Magento] Setting view mode to: custom');
  } else if (path === '/magentodata/uk-magento' || path === '/magentodata/uk-magento/') {
    // Redirect base URL to full-data to make URL explicit
    console.log('[UK Magento] Redirecting base URL to /full-data');
    window.navigate('/magentodata/uk-magento/full-data', true);
    return;
  } else {
    // Default to full data view
    viewMode = 'full';
    customRangeLabel = '';
    console.log('[UK Magento] Defaulting view mode to: full');
  }
  
  // Wait for DOM to be ready before setting up event listeners
  await new Promise(resolve => setTimeout(resolve, 0));
  
  // Show loading state immediately
  showLoadingState();
  
  // Set up event listeners immediately so UI is responsive
  setupEventListeners();
  
  // Update active button based on view mode immediately
  updateViewButtons();
  
  // Check if tables exist (quick status check)
  try {
    const status = await checkTablesStatus();
    if (!status.all_tables_exist) {
      console.warn('Some Magento tables do not exist, initializing...', status.tables_status);
      showToast('Initializing database tables...', 'info');
      await initializeTables();
    }
  } catch (error) {
    console.error('Error checking/initializing tables:', error);
    // Continue loading - tables may still work
  }
  
  // Load initial data based on view mode
  if (viewMode === 'custom') {
    // Check if custom range parameters exist
    if (window.customRangeActive) {
      customRangeLabel = window.customRangeActive.rangeLabel || 'Custom Range';
      // Load the custom range data
      allData = window.customRangeActive.data || [];
      totalRecords = window.customRangeActive.totalCount || 0;
      currentPage = 0;
      displayCurrentPage();
    } else {
      // No custom range set, redirect to full data
      showToast('No custom range data available. Please select a date range first.', 'warning');
      window.navigate('/magentodata/uk-magento/full-data', true);
    }
  } else if (viewMode === 'aggregated') {
    await handleRefreshAggregatedData();
  } else {
    // Full data view: sync from Magento first, then load
    await syncAndLoadFullData();
  }
  
  console.log('[UK Magento] Initialization complete. View mode:', viewMode);
}

/**
 * Get date string for N days ago in YYYY-MM-DD HH:MM:SS format
 */
function getDateNDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Sync from Magento and load full data
 */
async function syncAndLoadFullData() {
  const syncBtn = document.getElementById('syncNowBtn');
  const originalBtnContent = syncBtn ? syncBtn.innerHTML : '';
  
  try {
    showToast('Syncing latest orders from Magento...', 'info');
    console.log('[UK Magento] Starting sync before loading full data...');
    
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    syncAbortController = new AbortController();
    isSyncing = true;
    
    // Sync orders from the last 7 days (explicit date, not relative to last sync)
    const startDate = getDateNDaysAgo(7);
    const syncResult = await syncUKMagentoData(syncAbortController.signal, startDate, null, null, null);
    
    if (syncResult.status === 'success') {
      if (syncResult.rows_synced > 0) {
        showToast(`✓ Synced ${syncResult.rows_synced} new/updated rows`, 'success');
      } else {
        showToast('✓ Cache is up to date', 'info');
      }
    } else if (syncResult.status === 'error') {
      console.warn('[UK Magento] Sync warning:', syncResult.message);
      showToast('Sync issue: ' + syncResult.message, 'warning');
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[UK Magento] Sync error:', error);
      showToast('Sync error: ' + error.message, 'error');
    }
  } finally {
    isSyncing = false;
    syncAbortController = null;
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalBtnContent;
    }
  }
  
  // Now load the data from cache
  await loadMagentoData();
}

/**
 * Trigger background sync to cache latest data
 * Uses the same date range as automatic sync based on current view mode
 * In 6-month view, also triggers aggregation after sync
 */
async function triggerBackgroundSync() {
  if (isSyncing) return;
  
  const syncBtn = document.getElementById('syncNowBtn');
  const originalBtnContent = syncBtn ? syncBtn.innerHTML : '';
  
  try {
    isSyncing = true;
    
    // Use same date range as automatic sync based on view mode
    // Full Data view: 7 days, Aggregated/6-Month view: 180 days
    const daysToSync = viewMode === 'aggregated' ? 180 : 7;
    const startDate = getDateNDaysAgo(daysToSync);
    console.log(`[UK Magento] Starting manual sync (${daysToSync} days, view: ${viewMode})...`);
    
    showToast('Syncing latest orders from Magento...', 'info');
    
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    // Create abort controller for this sync
    syncAbortController = new AbortController();
    
    // Sync with explicit startDate (same as automatic sync)
    const result = await syncUKMagentoData(syncAbortController.signal, startDate, null, null, null);
    
    if (result.status === 'success') {
      if (result.rows_synced > 0) {
        showToast(`✓ Synced ${result.rows_synced} new/updated rows`, 'success');
      } else {
        showToast('✓ Cache is up to date', 'info');
      }
    } else if (result.status === 'error') {
      console.warn('[UK Magento] Background sync warning:', result.message);
      showToast('Sync Warning: ' + result.message, 'warning');
    }
    
    // In 6-month view, also refresh aggregated data (same as automatic sync)
    if (viewMode === 'aggregated') {
      showToast('Calculating 6-month aggregated data...', 'info');
      
      const aggResult = await refreshAggregatedDataForRegion('uk');
      
      if (aggResult.status === 'success') {
        showToast(`✓ Aggregated ${aggResult.rows_aggregated} SKUs`, 'success');
        // Reload data to show updated aggregation
        if (currentPage === 0 && !isSearchMode) {
          loadMagentoData();
        }
      } else {
        showToast('Aggregation failed: ' + aggResult.message, 'error');
      }
    } else {
      // Full data view: just reload data if on first page
      if (result.status === 'success' && result.rows_synced > 0 && currentPage === 0 && !isSearchMode) {
        loadMagentoData();
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[UK Magento] Background sync error:', error);
      showToast('Sync Failed: ' + error.message, 'error');
    }
  } finally {
    isSyncing = false;
    syncAbortController = null;
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalBtnContent;
    }
  }
}

/**
 * Update view buttons to reflect current view mode
 */
function updateViewButtons() {
  const viewFullBtn = document.getElementById('viewFullBtn');
  const viewAggregatedBtn = document.getElementById('viewAggregatedBtn');
  const customRangeBtn = document.getElementById('customRangeBtn');
  
  // Remove active class from all
  viewFullBtn?.classList.remove('active');
  viewAggregatedBtn?.classList.remove('active');
  customRangeBtn?.classList.remove('active');
  
  // Add active class to current view
  if (viewMode === 'full') {
    viewFullBtn?.classList.add('active');
  } else if (viewMode === 'aggregated') {
    viewAggregatedBtn?.classList.add('active');
  } else if (viewMode === 'custom') {
    customRangeBtn?.classList.add('active');
  }
}

/**
 * Set up event listeners for the page
 */
function setupEventListeners() {
  // View toggle buttons - now navigate to different URLs
  const viewFullBtn = document.getElementById('viewFullBtn');
  const viewAggregatedBtn = document.getElementById('viewAggregatedBtn');
  
  if (viewFullBtn) {
    viewFullBtn.addEventListener('click', () => {
      window.navigate('/magentodata/uk-magento/full-data');
    });
  }
  
  if (viewAggregatedBtn) {
    viewAggregatedBtn.addEventListener('click', () => {
      window.navigate('/magentodata/uk-magento/6-month');
    });
  }

  // Sync Now button
  const syncNowBtn = document.getElementById('syncNowBtn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      showToast('Starting sync...', 'info');
      await triggerBackgroundSync();
    });
  }
  
  // Search functionality - server-side query with fuzzy matching
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('magentoSearchInput');
  
  // Check for duplicate elements with same ID
  const allSearchInputs = document.querySelectorAll('#magentoSearchInput');
  const allSearchInputsByClass = document.querySelectorAll('.search-input');
  allSearchInputs.forEach((el, idx) => {
  });
  
  let searchTimeout = null;
  
  // Perform search function - queries server for ALL matching records
  const performSearch = async () => {
    const inputElement = document.getElementById('magentoSearchInput');
    if (!inputElement) {
      console.warn('[UK Magento] Search input not found');
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
    
    // Clear any pending debounced search
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    
    // Reload just the first page of data
    loadMagentoData();
  };
  
  // Add event listeners
  if (searchInput) {
    // Test: Can we set the value programmatically?
    searchInput.value = 'TEST';
    searchInput.value = '';
    
    // Debounced real-time search as user types
    searchInput.addEventListener('input', (e) => {
      debouncedSearch();
    });
    
    // Enter key to search immediately
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchTimeout) clearTimeout(searchTimeout);
        performSearch();
      }
    });
  } else {
    console.error('[UK Magento] Search input element not found! Cannot attach event listeners.');
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (searchTimeout) clearTimeout(searchTimeout);
      performSearch();
    });
  } else {
    console.error('[UK Magento] Search button not found!');
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      clearSearch();
    });
  } else {
    console.error('[UK Magento] Clear search button not found!');
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
          // In pagination mode, load next 100 records from server
          loadMagentoData();
        }
      }
    });
  }
  
  // Refresh aggregated data button
  const refreshAggregatedBtn = document.getElementById('refreshAggregatedBtn');
  if (refreshAggregatedBtn) {
    refreshAggregatedBtn.addEventListener('click', handleRefreshAggregatedData);
  }
  
  // Custom Range button
  // Use a more defensive approach with a slight delay to ensure DOM is ready
  let retryCount = 0;
  const setupCustomRangeButton = () => {
    const customRangeBtn = document.getElementById('customRangeBtn');
    if (customRangeBtn) {
      // Remove any existing listener
      const newBtn = customRangeBtn.cloneNode(true);
      customRangeBtn.parentNode.replaceChild(newBtn, customRangeBtn);
      
      newBtn.addEventListener('click', () => {
        try {
          showCustomRangeModal('uk');
        } catch (error) {
          console.error('[UK Magento] Error calling showCustomRangeModal:', error);
        }
      });
    } else {
      console.error('[UK Magento] Custom Range Button NOT found');
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
      showFiltersModal('uk');
    });
  }
  
  // Export PDF button
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
      await handleExportPDF();
    });
  }
  
  // Set up table header sorting
  setupTableSorting();
  
  // Listen for aggregated data refresh events from filter modal
  document.addEventListener('aggregated-data-refreshed', (e) => {
    if (e.detail.region === 'uk' && viewMode === 'aggregated') {
      // Reload the table data if currently viewing aggregated data
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
    if (e.detail.region === 'uk') {
      // Navigate to the custom range URL
      window.navigate('/magentodata/uk-magento/custom-range');
    }
  });
}

/**
 * Show loading state in the table
 */
function showLoadingState() {
  const tbody = document.getElementById('magentoTableBody');
  if (!tbody) return;
  
  const colSpan = viewMode === 'aggregated' ? '4' : '14';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px;">
      <div class="loader" style="margin: 0;">
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
      </div>
      <span style="color: var(--text-secondary); font-size: 0.9rem;">Loading data...</span>
    </div>
  </td></tr>`;
}

/**
 * Load magento data from the backend - pagination mode (100 records at a time)
 */
async function loadMagentoData() {
  const tbody = document.getElementById('magentoTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) return;
  
  // Show loading state
  const colSpan = viewMode === 'aggregated' ? '4' : '14';
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
    
    // Both full and aggregated views now use server-side pagination (100 records at a time)
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'aggregated') {
      result = await getUKAggregatedData(pageSize, offset, '');
    } else {
      result = await getUKMagentoData(pageSize, offset, '');
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      // Apply current sort if one is active
      if (currentSortColumn) {
        applySortToData();
      }
      
      // Display the data
      displayCurrentPage();
    } else {
      console.error('[UK Magento] Failed to load data:', result.message);
      console.log('[UK Magento] Using fallback demo data');
      
      // Use fallback demo data when API returns error
      allData = getFallbackMagentoData('uk');
      totalRecords = allData.length;
      displayCurrentPage();
      showToast('Using demo data - backend not connected', 'info');
    }
  } catch (error) {
    console.error('[UK Magento] Error loading data:', error);
    console.log('[UK Magento] Using fallback demo data');
    
    // Use fallback demo data when connection fails
    allData = getFallbackMagentoData('uk');
    totalRecords = allData.length;
    displayCurrentPage();
    showToast('Using demo data - backend not connected', 'info');
  }
}

/**
 * Fallback demo data when connection fails
 */
function getFallbackMagentoData(region) {
  const currencyMap = { uk: 'GBP', fr: 'EUR', nl: 'EUR' };
  const currency = currencyMap[region] || 'GBP';
  
  return [
    {
      order_number: 'UK-100001234',
      created_at: '2024-01-15 10:30:00',
      sku: 'PROD-001',
      name: 'Premium Widget Set',
      qty: 2,
      original_price: 49.99,
      special_price: null,
      status: 'complete',
      currency: currency,
      grand_total: 99.98,
      customer_email: 'john.demo@example.com',
      customer_fullname: 'John Demo',
      billing_address: '123 Demo Street, London',
      shipping_address: '123 Demo Street, London',
      customer_group_code: 'General'
    },
    {
      order_number: 'UK-100001235',
      created_at: '2024-01-15 11:45:00',
      sku: 'PROD-002',
      name: 'Standard Gadget Pro',
      qty: 1,
      original_price: 129.99,
      special_price: 99.99,
      status: 'processing',
      currency: currency,
      grand_total: 99.99,
      customer_email: 'jane.sample@example.com',
      customer_fullname: 'Jane Sample',
      billing_address: '456 Sample Road, Manchester',
      shipping_address: '456 Sample Road, Manchester',
      customer_group_code: 'Retail'
    },
    {
      order_number: 'UK-100001236',
      created_at: '2024-01-14 09:15:00',
      sku: 'PROD-003',
      name: 'Deluxe Package Bundle',
      qty: 3,
      original_price: 75.00,
      special_price: null,
      status: 'complete',
      currency: currency,
      grand_total: 225.00,
      customer_email: 'test.user@example.com',
      customer_fullname: 'Test User',
      billing_address: '789 Test Avenue, Birmingham',
      shipping_address: '789 Test Avenue, Birmingham',
      customer_group_code: 'Wholesale'
    },
    {
      order_number: 'UK-100001237',
      created_at: '2024-01-14 14:20:00',
      sku: 'PROD-004',
      name: 'Economy Basic Kit',
      qty: 5,
      original_price: 19.99,
      special_price: 14.99,
      status: 'pending',
      currency: currency,
      grand_total: 74.95,
      customer_email: 'demo.account@example.com',
      customer_fullname: 'Demo Account',
      billing_address: '321 Demo Lane, Leeds',
      shipping_address: '321 Demo Lane, Leeds',
      customer_group_code: 'General'
    },
    {
      order_number: 'UK-100001238',
      created_at: '2024-01-13 16:00:00',
      sku: 'PROD-005',
      name: 'Professional Tool Set',
      qty: 1,
      original_price: 299.99,
      special_price: null,
      status: 'complete',
      currency: currency,
      grand_total: 299.99,
      customer_email: 'pro.buyer@example.com',
      customer_fullname: 'Pro Buyer',
      billing_address: '555 Pro Street, Liverpool',
      shipping_address: '555 Pro Street, Liverpool',
      customer_group_code: 'Trade'
    }
  ];
}

/**
 * Load search results - queries ALL records matching the search term from server
 */
/**
 * Load search results from server - pagination mode (100 records at a time with search term)
 */
async function loadSearchResults(searchTerm) {
  const tbody = document.getElementById('magentoTableBody');
  const colSpan = viewMode === 'aggregated' ? '4' : '14';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">Searching for "${searchTerm}"...</td></tr>`;
  
  try {
    // Fetch 100 matching records at a time, just like regular pagination
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'aggregated') {
      result = await getUKAggregatedData(pageSize, offset, searchTerm);
    } else {
      result = await getUKMagentoData(pageSize, offset, searchTerm);
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      // Apply current sort if one is active
      if (currentSortColumn) {
        applySortToData();
      }
      
      displayCurrentPage();
    } else {
      console.error('[UK Magento] Search failed:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${result.message}</td></tr>`;
    }
    
  } catch (error) {
    console.error('[UK Magento] Error searching data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${error.message}</td></tr>`;
    showToast('Search error: ' + error.message, 'error');
  }
}

/**
 * Display current page of data (works for both pagination and search modes)
 */
function displayCurrentPage() {
  const tbody = document.getElementById('magentoTableBody');
  const pageInfo = document.getElementById('pageInfo');
  
  if (!tbody) {
    console.warn('[UK Magento] Table body not found');
    return;
  }
  
  // Check if data is loaded
  if (!allData || allData.length === 0) {
    const colSpan = viewMode === 'aggregated' ? '4' : '14';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">No data available</td></tr>`;
    if (pageInfo) {
      pageInfo.textContent = 'No data loaded';
    }
    updatePaginationButtons();
    return;
  }
  
  // All views now use server-side pagination (100 records at a time)
  // Display all data from the current page load
  let pageData = allData;
  
  // For custom view, we have all data client-side (up to 1000 rows), so we need to slice it
  if (viewMode === 'custom') {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    pageData = allData.slice(start, end);
  }

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  
  
  // Display the data
  if (viewMode === 'aggregated' || viewMode === 'custom') {
    displayAggregatedData(pageData);
  } else {
    displayMagentoData(pageData);
  }
  
  // Show/hide export PDF button based on view mode
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) {
    if (viewMode === 'aggregated' || viewMode === 'custom') {
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
    } else if (viewMode === 'aggregated') {
      viewLabel = 'Aggregated (6-Month)';
    } else {
      viewLabel = 'Full Magento';
    }
    const searchLabel = currentSearch ? ` (search: "${currentSearch}")` : '';
    
    if (isSearchMode) {
      pageInfo.textContent = `${viewLabel}${searchLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} matching records)`;
    } else if (viewMode === 'aggregated' || viewMode === 'custom') {
      pageInfo.textContent = `${viewLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} total SKUs)`;
    } else {
      pageInfo.textContent = `${viewLabel} - Page ${currentPage + 1} of ${totalPages} (${totalRecords} total records)`;
    }
  }
  
  updatePaginationButtons();
  updateSortIndicators();
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
  
  // Update table headers for full view (matching the 14 columns in HTML)
  if (thead) {
    thead.innerHTML = `
      <th><i class="fas fa-hashtag"></i> Order Number</th>
      <th><i class="fas fa-calendar"></i> Created At</th>
      <th><i class="fas fa-barcode"></i> Product SKU</th>
      <th><i class="fas fa-box"></i> Product Name</th>
      <th><i class="fas fa-sort-numeric-up"></i> Product Qty</th>
      <th><i class="fas fa-pound-sign"></i> Original Price</th>
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
      <td>${escapeHtml(row.customer_group_code || '')}</td>
    </tr>
  `).join('');
}

/**
 * Display aggregated magento data in the table
 */
function displayAggregatedData(data) {
  const tbody = document.getElementById('magentoTableBody');
  const thead = document.querySelector('#magentoTable thead tr');
  
  if (!tbody) return;
  
  // Update table headers for aggregated view
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
  if (viewMode !== 'aggregated' && viewMode !== 'custom') {
    showToast('PDF export is only available for aggregated and custom range views', 'warning');
    return;
  }
  
  if (!allData || allData.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }
  
  try {
    showToast('Generating PDF...', 'info');
    
    const viewLabel = viewMode === 'custom' ? customRangeLabel : '6-Month';
    await exportToPDF(allData, 'uk', viewLabel, currentSearch);
    
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
 * Handle refresh aggregated data - syncs from Magento first, then refreshes aggregated view
 */
async function handleRefreshAggregatedData() {
  const syncBtn = document.getElementById('syncNowBtn');
  const originalBtnContent = syncBtn ? syncBtn.innerHTML : '';
  
  try {
    // Step 1: Sync from Magento first (180 days for 6-month view)
    showToast('Syncing latest orders from Magento...', 'info');
    console.log('[UK Magento] Starting automatic sync before aggregated refresh...');
    
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    // Create abort controller for this sync
    syncAbortController = new AbortController();
    isSyncing = true;
    
    // Sync orders from the last 180 days (explicit date for 6-month view)
    const startDate = getDateNDaysAgo(180);
    const syncResult = await syncUKMagentoData(syncAbortController.signal, startDate, null, null, null);
    
    // Show sync result toast
    if (syncResult.status === 'success') {
      if (syncResult.rows_synced > 0) {
        showToast(`✓ Synced ${syncResult.rows_synced} new/updated rows`, 'success');
      } else {
        showToast('✓ Cache is up to date', 'info');
      }
    } else if (syncResult.status === 'error') {
      console.warn('[UK Magento] Sync warning:', syncResult.message);
      showToast('Sync issue: ' + syncResult.message, 'warning');
      // Continue with refresh even if sync had issues
    } else {
      // Unknown status - log it
      console.warn('[UK Magento] Unexpected sync result:', syncResult);
      showToast('✓ Sync completed', 'info');
    }
    
    // Small delay so user can see the sync result before aggregation starts
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 2: Now refresh aggregated data (with FREE GIFT exclusion)
    showToast('Calculating 6-month aggregated data...', 'info');
    
    const result = await refreshAggregatedDataForRegion('uk');
    
    if (result.status === 'success') {
      showToast(`✓ Aggregated ${result.rows_aggregated} SKUs`, 'success');
      
      // Reload the data if currently viewing aggregated view
      if (viewMode === 'aggregated') {
        // Check if there's an active search and reload with it
        if (currentSearch) {
          await loadSearchResults(currentSearch);
        } else {
          await loadMagentoData();
        }
      }
    } else {
      showToast('Aggregation failed: ' + result.message, 'error');
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[UK Magento] Refresh error:', error);
      showToast('Refresh error: ' + error.message, 'error');
    }
  } finally {
    isSyncing = false;
    syncAbortController = null;
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalBtnContent;
    }
  }
}

/**
 * Set up table header sorting functionality
 */
function setupTableSorting() {
  // Use event delegation on the table to handle clicks on header cells
  const table = document.getElementById('magentoTable');
  if (!table) {
    console.warn('[UK Magento] Table not found for sorting setup');
    return;
  }
  
  console.log('[UK Magento] Setting up table sorting...');
  
  table.addEventListener('click', (e) => {
    // Find the closest th element
    const th = e.target.closest('th');
    if (!th) return;
    
    const thead = th.closest('thead');
    if (!thead) return;
    
    // Get the column index
    const columnIndex = Array.from(th.parentElement.children).indexOf(th);
    
    // Determine the column key based on view mode and column index
    let columnKey;
    if (viewMode === 'aggregated' || viewMode === 'custom') {
      // Aggregated view columns: SKU, Product Name, Total Quantity, Last Updated
      const aggregatedColumns = ['sku', 'name', 'total_qty', 'last_updated'];
      columnKey = aggregatedColumns[columnIndex];
    } else {
      // Full view columns
      const fullColumns = [
        'order_number', 'created_at', 'sku', 'name', 'qty', 
        'original_price', 'special_price', 'status', 'currency', 'grand_total',
        'customer_email', 'customer_full_name', 'billing_address', 'shipping_address', 'customer_group_code'
      ];
      columnKey = fullColumns[columnIndex];
    }
    
    if (!columnKey) {
      console.warn('[UK Magento] No column key found for index:', columnIndex);
      return;
    }
    
    // Toggle sort direction if clicking the same column
    if (currentSortColumn === columnKey) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortColumn = columnKey;
      currentSortDirection = 'asc';
    }
    
    console.log(`[UK Magento] Sorting by ${columnKey} (${currentSortDirection})`);
    
    // Sort the data and re-render
    sortAndRenderData();
  });
  
  console.log('[UK Magento] Table sorting setup complete');
}

/**
 * Sort the current data and re-render the table
 */
function sortAndRenderData() {
  if (!allData || allData.length === 0) return;
  
  applySortToData();
  
  // Re-render the display
  displayCurrentPage();
  
  // Update sort indicators in headers
  updateSortIndicators();
}

/**
 * Apply sorting to the current data (without rendering)
 */
function applySortToData() {
  if (!allData || allData.length === 0 || !currentSortColumn) return;
  
  // Create a copy to sort
  const sortedData = [...allData];
  
  // Sort the data
  sortedData.sort((a, b) => {
    let aVal = a[currentSortColumn];
    let bVal = b[currentSortColumn];
    
    // Handle null/undefined values
    if (aVal == null) aVal = '';
    if (bVal == null) bVal = '';
    
    // Determine if numeric comparison
    const isNumeric = ['qty', 'total_qty', 'original_price', 'special_price', 'grand_total'].includes(currentSortColumn);
    
    let comparison;
    if (isNumeric) {
      const numA = parseFloat(aVal) || 0;
      const numB = parseFloat(bVal) || 0;
      comparison = numA - numB;
    } else if (currentSortColumn === 'created_at' || currentSortColumn === 'last_updated') {
      // Date comparison
      const dateA = new Date(aVal);
      const dateB = new Date(bVal);
      comparison = dateA - dateB;
    } else {
      // String comparison
      comparison = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' });
    }
    
    return currentSortDirection === 'asc' ? comparison : -comparison;
  });
  
  // Update allData with sorted data
  allData = sortedData;
}

/**
 * Update sort indicators in table headers
 */
function updateSortIndicators() {
  const thead = document.querySelector('#magentoTable thead tr');
  if (!thead) return;
  
  const ths = thead.querySelectorAll('th');
  
  // Determine column index from current sort column
  let columnIndex = -1;
  if (viewMode === 'aggregated' || viewMode === 'custom') {
    const aggregatedColumns = ['sku', 'name', 'total_qty', 'last_updated'];
    columnIndex = aggregatedColumns.indexOf(currentSortColumn);
  } else {
    const fullColumns = [
      'order_number', 'created_at', 'sku', 'name', 'qty', 
      'original_price', 'special_price', 'status', 'currency', 'grand_total',
      'customer_email', 'customer_full_name', 'billing_address', 'shipping_address', 'customer_group_code'
    ];
    columnIndex = fullColumns.indexOf(currentSortColumn);
  }
  
  // Remove all existing sort indicators and add cursor pointer
  ths.forEach((th, index) => {
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    
    // Remove any existing sort icons
    const existingSortIcon = th.querySelector('.sort-indicator');
    if (existingSortIcon) {
      existingSortIcon.remove();
    }
    
    // Add sort indicator to the active column
    if (index === columnIndex && currentSortColumn) {
      const sortIcon = document.createElement('i');
      sortIcon.className = `fas fa-sort-${currentSortDirection === 'asc' ? 'up' : 'down'} sort-indicator`;
      sortIcon.style.marginLeft = '5px';
      sortIcon.style.fontSize = '0.8em';
      th.appendChild(sortIcon);
    }
  });
}
