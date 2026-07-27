// frontend/js/modules/magentodata/nl-magento.js
import { getNLMagentoData, getNLAggregatedData, getCustomRangeAggregatedData, refreshAggregatedDataForRegion, checkTablesStatus, initializeTables, syncNLMagentoData } from '../../services/api/magentoDataApi.js?v=9';
import { showToast } from '../../ui/toast.js';
import { showProgressNotification } from '../../ui/progressNotification.js';
import { confirmModal } from '../../ui/confirmationModal.js';
import { showFiltersModal, showCustomRangeModal } from './aggregated-filters.js?v=3';
import { exportToPDF } from '../../utils/pdfExport.js';
import { exportToCSV, exportFullDataToCSV } from '../../utils/csvExport.js';
import {
  showFullDataFilterModal,
  renderFullDataFilterBar,
  syncControlGroups,
  emptyFullDataFilters,
  hasActiveFullDataFilters,
  describeFullDataFilters,
  filtersFilenameSlug
} from './full-data-filters.js?v=5';

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
let _onAggregatedRefreshed = null; // Stored handler ref to avoid listener duplication
let _onCustomRangeApplied = null; // Stored handler ref to avoid listener duplication
let fullDataFilters = emptyFullDataFilters(); // Date range + order status filters for the Full Data view
const EXPORT_WARN_ROWS = 50000; // Above this, confirm before exporting - the browser holds every row in memory

/**
 * Initialize NL magento page
 */
export async function initNLMagentoData(path = '/sales/nl') {
  showToast('Initializing Netherlands Magento...', 'info');
  
  // Reset state for new page load
  currentPage = 0;
  currentSearch = '';
  isSearchMode = false;
  allData = [];
  totalRecords = 0;
  fullDataFilters = emptyFullDataFilters();

  // Determine initial view mode from URL
  if (path.includes('/full-data')) {
    viewMode = 'full';
    customRangeLabel = '';
    console.log('[NL Magento] Setting view mode to: full');
  } else if (path.includes('/6-month')) {
    viewMode = 'aggregated';
    customRangeLabel = '';
    console.log('[NL Magento] Setting view mode to: aggregated');
  } else if (path.includes('/custom-range')) {
    viewMode = 'custom';
    console.log('[NL Magento] Setting view mode to: custom');
  } else {
    // Base URL or unknown path - default to full data view
    // Just update the URL without causing a new navigation
    viewMode = 'full';
    customRangeLabel = '';
    console.log('[NL Magento] Base URL - defaulting to full data view');
    // Silently update URL to include /full-data for clarity
    history.replaceState({ path: '/sales/nl/full-data' }, '', '/sales/nl/full-data');
  }
  
  // Wait for DOM to be ready before setting up event listeners
  await new Promise(resolve => setTimeout(resolve, 0));
  
  // Show loading state immediately
  showLoadingState();
  
  // Set up event listeners immediately so UI is responsive
  setupEventListeners();
  
  // Update active button based on view mode immediately
  updateViewButtons();
  
  showToast('Checking database tables...', 'info');
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
  // Note: Syncing is now handled by the nightly scheduler - page load just reads from cache
  if (viewMode === 'custom') {
    // Check if custom range parameters exist
    if (window.customRangeActive) {
      showToast('Loading custom date range...', 'info');
      customRangeLabel = window.customRangeActive.rangeLabel || 'Custom Range';
      // Load the custom range data
      allData = window.customRangeActive.data || [];
      totalRecords = window.customRangeActive.totalCount || 0;
      currentPage = 0;
      displayCurrentPage();
    } else {
      // No custom range set, switch to full data view instead of redirecting
      showToast('No custom range data available. Loading full data instead.', 'warning');
      viewMode = 'full';
      customRangeLabel = '';
      history.replaceState({ path: '/sales/nl/full-data' }, '', '/sales/nl/full-data');
      updateViewButtons();
      await loadMagentoData();
    }
  } else if (viewMode === 'aggregated') {
    showToast('Loading 6-month aggregated data...', 'info');
    await loadMagentoData();
  } else {
    showToast('Loading Netherlands Magento data...', 'info');
    // Full data view: load from cache (nightly scheduler keeps data fresh)
    await loadMagentoData();
  }
  
  console.log('[NL Magento] Initialization complete. View mode:', viewMode);
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
    console.log('[NL Magento] Starting sync before loading full data...');
    
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    syncAbortController = new AbortController();
    isSyncing = true;
    
    // Sync orders from the last 7 days (explicit date, not relative to last sync)
    const startDate = getDateNDaysAgo(7);
    const syncResult = await syncNLMagentoData(syncAbortController.signal, startDate, null, null, null);
    
    if (syncResult.status === 'success') {
      if (syncResult.rows_synced > 0) {
        showToast(`✓ Synced ${syncResult.rows_synced} new/updated rows`, 'success');
      } else {
        showToast('✓ Cache is up to date', 'info');
      }
    } else if (syncResult.status === 'error') {
      console.warn('[NL Magento] Sync warning:', syncResult.message);
      showToast('Sync issue: ' + syncResult.message, 'warning');
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[NL Magento] Sync error:', error);
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
    console.log(`[NL Magento] Starting manual sync (${daysToSync} days, view: ${viewMode})...`);
    
    showToast('Syncing latest orders from Magento...', 'info');
    
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    // Create abort controller for this sync
    syncAbortController = new AbortController();
    
    // Sync with explicit startDate (same as automatic sync)
    const result = await syncNLMagentoData(syncAbortController.signal, startDate, null, null, null);
    
    if (result.status === 'success') {
      if (result.rows_synced > 0) {
        showToast(`✓ Synced ${result.rows_synced} new/updated rows`, 'success');
      } else {
        showToast('✓ Cache is up to date', 'info');
      }
    } else if (result.status === 'error') {
      console.warn('[NL Magento] Background sync warning:', result.message);
      showToast('Sync Warning: ' + result.message, 'warning');
    }
    
    // In 6-month view, also refresh aggregated data (same as automatic sync)
    if (viewMode === 'aggregated') {
      showToast('Calculating 6-month aggregated data...', 'info');
      
      const aggResult = await refreshAggregatedDataForRegion('nl');
      
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
      console.error('[NL Magento] Background sync error:', error);
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
  const orderDataTitle = document.getElementById('orderDataTitle');
  
  // Remove active class from all
  viewFullBtn?.classList.remove('active');
  viewAggregatedBtn?.classList.remove('active');
  customRangeBtn?.classList.remove('active');
  
  // Add active class to current view and update title
  if (viewMode === 'full') {
    viewFullBtn?.classList.add('active');
    if (orderDataTitle) orderDataTitle.textContent = 'Full Data';
  } else if (viewMode === 'aggregated') {
    viewAggregatedBtn?.classList.add('active');
    if (orderDataTitle) orderDataTitle.textContent = '6-Month Data';
  } else if (viewMode === 'custom') {
    customRangeBtn?.classList.add('active');
    if (orderDataTitle) orderDataTitle.textContent = 'Custom Range Data';
  }

  updateFullDataFilterUI();
}

/**
 * Set up event listeners for the page
 */
function setupEventListeners() {
  // Helper to safely attach listener
  const attachListener = (id, callback) => {
    const el = document.getElementById(id);
    if (el) {
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      newEl.addEventListener('click', callback);
      return true;
    }
    return false;
  };

  // View toggle buttons
  attachListener('viewFullBtn', () => {
    window.navigate('/sales/nl/full-data');
  });
  
  attachListener('viewAggregatedBtn', () => {
    window.navigate('/sales/nl/6-month');
  });

  // Sync Now button
  const syncNowBtn = document.getElementById('syncNowBtn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      showToast('Starting sync...', 'info');
      await triggerBackgroundSync();
    });
  }
  
  // Search functionality - completely rebuilt
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('magentoSearchInput');
  
  let searchTimeout = null;
  
  // Perform search function - queries server for ALL matching records
  const performSearch = async () => {
    const inputElement = document.getElementById('magentoSearchInput');
    if (!inputElement) {
      console.warn('[NL Magento] Search input not found');
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
  
  // Refresh aggregated data button
  const refreshAggregatedBtn = document.getElementById('refreshAggregatedBtn');
  if (refreshAggregatedBtn) {
    refreshAggregatedBtn.addEventListener('click', handleRefreshAggregatedData);
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
          showCustomRangeModal('nl');
        } catch (error) {
          console.error('[NL Magento] Error calling showCustomRangeModal:', error);
        }
      });
    } else {
      console.error('[NL Magento] Custom Range Button NOT found');
      // Try again after a short delay (max 5 retries)
      if (retryCount < 5) {
        retryCount++;
        setTimeout(setupCustomRangeButton, 100);
      }
    }
  };
  
  setupCustomRangeButton();

  // Filters button (6-month aggregation config)
  const filtersBtn = document.getElementById('filtersBtn');
  if (filtersBtn) {
    filtersBtn.addEventListener('click', () => {
      showFiltersModal('nl');
    });
  }

  // Full Data filter button (date range + order status)
  const fullDataFilterBtn = document.getElementById('fullDataFilterBtn');
  if (fullDataFilterBtn) {
    fullDataFilterBtn.addEventListener('click', () => {
      showFullDataFilterModal('nl', fullDataFilters, applyFullDataFilters);
    });
  }

  // Export PDF button
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
      await handleExportPDF();
    });
  }

  // Export CSV button
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', async () => {
      await handleExportCSV();
    });
  }
  
  // Set up table header sorting
  setupTableSorting();
  
  // Listen for aggregated data refresh events from filter modal
  if (_onAggregatedRefreshed) document.removeEventListener('aggregated-data-refreshed', _onAggregatedRefreshed);
  _onAggregatedRefreshed = (e) => {
    if (e.detail.region === 'nl' && viewMode === 'aggregated') {
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
  };
  document.addEventListener('aggregated-data-refreshed', _onAggregatedRefreshed);
  
  // Listen for custom range applied event
  if (_onCustomRangeApplied) window.removeEventListener('customRangeApplied', _onCustomRangeApplied);
  _onCustomRangeApplied = (e) => {
    if (e.detail.region === 'nl') {
      // Navigate to the custom range URL
      window.navigate('/sales/nl/custom-range');
    }
  };
  window.addEventListener('customRangeApplied', _onCustomRangeApplied);
}

/**
 * Show loading state in the table
 */
function showLoadingState() {
  const tbody = document.getElementById('magentoTableBody');
  if (!tbody) return;
  
  const colSpan = viewMode === 'aggregated' || viewMode === 'custom' ? '4' : '14';
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
  const colSpan = viewMode === 'aggregated' || viewMode === 'custom' ? '4' : '14';
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
    // Custom mode - restore original data from customRangeActive (may have been overwritten by search)
    if (viewMode === 'custom') {
      if (window.customRangeActive && window.customRangeActive.data) {
        allData = window.customRangeActive.data;
        totalRecords = window.customRangeActive.totalCount || allData.length;
      }
      displayCurrentPage();
      return;
    }
    
    // Both full and aggregated views now use server-side pagination (100 records at a time)
    const offset = currentPage * pageSize;
    
    let result;
    if (viewMode === 'aggregated') {
      result = await getNLAggregatedData(pageSize, offset, '', currentSortColumn || '', currentSortDirection);
    } else {
      result = await getNLMagentoData(pageSize, offset, '', currentSortColumn || '', currentSortDirection, fullDataFilters);
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      // Display the data (server already sorted)
      displayCurrentPage();
    } else {
      console.error('[NL Magento] Failed to load data:', result.message);
      console.log('[NL Magento] Using fallback demo data');
      
      // Use fallback demo data when API returns error
      allData = getFallbackMagentoData('nl');
      totalRecords = allData.length;
      displayCurrentPage();
      showToast('Using demo data - backend not connected', 'info');
    }
  } catch (error) {
    console.error('[NL Magento] Error loading data:', error);
    console.log('[NL Magento] Using fallback demo data');
    
    // Use fallback demo data when connection fails
    allData = getFallbackMagentoData('nl');
    totalRecords = allData.length;
    displayCurrentPage();
    showToast('Using demo data - backend not connected', 'info');
  }
}

/**
 * Fallback demo data when connection fails
 */
function getFallbackMagentoData(region) {
  const currency = 'EUR';
  
  return [
    {
      order_number: 'NL-300001234',
      created_at: '2024-01-15 10:30:00',
      sku: 'PROD-NL-001',
      name: 'Premium Widget Set',
      qty: 2,
      original_price: 49.99,
      special_price: null,
      status: 'complete',
      currency: currency,
      grand_total: 99.98,
      customer_email: 'jan.demo@example.nl',
      customer_fullname: 'Jan Demo',
      billing_address: '123 Demo Straat, Amsterdam',
      shipping_address: '123 Demo Straat, Amsterdam',
      customer_group_code: 'General'
    },
    {
      order_number: 'NL-300001235',
      created_at: '2024-01-15 11:45:00',
      sku: 'PROD-NL-002',
      name: 'Standard Gadget Pro',
      qty: 1,
      original_price: 129.99,
      special_price: 99.99,
      status: 'processing',
      currency: currency,
      grand_total: 99.99,
      customer_email: 'anna.sample@example.nl',
      customer_fullname: 'Anna Sample',
      billing_address: '456 Sample Weg, Rotterdam',
      shipping_address: '456 Sample Weg, Rotterdam',
      customer_group_code: 'Retail'
    },
    {
      order_number: 'NL-300001236',
      created_at: '2024-01-14 09:15:00',
      sku: 'PROD-NL-003',
      name: 'Deluxe Pakket Bundle',
      qty: 3,
      original_price: 75.00,
      special_price: null,
      status: 'complete',
      currency: currency,
      grand_total: 225.00,
      customer_email: 'test.gebruiker@example.nl',
      customer_fullname: 'Test Gebruiker',
      billing_address: '789 Test Laan, Den Haag',
      shipping_address: '789 Test Laan, Den Haag',
      customer_group_code: 'Wholesale'
    },
    {
      order_number: 'NL-300001237',
      created_at: '2024-01-14 14:20:00',
      sku: 'PROD-NL-004',
      name: 'Basis Kit Economisch',
      qty: 5,
      original_price: 19.99,
      special_price: 14.99,
      status: 'pending',
      currency: currency,
      grand_total: 74.95,
      customer_email: 'demo.account@example.nl',
      customer_fullname: 'Demo Account',
      billing_address: '321 Demo Straat, Utrecht',
      shipping_address: '321 Demo Straat, Utrecht',
      customer_group_code: 'General'
    },
    {
      order_number: 'NL-300001238',
      created_at: '2024-01-13 16:00:00',
      sku: 'PROD-NL-005',
      name: 'Professionele Gereedschap Set',
      qty: 1,
      original_price: 299.99,
      special_price: null,
      status: 'complete',
      currency: currency,
      grand_total: 299.99,
      customer_email: 'pro.koper@example.nl',
      customer_fullname: 'Pro Koper',
      billing_address: '555 Pro Straat, Eindhoven',
      shipping_address: '555 Pro Straat, Eindhoven',
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
    if (viewMode === 'custom' && window.customRangeActive) {
      const { rangeType, rangeValue, useExclusions, shippingMethod } = window.customRangeActive;
      result = await getCustomRangeAggregatedData('nl', rangeType, rangeValue, useExclusions !== false, pageSize, offset, searchTerm, shippingMethod || '');
    } else if (viewMode === 'aggregated') {
      result = await getNLAggregatedData(pageSize, offset, searchTerm, currentSortColumn || '', currentSortDirection);
    } else {
      result = await getNLMagentoData(pageSize, offset, searchTerm, currentSortColumn || '', currentSortDirection, fullDataFilters);
    }
    
    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      
      // Display the data (server already sorted)
      displayCurrentPage();
    } else {
      console.error('[NL Magento] Search failed:', result.message);
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${result.message}</td></tr>`;
    }
    
  } catch (error) {
    console.error('[NL Magento] Error searching data:', error);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem; color: red;">Search error: ${error.message}</td></tr>`;
    showToast('Search error: ' + error.message, 'error');
  }
}

/**
 * Load ALL data for aggregated view
 */
async function loadAllDataForAggregated() {
  const tbody = document.getElementById('magentoTableBody');
  const colSpan = '4';
  
  if (!tbody) return;
  
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px; flex-direction: column;">
      <div style="margin-bottom: 1rem; color: var(--text-secondary);">Loading aggregated data...</div>
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
      const result = await getNLAggregatedData(batchSize, offset, '');
      
      if (result.status === 'success' && result.data && result.data.length > 0) {
        allData = allData.concat(result.data);
        offset += batchSize;
        
        // Update loading message
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
          <div style="display: flex; justify-content: center; align-items: center; gap: 10px; flex-direction: column;">
            <div style="margin-bottom: 1rem; color: var(--text-secondary);">Loading aggregated data... (${allData.length} SKUs loaded)</div>
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
    console.error('[NL Magento] Error loading aggregated data:', error);
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
  const paginationInfo = document.getElementById('paginationInfo');
  
  if (!tbody) {
    console.warn('[NL Magento] Table body not found');
    return;
  }
  
  // Check if data is loaded
  if (!allData || allData.length === 0) {
    const colSpan = viewMode === 'aggregated' || viewMode === 'custom' ? '4' : '14';
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">No data available</td></tr>`;
    if (pageInfo) {
      pageInfo.textContent = 'No data loaded';
    }
    if (paginationInfo) {
      paginationInfo.innerHTML = 'Showing <strong>0</strong> of <strong>0</strong> items';
    }
    updatePaginationButtons();
    updateFullDataFilterUI();
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
  
  // Show/hide export buttons based on view mode
  // PDF stays aggregated-only; CSV is available everywhere including Full Data
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportPdfBtn) {
    exportPdfBtn.style.display = (viewMode === 'aggregated' || viewMode === 'custom') ? '' : 'none';
  }
  if (exportCsvBtn) {
    exportCsvBtn.style.display = '';
  }

  updateFullDataFilterUI();

  // Calculate showing range
  const startItem = currentPage * pageSize + 1;
  const endItem = Math.min((currentPage + 1) * pageSize, totalRecords);
  
  // Update pagination info (showing X-Y of Z)
  if (paginationInfo) {
    paginationInfo.innerHTML = `Showing <strong>${startItem}-${endItem}</strong> of <strong>${totalRecords}</strong> items`;
  }
  
  // Update page indicator
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages}`;
  }
  
  updatePaginationButtons();
  
  // Update sort indicators after table is rendered
  updateSortIndicators();
}

/**
 * Reset the search box and its state without triggering a reload - the caller
 * decides how to refresh so removing a chip only costs one request.
 */
function clearSearchTerm() {
  const input = document.getElementById('magentoSearchInput');
  if (input) input.value = '';
  currentSearch = '';
  isSearchMode = false;
  currentPage = 0;
}

/**
 * Show/hide the Full Data filter button and the active filter summary bar
 */
function updateFullDataFilterUI() {
  const filterBtn = document.getElementById('fullDataFilterBtn');
  if (filterBtn) {
    filterBtn.style.display = viewMode === 'full' ? '' : 'none';
  }

  // Chips only make sense in Full Data view; null collapses the bar
  renderFullDataFilterBar(viewMode === 'full' ? fullDataFilters : null, {
    search: currentSearch,
    onChange: applyFullDataFilters,
    onClearSearch: () => {
      clearSearchTerm();
      loadMagentoData();
    },
    onClearAll: () => {
      clearSearchTerm();
      applyFullDataFilters(emptyFullDataFilters());
    }
  });

  // Drop any control group left with no visible buttons in this view
  syncControlGroups();
}

/**
 * Apply new Full Data filters and reload from the first page
 */
async function applyFullDataFilters(filters) {
  fullDataFilters = filters;
  currentPage = 0;
  updateFullDataFilterUI();

  if (currentSearch) {
    await loadSearchResults(currentSearch);
  } else {
    await loadMagentoData();
  }

  if (hasActiveFullDataFilters(filters)) {
    showToast(`Filters applied: ${describeFullDataFilters(filters)}`, 'success');
  } else {
    showToast('Filters cleared', 'info');
  }
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
      <th><i class="fas fa-truck"></i> Shipping Method</th>
      <th><i class="fas fa-users"></i> Customer Group Code</th>
    `;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; padding: 2rem;">No data found</td></tr>';
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
      <td>${escapeHtml(row.shipping_method || '')}</td>
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
 * Handle Magento data sync with progress tracking
 */
async function handleSync() {
  const syncBtn = document.getElementById('syncDataBtn');
  
  if (!syncBtn) {
    return;
  }
  
  // If this is the very first call (no abort controller exists), initialize everything
  if (!syncAbortController) {
    console.log('[NL Magento] Initializing new sync session');
    syncAbortController = new AbortController();
    isSyncing = true;
    
    // Change button to cancel mode
    syncBtn.classList.add('syncing');
    syncBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Sync';
    syncBtn.style.background = '#f44336';
  }
  
  // Early exit if sync was cancelled
  if (!isSyncing) {
    console.log('[NL Magento] Sync is not active, not starting');
    return;
  }
  
  // Check if abort signal is active (user cancelled)
  if (syncAbortController.signal.aborted) {
    console.log('[NL Magento] Sync was cancelled, exiting');
    return;
  }
  
  try {
    // Change button to cancel mode
    syncBtn.classList.add('syncing');
    syncBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Sync';
    syncBtn.style.background = '#f44336';
    
    showToast('Starting Magento sync... Progress is saved after each batch.', 'info');
    
    const result = await syncNLMagentoData(syncAbortController.signal);
    
    if (result.status === 'success') {
      showToast(
        `✅ Successfully synced ${result.rows_synced} product rows from ${result.orders_processed} orders!`, 
        'success',
        5000
      );
      
      // Show any errors that occurred during sync
      if (result.errors && result.errors.length > 0) {
        console.warn('[NL Magento] Sync errors:', result.errors);
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
      console.log('[NL Magento] Sync cancelled by user');
      showToast('⚠️ Sync cancelled. Progress has been saved.', 'warning', 5000);
    } else {
      console.error('[NL Magento] Sync error:', error);
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
    console.log('[NL Magento] Cancelling sync... Progress will be saved.');
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
 * Fetch all data for export (loops through pages in batches of 1000)
 */
async function fetchAllDataForExport(onProgress = null) {
  const batchSize = 1000;
  let allExportData = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let result;
    if (viewMode === 'aggregated') {
      result = await getNLAggregatedData(batchSize, offset, currentSearch, currentSortColumn || '', currentSortDirection);
    } else if (viewMode === 'custom' && window.customRangeActive) {
      const { rangeType, rangeValue, useExclusions, shippingMethod } = window.customRangeActive;
      result = await getCustomRangeAggregatedData('nl', rangeType, rangeValue, useExclusions !== false, batchSize, offset, currentSearch, shippingMethod || '');
    } else if (viewMode === 'full') {
      result = await getNLMagentoData(batchSize, offset, currentSearch, currentSortColumn || '', currentSortDirection, fullDataFilters);
    } else {
      break;
    }

    if (result.status === 'success' && result.data && result.data.length > 0) {
      allExportData = allExportData.concat(result.data);
      offset += batchSize;
      if (result.data.length < batchSize) hasMore = false;
      if (onProgress) onProgress(allExportData.length, result.total_count || 0);
    } else {
      hasMore = false;
    }
  }

  return allExportData;
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
    showToast('Fetching all data for export...', 'info');
    const exportData = await fetchAllDataForExport();
    if (!exportData || exportData.length === 0) {
      showToast('No data to export', 'warning');
      return;
    }
    
    showToast(`Generating PDF with ${exportData.length} items...`, 'info');
    const viewLabel = viewMode === 'custom' ? customRangeLabel : '6-Month';
    await exportToPDF(exportData, 'nl', viewLabel, currentSearch);
    
    showToast('PDF exported successfully!', 'success');
  } catch (error) {
    console.error('Error exporting PDF:', error);
    showToast(`Failed to export PDF: ${error.message}`, 'error');
  }
}

async function handleExportCSV() {
  if (!allData || allData.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  // Nothing is capped - but every row is held in memory until the file is
  // built, so make the cost clear before starting a very large export.
  if (totalRecords > EXPORT_WARN_ROWS) {
    const proceed = await confirmModal({
      title: 'Large export',
      message: `<strong>${totalRecords.toLocaleString()} rows</strong> match the current view.`
        + '<br><br>They are downloaded 1,000 at a time and kept in memory until the file is built, '
        + 'so this can take several minutes and may make the browser unresponsive. '
        + 'A very large export can run out of memory and crash the tab.'
        + '<br><br>Narrowing the date range, order status or search first will be much faster.',
      confirmText: 'Export anyway',
      cancelText: 'Cancel',
      confirmVariant: 'warning'
    });
    if (!proceed) return;
  }

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const originalBtnContent = exportCsvBtn ? exportCsvBtn.innerHTML : '';
  if (exportCsvBtn) {
    exportCsvBtn.disabled = true;
    exportCsvBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
  }

  // Large exports page through the API 1,000 rows at a time - show progress
  const job = showProgressNotification({
    title: 'Exporting CSV',
    message: 'Fetching rows...'
  });

  try {
    const exportData = await fetchAllDataForExport((fetched, total) => {
      job.update({
        percent: total > 0 ? (fetched / total) * 100 : undefined,
        message: total > 0
          ? `Fetched ${fetched.toLocaleString()} of ${total.toLocaleString()} rows`
          : `Fetched ${fetched.toLocaleString()} rows`
      });
    });

    if (!exportData || exportData.length === 0) {
      job.fail({ message: 'Nothing matched the current filters' });
      showToast('No data to export', 'warning');
      return;
    }

    job.update({ percent: 100, message: `Building CSV from ${exportData.length.toLocaleString()} rows...` });
    // Yield a frame so the bar paints before the (synchronous) CSV build
    await new Promise(resolve => setTimeout(resolve, 0));

    if (viewMode === 'full') {
      exportFullDataToCSV(exportData, 'nl', filtersFilenameSlug(fullDataFilters), currentSearch);
    } else {
      const viewLabel = viewMode === 'custom' ? customRangeLabel : '6-Month';
      exportToCSV(exportData, 'nl', viewLabel, currentSearch);
    }
    job.succeed({ message: `Downloaded ${exportData.length.toLocaleString()} rows` });
    showToast(`CSV exported successfully (${exportData.length} items)!`, 'success');
  } catch (error) {
    console.error('Error exporting CSV:', error);
    job.fail({ message: error.message });
    showToast(`Failed to export CSV: ${error.message}`, 'error');
  } finally {
    if (exportCsvBtn) {
      exportCsvBtn.disabled = false;
      exportCsvBtn.innerHTML = originalBtnContent;
    }
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
    console.log('[NL Magento] Starting automatic sync before aggregated refresh...');
    
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    // Create abort controller for this sync
    syncAbortController = new AbortController();
    isSyncing = true;
    
    // Sync orders from the last 180 days (explicit date for 6-month view)
    const startDate = getDateNDaysAgo(180);
    const syncResult = await syncNLMagentoData(syncAbortController.signal, startDate, null, null, null);
    
    // Show sync result toast
    if (syncResult.status === 'success') {
      if (syncResult.rows_synced > 0) {
        showToast(`✓ Synced ${syncResult.rows_synced} new/updated rows`, 'success');
      } else {
        showToast('✓ Cache is up to date', 'info');
      }
    } else if (syncResult.status === 'error') {
      console.warn('[NL Magento] Sync warning:', syncResult.message);
      showToast('Sync issue: ' + syncResult.message, 'warning');
      // Continue with refresh even if sync had issues
    } else {
      // Unknown status - log it
      console.warn('[NL Magento] Unexpected sync result:', syncResult);
      showToast('✓ Sync completed', 'info');
    }
    
    // Small delay so user can see the sync result before aggregation starts
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 2: Now refresh aggregated data (with FREE GIFT exclusion)
    showToast('Calculating 6-month aggregated data...', 'info');
    
    const result = await refreshAggregatedDataForRegion('nl');
    
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
      console.error('[NL Magento] Refresh error:', error);
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
    console.warn('[NL Magento] Table not found for sorting setup');
    return;
  }
  
  console.log('[NL Magento] Setting up table sorting...');
  
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
        'customer_email', 'customer_full_name', 'billing_address', 'shipping_address', 'shipping_method', 'customer_group_code'
      ];
      columnKey = fullColumns[columnIndex];
    }
    
    if (!columnKey) {
      console.warn('[NL Magento] No column key found for index:', columnIndex);
      return;
    }
    
    // Toggle sort direction if clicking the same column
    if (currentSortColumn === columnKey) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortColumn = columnKey;
      currentSortDirection = 'asc';
    }
    
    console.log(`[NL Magento] Sorting by ${columnKey} (${currentSortDirection})`);
    
    // Sort the data and re-render
    sortAndRenderData();
  });
  
  // Show initial sort indicators (neutral state)
  updateSortIndicators();
  
  console.log('[NL Magento] Table sorting setup complete');
}

/**
 * Sort the current data and re-render the table
 * Uses server-side sorting by reloading data with sort parameters
 */
async function sortAndRenderData() {
  if (viewMode === 'custom') {
    // Custom mode uses client-side sorting since data is already loaded
    applySortToData();
    displayCurrentPage();
    updateSortIndicators();
    return;
  }
  
  // Reset to first page when sorting
  currentPage = 0;
  
  // Show loading state
  const tbody = document.getElementById('magentoTableBody');
  const colSpan = viewMode === 'aggregated' ? '4' : '14';
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;"><i class="fas fa-spinner fa-spin"></i> Sorting...</td></tr>`;
  }
  
  // Reload data with new sort parameters
  if (currentSearch) {
    await loadSearchResults(currentSearch);
  } else {
    await loadMagentoData();
  }
  
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
      'customer_email', 'customer_full_name', 'billing_address', 'shipping_address', 'shipping_method', 'customer_group_code'
    ];
    columnIndex = fullColumns.indexOf(currentSortColumn);
  }
  
  // Update all headers with sort indicators
  ths.forEach((th, index) => {
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    
    // Remove any existing sort icons
    const existingSortIcon = th.querySelector('.sort-indicator');
    if (existingSortIcon) {
      existingSortIcon.remove();
    }
    
    // Create sort icon
    const sortIcon = document.createElement('i');
    sortIcon.style.marginLeft = '5px';
    sortIcon.style.fontSize = '0.8em';
    
    if (index === columnIndex && currentSortColumn) {
      // Active column - show direction arrow
      sortIcon.className = `fas fa-sort-${currentSortDirection === 'asc' ? 'up' : 'down'} sort-indicator`;
      sortIcon.style.opacity = '1';
    } else {
      // Inactive column - show neutral sort icon
      sortIcon.className = 'fas fa-sort sort-indicator';
      sortIcon.style.opacity = '0.5';
    }
    
    th.appendChild(sortIcon);
  });
}






