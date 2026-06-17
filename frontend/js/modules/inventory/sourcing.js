/**
 * Product Sourcing Module - Command Center
 * 
 * Implements the 4-sheet architecture:
 * 1. DB_Magento - Product data (from Magento sync)
 * 2. FX_Rates - Currency exchange rates
 * 3. Supplier_Matrix - Supplier pricing by SKU
 * 4. Analysis_Dashboard - Best price & margin calculations
 */

import { showToast, showToastWithAction } from '../../ui/toast.js';
import { getToken } from '../../services/state/sessionStore.js';
import { showLoading, hideLoading } from '../../router.js';
import { initDropdown } from '../../ui/dropdown.js';
import { initNumberInput } from '../../ui/number-input.js';
import {
  checkSourcingTablesStatus,
  initializeSourcingTables,
  getFXRates,
  setFXOverride,
  removeFXOverride,
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierMatrix,
  bulkUpdatePricing,
  getAnalysisDashboard,
  getPricingForSku,
  upsertPricing,
  deletePricing,
  formatCurrency,
  getMarginStatusClass,
  syncMatrixToGSheet,
  syncMatrixFromGSheet,
  getSupplierMappings,
  createSupplierMapping,
  deleteSupplierMapping,
  importMappingsFile
} from '../../services/api/sourcingApi.js?v=2';

// ============================================================================
// CURRENCY HELPERS
// ============================================================================

const CURRENCY_SYMBOLS = {
  'GBP': '£',
  'USD': '$',
  'EUR': '€',
  'JPY': '¥',
  'PLN': 'zł',
  'SEK': 'kr'
};

const SYMBOL_TO_CURRENCY = {
  '£': 'GBP',
  '$': 'USD',
  '€': 'EUR',
  '¥': 'JPY',
  'zł': 'PLN',
  'kr': 'SEK'
};

// Hardcoded Google Sheet ID — same for all users
const DEFAULT_GSHEET_ID = '1zq_pWUTRp27Q0CE_5h0pt04XmouYKY04lgYYLLyLWQg';

/**
 * Parse a price string that may contain a currency symbol.
 * Returns { price: number|null, currency: string|null }
 * 
 * Examples:
 *   '£10.50' -> { price: 10.50, currency: 'GBP' }
 *   '$25' -> { price: 25.0, currency: 'USD' }
 *   '10.50' -> { price: 10.50, currency: null }  (placeholder)
 */
function parsePriceWithCurrency(rawValue) {
  if (!rawValue || rawValue === '') {
    return { price: null, currency: null };
  }
  
  let value = String(rawValue).trim();
  let detectedCurrency = null;
  
  // Detect currency from symbol
  for (const [symbol, currency] of Object.entries(SYMBOL_TO_CURRENCY)) {
    if (value.includes(symbol)) {
      detectedCurrency = currency;
      value = value.replace(symbol, '');
      break;
    }
  }
  
  // Clean remaining characters
  const cleanPrice = value.replace(/,/g, '').trim();
  const price = parseFloat(cleanPrice);
  
  if (isNaN(price)) {
    return { price: null, currency: null };
  }
  
  return { price, currency: detectedCurrency };
}

/**
 * Format a price with optional currency symbol.
 * If currency is null/undefined, just show the number (placeholder).
 */
function formatPriceDisplay(price, currency) {
  if (price == null) return '';
  
  const numPrice = parseFloat(price);
  if (isNaN(numPrice)) return '';
  
  // No currency = placeholder (just show number)
  if (!currency) {
    return numPrice.toFixed(2);
  }
  
  const symbol = CURRENCY_SYMBOLS[currency] || '';
  return `${symbol}${numPrice.toFixed(2)}`;
}

// ============================================================================
// STATE
// ============================================================================

let state = {
  // Current tab
  activeTab: 'dashboard',
  
  // FX Rates
  fxRates: {},
  fxOverrides: [],
  
  // Suppliers
  suppliers: [],
  
  // Matrix
  matrixData: [],
  allMatrixData: [],  // Full cached dataset for client-side search
  matrixSuppliers: [],
  matrixPage: 1,
  matrixPerPage: 100,
  matrixTotal: 0,
  matrixSearch: '',
  matrixSortBy: 'sku',
  matrixSortOrder: 'asc',
  
  // GSheet sync (batched to avoid API rate limits)
  gsheetSyncPending: false,
  gsheetSyncTimeout: null,
  gsheetId: null,  // The sheet ID being used
  autoImportEnabled: false,  // Auto-import from Sheet → App
  autoExportEnabled: false,  // Auto-export from App → Sheet
  autoImportInterval: null,  // Interval for periodic imports
  
  // Analysis
  analysisData: [],
  allAnalysisData: [],  // Full cached dataset for client-side search
  analysisSummary: {},
  analysisPage: 1,
  analysisPerPage: 100,
  analysisTotal: 0,
  analysisSearch: '',
  analysisMarginFilter: '',
  analysisSortBy: 'sku',
  analysisSortOrder: 'asc',
  
  // Product Mappings
  mappingsData: [],
  allMappingsData: [],
  mappingsSearch: '',
  mappingsSupplierFilter: '',
  
  // UI
  isLoading: false
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the sourcing module
 */
export async function init(path = '/inventory/sourcing') {
  console.log('[Sourcing] Initializing Product Sourcing module with path:', path);
  
  // Determine which tab to show based on path
  const tabFromPath = getTabFromPath(path);
  state.activeTab = tabFromPath;
  
  try {
    // Check if tables exist
    const status = await checkSourcingTablesStatus();
    console.log('[Sourcing] Tables status:', status);
    
    if (!status.all_tables_exist) {
      showToast('Initializing sourcing tables...', 'info');
      await initializeSourcingTables();
      showToast('Sourcing tables initialized', 'success');
    }
    
    // Set up event listeners
    setupEventListeners();
    
    // Update UI to show correct tab
    updateTabUI();
    
    // Load initial data based on active tab
    await loadActiveTabData();
    
  } catch (error) {
    console.error('[Sourcing] Initialization error:', error);
    showToast('Failed to initialize sourcing module', 'error');
  }
}

/**
 * Parse the path to determine which tab to show
 */
function getTabFromPath(path) {
  if (path.includes('/supplier-matrix')) return 'matrix';
  if (path.includes('/suppliers')) return 'suppliers';
  if (path.includes('/fx-rates')) return 'fx-rates';
  if (path.includes('/mappings')) return 'mappings';
  // Default to dashboard (analysis-dashboard or just /sourcing)
  return 'dashboard';
}

/**
 * Update tab UI to reflect current state
 */
function updateTabUI() {
  document.querySelectorAll('.sourcing-sub-nav .nui-tab[data-tab]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.tab === state.activeTab);
  });
  document.querySelectorAll('.sourcing-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${state.activeTab}`);
  });
}

/**
 * Stop all auto-sync (import and export) and update UI
 * Called when leaving the matrix tab or the module
 */
function stopAutoSync() {
  let stopped = false;
  
  // Stop auto-import
  if (state.autoImportEnabled) {
    state.autoImportEnabled = false;
    stopAutoImport();
    stopped = true;
  }
  
  // Stop auto-export
  if (state.autoExportEnabled) {
    state.autoExportEnabled = false;
    stopped = true;
  }
  
  // Clear any pending sync timeout
  if (state.gsheetSyncTimeout) {
    clearTimeout(state.gsheetSyncTimeout);
    state.gsheetSyncTimeout = null;
  }
  state.gsheetSyncPending = false;
  
  // Clear auto-import interval
  if (state.autoImportInterval) {
    clearInterval(state.autoImportInterval);
    state.autoImportInterval = null;
  }
  
  // Update button UI if we stopped something
  if (stopped) {
    const importBtn = document.getElementById('btn-auto-import');
    const exportBtn = document.getElementById('btn-auto-export');
    if (importBtn) {
      importBtn.classList.remove('active');
      importBtn.innerHTML = '<i class="fas fa-download"></i> Enable';
    }
    if (exportBtn) {
      exportBtn.classList.remove('active');
      exportBtn.innerHTML = '<i class="fas fa-upload"></i> Enable';
    }
    console.log('[Sourcing] Auto-sync stopped');
  }
}

/**
 * Cleanup function called when leaving the module
 */
export function cleanup() {
  console.log('[Sourcing] Cleaning up sourcing module');
  
  // Stop all auto-sync
  stopAutoSync();
  
  // Reset state (but keep gsheetId as it's in localStorage)
  const savedGsheetId = state.gsheetId;
  state = {
    activeTab: 'dashboard',
    fxRates: {},
    fxOverrides: [],
    suppliers: [],
    matrixData: [],
    matrixSuppliers: [],
    matrixPage: 1,
    matrixPerPage: 100,
    matrixTotal: 0,
    matrixSearch: '',
    matrixSortBy: 'sku',
    matrixSortOrder: 'asc',
    gsheetSyncPending: false,
    gsheetSyncTimeout: null,
    gsheetId: savedGsheetId,  // Preserve the linked sheet ID
    autoImportEnabled: false,
    autoExportEnabled: false,
    autoImportInterval: null,
    analysisData: [],
    allAnalysisData: [],
    analysisSummary: {},
    analysisPage: 1,
    analysisPerPage: 100,
    analysisTotal: 0,
    analysisSearch: '',
    analysisMarginFilter: '',
    analysisSortBy: 'sku',
    analysisSortOrder: 'asc',
    allMatrixData: [],
    mappingsData: [],
    allMappingsData: [],
    mappingsSearch: '',
    mappingsSupplierFilter: '',
    isLoading: false
  };
  
  console.log('[Sourcing] Auto-sync disabled on navigation');
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Tab switching - now uses links with SPA navigation
  document.querySelectorAll('.sourcing-sub-nav .nui-tab[data-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();  // Prevent default navigation
      const tabId = link.dataset.tab;
      switchTab(tabId);
    });
  });
  
  // Analysis Dashboard
  initDropdown('#analysis-margin-filter');
  document.getElementById('btn-refresh-analysis')?.addEventListener('click', loadAnalysisDashboard);
  document.getElementById('analysis-search')?.addEventListener('input', debounce(handleAnalysisSearch, 500));
  document.getElementById('analysis-margin-filter')?.addEventListener('change', handleMarginFilterChange);
  
  // FX Rates & Supplier dropdowns
  initDropdown('#override-currency');
  initDropdown('#supplier-currency');
  
  // Matrix (auto-save on blur - no save button needed)
  document.getElementById('btn-export-matrix')?.addEventListener('click', exportMatrix);
  document.getElementById('btn-import-matrix')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  });
  document.getElementById('import-file-input')?.addEventListener('change', handleImportFileSelect);
  document.getElementById('matrix-search')?.addEventListener('input', debounce(handleMatrixSearch, 500));
  
  // CSV Import Confirmation Modal
  document.getElementById('btn-csv-import-close')?.addEventListener('click', closeCsvImportModal);
  document.getElementById('btn-csv-import-cancel')?.addEventListener('click', closeCsvImportModal);
  document.getElementById('btn-csv-import-confirm')?.addEventListener('click', confirmCsvImport);
  document.getElementById('modal-confirm-csv-import')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCsvImportModal();
  });
  
  // CSV Import Results Modal
  document.getElementById('btn-csv-results-close')?.addEventListener('click', closeCsvResultsModal);
  document.getElementById('btn-csv-results-ok')?.addEventListener('click', closeCsvResultsModal);
  document.getElementById('modal-csv-import-results')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCsvResultsModal();
  });
  
  // GSheets Card - buttons on the card
  document.getElementById('btn-gsheet-export')?.addEventListener('click', handleGSheetExport);
  document.getElementById('btn-gsheet-import')?.addEventListener('click', handleGSheetImport);
  document.getElementById('btn-auto-import')?.addEventListener('click', handleToggleAutoImport);
  document.getElementById('btn-auto-export')?.addEventListener('click', handleToggleAutoExport);
  document.getElementById('btn-edit-gsheet-link')?.addEventListener('click', openGSheetLinkModal);
  
  // GSheet Link Modal
  document.getElementById('btn-gsheet-link-close')?.addEventListener('click', closeGSheetLinkModal);
  document.getElementById('btn-gsheet-link-cancel')?.addEventListener('click', closeGSheetLinkModal);
  document.getElementById('btn-gsheet-link-save')?.addEventListener('click', handleSaveGSheetLink);
  document.getElementById('modal-gsheet-link')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGSheetLinkModal();
  });
  
  // Confirm GSheet Modal
  document.getElementById('btn-confirm-gsheet-cancel')?.addEventListener('click', closeConfirmGSheetModal);
  document.getElementById('btn-confirm-gsheet-yes')?.addEventListener('click', confirmSaveGSheetLink);
  document.getElementById('modal-confirm-gsheet')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeConfirmGSheetModal();
  });
  
  // Use hardcoded Google Sheet ID as default; localStorage can override if set
  state.gsheetId = localStorage.getItem('rm365_gsheet_id') || DEFAULT_GSHEET_ID;
  updateGSheetCardDisplay();
  
  // Suppliers
  document.getElementById('btn-add-supplier')?.addEventListener('click', openAddSupplierModal);
  document.getElementById('btn-save-supplier')?.addEventListener('click', handleSaveSupplier);
  document.getElementById('btn-cancel-supplier')?.addEventListener('click', closeSupplierModal);
  document.getElementById('btn-delete-supplier')?.addEventListener('click', handleDeleteSupplier);
  document.getElementById('supplier-modal-close')?.addEventListener('click', closeSupplierModal);
  document.getElementById('supplier-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSupplierModal();
  });
  
  // FX Rates
  document.getElementById('btn-refresh-rates')?.addEventListener('click', loadFXRates);
  document.getElementById('btn-set-override')?.addEventListener('click', handleSetFXOverride);
  
  // Pricing Modal
  document.getElementById('pricing-modal-close')?.addEventListener('click', closePricingModal);
  document.getElementById('btn-close-pricing')?.addEventListener('click', closePricingModal);
  document.getElementById('btn-save-pricing')?.addEventListener('click', handleSavePricing);
  document.getElementById('pricing-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePricingModal();
  });

  // Product Mappings Tab Events
  document.getElementById('btn-add-mapping')?.addEventListener('click', openAddMappingModal);
  document.getElementById('btn-import-mappings')?.addEventListener('click', () => {
    document.getElementById('mappings-import-file')?.click();
  });
  document.getElementById('mappings-import-file')?.addEventListener('change', handleMappingsImportFileChange);
  document.getElementById('mappings-import-result-close')?.addEventListener('click', closeMappingsImportResultModal);
  document.getElementById('btn-close-mappings-import-result')?.addEventListener('click', closeMappingsImportResultModal);
  document.getElementById('btn-save-mapping')?.addEventListener('click', handleSaveMapping);
  document.getElementById('btn-cancel-mapping')?.addEventListener('click', closeMappingModal);
  document.getElementById('mapping-modal-close')?.addEventListener('click', closeMappingModal);
  document.getElementById('mapping-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMappingModal();
  });
  document.getElementById('mappings-search')?.addEventListener('input', debounce(handleMappingsSearch, 500));
  document.getElementById('mappings-supplier-filter')?.addEventListener('change', handleMappingsSupplierFilterChange);
  document.getElementById('mapping-internal-search')?.addEventListener('input', handleMappingInternalSearchInput);
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================

async function switchTab(tabId) {
  // If leaving the matrix tab, stop auto-sync
  if (state.activeTab === 'matrix' && tabId !== 'matrix') {
    stopAutoSync();
  }
  
  // Navigate to the new URL - this will re-init the module with the correct tab
  const tabPaths = {
    'dashboard': '/inventory/sourcing/analysis-dashboard',
    'matrix': '/inventory/sourcing/supplier-matrix',
    'suppliers': '/inventory/sourcing/suppliers',
    'fx-rates': '/inventory/sourcing/fx-rates',
    'mappings': '/inventory/sourcing/mappings'
  };
  
  const newPath = tabPaths[tabId] || '/inventory/sourcing/analysis-dashboard';
  
  // Use the router to navigate (updates URL and triggers proper init)
  if (window.router?.navigate) {
    window.router.navigate(newPath);
  } else {
    // Fallback: update history and reload tab content
    window.history.pushState({}, '', newPath);
    
    // Update UI
    document.querySelectorAll('.sourcing-sub-nav .nui-tab[data-tab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.sourcing-tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
    
    state.activeTab = tabId;
    await loadActiveTabData();
  }
}

async function loadActiveTabData() {
  // Show loading overlay with custom message for each tab
  const loadingMessages = {
    'dashboard': 'Loading analysis dashboard...',
    'matrix': 'Loading supplier matrix...',
    'suppliers': 'Loading suppliers...',
    'fx-rates': 'Loading exchange rates...',
    'mappings': 'Loading product mappings...'
  };
  
  const message = loadingMessages[state.activeTab] || 'Loading...';
  showLoading();
  showToast(message, 'info');
  
  try {
    switch (state.activeTab) {
      case 'dashboard':
        await loadAnalysisDashboard({ skipLoadingOverlay: true });
        break;
      case 'matrix':
        await loadSupplierMatrix({ skipLoadingOverlay: true });
        break;
      case 'suppliers':
        await loadSuppliers({ skipLoadingOverlay: true });
        break;
      case 'fx-rates':
        await loadFXRates({ skipLoadingOverlay: true });
        break;
      case 'mappings':
        await loadProductMappings({ skipLoadingOverlay: true });
        break;
    }
  } finally {
    hideLoading();
  }
}

// ============================================================================
// ANALYSIS DASHBOARD (Sheet 4: The Brain)
// ============================================================================

async function loadAnalysisDashboard(options = {}) {
  const { skipLoadingOverlay = false } = options;
  
  if (!skipLoadingOverlay) {
    setLoading(true);
    showToast('Loading analysis dashboard...', 'info');
  }
  
  try {
    console.log('[loadAnalysisDashboard] Calling API with state:', {
      sortBy: state.analysisSortBy,
      sortOrder: state.analysisSortOrder
    });
    // Fetch ALL data from server (no search param - search is client-side)
    const data = await getAnalysisDashboard({
      page: 1,
      perPage: 100000,
      marginStatus: state.analysisMarginFilter,
      sortBy: state.analysisSortBy,
      sortOrder: state.analysisSortOrder
    });
    
    // Cache full dataset for client-side search
    state.allAnalysisData = data.products || [];
    state.analysisSummary = data.summary || {};
    state.matrixSuppliers = data.suppliers || [];
    
    // Apply client-side search and pagination
    applyAnalysisClientFilters();
    
    renderAnalysisSummary();
    renderAnalysisTable();
    renderAnalysisPagination();
    
    // Set up server-side sorting (don't use default client-side sorting)
    setupServerSideSorting('#analysis-table', 'analysis');
    
  } catch (error) {
    console.error('[Sourcing] Error loading analysis:', error);
    showToast('Failed to load analysis data', 'error');
  } finally {
    if (!skipLoadingOverlay) {
      setLoading(false);
    }
  }
}

function renderAnalysisSummary() {
  const summary = state.analysisSummary;
  
  document.getElementById('summary-total-products').textContent = summary.total_products ?? '—';
  document.getElementById('summary-with-pricing').textContent = summary.products_with_pricing ?? '—';
  document.getElementById('summary-healthy').textContent = summary.healthy_count ?? '—';
  document.getElementById('summary-warning').textContent = summary.warning_count ?? '—';
  document.getElementById('summary-loss').textContent = summary.loss_count ?? '—';
  
  // Update additional summary stats if elements exist
  const magentoElem = document.getElementById('summary-with-magento');
  if (magentoElem) magentoElem.textContent = summary.products_with_magento_price ?? '—';
  
  const noDataElem = document.getElementById('summary-no-data');
  if (noDataElem) noDataElem.textContent = summary.no_data_count ?? '—';
}

function renderAnalysisTable() {
  const tbody = document.getElementById('analysis-table-body');
  if (!tbody) return;
  
  if (state.analysisData.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <i class="fas fa-chart-line"></i>
            <p>No products found. Products are loaded from inventory metadata.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = state.analysisData.map(row => {
    const marginClass = getMarginStatusClass(row.margin_status);
    const marginDisplay = row.margin_percentage != null 
      ? `${row.margin_percentage.toFixed(1)}%` 
      : '—';
    
    // Status badge styling
    const statusClass = row.status === 'Available' ? 'status-available' : 
                        row.status === 'Unavailable' ? 'status-unavailable' : 
                        'status-unknown';
    
    // Magento price with source indicator
    const magentoDisplay = row.magento_price 
      ? `${formatCurrency(row.magento_price, 'GBP')}${row.price_source === 'special_price' ? ' <span class="price-special" title="Special Price">★</span>' : ''}`
      : '<span class="no-price">N/A</span>';
    
    // Build supplier price chips
    const supplierChips = Object.entries(row.supplier_prices || {})
      .map(([code, price]) => {
        const isWinner = code === row.winning_supplier;
        return `<span class="supplier-chip ${isWinner ? 'winner' : ''}" title="${code}: ${formatCurrency(price, 'GBP')}">${code}</span>`;
      })
      .join('');
    
    return `
      <tr data-sku="${escapeHtml(row.sku)}">
        <td class="col-sku sticky-col"><strong>${escapeHtml(row.sku)}</strong></td>
        <td class="col-product sticky-col-2">${escapeHtml(row.product_name || '')}</td>
        <td class="col-status"><span class="status-badge ${statusClass}">${escapeHtml(row.status || 'Unknown')}</span></td>
        <td class="col-magento">${magentoDisplay}</td>
        <td class="col-best-price ${row.best_price ? 'has-value' : ''}">${row.best_price ? formatCurrency(row.best_price, 'GBP') : '—'}</td>
        <td class="col-winner">${row.winning_supplier ? `<span class="winner-badge">${escapeHtml(row.winning_supplier)}</span>` : '—'}</td>
        <td class="col-margin ${marginClass}">${marginDisplay}</td>
        <td class="col-suppliers">${supplierChips || '—'}</td>
        <td class="col-actions">
          <button class="btn btn-ghost btn-default btn-icon-only btn-sm" title="Edit Pricing" onclick="window.sourcingModule.openPricingModal('${escapeHtml(row.sku)}')">
            <i class="fas fa-edit"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAnalysisPagination() {
  const container = document.getElementById('analysis-pagination');
  if (!container) return;
  
  const totalPages = Math.ceil(state.analysisTotal / state.analysisPerPage);
  const startItem = (state.analysisPage - 1) * state.analysisPerPage + 1;
  const endItem = Math.min(state.analysisPage * state.analysisPerPage, state.analysisTotal);
  
  if (totalPages <= 1 && state.analysisTotal === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <div class="pagination-wrapper">
      <div class="pagination-info">
        Showing <strong>${startItem}-${endItem}</strong> of <strong>${state.analysisTotal}</strong> items
      </div>
      <div class="pagination-controls">
        <button class="btn btn-ghost btn-success" ${state.analysisPage <= 1 ? 'disabled' : ''} onclick="window.sourcingModule.goToAnalysisPage(${state.analysisPage - 1})">
          <i class="fas fa-chevron-left"></i>
          <span>Previous</span>
        </button>
        <span class="page-indicator">Page ${state.analysisPage} of ${totalPages}</span>
        <button class="btn btn-ghost btn-success" ${state.analysisPage >= totalPages ? 'disabled' : ''} onclick="window.sourcingModule.goToAnalysisPage(${state.analysisPage + 1})">
          <span>Next</span>
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;
}

function handleAnalysisSearch(e) {
  state.analysisSearch = e.target.value.trim();
  state.analysisPage = 1;
  // Client-side filter from cached data — no API call needed
  applyAnalysisClientFilters();
  renderAnalysisTable();
  renderAnalysisPagination();
}

/**
 * Apply client-side search filter and pagination to cached analysis data.
 * Searches against SKU, product name, and item ID only.
 */
function applyAnalysisClientFilters() {
  let filtered = state.allAnalysisData;
  
  if (state.analysisSearch) {
    const query = state.analysisSearch.toLowerCase();
    filtered = filtered.filter(p => 
      (p.sku || '').toLowerCase().includes(query) ||
      (p.product_name || '').toLowerCase().includes(query) ||
      (p.item_id || '').toLowerCase().includes(query)
    );
  }
  
  state.analysisTotal = filtered.length;
  
  // Paginate from filtered data
  const start = (state.analysisPage - 1) * state.analysisPerPage;
  const end = start + state.analysisPerPage;
  state.analysisData = filtered.slice(start, end);
}

function handleMarginFilterChange(e) {
  state.analysisMarginFilter = e.target.value;
  state.analysisPage = 1;
  loadAnalysisDashboard();
}

/**
 * Show a loading state inside a table tbody with animated dots
 * @param {string} tbodyId - The ID of the tbody element
 * @param {number} colspan - Number of columns for the loading row
 * @param {string} message - Loading message to display
 */
function showTableLoading(tbodyId, colspan, message = 'Loading') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  
  tbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="${colspan}">
        <div class="table-loading-state">
          <i class="fas fa-spinner fa-spin"></i>
          <span class="loading-text">${message}<span class="loading-dots"></span></span>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Set up server-side sorting for paginated tables.
 * Replaces the default client-side sorting with server-side requests.
 * @param {string} tableSelector - CSS selector for the table
 * @param {string} tableType - 'matrix' or 'analysis'
 */
function setupServerSideSorting(tableSelector, tableType) {
  const table = document.querySelector(tableSelector);
  if (!table) return;
  
  // Remove any existing sorting setup
  if (typeof disableTableSorting !== 'undefined') {
    disableTableSorting(tableSelector);
  }
  
  // Map column index to sort field name
  const columnMappings = {
    analysis: {
      0: 'sku',
      1: 'product_name',
      2: 'status',
      3: 'magento_price',
      4: 'best_price',
      5: 'winning_supplier',
      6: 'margin_percentage',
      // Column 7 (suppliers) and 8 (actions) not sortable
    },
    matrix: {
      0: 'sku',
      1: 'product_name',
      2: 'magento_price',
      3: 'status',
      // Supplier columns are dynamic, handled by data-supplier attribute
    }
  };
  
  const sortState = tableType === 'matrix' 
    ? { sortBy: state.matrixSortBy, sortOrder: state.matrixSortOrder }
    : { sortBy: state.analysisSortBy, sortOrder: state.analysisSortOrder };
  
  // Get all headers
  const allHeaders = table.querySelectorAll('thead th');
  const sortableHeaders = table.querySelectorAll('th.sortable');
  
  sortableHeaders.forEach((header) => {
    // Skip if already initialized for server-side
    if (header.dataset.serverSortEnabled === 'true') return;
    header.dataset.serverSortEnabled = 'true';
    header.style.cursor = 'pointer';
    header.style.userSelect = 'none';
    
    // Find column index
    let columnIndex = -1;
    allHeaders.forEach((th, idx) => {
      if (th === header) columnIndex = idx;
    });
    
    // Determine sort field
    let sortField = columnMappings[tableType]?.[columnIndex];
    
    // For matrix supplier columns, use the supplier code
    if (!sortField && tableType === 'matrix' && header.dataset.supplier) {
      sortField = header.dataset.supplier;
    }
    
    if (!sortField) return; // Not a sortable column
    
    // Add sort icon if not present
    let icon = header.querySelector('.sort-icon');
    if (!icon) {
      icon = document.createElement('i');
      icon.className = 'fas fa-sort sort-icon';
      icon.style.marginLeft = '0.5rem';
      icon.style.fontSize = '0.75rem';
      icon.style.opacity = '0.5';
      header.appendChild(icon);
    }
    
    // Update icon if this is the currently sorted column
    if (sortField === sortState.sortBy) {
      icon.className = sortState.sortOrder === 'asc' 
        ? 'fas fa-sort-up sort-icon' 
        : 'fas fa-sort-down sort-icon';
      icon.style.opacity = '1';
    }
    
    // Click handler for sorting
    const clickHandler = async () => {
      console.log(`[Sorting] Clicked column: ${sortField}, tableType: ${tableType}`);
      // Toggle sort order if same column, else reset to asc
      let newOrder = 'asc';
      if (tableType === 'matrix') {
        if (state.matrixSortBy === sortField) {
          newOrder = state.matrixSortOrder === 'asc' ? 'desc' : 'asc';
        }
        state.matrixSortBy = sortField;
        state.matrixSortOrder = newOrder;
        state.matrixPage = 1; // Reset to first page on sort
        console.log(`[Sorting] Matrix - sortBy: ${state.matrixSortBy}, sortOrder: ${state.matrixSortOrder}`);
        
        // Show loading and reload
        const colCount = 4 + (state.matrixSuppliers?.length || 5);
        showTableLoading('matrix-table-body', colCount, 'Sorting');
        await loadSupplierMatrix({ skipLoadingOverlay: true });
      } else {
        if (state.analysisSortBy === sortField) {
          newOrder = state.analysisSortOrder === 'asc' ? 'desc' : 'asc';
        }
        state.analysisSortBy = sortField;
        state.analysisSortOrder = newOrder;
        state.analysisPage = 1; // Reset to first page on sort
        console.log(`[Sorting] Analysis - sortBy: ${state.analysisSortBy}, sortOrder: ${state.analysisSortOrder}`);
        
        // Show loading and reload
        showTableLoading('analysis-table-body', 9, 'Sorting');
        await loadAnalysisDashboard({ skipLoadingOverlay: true });
      }
    };
    
    header.addEventListener('click', clickHandler);
    header._serverSortClickHandler = clickHandler;
  });
}

// ============================================================================
// SUPPLIER MATRIX (Sheet 3)
// ============================================================================

async function loadSupplierMatrix(options = {}) {
  const { skipLoadingOverlay = false } = options;
  
  if (!skipLoadingOverlay) {
    setLoading(true);
    showToast('Loading supplier matrix...', 'info');
  }
  
  try {
    // Fetch ALL data from server (no search param - search is client-side)
    const data = await getSupplierMatrix({
      page: 1,
      perPage: 100000,
      sortBy: state.matrixSortBy,
      sortOrder: state.matrixSortOrder
    });
    
    // Cache full dataset for client-side search
    state.allMatrixData = data.matrix || [];
    state.matrixSuppliers = data.suppliers || [];
    
    // Apply client-side search and pagination
    applyMatrixClientFilters();
    
    renderMatrixTable();
    renderMatrixPagination();
    
    // Set up server-side sorting (don't use default client-side sorting)
    setupServerSideSorting('#matrix-table', 'matrix');
    
  } catch (error) {
    console.error('[Sourcing] Error loading matrix:', error);
    showToast('Failed to load supplier matrix', 'error');
  } finally {
    if (!skipLoadingOverlay) {
      setLoading(false);
    }
  }
}

function renderMatrixTable() {
  const thead = document.getElementById('matrix-table-head');
  const tbody = document.getElementById('matrix-table-body');
  if (!thead || !tbody) return;
  
  // Build dynamic headers based on suppliers
  const headerRow = thead.querySelector('tr');
  headerRow.innerHTML = `
    <th class="col-sku sticky-col sortable">SKU</th>
    <th class="col-product sticky-col-2 sortable">Product Name</th>
    <th class="col-magento sortable">Magento Price</th>
    <th class="col-status sortable">Status</th>
    ${state.matrixSuppliers.map(s => `
      <th class="col-supplier sortable" data-supplier="${s.code}">
        <div class="supplier-header">
          <span class="supplier-code">${escapeHtml(s.code)}</span>
          <span class="supplier-name">${escapeHtml(s.name)}</span>
        </div>
      </th>
    `).join('')}
  `;
  
  if (state.matrixData.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="${state.matrixSuppliers.length + 4}">
          <div class="empty-state">
            <i class="fas fa-table"></i>
            <p>No products found. Products are loaded from inventory metadata.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = state.matrixData.map(row => {
    // Find best price for this SKU
    let bestPrice = Infinity;
    let bestSupplier = null;
    
    Object.entries(row.suppliers || {}).forEach(([code, data]) => {
      if (data.normalized_price_gbp && data.normalized_price_gbp < bestPrice) {
        bestPrice = data.normalized_price_gbp;
        bestSupplier = code;
      }
    });
    
    // Status badge styling
    const statusClass = row.status === 'Available' ? 'status-available' : 
                        row.status === 'Unavailable' ? 'status-unavailable' : 
                        'status-unknown';
    
    // Magento price with source indicator
    const magentoDisplay = row.magento_price 
      ? `${formatCurrency(row.magento_price, 'GBP')}${row.price_source === 'special_price' ? ' <span class="price-special" title="Special Price">★</span>' : ''}`
      : '<span class="no-price">N/A</span>';
    
    // Build supplier cells
    const supplierCells = state.matrixSuppliers.map(s => {
      const pricing = row.suppliers?.[s.code];
      const isBest = s.code === bestSupplier;
      const hasPrice = pricing?.unit_price != null;
      
      const cellClass = isBest ? 'best-price' : (hasPrice ? 'has-price' : 'no-price');
      
      // Display with currency symbol if currency is set, otherwise just number (placeholder)
      const displayValue = hasPrice ? formatPriceDisplay(pricing.unit_price, pricing.currency) : '';
      // Store raw values for editing
      const rawPrice = hasPrice ? pricing.unit_price : '';
      const rawCurrency = pricing?.currency || '';  // Empty string = no currency (placeholder)
      
      return `
        <td class="col-supplier ${cellClass}" 
            data-sku="${escapeHtml(row.sku)}" 
            data-supplier-id="${s.id}"
            data-supplier-code="${s.code}"
            data-default-currency="${s.default_currency || 'GBP'}">
          <div class="matrix-cell" contenteditable="true" 
               data-original="${rawPrice}"
               data-currency="${rawCurrency}"
               onblur="window.sourcingModule.handleMatrixCellEdit(this)">
            ${displayValue}
          </div>
          ${pricing?.notes ? `<span class="cell-note" title="${escapeHtml(pricing.notes)}">📝</span>` : ''}
        </td>
      `;
    }).join('');
    
    return `
      <tr data-sku="${escapeHtml(row.sku)}">
        <td class="col-sku sticky-col"><strong>${escapeHtml(row.sku)}</strong></td>
        <td class="col-product sticky-col-2">${escapeHtml(row.product_name || '')}</td>
        <td class="col-magento">${magentoDisplay}</td>
        <td class="col-status"><span class="status-badge ${statusClass}">${escapeHtml(row.status || 'Unknown')}</span></td>
        ${supplierCells}
      </tr>
    `;
  }).join('');
}

function renderMatrixPagination() {
  const container = document.getElementById('matrix-pagination');
  if (!container) return;
  
  const totalPages = Math.ceil(state.matrixTotal / state.matrixPerPage);
  const startItem = (state.matrixPage - 1) * state.matrixPerPage + 1;
  const endItem = Math.min(state.matrixPage * state.matrixPerPage, state.matrixTotal);
  
  if (totalPages <= 1 && state.matrixTotal === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <div class="pagination-wrapper">
      <div class="pagination-info">
        Showing <strong>${startItem}-${endItem}</strong> of <strong>${state.matrixTotal}</strong> items
      </div>
      <div class="pagination-controls">
        <button class="btn btn-ghost btn-success" ${state.matrixPage <= 1 ? 'disabled' : ''} onclick="window.sourcingModule.goToMatrixPage(${state.matrixPage - 1})">
          <i class="fas fa-chevron-left"></i>
          <span>Previous</span>
        </button>
        <span class="page-indicator">Page ${state.matrixPage} of ${totalPages}</span>
        <button class="btn btn-ghost btn-success" ${state.matrixPage >= totalPages ? 'disabled' : ''} onclick="window.sourcingModule.goToMatrixPage(${state.matrixPage + 1})">
          <span>Next</span>
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;
}

async function handleMatrixCellEdit(cell) {
  const newValue = cell.textContent.trim();
  const originalValue = cell.dataset.original || '';
  const originalCurrency = cell.dataset.currency || '';
  
  const td = cell.closest('td');
  const sku = td.dataset.sku;
  const supplierId = parseInt(td.dataset.supplierId);
  
  // Case 1: Cleared the cell (delete the pricing)
  if (newValue === '' && originalValue !== '') {
    try {
      td.classList.add('saving');
      await deletePricing(sku, supplierId);
      
      // Update local state
      cell.dataset.original = '';
      cell.dataset.currency = '';
      td.classList.remove('has-price', 'best-price');
      td.classList.add('no-price');
      
      // Recalculate best price for this row
      recalculateRowBestPrice(td.closest('tr'));
      
      showToast('Price removed', 'success');
      
      // Trigger debounced GSheet sync if linked
      scheduleGSheetSync();
      
    } catch (error) {
      console.error('[Sourcing] Delete failed:', error);
      // Restore original value
      cell.textContent = formatPriceDisplay(originalValue, originalCurrency);
      showToast('Failed to remove price', 'error');
    } finally {
      td.classList.remove('saving');
    }
    return;
  }
  
  // Case 2: Cell is empty and was empty - do nothing
  if (newValue === '' && originalValue === '') {
    return;
  }
  
  // Parse the input - might contain currency symbol
  const { price, currency: detectedCurrency } = parsePriceWithCurrency(newValue);
  
  // Case 3: Invalid input
  if (price === null) {
    // Flash red and restore
    td.classList.add('invalid-flash');
    setTimeout(() => td.classList.remove('invalid-flash'), 600);
    
    cell.textContent = originalValue ? formatPriceDisplay(originalValue, originalCurrency) : '';
    showToast('Invalid price value', 'error');
    return;
  }
  
  // Determine final currency - use supplier's default if not specified
  const supplierDefaultCurrency = td.dataset.defaultCurrency || 'GBP';
  const finalCurrency = detectedCurrency || supplierDefaultCurrency;
  
  // Case 4: No actual change - just restore display format
  const originalPrice = originalValue !== '' ? parseFloat(originalValue) : null;
  const priceChanged = originalPrice === null || Math.abs(originalPrice - price) > 0.001;
  // Compare currencies (treat empty original as supplier default)
  const effectiveOriginalCurrency = originalCurrency || supplierDefaultCurrency;
  const currencyChanged = effectiveOriginalCurrency !== finalCurrency;
  
  if (!priceChanged && !currencyChanged) {
    // Just update display format without saving
    cell.textContent = formatPriceDisplay(price, finalCurrency);
    return;
  }
  
  // Case 5: Value changed - save immediately
  try {
    td.classList.add('saving');
    
    await upsertPricing({
      sku,
      supplier_id: supplierId,
      unit_price: price,
      currency: finalCurrency
    });
    
    // Update local state
    cell.textContent = formatPriceDisplay(price, finalCurrency);
    cell.dataset.original = price.toString();
    cell.dataset.currency = finalCurrency || '';
    
    td.classList.remove('no-price');
    td.classList.add('has-price');
    td.classList.add('save-success');
    setTimeout(() => td.classList.remove('save-success'), 600);
    
    // Recalculate best price for this row
    recalculateRowBestPrice(td.closest('tr'));
    
    showToast('Price saved', 'success');
    
    // Trigger debounced GSheet sync if linked
    scheduleGSheetSync();
    
  } catch (error) {
    console.error('[Sourcing] Save failed:', error);
    // Restore original value
    cell.textContent = originalValue ? formatPriceDisplay(originalValue, originalCurrency) : '';
    showToast('Failed to save price', 'error');
  } finally {
    td.classList.remove('saving');
  }
}

/**
 * Recalculate which cell has the best (lowest) price in a row
 * and update the CSS classes accordingly
 */
function recalculateRowBestPrice(row) {
  if (!row) return;
  
  const supplierCells = row.querySelectorAll('td.col-supplier');
  let bestPrice = Infinity;
  let bestCell = null;
  
  // First pass: find the best price
  supplierCells.forEach(td => {
    const cell = td.querySelector('.matrix-cell');
    if (!cell) return;
    
    const priceStr = cell.dataset.original;
    if (priceStr && priceStr !== '') {
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price < bestPrice) {
        bestPrice = price;
        bestCell = td;
      }
    }
  });
  
  // Second pass: update classes
  supplierCells.forEach(td => {
    const cell = td.querySelector('.matrix-cell');
    if (!cell) return;
    
    const priceStr = cell.dataset.original;
    const hasPrice = priceStr && priceStr !== '';
    
    // Remove both classes first
    td.classList.remove('best-price', 'has-price', 'no-price');
    
    if (td === bestCell) {
      td.classList.add('best-price');
    } else if (hasPrice) {
      td.classList.add('has-price');
    } else {
      td.classList.add('no-price');
    }
  });
}

// ============================================================================
// GOOGLE SHEETS AUTO-SYNC
// ============================================================================

/**
 * Schedule a GSheet export after a delay (debounced to batch rapid changes)
 * Google Sheets API has limits: 60 requests/min per user, 300/min per project
 * We wait 5 seconds after last change before syncing
 */
function scheduleGSheetSync() {
  if (!state.gsheetId) return;  // No sheet linked
  
  // Clear any pending sync
  if (state.gsheetSyncTimeout) {
    clearTimeout(state.gsheetSyncTimeout);
  }
  
  // Mark sync as pending
  state.gsheetSyncPending = true;
  
  // Schedule sync after 5 seconds of inactivity
  state.gsheetSyncTimeout = setTimeout(async () => {
    await performGSheetExport();
  }, 5000);
}

/**
 * Perform the actual GSheet export (App → Sheet)
 */
async function performGSheetExport() {
  if (!state.gsheetId) return;
  
  try {
    console.log('[Sourcing] Auto-exporting to GSheet:', state.gsheetId);
    
    await syncMatrixToGSheet(state.gsheetId);
    
    state.gsheetSyncPending = false;
    
  } catch (error) {
    console.error('[Sourcing] GSheet auto-export failed:', error);
    state.gsheetSyncPending = false;
    showToastWithAction(
      'Failed to export to Google Sheet',
      'error',
      'Export to Sheet',
      () => handleGSheetExport()
    );
  }
}

/**
 * Perform a GSheet import (Sheet → App)
 */
async function performGSheetImport() {
  if (!state.gsheetId) return;
  
  try {
    console.log('[Sourcing] Auto-importing from GSheet:', state.gsheetId);
    
    const result = await syncMatrixFromGSheet(state.gsheetId);
    
    // Update only the changed cells in the DOM (no full reload)
    if (result.imported > 0 && result.changed_entries) {
      updateMatrixCells(result.changed_entries);
      console.log(`[Sourcing] Updated ${result.imported} cells in DOM`);
    }
    
    // Handle deleted entries (prices cleared in sheet)
    if (result.deleted > 0 && result.deleted_entries) {
      clearMatrixCells(result.deleted_entries);
      console.log(`[Sourcing] Cleared ${result.deleted} cells in DOM`);
    }
    
  } catch (error) {
    console.error('[Sourcing] GSheet auto-import failed:', error);
    showToast('Failed to import from Google Sheet', 'error');
  }
}

/**
 * Update specific cells in the matrix DOM without full reload
 */
function updateMatrixCells(changedEntries) {
  for (const entry of changedEntries) {
    const { sku, supplier_id, unit_price, currency } = entry;
    
    // Find the cell by sku and supplier_id
    const cell = document.querySelector(
      `td[data-sku="${sku}"][data-supplier-id="${supplier_id}"] .matrix-cell`
    );
    
    if (cell) {
      const td = cell.closest('td');
      
      // Update cell content and data attributes
      cell.textContent = formatPriceDisplay(unit_price, currency);
      cell.dataset.original = unit_price.toString();
      cell.dataset.currency = currency || '';
      
      // Update cell styling
      td.classList.remove('no-price');
      td.classList.add('has-price');
      
      // Flash to indicate update
      td.classList.add('cell-updated');
      setTimeout(() => td.classList.remove('cell-updated'), 1000);
    }
  }
  
  // Recalculate best prices for affected rows
  const affectedSkus = new Set(changedEntries.map(e => e.sku));
  for (const sku of affectedSkus) {
    const row = document.querySelector(`tr[data-sku="${sku}"]`);
    if (row) {
      recalculateRowBestPrice(row);
    }
  }
}

/**
 * Clear specific cells in the matrix DOM (for deleted prices)
 */
function clearMatrixCells(deletedEntries) {
  const affectedSkus = new Set();
  
  for (const entry of deletedEntries) {
    const { sku, supplier_id } = entry;
    affectedSkus.add(sku);
    
    // Find the cell by sku and supplier_id
    const cell = document.querySelector(
      `td[data-sku="${sku}"][data-supplier-id="${supplier_id}"] .matrix-cell`
    );
    
    if (cell) {
      const td = cell.closest('td');
      
      // Clear cell content and data attributes
      cell.textContent = '';
      cell.dataset.original = '';
      cell.dataset.currency = '';
      
      // Update cell styling
      td.classList.remove('has-price', 'best-price');
      td.classList.add('no-price');
      
      // Flash to indicate deletion
      td.classList.add('cell-updated');
      setTimeout(() => td.classList.remove('cell-updated'), 1000);
    }
  }
  
  // Recalculate best prices for affected rows
  for (const sku of affectedSkus) {
    const row = document.querySelector(`tr[data-sku="${sku}"]`);
    if (row) {
      recalculateRowBestPrice(row);
    }
  }
}

/**
 * Start the auto-import interval (polls every 30 seconds)
 */
function startAutoImport() {
  if (state.autoImportInterval) {
    clearInterval(state.autoImportInterval);
  }
  
  // Perform initial import immediately
  performGSheetImport();
  
  // Then poll every 30 seconds
  state.autoImportInterval = setInterval(() => {
    if (state.autoImportEnabled && state.gsheetId) {
      performGSheetImport();
    }
  }, 30000);
}

/**
 * Stop the auto-import interval
 */
function stopAutoImport() {
  if (state.autoImportInterval) {
    clearInterval(state.autoImportInterval);
    state.autoImportInterval = null;
  }
}

async function exportMatrix() {
  try {
    showToast('Preparing CSV export...', 'info');
    
    // Fetch with authentication using correct token source
    const token = getToken();
    if (!token) {
      showToast('Please log in to export data', 'error');
      return;
    }
    
    const response = await fetch('/api/v1/inventory/sourcing/export/csv', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Export failed');
    }
    
    // Create blob and download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'supplier_matrix.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    showToast('CSV exported successfully', 'success');
  } catch (error) {
    console.error('[Sourcing] Export error:', error);
    showToast('Export failed', 'error');
  }
}

// Store pending import file for confirmation
let pendingImportFile = null;

/**
 * Handle file selection - show confirmation modal
 */
function handleImportFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  
  // Store file for later
  pendingImportFile = file;
  
  // Show filename in modal
  const filenameEl = document.getElementById('csv-import-filename');
  if (filenameEl) {
    filenameEl.textContent = file.name;
  }
  
  // Open confirmation modal
  const modal = document.getElementById('modal-confirm-csv-import');
  if (modal) {
    modal.classList.add('active');
  }
}

/**
 * Close CSV import confirmation modal
 */
function closeCsvImportModal() {
  const modal = document.getElementById('modal-confirm-csv-import');
  if (modal) {
    modal.classList.remove('active');
  }
  
  // Reset file input
  const fileInput = document.getElementById('import-file-input');
  if (fileInput) {
    fileInput.value = '';
  }
  pendingImportFile = null;
}

/**
 * Confirm CSV import - proceed with actual import
 */
async function confirmCsvImport() {
  if (!pendingImportFile) {
    closeCsvImportModal();
    return;
  }
  
  // Close confirmation modal
  const confirmModal = document.getElementById('modal-confirm-csv-import');
  if (confirmModal) {
    confirmModal.classList.remove('active');
  }
  
  const file = pendingImportFile;
  pendingImportFile = null;
  
  try {
    showToast('Importing CSV...', 'info');
    
    // Create FormData for file upload
    const formData = new FormData();
    formData.append('file', file);
    
    // Use correct token source
    const token = getToken();
    if (!token) {
      showToast('Please log in to import data', 'error');
      return;
    }
    
    const response = await fetch('/api/v1/inventory/sourcing/import/csv', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Import failed');
    }
    
    const result = await response.json();
    
    // Show results modal
    showCsvImportResults(result, file.name);
    
    // Log details to console for debugging
    if (result.skipped_sku_list?.length > 0) {
      console.log('[Sourcing] Skipped invalid SKUs:', result.skipped_sku_list);
    }
    if (result.error_details?.length > 0) {
      console.log('[Sourcing] Import errors:', result.error_details);
    }
    
    await loadSupplierMatrix();
    
  } catch (error) {
    console.error('[Sourcing] Import error:', error);
    showToast('Import failed: ' + error.message, 'error');
  }
  
  // Reset file input
  const fileInput = document.getElementById('import-file-input');
  if (fileInput) {
    fileInput.value = '';
  }
}

/**
 * Show CSV import results modal
 */
function showCsvImportResults(result, filename) {
  const contentEl = document.getElementById('csv-import-results-content');
  if (!contentEl) return;
  
  const hasErrors = (result.errors || 0) > 0;
  const hasSkipped = (result.skipped_invalid_skus || 0) > 0;
  
  // Build results HTML
  let html = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <div style="font-size: 3rem; color: ${hasErrors ? 'var(--warning)' : 'var(--success)'}; margin-bottom: 0.5rem;">
        <i class="fas ${hasErrors ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>
      </div>
      <p style="font-weight: 600; font-size: 1.1rem;">${hasErrors ? 'Import Completed with Warnings' : 'Import Successful!'}</p>
      <p class="help-text">${filename}</p>
    </div>
    
    <div style="background: var(--bg-light); border-radius: 8px; padding: 1rem;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div style="text-align: center; padding: 0.75rem; background: var(--bg); border-radius: 6px;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--success);">${result.imported || 0}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Updated</div>
        </div>
        <div style="text-align: center; padding: 0.75rem; background: var(--bg); border-radius: 6px;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--text);">${result.processed || 0}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Processed</div>
        </div>
      </div>
  `;
  
  if (hasSkipped || hasErrors) {
    html += `
      <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--bg-dark);">
    `;
    
    if (hasSkipped) {
      html += `
        <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--warning); margin-bottom: 0.5rem;">
          <i class="fas fa-forward"></i>
          <span><strong>${result.skipped_invalid_skus}</strong> SKUs skipped (not in system)</span>
        </div>
      `;
    }
    
    if (hasErrors) {
      html += `
        <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--error);">
          <i class="fas fa-times-circle"></i>
          <span><strong>${result.errors}</strong> errors encountered</span>
        </div>
      `;
    }
    
    html += `</div>`;
  }
  
  html += `</div>`;
  
  contentEl.innerHTML = html;
  
  // Update modal header icon based on result
  const modalHeader = document.querySelector('#modal-csv-import-results .modal-header h3');
  if (modalHeader) {
    modalHeader.innerHTML = hasErrors 
      ? '<i class="fas fa-exclamation-circle"></i> Import Complete'
      : '<i class="fas fa-check-circle"></i> Import Complete';
  }
  
  // Show modal
  const modal = document.getElementById('modal-csv-import-results');
  if (modal) {
    modal.classList.add('active');
  }
}

/**
 * Close CSV results modal
 */
function closeCsvResultsModal() {
  const modal = document.getElementById('modal-csv-import-results');
  if (modal) {
    modal.classList.remove('active');
  }
}

// ============================================================================
// GOOGLE SHEETS SYNC (Card-based UI)
// ============================================================================

/**
 * Update the GSheet card display to show linked sheet ID
 */
function updateGSheetCardDisplay() {
  const textEl = document.getElementById('gsheet-id-text');
  if (!textEl) return;
  
  if (state.gsheetId) {
    // Truncate long IDs for display
    const displayId = state.gsheetId.length > 20 
      ? state.gsheetId.substring(0, 8) + '...' + state.gsheetId.substring(state.gsheetId.length - 8)
      : state.gsheetId;
    textEl.textContent = displayId;
    textEl.classList.add('linked');
    textEl.title = state.gsheetId;
  } else {
    textEl.textContent = 'No sheet linked';
    textEl.classList.remove('linked');
    textEl.title = '';
  }
  
  updateAutoSyncButtons();
}

/**
 * Open the sheet link edit modal
 */
function openGSheetLinkModal() {
  const modal = document.getElementById('modal-gsheet-link');
  if (modal) {
    modal.classList.add('active');
    // Pre-fill with current ID
    const input = document.getElementById('gsheet-id-input');
    if (input) {
      input.value = state.gsheetId || '';
    }
  }
}

/**
 * Close the sheet link modal
 */
function closeGSheetLinkModal() {
  const modal = document.getElementById('modal-gsheet-link');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Handle save button click - show confirmation
 */
function handleSaveGSheetLink() {
  const sheetId = document.getElementById('gsheet-id-input').value.trim();
  
  if (!sheetId) {
    showToast('Please enter a Google Sheet ID', 'warning');
    return;
  }
  
  // Show confirmation modal
  const confirmModal = document.getElementById('modal-confirm-gsheet');
  const confirmIdEl = document.getElementById('confirm-gsheet-id');
  if (confirmModal && confirmIdEl) {
    confirmIdEl.textContent = sheetId;
    confirmModal.classList.add('active');
  }
}

/**
 * Close confirmation modal
 */
function closeConfirmGSheetModal() {
  const modal = document.getElementById('modal-confirm-gsheet');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Confirm and save the sheet link
 */
function confirmSaveGSheetLink() {
  const sheetId = document.getElementById('gsheet-id-input').value.trim();
  
  // Save to state and localStorage
  state.gsheetId = sheetId;
  localStorage.setItem('rm365_gsheet_id', sheetId);
  
  // Close modals
  closeConfirmGSheetModal();
  closeGSheetLinkModal();
  
  // Update display
  updateGSheetCardDisplay();
  
  showToast('Google Sheet link saved!', 'success');
  
  // Immediately export to the new sheet
  if (sheetId) {
    showToast('Exporting to Google Sheet...', 'info');
    performGSheetExport().then(() => {
      showToast('Exported to Google Sheet', 'success');
    }).catch(err => {
      console.error('[Sourcing] Failed initial export to new sheet:', err);
      showToastWithAction(
        'Failed to export to Google Sheet',
        'error',
        'Export to Sheet',
        () => handleGSheetExport()
      );
    });
  }
}

/**
 * Update the auto-import and auto-export toggle buttons
 */
function updateAutoSyncButtons() {
  const importBtn = document.getElementById('btn-auto-import');
  const exportBtn = document.getElementById('btn-auto-export');
  const hasSheet = !!state.gsheetId;
  
  if (importBtn) {
    if (state.autoImportEnabled) {
      importBtn.innerHTML = '<i class="fas fa-stop"></i> Stop';
      importBtn.classList.add('active');
    } else {
      importBtn.innerHTML = '<i class="fas fa-download"></i> Enable';
      importBtn.classList.remove('active');
    }
    importBtn.disabled = !hasSheet;
  }
  
  if (exportBtn) {
    if (state.autoExportEnabled) {
      exportBtn.innerHTML = '<i class="fas fa-stop"></i> Stop';
      exportBtn.classList.add('active');
    } else {
      exportBtn.innerHTML = '<i class="fas fa-upload"></i> Enable';
      exportBtn.classList.remove('active');
    }
    exportBtn.disabled = !hasSheet;
  }
}

/**
 * Toggle auto-import mode (Sheet → App)
 * Auto-import and auto-export are mutually exclusive
 */
function handleToggleAutoImport() {
  if (!state.gsheetId) {
    showToast('Please link a Google Sheet first', 'warning');
    return;
  }
  
  if (state.autoImportEnabled) {
    // Disable auto-import
    state.autoImportEnabled = false;
    stopAutoImport();
    showToast('Auto-import disabled', 'info');
  } else {
    // First, disable auto-export if it's enabled (mutually exclusive)
    if (state.autoExportEnabled) {
      state.autoExportEnabled = false;
      if (state.gsheetSyncTimeout) {
        clearTimeout(state.gsheetSyncTimeout);
        state.gsheetSyncTimeout = null;
      }
      state.gsheetSyncPending = false;
    }
    
    // Enable auto-import
    state.autoImportEnabled = true;
    showToast('Auto-import enabled! Syncing from sheet every 30 seconds.', 'success');
    startAutoImport();
  }
  
  updateAutoSyncButtons();
}

/**
 * Toggle auto-export mode (App → Sheet)
 * Auto-import and auto-export are mutually exclusive
 */
function handleToggleAutoExport() {
  if (!state.gsheetId) {
    showToast('Please link a Google Sheet first', 'warning');
    return;
  }
  
  if (state.autoExportEnabled) {
    // Disable auto-export
    state.autoExportEnabled = false;
    // Clear any pending export
    if (state.gsheetSyncTimeout) {
      clearTimeout(state.gsheetSyncTimeout);
      state.gsheetSyncTimeout = null;
    }
    state.gsheetSyncPending = false;
    showToast('Auto-export disabled', 'info');
  } else {
    // First, disable auto-import if it's enabled (mutually exclusive)
    if (state.autoImportEnabled) {
      state.autoImportEnabled = false;
      stopAutoImport();
    }
    
    // Enable auto-export
    state.autoExportEnabled = true;
    showToast('Auto-export enabled! Changes will sync to sheet after 5 seconds.', 'success');
  }
  
  updateAutoSyncButtons();
}

async function handleGSheetExport() {
  if (!state.gsheetId) {
    showToast('Please link a Google Sheet first', 'warning');
    return;
  }
  
  const statusEl = document.getElementById('gsheet-status');
  if (statusEl) {
    statusEl.textContent = 'Exporting...';
    statusEl.style.color = '#0066cc';
  }
  
  setLoading(true);
  try {
    await syncMatrixToGSheet(state.gsheetId);
    showToast('Successfully exported to Google Sheet', 'success');
    if (statusEl) {
      statusEl.textContent = 'Export successful!';
      statusEl.style.color = 'green';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }
  } catch (error) {
    console.error('GSheet Export Error:', error);
    showToast('Export failed: ' + error.message, 'error');
    if (statusEl) {
      statusEl.textContent = 'Error: ' + error.message;
      statusEl.style.color = 'red';
    }
  } finally {
    setLoading(false);
  }
}

async function handleGSheetImport() {
  if (!state.gsheetId) {
    showToast('Please link a Google Sheet first', 'warning');
    return;
  }
  
  const statusEl = document.getElementById('gsheet-status');
  if (statusEl) {
    statusEl.textContent = 'Importing...';
    statusEl.style.color = '#0066cc';
  }

  setLoading(true);
  try {
    const result = await syncMatrixFromGSheet(state.gsheetId);
    const unchangedMsg = result.unchanged ? ` (${result.unchanged} unchanged)` : '';
    showToast(`Imported ${result.imported} prices${unchangedMsg}`, 'success');
    if (statusEl) {
      statusEl.textContent = `Import successful! Updated ${result.imported} prices.`;
      statusEl.style.color = 'green';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }
    
    // Refresh matrix
    loadSupplierMatrix();
  } catch (error) {
    console.error('GSheet Import Error:', error);
    showToast('Import failed: ' + error.message, 'error');
    if (statusEl) {
      statusEl.textContent = 'Error: ' + error.message;
      statusEl.style.color = 'red';
    }
  } finally {
    setLoading(false);
  }
}

function handleMatrixSearch(e) {
  state.matrixSearch = e.target.value.trim();
  state.matrixPage = 1;  // Reset to first page on search
  // Client-side filter from cached data — no API call needed
  applyMatrixClientFilters();
  renderMatrixTable();
  renderMatrixPagination();
}

/**
 * Apply client-side search filter and pagination to cached matrix data.
 * Searches against SKU, product name, and item ID only.
 */
function applyMatrixClientFilters() {
  let filtered = state.allMatrixData;
  
  if (state.matrixSearch) {
    const query = state.matrixSearch.toLowerCase();
    filtered = filtered.filter(p => 
      (p.sku || '').toLowerCase().includes(query) ||
      (p.product_name || '').toLowerCase().includes(query) ||
      (p.item_id || '').toLowerCase().includes(query)
    );
  }
  
  state.matrixTotal = filtered.length;
  
  // Paginate from filtered data
  const start = (state.matrixPage - 1) * state.matrixPerPage;
  const end = start + state.matrixPerPage;
  state.matrixData = filtered.slice(start, end);
}

// ============================================================================
// SUPPLIERS
// ============================================================================

async function loadSuppliers(options = {}) {
  const { skipLoadingOverlay = false } = options;
  
  if (!skipLoadingOverlay) {
    setLoading(true);
    showToast('Loading suppliers...', 'info');
  }
  
  try {
    state.suppliers = await getSuppliers(false); // Include inactive
    renderSupplierGrid();
    
  } catch (error) {
    console.error('[Sourcing] Error loading suppliers:', error);
    showToast('Failed to load suppliers', 'error');
  } finally {
    if (!skipLoadingOverlay) {
      setLoading(false);
    }
  }
}

function renderSupplierGrid() {
  const container = document.getElementById('supplier-grid');
  if (!container) return;
  
  if (state.suppliers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-users-slash"></i>
        <h3>No Suppliers Yet</h3>
        <p>Add your first supplier to start tracking pricing.</p>
        <button class="btn btn-solid btn-success" onclick="window.sourcingModule.openAddSupplierModal()">
          <i class="fas fa-plus"></i> Add Supplier
        </button>
      </div>
    `;
    return;
  }
  
  container.innerHTML = state.suppliers.map(s => `
    <div class="supplier-card ${s.is_active ? '' : 'inactive'}" data-supplier-id="${s.id}">
      <div class="supplier-card-header">
        <div class="supplier-avatar">${s.code.substring(0, 2).toUpperCase()}</div>
        <div class="supplier-info">
          <h4>${escapeHtml(s.name)}</h4>
          <span class="supplier-code">${escapeHtml(s.code)}</span>
        </div>
        <span class="supplier-status ${s.is_active ? 'active' : 'inactive'}">
          ${s.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div class="supplier-card-body">
        <div class="supplier-detail">
          <i class="fas fa-coins"></i>
          <span>${s.default_currency || 'GBP'}</span>
        </div>
        ${s.lead_time_days ? `
          <div class="supplier-detail">
            <i class="fas fa-clock"></i>
            <span>${s.lead_time_days} days</span>
          </div>
        ` : ''}
        ${s.contact_email ? `
          <div class="supplier-detail">
            <i class="fas fa-envelope"></i>
            <span>${escapeHtml(s.contact_email)}</span>
          </div>
        ` : ''}
      </div>
      <div class="supplier-card-footer">
        <button class="btn btn-solid btn-default rounded-lg btn-sm" onclick="window.sourcingModule.openEditSupplierModal(${s.id})">
          <i class="fas fa-edit"></i> Edit
        </button>
      </div>
    </div>
  `).join('');
}

function openAddSupplierModal() {
  document.getElementById('supplier-modal-title').textContent = 'Add Supplier';
  document.getElementById('supplier-form').reset();
  document.getElementById('supplier-id').value = '';
  document.getElementById('supplier-active').checked = true;
  document.getElementById('btn-delete-supplier').style.display = 'none';
  document.getElementById('supplier-modal-overlay').classList.add('active');
}

function openEditSupplierModal(supplierId) {
  const supplier = state.suppliers.find(s => s.id === supplierId);
  if (!supplier) return;
  
  document.getElementById('supplier-modal-title').textContent = 'Edit Supplier';
  document.getElementById('supplier-id').value = supplier.id;
  document.getElementById('supplier-name').value = supplier.name || '';
  document.getElementById('supplier-code').value = supplier.code || '';
  document.getElementById('supplier-currency').value = supplier.default_currency || 'GBP';
  document.getElementById('supplier-lead-time').value = supplier.lead_time_days || '';
  document.getElementById('supplier-email').value = supplier.contact_email || '';
  document.getElementById('supplier-phone').value = supplier.contact_phone || '';
  document.getElementById('supplier-website').value = supplier.website || '';
  document.getElementById('supplier-min-order').value = supplier.min_order_value || '';
  document.getElementById('supplier-payment-terms').value = supplier.payment_terms || '';
  document.getElementById('supplier-notes').value = supplier.notes || '';
  document.getElementById('supplier-active').checked = supplier.is_active;
  document.getElementById('btn-delete-supplier').style.display = 'block';
  
  document.getElementById('supplier-modal-overlay').classList.add('active');
}

function closeSupplierModal() {
  document.getElementById('supplier-modal-overlay').classList.remove('active');
}

async function handleSaveSupplier() {
  const supplierId = document.getElementById('supplier-id').value;
  const data = {
    name: document.getElementById('supplier-name').value.trim(),
    code: document.getElementById('supplier-code').value.trim().toUpperCase(),
    default_currency: document.getElementById('supplier-currency').value,
    lead_time_days: parseInt(document.getElementById('supplier-lead-time').value) || null,
    contact_email: document.getElementById('supplier-email').value.trim() || null,
    contact_phone: document.getElementById('supplier-phone').value.trim() || null,
    website: document.getElementById('supplier-website').value.trim() || null,
    min_order_value: parseFloat(document.getElementById('supplier-min-order').value) || null,
    payment_terms: document.getElementById('supplier-payment-terms').value.trim() || null,
    notes: document.getElementById('supplier-notes').value.trim() || null,
    is_active: document.getElementById('supplier-active').checked
  };
  
  if (!data.name || !data.code) {
    showToast('Name and Code are required', 'error');
    return;
  }
  
  try {
    if (supplierId) {
      await updateSupplier(parseInt(supplierId), data);
      showToast('Supplier updated', 'success');
    } else {
      await createSupplier(data);
      showToast('Supplier created', 'success');
    }
    
    closeSupplierModal();
    await loadSuppliers();
    
    // Sync supplier changes to Google Sheet if sheet is linked
    // This syncs regardless of auto-export setting since supplier changes are explicit saves
    if (state.gsheetId) {
      showToast('Syncing to Google Sheet...', 'info');
      try {
        await performGSheetExport();
        showToast('Synced to Google Sheet', 'success');
      } catch (err) {
        console.error('[Sourcing] Failed to sync supplier change:', err);
        showToastWithAction(
          'Supplier saved, but failed to export to Google Sheet',
          'error',
          'Export to Sheet',
          () => handleGSheetExport()
        );
      }
    }
    
  } catch (error) {
    console.error('[Sourcing] Error saving supplier:', error);
    showToast(error.message || 'Failed to save supplier', 'error');
  }
}

async function handleDeleteSupplier() {
  const supplierId = document.getElementById('supplier-id').value;
  if (!supplierId) return;
  
  if (!confirm('Delete this supplier? This will also delete all their pricing data.')) {
    return;
  }
  
  try {
    await deleteSupplier(parseInt(supplierId));
    showToast('Supplier deleted', 'success');
    closeSupplierModal();
    await loadSuppliers();
    
    // Sync supplier deletion to Google Sheet if sheet is linked
    if (state.gsheetId) {
      showToast('Syncing to Google Sheet...', 'info');
      try {
        await performGSheetExport();
        showToast('Synced to Google Sheet', 'success');
      } catch (err) {
        console.error('[Sourcing] Failed to sync supplier deletion:', err);
        showToastWithAction(
          'Supplier deleted, but failed to export to Google Sheet',
          'error',
          'Export to Sheet',
          () => handleGSheetExport()
        );
      }
    }
    
  } catch (error) {
    console.error('[Sourcing] Error deleting supplier:', error);
    showToast('Failed to delete supplier', 'error');
  }
}

// ============================================================================
// FX RATES (Sheet 2: Currency Engine)
// ============================================================================

async function loadFXRates(options = {}) {
  const { skipLoadingOverlay = false } = options;
  
  if (!skipLoadingOverlay) {
    setLoading(true);
    showToast('Loading FX rates...', 'info');
  }
  
  try {
    const data = await getFXRates();
    
    state.fxRates = data.rates || {};
    state.fxOverrides = data.overrides || [];
    
    document.getElementById('fx-base-currency').textContent = data.base_currency || 'GBP';
    document.getElementById('fx-source').textContent = data.source || 'API';
    document.getElementById('fx-last-updated').textContent = 
      data.last_updated ? new Date(data.last_updated).toLocaleString() : '—';
    
    renderFXRatesGrid();
    
  } catch (error) {
    console.error('[Sourcing] Error loading FX rates:', error);
    showToast('Failed to load exchange rates', 'error');
  } finally {
    if (!skipLoadingOverlay) {
      setLoading(false);
    }
  }
}

function renderFXRatesGrid() {
  const container = document.getElementById('fx-rates-grid');
  if (!container) return;
  
  // Popular currencies to display
  const popularCurrencies = ['USD', 'EUR', 'CNY', 'JPY', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF'];
  
  const currencyNames = {
    USD: 'US Dollar', EUR: 'Euro', CNY: 'Chinese Yuan', JPY: 'Japanese Yen',
    CAD: 'Canadian Dollar', AUD: 'Australian Dollar', CHF: 'Swiss Franc',
    SEK: 'Swedish Krona', NOK: 'Norwegian Krone', DKK: 'Danish Krone',
    PLN: 'Polish Zloty', CZK: 'Czech Koruna', HUF: 'Hungarian Forint'
  };
  
  container.innerHTML = popularCurrencies.map(code => {
    const rate = state.fxRates[code];
    const isOverride = state.fxOverrides.includes(code);
    
    return `
      <div class="fx-rate-card ${isOverride ? 'has-override' : ''}">
        <div class="rate-code">${code}</div>
        <div class="rate-name">${currencyNames[code] || code}</div>
        <div class="rate-value">${rate ? rate.toFixed(4) : '—'}</div>
        ${isOverride ? `
          <button class="btn btn-ghost btn-danger btn-icon-only btn-sm btn-remove-override" title="Remove Override" 
                  onclick="window.sourcingModule.handleRemoveFXOverride('${code}')">
            <i class="fas fa-times"></i>
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function handleSetFXOverride() {
  const currency = document.getElementById('override-currency').value;
  const rate = parseFloat(document.getElementById('override-rate').value);
  const notes = document.getElementById('override-notes').value.trim();
  
  if (!currency) {
    showToast('Select a currency', 'error');
    return;
  }
  
  if (isNaN(rate) || rate <= 0) {
    showToast('Enter a valid rate', 'error');
    return;
  }
  
  try {
    await setFXOverride(currency, rate, notes);
    showToast(`Override set for ${currency}`, 'success');
    
    // Clear form
    document.getElementById('override-currency').value = '';
    document.getElementById('override-rate').value = '';
    document.getElementById('override-notes').value = '';
    
    await loadFXRates();
    
  } catch (error) {
    console.error('[Sourcing] Error setting FX override:', error);
    showToast('Failed to set override', 'error');
  }
}

async function handleRemoveFXOverride(currencyCode) {
  try {
    await removeFXOverride(currencyCode);
    showToast(`Override removed for ${currencyCode}`, 'success');
    await loadFXRates();
    
  } catch (error) {
    console.error('[Sourcing] Error removing FX override:', error);
    showToast('Failed to remove override', 'error');
  }
}

// ============================================================================
// PRICING MODAL
// ============================================================================

let currentPricingSku = null;

async function openPricingModal(sku) {
  currentPricingSku = sku;
  document.getElementById('pricing-sku-display').textContent = sku;
  
  try {
    const data = await getPricingForSku(sku);
    renderPricingEntries(data.pricing || []);
    document.getElementById('pricing-modal-overlay').classList.add('active');
    
  } catch (error) {
    console.error('[Sourcing] Error loading pricing:', error);
    showToast('Failed to load pricing', 'error');
  }
}

function renderPricingEntries(pricing) {
  const container = document.getElementById('pricing-entries');
  if (!container) return;
  
  // Get all suppliers
  const supplierList = state.suppliers.length > 0 ? state.suppliers : state.matrixSuppliers;
  
  if (supplierList.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-info-circle"></i><p>No suppliers found. Add suppliers first.</p></div>';
    return;
  }

  // Create entries for all suppliers
  container.innerHTML = supplierList.map(supplier => {
    const existing = pricing.find(p => p.supplier_id === supplier.id);
    const hasPrice = existing?.unit_price != null && existing.unit_price !== '';
    
    return `
      <div class="pricing-entry ${hasPrice ? 'has-data' : ''}" data-supplier-id="${supplier.id}">
        <div class="pricing-supplier">
          <span class="supplier-code">${escapeHtml(supplier.code)}</span>
          <span class="supplier-name">${escapeHtml(supplier.name)}</span>
          ${hasPrice ? '<span class="pricing-badge">Priced</span>' : '<span class="pricing-badge empty">No price</span>'}
        </div>
        <div class="pricing-fields">
          <div class="field-group">
            <label>Price</label>
            <input type="number" class="nui-input nui-input-default price-input" step="0.01" 
                   value="${existing?.unit_price || ''}" 
                   data-original="${existing?.unit_price || ''}"
                   placeholder="0.00">
          </div>
          <div class="field-group">
            <label>Currency</label>
            <select class="currency-select">
              <option value="GBP" ${(existing?.currency || supplier.default_currency) === 'GBP' ? 'selected' : ''}>GBP</option>
              <option value="USD" ${existing?.currency === 'USD' ? 'selected' : ''}>USD</option>
              <option value="EUR" ${existing?.currency === 'EUR' ? 'selected' : ''}>EUR</option>
              <option value="CNY" ${existing?.currency === 'CNY' ? 'selected' : ''}>CNY</option>
            </select>
          </div>
          <div class="field-group">
            <label>MOQ</label>
            <input type="number" class="nui-input nui-input-default moq-input" min="1" value="${existing?.moq || ''}" placeholder="1">
          </div>
          <div class="field-group notes-field">
            <label>Notes</label>
            <input type="text" class="nui-input nui-input-default notes-input" value="${escapeHtml(existing?.notes || '')}" placeholder="Optional notes…">
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Enhance currency selects with NextUI dropdown
  container.querySelectorAll('.currency-select').forEach(sel => {
    initDropdown(sel);
  });

  // Enhance number inputs with clickable chevrons
  container.querySelectorAll('input[type="number"].nui-input').forEach(el => {
    initNumberInput(el);
  });
}

function closePricingModal() {
  document.getElementById('pricing-modal-overlay').classList.remove('active');
  currentPricingSku = null;
}

async function handleSavePricing() {
  if (!currentPricingSku) return;
  
  const entries = [];
  document.querySelectorAll('#pricing-entries .pricing-entry').forEach(entry => {
    const supplierId = parseInt(entry.dataset.supplierId);
    const price = parseFloat(entry.querySelector('.price-input').value);
    const currency = entry.querySelector('.currency-select').value;
    const moq = parseInt(entry.querySelector('.moq-input').value) || null;
    const notes = entry.querySelector('.notes-input').value.trim() || null;
    
    if (!isNaN(price) && price > 0) {
      entries.push({
        sku: currentPricingSku,
        supplier_id: supplierId,
        unit_price: price,
        currency,
        moq,
        notes
      });
    }
  });
  
  try {
    if (entries.length > 0) {
      await bulkUpdatePricing(entries);
    }
    
    showToast('Pricing saved', 'success');
    closePricingModal();
    
    // Refresh current view
    if (state.activeTab === 'dashboard') {
      await loadAnalysisDashboard();
    } else if (state.activeTab === 'matrix') {
      await loadSupplierMatrix();
    }
    
    // Sync pricing changes to Google Sheet if sheet is linked
    if (state.gsheetId) {
      try {
        await performGSheetExport();
        showToast('Synced to Google Sheet', 'success');
      } catch (err) {
        console.error('[Sourcing] Failed to sync pricing to GSheet:', err);
        showToastWithAction(
          'Pricing saved, but failed to export to Google Sheet',
          'error',
          'Export to Sheet',
          () => handleGSheetExport()
        );
      }
    }
    
  } catch (error) {
    console.error('[Sourcing] Error saving pricing:', error);
    showToast('Failed to save pricing', 'error');
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Set loading state
 * @param {boolean} isLoading - Whether loading is in progress
 * @param {boolean} showOverlay - Whether to show the full-page loading overlay (default: false)
 */
function setLoading(isLoading, showOverlay = false) {
  state.isLoading = isLoading;
  document.querySelector('.product-sourcing')?.classList.toggle('loading', isLoading);
  
  // Only show global loading overlay when explicitly requested (e.g., initial page load)
  if (showOverlay) {
    if (isLoading) {
      showLoading();
    } else {
      hideLoading();
    }
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// PRODUCT MAPPINGS (Product Mappings sub-tab)
// ============================================================================

// Cache of internal products for mapping SKU picker search
let cachedInternalProducts = [];

async function loadProductMappings(options = {}) {
  const { skipLoadingOverlay = false } = options;
  
  if (!skipLoadingOverlay) {
    setLoading(true);
  }
  
  try {
    // 1. Fetch suppliers to populate filters and modals
    if (state.suppliers.length === 0) {
      state.suppliers = await getSuppliers(true);
    }
    populateSupplierFilters();
    
    // 2. Fetch mappings
    const mappings = await getSupplierMappings();
    state.allMappingsData = mappings || [];
    
    // Apply client filter and search
    applyMappingsClientFilters();
    renderMappingsTable();
    
  } catch (error) {
    console.error('[Sourcing] Error loading mappings:', error);
    showToast('Failed to load product mappings', 'error');
  } finally {
    if (!skipLoadingOverlay) {
      setLoading(false);
    }
  }
}

function populateSupplierFilters() {
  // Populate the supplier filter on the page
  const filterSelect = document.getElementById('mappings-supplier-filter');
  if (filterSelect) {
    // Keep first option (All Suppliers)
    filterSelect.innerHTML = '<option value="" selected>All Suppliers</option>';
    state.suppliers.forEach(s => {
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = `${s.name} (${s.code})`;
      filterSelect.appendChild(option);
    });
  }
  
  // Populate the supplier select inside the mapping modal
  const modalSelect = document.getElementById('mapping-supplier');
  if (modalSelect) {
    modalSelect.innerHTML = '<option value="" selected disabled>Select supplier...</option>';
    state.suppliers.forEach(s => {
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = `${s.name} (${s.code})`;
      modalSelect.appendChild(option);
    });
  }
}

function applyMappingsClientFilters() {
  let filtered = state.allMappingsData;
  
  // Apply supplier filter
  if (state.mappingsSupplierFilter) {
    const supplierId = parseInt(state.mappingsSupplierFilter);
    filtered = filtered.filter(m => m.supplier_id === supplierId);
  }
  
  // Apply search query
  if (state.mappingsSearch) {
    const query = state.mappingsSearch.toLowerCase();
    filtered = filtered.filter(m =>
      (m.supplier_sku || '').toLowerCase().includes(query) ||
      (m.supplier_product_name || '').toLowerCase().includes(query) ||
      (m.internal_sku || '').toLowerCase().includes(query) ||
      (m.internal_product_name || '').toLowerCase().includes(query) ||
      (m.supplier_name || '').toLowerCase().includes(query) ||
      (m.supplier_code || '').toLowerCase().includes(query)
    );
  }
  
  state.mappingsData = filtered;
}

function renderMappingsTable() {
  const tbody = document.getElementById('mappings-table-body');
  if (!tbody) return;
  
  if (state.mappingsData.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <i class="fas fa-link"></i>
            <p>No product mappings found.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = state.mappingsData.map(row => {
    const createdDate = row.created_at ? new Date(row.created_at).toLocaleDateString() : '—';
    return `
      <tr data-mapping-id="${row.id}">
        <td><strong>${escapeHtml(row.supplier_name || '')} (${escapeHtml(row.supplier_code || '')})</strong></td>
        <td>${row.supplier_sku ? `<code class="supplier-identifier-code">${escapeHtml(row.supplier_sku)}</code>` : '—'}</td>
        <td>${row.supplier_product_name ? `<code class="supplier-identifier-code">${escapeHtml(row.supplier_product_name)}</code>` : '—'}</td>
        <td><code class="internal-sku-code">${escapeHtml(row.internal_sku)}</code></td>
        <td>${escapeHtml(row.internal_product_name || '—')}</td>
        <td>${escapeHtml(createdDate)}</td>
        <td class="col-actions">
          <button class="btn btn-ghost btn-danger btn-icon-only btn-sm" title="Delete Mapping" onclick="window.sourcingModule.deleteMapping(${row.id})">
            <i class="fas fa-trash-alt"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleMappingsSearch(e) {
  state.mappingsSearch = e.target.value.trim();
  applyMappingsClientFilters();
  renderMappingsTable();
}

function handleMappingsSupplierFilterChange(e) {
  state.mappingsSupplierFilter = e.target.value;
  applyMappingsClientFilters();
  renderMappingsTable();
}

// Modal handling
async function openAddMappingModal() {
  // Clear modal inputs
  document.getElementById('mapping-form').reset();
  
  // Populate suppliers if needed
  if (state.suppliers.length === 0) {
    state.suppliers = await getSuppliers(true);
  }
  populateSupplierFilters();
  
  // Show overlay/modal
  document.getElementById('mapping-modal-overlay').classList.add('active');
  
  // Load products list for SKU picker
  await loadInternalProductsForSearch();
}

function closeMappingModal() {
  document.getElementById('mapping-modal-overlay').classList.remove('active');
}

async function loadInternalProductsForSearch() {
  const select = document.getElementById('mapping-internal-sku');
  if (!select) return;
  
  select.innerHTML = '<option value="" disabled selected>Loading products...</option>';
  
  try {
    if (cachedInternalProducts.length === 0) {
      const data = await getAnalysisDashboard({ page: 1, perPage: 100000 });
      cachedInternalProducts = (data.products || []).map(p => ({
        sku: p.sku,
        name: p.product_name || p.sku
      }));
    }
    
    // Render full list initially
    filterInternalProductsSelect('');
  } catch (error) {
    console.error('[Sourcing] Error loading products for search:', error);
    select.innerHTML = '<option value="" disabled selected>Error loading products</option>';
  }
}

function filterInternalProductsSelect(query) {
  const select = document.getElementById('mapping-internal-sku');
  if (!select) return;
  
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = cachedInternalProducts.filter(p => 
    p.sku.toLowerCase().includes(trimmedQuery) || 
    p.name.toLowerCase().includes(trimmedQuery)
  );
  
  if (filtered.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No products match your search</option>';
    return;
  }
  
  select.innerHTML = filtered.map(p => 
    `<option value="${escapeHtml(p.sku)}">[${escapeHtml(p.sku)}] ${escapeHtml(p.name)}</option>`
  ).join('');
}

function handleMappingInternalSearchInput(e) {
  filterInternalProductsSelect(e.target.value);
}

async function handleSaveMapping() {
  const supplierId = document.getElementById('mapping-supplier').value;
  const supplierSku = (document.getElementById('mapping-supplier-sku')?.value || '').trim();
  const supplierProductName = (document.getElementById('mapping-supplier-product-name')?.value || '').trim();
  const internalSku = document.getElementById('mapping-internal-sku').value;

  if (!supplierId) {
    showToast('Please select a supplier', 'warning');
    return;
  }
  if (!supplierSku && !supplierProductName) {
    showToast('Please provide at least one of Supplier SKU or Supplier Product Name', 'warning');
    return;
  }
  if (!internalSku) {
    showToast('Please select an internal SKU', 'warning');
    return;
  }

  setLoading(true);
  try {
    await createSupplierMapping({
      supplier_id: parseInt(supplierId),
      supplier_sku: supplierSku || null,
      supplier_product_name: supplierProductName || null,
      internal_sku: internalSku
    });

    showToast('Product mapping saved successfully', 'success');
    closeMappingModal();
    await loadProductMappings();
  } catch (error) {
    console.error('[Sourcing] Error saving mapping:', error);
    showToast(error.message || 'Failed to save mapping', 'error');
  } finally {
    setLoading(false);
  }
}

async function deleteMapping(mappingId) {
  if (!confirm('Are you sure you want to delete this product mapping?')) {
    return;
  }

  setLoading(true);
  try {
    await deleteSupplierMapping(mappingId);
    showToast('Product mapping deleted successfully', 'success');
    await loadProductMappings();
  } catch (error) {
    console.error('[Sourcing] Error deleting mapping:', error);
    showToast('Failed to delete mapping', 'error');
  } finally {
    setLoading(false);
  }
}

async function handleMappingsImportFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  setLoading(true);
  try {
    const result = await importMappingsFile(file);
    showMappingsImportResult(result, file.name);
    await loadProductMappings(true);
  } catch (error) {
    console.error('[Sourcing] Error importing mappings:', error);
    showToast('Import failed: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    setLoading(false);
  }
}

function showMappingsImportResult(result, filename) {
  const body = document.getElementById('mappings-import-result-body');
  if (!body) return;

  const errorList = (result.errors || []).map(e => `<li>${escapeHtml(e)}</li>`).join('');

  body.innerHTML = `
    <p><strong>File:</strong> ${escapeHtml(filename)}</p>
    <div style="display:flex; gap:1.5rem; margin:1rem 0;">
      <div style="text-align:center;">
        <div style="font-size:1.8rem; font-weight:bold; color:var(--color-success, #16a34a);">${result.imported ?? 0}</div>
        <div style="font-size:0.85rem; color:var(--color-muted, #6b7280);">Imported</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:1.8rem; font-weight:bold; color:var(--color-warning, #d97706);">${result.skipped ?? 0}</div>
        <div style="font-size:0.85rem; color:var(--color-muted, #6b7280);">Skipped</div>
      </div>
    </div>
    ${errorList ? `<details open><summary style="cursor:pointer; font-weight:600; margin-bottom:0.5rem;">Errors (${result.errors.length})</summary><ul style="margin:0; padding-left:1.25rem; font-size:0.85rem; max-height:200px; overflow-y:auto;">${errorList}</ul></details>` : ''}
  `;

  document.getElementById('mappings-import-result-overlay')?.classList.add('active');
}

function closeMappingsImportResultModal() {
  document.getElementById('mappings-import-result-overlay')?.classList.remove('active');
}

// ============================================================================
// CUSTOM DROPDOWN FUNCTIONS
// ============================================================================

// EXPOSE TO WINDOW FOR ONCLICK HANDLERS
// ============================================================================

window.sourcingModule = {
  openPricingModal,
  openAddSupplierModal,
  openEditSupplierModal,
  handleMatrixCellEdit,
  handleRemoveFXOverride,
  openGSheetLinkModal,
  deleteMapping,
  goToAnalysisPage: async (page) => {
    state.analysisPage = page;
    // Client-side pagination from cached data — no API call needed
    applyAnalysisClientFilters();
    renderAnalysisTable();
    renderAnalysisPagination();
  },
  goToMatrixPage: async (page) => {
    state.matrixPage = page;
    // Client-side pagination from cached data — no API call needed
    applyMatrixClientFilters();
    renderMatrixTable();
    renderMatrixPagination();
  }
};

