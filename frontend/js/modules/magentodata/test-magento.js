// frontend/js/modules/magentodata/test-magento.js
import { getTestMagentoData, syncTestMagentoData, initializeTables } from '../../services/api/magentoDataApi.js';
import { showToast } from '../../ui/toast.js';

let currentPage = 0;
const pageSize = 100; // Display 100 records per page
let currentSearch = '';
let allData = []; // Store loaded data
let totalRecords = 0; // Total records available (from server count)
let isSearchMode = false; // Whether we're in search mode (all matching results loaded) or pagination mode
let syncAbortController = null; // AbortController for cancelling ongoing sync
let isSyncing = false; // Track if sync is in progress

/**
 * Initialize Test magento page
 */
export async function initTestMagentoData() {
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
      // Modern browsers require returnValue to be set
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
  // Sync button
  const syncDataBtn = document.getElementById('syncDataBtn');
  if (syncDataBtn) {
    syncDataBtn.addEventListener('click', handleSync);
  }
  
  // Search functionality - server-side query with fuzzy matching
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchInput = document.getElementById('magentoSearchInput');
  
  let searchTimeout = null;
  
  // Perform search function - queries server for ALL matching records
  const performSearch = async () => {
    const inputElement = document.getElementById('magentoSearchInput');
    if (!inputElement) {
      console.warn('[Test Magento] Search input not found');
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
          loadSearchResults(currentSearch);
        } else {
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
          loadSearchResults(currentSearch);
        } else {
          loadMagentoData();
        }
      }
    });
  }
}

/**
 * Handle sync button click
 */
async function handleSync() {
  const syncDataBtn = document.getElementById('syncDataBtn');
  
  // If currently syncing, cancel
  if (isSyncing) {
    if (syncAbortController) {
      syncAbortController.abort();
      showToast('Cancelling sync...', 'info');
    }
    return;
  }
  
  try {
    isSyncing = true;
    syncAbortController = new AbortController();
    
    // Update button to show cancel option
    if (syncDataBtn) {
      syncDataBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
      syncDataBtn.classList.remove('primary-btn');
      syncDataBtn.classList.add('danger-btn');
    }
    
    showToast('Starting test sync (10 orders)...', 'info');
    
    const result = await syncTestMagentoData(syncAbortController.signal);
    
    if (result.status === 'success') {
      showToast(
        `✅ ${result.message}`,
        'success',
        5000
      );
      
      // Reload the data to show newly synced records
      await loadMagentoData();
    } else {
      showToast('❌ Test sync failed: ' + result.message, 'error');
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[Test Sync] Cancelled by user');
      showToast('⚠️ Test sync cancelled', 'warning');
    } else {
      console.error('[Test Sync] Error:', error);
      showToast('❌ Test sync error: ' + error.message, 'error');
    }
  } finally {
    isSyncing = false;
    syncAbortController = null;
    
    // Reset button
    if (syncDataBtn) {
      syncDataBtn.innerHTML = '<i class="fas fa-vial"></i> Test Sync (10 Orders)';
      syncDataBtn.classList.remove('danger-btn');
      syncDataBtn.classList.add('primary-btn');
    }
  }
}

/**
 * Load magento data from server
 */
async function loadMagentoData() {
  try {
    const offset = currentPage * pageSize;
    const result = await getTestMagentoData(pageSize, offset, '');
    
    if (result.status === 'success') {
      allData = result.data || [];
      totalRecords = result.total || 0;
      renderTable(allData);
      updatePaginationControls();
    } else {
      showToast('Failed to load test data: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Test Magento] Error loading data:', error);
    showToast('Error loading test data: ' + error.message, 'error');
  }
}

/**
 * Load search results from server
 */
async function loadSearchResults(searchTerm) {
  try {
    const offset = currentPage * pageSize;
    const result = await getTestMagentoData(pageSize, offset, searchTerm);
    
    if (result.status === 'success') {
      allData = result.data || [];
      totalRecords = result.total || 0;
      renderTable(allData);
      updatePaginationControls();
    } else {
      showToast('Search failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Test Magento] Search error:', error);
    showToast('Search error: ' + error.message, 'error');
  }
}

/**
 * Render the data table
 */
function renderTable(data) {
  const tbody = document.getElementById('magentoTableBody');
  
  if (!tbody) {
    console.error('[Test Magento] Table body not found');
    return;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="14" class="empty-state">
          <div class="empty-icon"><i class="fas fa-vial"></i></div>
          <div class="empty-message">No test data available</div>
          <div class="empty-submessage">Click "Test Sync" to fetch 10 sample orders from Magento</div>
        </td>
      </tr>
    `;
    return;
  }
  
  // Render rows
  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.order_number || '')}</td>
      <td>${formatDate(row.created_at)}</td>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${row.qty || 0}</td>
      <td>${formatCurrency(row.price, row.currency)}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${formatCurrency(row.grand_total, row.currency)}</td>
      <td>${escapeHtml(row.customer_email || '')}</td>
      <td>${escapeHtml(row.customer_full_name || '')}</td>
      <td>${escapeHtml(row.billing_address || '')}</td>
      <td>${escapeHtml(row.shipping_address || '')}</td>
      <td>${escapeHtml(row.customer_group_code || '')}</td>
    </tr>
  `).join('');
}

/**
 * Update pagination controls
 */
function updatePaginationControls() {
  const pageInfo = document.getElementById('pageInfo');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  const totalPages = Math.ceil(totalRecords / pageSize);
  const currentPageNum = currentPage + 1;
  
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPageNum} of ${totalPages} (${totalRecords} total records)`;
  }
  
  if (prevBtn) {
    prevBtn.disabled = currentPage === 0;
  }
  
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages - 1 || totalPages === 0;
  }
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateString;
  }
}

/**
 * Format currency for display
 */
function formatCurrency(amount, currency) {
  if (amount === null || amount === undefined) return '';
  
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£';
  return `${symbol}${parseFloat(amount).toFixed(2)}`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
