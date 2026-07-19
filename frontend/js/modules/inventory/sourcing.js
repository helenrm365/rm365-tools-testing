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
  importMappingsFile,
  importMatrixPDF,
  importMatrixPDFStream,
  identifyPdfSupplier,
  identifyPdfSuppliers
} from '../../services/api/sourcingApi.js?v=3';
import { initCombobox, pruneDetachedComboboxes, closeOpenCombobox } from '../../ui/combobox.js?v=2';
import { confirmModal } from '../../ui/confirmationModal.js';

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

/**
 * Format an ISO date (YYYY-MM-DD, from the PDF date extraction) for display.
 * Falls back to the raw string if it can't be parsed so nothing is ever hidden.
 */
function formatPdfDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
}

/**
 * Format a "price last updated" timestamp (UTC ISO from the backend) into a short
 * local-date label for display. Returns 'N/A' for legacy prices with no recorded
 * date. Dates are stored in UTC and rendered in the viewer's local timezone.
 */
function formatLastUpdated(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString();
}

/** Full local date+time, used as the hover tooltip on a "last updated" date. */
function formatLastUpdatedFull(iso) {
  if (!iso) return 'No update date recorded';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 'No update date recorded' : `Price last updated ${d.toLocaleString()}`;
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

  // PDF Import
  document.getElementById('btn-import-pdf')?.addEventListener('click', openPdfImportModal);
  document.getElementById('pdf-import-modal-close')?.addEventListener('click', closePdfImportModal);
  document.getElementById('btn-pdf-import-cancel')?.addEventListener('click', closePdfImportModal);
  document.getElementById('pdf-import-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePdfImportModal();
  });
  document.getElementById('pdf-import-drop-zone')?.addEventListener('click', () => {
    document.getElementById('pdf-import-file-input')?.click();
  });
  document.getElementById('pdf-import-file-input')?.addEventListener('change', handlePdfFileSelect);
  document.getElementById('btn-pdf-import-process')?.addEventListener('click', processPdfImport);
  document.getElementById('btn-pdf-preview-back')?.addEventListener('click', showPdfImportStep1);
  document.getElementById('btn-pdf-preview-cancel')?.addEventListener('click', closePdfImportModal);
  document.getElementById('btn-pdf-preview-confirm')?.addEventListener('click', confirmPdfImport);
  document.getElementById('btn-pdf-preview-confirm-all')?.addEventListener('click', confirmPdfImportAll);
  document.getElementById('pdf-carousel-prev')?.addEventListener('click', () => pdfCarouselGo(-1));
  document.getElementById('pdf-carousel-next')?.addEventListener('click', () => pdfCarouselGo(1));

  // Preview table search boxes
  document.getElementById('pdf-import-changes-search')?.addEventListener('input', (e) => {
    pdfMatchedView.query = e.target.value;
    pdfMatchedView.page = 1;
    renderPdfMatched();
  });
  document.getElementById('pdf-import-unmatched-search')?.addEventListener('input', (e) => {
    pdfUnmatchedView.query = e.target.value;
    pdfUnmatchedView.page = 1;
    renderPdfUnmatched();
  });
  // Unmatched product picker + mapping-type select (delegated — rows re-render)
  document.getElementById('pdf-import-unmatched-body')?.addEventListener('change', (e) => {
    const input = e.target.closest('.pdf-unmatched-input');
    if (input) {
      resolveUnmatched(parseInt(input.dataset.unmatchedIdx, 10), input.value);
      return;
    }
    const sel = e.target.closest('.pdf-unmatched-maptype');
    if (sel) {
      setUnmatchedMappingType(parseInt(sel.dataset.unmatchedIdx, 10), sel.value);
    }
  });

  // Matched table: changes-only toggle, select-all, per-row include/exclude, sort
  document.getElementById('pdf-import-changes-only')?.addEventListener('change', (e) => {
    pdfMatchedView.changesOnly = e.target.checked;
    pdfMatchedView.page = 1;
    renderPdfMatched();
  });
  document.getElementById('pdf-import-select-all')?.addEventListener('change', (e) => {
    setPdfAllExcluded(!e.target.checked);
  });
  document.getElementById('pdf-import-changes-body')?.addEventListener('change', (e) => {
    const cb = e.target.closest('.pdf-matched-check');
    if (!cb) return;
    const idx = parseInt(cb.dataset.matchedIdx, 10);
    if (cb.dataset.hasChange === 'true') {
      setPdfMatchedExcluded(idx, !cb.checked);
    } else {
      setPdfNoChangeIncluded(idx, cb.checked);
    }
  });
  document.querySelectorAll('#pdf-import-changes-table th.pdf-sortable').forEach(th => {
    th.addEventListener('click', () => togglePdfMatchedSort(th.dataset.pdfSort));
  });

  // Drag-and-drop for PDF drop zone
  const dropZone = document.getElementById('pdf-import-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--color-primary, #2563eb)';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'var(--color-border, #d1d5db)';
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--color-border, #d1d5db)';
      setPdfFiles(e.dataTransfer.files);
    });
  }

  // Product Mappings — PDF Import
  document.getElementById('btn-import-mappings-pdf')?.addEventListener('click', openMappingPdfModal);
  document.getElementById('mapping-pdf-modal-close')?.addEventListener('click', closeMappingPdfModal);
  document.getElementById('btn-mapping-pdf-cancel')?.addEventListener('click', closeMappingPdfModal);
  document.getElementById('btn-mapping-pdf-step2-cancel')?.addEventListener('click', closeMappingPdfModal);
  document.getElementById('mapping-pdf-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMappingPdfModal();
  });
  document.getElementById('mapping-pdf-drop-zone')?.addEventListener('click', () => {
    document.getElementById('mapping-pdf-file-input')?.click();
  });
  document.getElementById('mapping-pdf-file-input')?.addEventListener('change', handleMapPdfFileSelect);
  document.getElementById('btn-mapping-pdf-process')?.addEventListener('click', processMappingPdfImport);
  document.getElementById('btn-mapping-pdf-back')?.addEventListener('click', showMappingPdfStep1);
  document.getElementById('btn-mapping-pdf-confirm')?.addEventListener('click', confirmMappingPdfImport);
  // Supplier is optional up front (the AI detects it) — nothing to toggle on change.
  document.getElementById('mapping-pdf-unmapped-search')?.addEventListener('input', (e) => {
    mapPdfView.query = e.target.value;
    mapPdfView.page = 1;
    renderMapPdfUnmapped();
  });
  // Product picker + mapping-type select (delegated — rows re-render)
  document.getElementById('mapping-pdf-unmapped-body')?.addEventListener('change', (e) => {
    const input = e.target.closest('.map-pdf-input');
    if (input) {
      resolveMapPdf(parseInt(input.dataset.mapIdx, 10), input.value);
      return;
    }
    const sel = e.target.closest('.map-pdf-maptype');
    if (sel) {
      setMapPdfMappingType(parseInt(sel.dataset.mapIdx, 10), sel.value);
    }
  });
  // Already-mapped (remap) search + product picker (delegated — rows re-render)
  document.getElementById('mapping-pdf-mapped-search')?.addEventListener('input', (e) => {
    mapPdfMappedView.query = e.target.value;
    mapPdfMappedView.page = 1;
    renderMapPdfMapped();
  });
  document.getElementById('mapping-pdf-mapped-body')?.addEventListener('change', (e) => {
    const input = e.target.closest('.map-pdf-remap-input');
    if (input) resolveMapPdfRemap(parseInt(input.dataset.remapIdx, 10), input.value);
  });
  // Import confirmation summary modal (shared by matrix + mappings PDF import)
  document.getElementById('import-confirm-close')?.addEventListener('click', closeImportConfirm);
  document.getElementById('btn-import-confirm-cancel')?.addEventListener('click', closeImportConfirm);
  document.getElementById('import-confirm-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeImportConfirm();
  });
  // Drag-and-drop for the mapping PDF drop zone
  const mapDropZone = document.getElementById('mapping-pdf-drop-zone');
  if (mapDropZone) {
    mapDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      mapDropZone.style.borderColor = 'var(--color-primary, #2563eb)';
    });
    mapDropZone.addEventListener('dragleave', () => {
      mapDropZone.style.borderColor = 'var(--color-border, #d1d5db)';
    });
    mapDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      mapDropZone.style.borderColor = 'var(--color-border, #d1d5db)';
      setMapPdfFiles(e.dataTransfer.files);
    });
  }

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
        <td class="col-winner">${row.winning_supplier
          ? `<div class="winner-cell">
               <span class="winner-badge">${escapeHtml(row.winning_supplier)}</span>
               <span class="winner-date" title="${escapeHtml(formatLastUpdatedFull(row.best_price_updated_at))}">${escapeHtml(formatLastUpdated(row.best_price_updated_at))}</span>
             </div>`
          : '—'}</td>
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
    // Server-side pagination + search: fetch only the current page. The backend
    // searches/sorts/paginates and hydrates prices for just this page's SKUs, so
    // this stays fast even against a remote database.
    const data = await getSupplierMatrix({
      page: state.matrixPage,
      perPage: state.matrixPerPage,
      search: state.matrixSearch,
      sortBy: state.matrixSortBy,
      sortOrder: state.matrixSortOrder
    });

    state.matrixData = data.matrix || [];
    state.matrixSuppliers = data.suppliers || [];
    state.matrixTotal = data.total || 0;

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
      
      // "Last updated" date sits in the top-right of the cell. Shown for any cell
      // that has a price (legacy prices with no recorded date show "N/A").
      const priceDate = pricing?.price_updated_at || '';
      const dateLabel = hasPrice ? formatLastUpdated(priceDate) : '';

      return `
        <td class="col-supplier ${cellClass}"
            data-sku="${escapeHtml(row.sku)}"
            data-supplier-id="${s.id}"
            data-supplier-code="${s.code}"
            data-default-currency="${s.default_currency || 'GBP'}">
          <span class="cell-date" title="${escapeHtml(formatLastUpdatedFull(priceDate))}">${escapeHtml(dateLabel)}</span>
          <div class="matrix-cell" contenteditable="true"
               data-original="${rawPrice}"
               data-currency="${rawCurrency}"
               onblur="window.sourcingModule.handleMatrixCellEdit(this)">
            ${displayValue}
          </div>
          ${pricing?.notes ? `<span class="cell-note" data-note="${escapeHtml(pricing.notes)}"><i class="fas fa-sticky-note"></i></span>` : ''}
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

/**
 * Update the "last updated" date label shown in the top-right of a matrix cell.
 * Pass an ISO timestamp to show that date, or null/'' to clear it (empty cell).
 */
function setCellDate(td, iso) {
  const span = td?.querySelector('.cell-date');
  if (!span) return;
  span.textContent = iso ? formatLastUpdated(iso) : '';
  span.title = formatLastUpdatedFull(iso);
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
      setCellDate(td, null);  // cleared price → no date

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
    
    const saved = await upsertPricing({
      sku,
      supplier_id: supplierId,
      unit_price: price,
      currency: finalCurrency
    });

    // Update local state
    cell.textContent = formatPriceDisplay(price, finalCurrency);
    cell.dataset.original = price.toString();
    cell.dataset.currency = finalCurrency || '';
    // Stamp the "last updated" date from the server response (falls back to now).
    setCellDate(td, saved?.price_updated_at || new Date().toISOString());

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

    // Push the freshly-stamped "last updated" dates straight back to the sheet so
    // they're reflected there immediately (the import itself can't write them).
    if (result.imported > 0 || result.deleted > 0) {
      await performGSheetExport();
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
      // These prices were just changed by this import → stamp with today.
      setCellDate(td, entry.price_updated_at || new Date().toISOString());

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
      setCellDate(td, null);  // cleared price → no date

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

    // Re-export right after the import so the sheet immediately shows the new
    // "last updated" dates (the import reads the sheet; it can't write back to it).
    if (result.imported > 0 || result.deleted > 0) {
      if (statusEl) {
        statusEl.textContent = 'Syncing dates back to sheet...';
        statusEl.style.color = '#0066cc';
      }
      await performGSheetExport();
      if (statusEl) {
        statusEl.textContent = 'Sheet synced.';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      }
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
  // Server-side search: the input listener is already debounced (see init), so
  // fetch the first page of matching results. Skip the full-screen overlay and
  // show an inline table spinner so typing stays responsive.
  const colCount = 4 + (state.matrixSuppliers?.length || 5);
  showTableLoading('matrix-table-body', colCount, 'Searching');
  loadSupplierMatrix({ skipLoadingOverlay: true });
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

// When another flow (e.g. the PDF importer) opens the Add Supplier modal to
// create a supplier mid-task, this holds a resolver that receives the newly
// created supplier (or null if the modal is cancelled) so that flow can carry on.
let _supplierModalResolver = null;

function openAddSupplierModal() {
  document.getElementById('supplier-modal-title').textContent = 'Add Supplier';
  document.getElementById('supplier-form').reset();
  document.getElementById('supplier-id').value = '';
  document.getElementById('supplier-active').checked = true;
  document.getElementById('btn-delete-supplier').style.display = 'none';
  document.getElementById('supplier-modal-overlay').classList.add('active');
}

/**
 * Open the same Add Supplier modal the Suppliers tab uses, but as a picker: the
 * returned promise resolves with the created supplier once the user saves, or
 * null if they cancel/close it. Callers that show their own modal underneath
 * should hide it first and restore it after (the supplier modal shares the same
 * z-index layer).
 * @returns {Promise<{id:number, name:string, code:string}|null>}
 */
function _createSupplierViaSuppliersModal() {
  return new Promise((resolve) => {
    // If something was already waiting, don't strand it.
    if (_supplierModalResolver) _supplierModalResolver(null);
    _supplierModalResolver = resolve;
    openAddSupplierModal();
  });
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
  // Cancelled/closed without saving → let any waiting picker flow know.
  if (_supplierModalResolver) {
    const resolve = _supplierModalResolver;
    _supplierModalResolver = null;
    resolve(null);
  }
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
    let createdSupplier = null;
    if (supplierId) {
      await updateSupplier(parseInt(supplierId), data);
      showToast('Supplier updated', 'success');
    } else {
      createdSupplier = await createSupplier(data);
      showToast('Supplier created', 'success');
    }

    // Hand the new supplier back to any waiting picker flow BEFORE closing, so
    // closeSupplierModal() doesn't resolve it as a cancellation.
    if (_supplierModalResolver) {
      const resolve = _supplierModalResolver;
      _supplierModalResolver = null;
      resolve(createdSupplier);
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

// ============================================================================
// PDF IMPORT
// ============================================================================

// Selected PDFs (one or more) — merged server-side into a single document before parsing.
let pendingPdfFiles = [];
let pendingPdfPreview = null;
// Map of conflict key → chosen SKU (populated as user resolves each conflict)
const conflictResolutions = new Map();

// Keep only PDF files from a FileList/array, and describe the selection for the
// drop-zone label. Shared by the matrix and mapping importers.
function _filterPdfFiles(fileList) {
  return Array.from(fileList || []).filter(
    f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
  );
}

function _describePdfSelection(files) {
  if (!files || files.length === 0) return '';
  if (files.length === 1) return files[0].name;
  return `${files.length} PDFs: ${files.map(f => f.name).join(', ')}`;
}

async function openPdfImportModal() {
  pendingPdfFiles = [];
  pendingPdfPreview = null;

  // Reset step 1 fields before showing
  const filenameEl = document.getElementById('pdf-import-filename');
  if (filenameEl) filenameEl.textContent = '';
  const processBtn = document.getElementById('btn-pdf-import-process');
  if (processBtn) processBtn.disabled = true;
  const fileInput = document.getElementById('pdf-import-file-input');
  if (fileInput) fileInput.value = '';

  showPdfImportStep1();
  document.getElementById('pdf-import-overlay')?.classList.add('active');

  // Fetch suppliers if not already cached (user may not have visited the Suppliers tab)
  if (!state.suppliers || state.suppliers.length === 0) {
    try {
      state.suppliers = await getSuppliers(true);
    } catch (e) {
      console.error('[Sourcing] Could not load suppliers for PDF modal:', e);
    }
  }

  // Populate supplier dropdown
  const select = document.getElementById('pdf-import-supplier');
  if (select) {
    select.innerHTML = '<option value="">— Auto-detect from PDF —</option>';
    (state.suppliers || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.code})`;
      select.appendChild(opt);
    });
    select.value = '';
  }
}

function closePdfImportModal() {
  closeOpenCombobox();
  // If a parse is in flight, abort it (the fetch stream stops, backend thread ends).
  if (pdfParseAbort) {
    try { pdfParseAbort.abort(); } catch {}
    pdfParseAbort = null;
  }
  _setPdfParsing(false);
  document.getElementById('pdf-import-overlay')?.classList.remove('active');
  pendingPdfFiles = [];
  pendingPdfPreview = null;
  _resetPdfCarousel();
}

function showPdfImportStep1() {
  closeOpenCombobox();
  _resetPdfCarousel();
  document.getElementById('pdf-import-step-1').style.display = '';
  document.getElementById('pdf-import-step-2').style.display = 'none';
  document.getElementById('pdf-import-modal-title').textContent = 'Import PDF Price List';
}

function showPdfImportStep2() {
  document.getElementById('pdf-import-step-1').style.display = 'none';
  document.getElementById('pdf-import-step-2').style.display = '';
}

function setPdfFiles(fileList) {
  const pdfs = _filterPdfFiles(fileList);
  const dropped = Array.from(fileList || []).length;
  if (dropped && !pdfs.length) {
    showToast('Please choose PDF files', 'warning');
    return;
  }
  pendingPdfFiles = pdfs;
  const filenameEl = document.getElementById('pdf-import-filename');
  if (filenameEl) filenameEl.textContent = _describePdfSelection(pdfs);
  const processBtn = document.getElementById('btn-pdf-import-process');
  // Supplier is optional up front (the AI detects it) — enable once files exist.
  if (processBtn) processBtn.disabled = !pdfs.length;
}

function handlePdfFileSelect(e) {
  setPdfFiles(e.target.files);
}

/**
 * Detect the PDF's supplier with the AI and reconcile it against what the user
 * has (or hasn't) selected, BEFORE the main parse. Shared by the matrix and
 * mappings importers. Returns ``{ proceed, supplierId }``:
 *   - proceed=false  → caller must stop (a message/redirect was already shown).
 *   - proceed=true   → parse with the returned supplierId.
 *
 * Behaviour:
 *   • No supplier chosen + detected a KNOWN supplier → auto-select it, continue.
 *   • No supplier chosen + detected an UNKNOWN supplier → offer to create it
 *     (redirect to the Suppliers tab), then stop.
 *   • No supplier chosen + nothing detected → ask the user to pick one, stop.
 *   • Supplier chosen but the AI detects a DIFFERENT known supplier → confirm
 *     switch-or-keep, continue with the chosen answer.
 *   • Otherwise → continue with the user's selection.
 *
 * @param {{ selectedId: number|null, files: File[], signal?: AbortSignal, closeModal?: Function }} opts
 * @returns {Promise<{proceed: boolean, supplierId?: number}>}
 */
async function _reconcilePdfSupplier({ selectedId, files, signal, closeModal }) {
  let detection = null;
  try {
    detection = await identifyPdfSupplier(files, { signal });
  } catch (e) {
    if (e?.name === 'AbortError') return { proceed: false };
    // Detection is advisory — a failure must never block a manual import.
    console.warn('[Sourcing] Supplier detection failed:', e);
  }

  const enabled = !!detection?.enabled;
  const matchedId = detection?.matched_supplier_id || null;
  const matchedName = detection?.matched_supplier_name || null;
  const detectedName = (detection?.detected_name || '').trim();

  // --- No supplier selected yet ---
  if (!selectedId) {
    if (matchedId) {
      showToast(`Detected supplier: ${matchedName}`, 'success');
      return { proceed: true, supplierId: matchedId };
    }
    if (enabled && detectedName) {
      // A supplier was read off the PDF but it isn't one we know — steer the
      // user to create it first, then re-run the import.
      const go = await confirmModal({
        title: 'Supplier not found',
        message: `This looks like a price list from <strong>${escapeHtml(detectedName)}</strong>, `
          + `which isn’t one of your suppliers yet. Create it first, then come back and run the import again.`,
        confirmText: 'Go to Suppliers',
        cancelText: 'Cancel',
        confirmVariant: 'primary',
        icon: 'fas fa-user-plus',
      });
      if (go) {
        closeModal?.();
        showToast(`Create the supplier “${detectedName}”, then re-run the import.`, 'info');
        switchTab('suppliers');
      }
      return { proceed: false };
    }
    // AI disabled or couldn't tell — fall back to a manual choice.
    showToast('Could not detect the supplier — please choose one from the list.', 'warning');
    return { proceed: false };
  }

  // --- A supplier is already selected ---
  if (matchedId && matchedId !== selectedId) {
    const selected = (state.suppliers || []).find(s => s.id === selectedId);
    const keepName = selected ? selected.name : 'your selection';
    const switchIt = await confirmModal({
      title: 'Supplier mismatch',
      message: `The PDF looks like it’s from <strong>${escapeHtml(matchedName)}</strong>, `
        + `but you selected <strong>${escapeHtml(keepName)}</strong>. `
        + `Switch to the detected supplier, or keep your selection?`,
      confirmText: `Switch to ${matchedName}`,
      cancelText: `Keep ${keepName}`,
      confirmVariant: 'warning',
      icon: 'fas fa-exchange-alt',
    });
    return { proceed: true, supplierId: switchIt ? matchedId : selectedId };
  }

  // Selection matches the detection, or detection was inconclusive — trust it.
  return { proceed: true, supplierId: selectedId };
}

async function processPdfImport() {
  if (!pendingPdfFiles.length) {
    showToast('Please choose at least one PDF file', 'warning');
    return;
  }
  const selectedId = parseInt(document.getElementById('pdf-import-supplier')?.value) || null;

  const processBtn = document.getElementById('btn-pdf-import-process');
  const supplierSelect = document.getElementById('pdf-import-supplier');
  const dropZone = document.getElementById('pdf-import-drop-zone');

  _setPdfParsing(true);

  // Allow the parse (and the detection call) to be aborted if the user
  // cancels/closes the modal.
  pdfParseAbort = new AbortController();

  try {
    // --- No supplier chosen up front → auto-detect per file. The user confirms
    // or adjusts each PDF's supplier (or skips it) before anything is parsed;
    // each supplier's files are then imported as their own preview. ---
    if (!selectedId) {
      await _autoDetectAndImport();
      return;
    }

    // --- A supplier was chosen up front → single-supplier import: all files go
    // to that supplier, with a switch/keep confirm if the AI is confident they
    // actually belong to a different known supplier. ---
    _updatePdfProgress(-1, 'Detecting supplier…');
    const recon = await _reconcilePdfSupplier({
      selectedId,
      files: pendingPdfFiles,
      signal: pdfParseAbort.signal,
      closeModal: closePdfImportModal,
    });
    if (!recon.proceed) return; // messaging/redirect already handled
    const supplierId = parseInt(recon.supplierId);
    // A confirm dialog (switch/keep) can drop the modal's active class on
    // confirm — re-assert it so parsing stays visible behind the progress bar.
    document.getElementById('pdf-import-overlay')?.classList.add('active');
    // Reflect the resolved supplier in the dropdown so the UI stays truthful.
    if (supplierSelect && String(supplierSelect.value) !== String(supplierId)) {
      supplierSelect.value = String(supplierId);
    }

    const supplierName = (state.suppliers || []).find(s => s.id === supplierId)?.name || '';
    await _runGroupedImport([{
      supplierId,
      supplierName,
      files: pendingPdfFiles,
      fileNames: pendingPdfFiles.map((f, i) => f.name || `PDF ${i + 1}`),
    }]);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('[Sourcing] Error processing PDF:', error);
    showToast('Failed to parse PDF: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    pdfParseAbort = null;
    _setPdfParsing(false);
    if (supplierSelect) supplierSelect.disabled = false;
    if (dropZone) dropZone.style.pointerEvents = '';
    // Supplier is now optional up front — the AI detects it — so gate on files only.
    if (processBtn) processBtn.disabled = !pendingPdfFiles.length;
  }
}

// ============================================================================
// MULTI-SUPPLIER PDF IMPORT (carousel)
// ============================================================================
// When a multi-file upload is auto-detected to span several suppliers, each
// supplier's files are parsed as their own import and previewed in a sliding
// carousel: chevrons navigate between supplier previews, each preview has its
// own confirm button, and a "Confirm & Import All/Rest" applies the remainder.

/**
 * No-supplier-chosen import: detect each PDF's supplier, let the user confirm or
 * adjust the matches (assign the unmatched ones, correct the wrong ones, skip the
 * ones they don't want), then import each supplier's files as its own preview.
 *
 * Only the confident, unambiguous case skips the confirmation modal: every file
 * maps to the SAME known supplier with nothing unmatched → straight to preview.
 * Anything else — several suppliers, an unmatched file, or nothing detected —
 * opens the assignment modal so the user is always in control (and a wrong AI
 * guess can never silently import against the wrong supplier or break the batch).
 */
async function _autoDetectAndImport() {
  _updatePdfProgress(-1, 'Detecting supplier…');

  // Best-effort per-file detection. A failure (older server / AI off) just means
  // nothing is pre-filled — the user assigns suppliers by hand in the modal.
  let batch = null;
  try {
    batch = await identifyPdfSuppliers(pendingPdfFiles, { signal: pdfParseAbort.signal });
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.warn('[Sourcing] Batch supplier detection unavailable:', e);
  }

  const results = batch?.results || [];
  const rows = pendingPdfFiles.map((f, i) => {
    const r = results.find(x => x.index === i) || {};
    return {
      file: f,
      fileName: r.filename || f.name || `PDF ${i + 1}`,
      detectedName: (r.detected_name || '').trim(),
      matchedSupplierId: r.matched_supplier_id || null,
      matchedSupplierName: r.matched_supplier_name || null,
    };
  });

  const matchedIds = new Set(rows.filter(r => r.matchedSupplierId).map(r => r.matchedSupplierId));
  const allMatchedOne = rows.length > 0 && matchedIds.size === 1 && rows.every(r => r.matchedSupplierId);

  // Confident happy path: every file maps to the same known supplier → import
  // straight away (covers the common single-file / single-supplier upload).
  if (allMatchedOne) {
    const only = rows.find(r => r.matchedSupplierId);
    showToast(`Detected supplier: ${only.matchedSupplierName}`, 'success');
    await _runGroupedImport(_groupRowsBySupplier(
      rows.map(r => ({ ...r, supplierId: r.matchedSupplierId, supplierName: r.matchedSupplierName }))
    ));
    return;
  }

  // Everything else needs a human eye: confirm / correct / assign each file.
  const res = await _promptSupplierAssignments({ rows, suppliers: state.suppliers || [] });
  // The assignment modal takes the import overlay's active class — re-assert it.
  document.getElementById('pdf-import-overlay')?.classList.add('active');

  if (!res || res.action === 'cancel') return; // stay on step 1 so they can retry

  // action === 'continue' — skipped files are already dropped from assignments.
  // (A supplier can be created mid-flow from inside the modal; that new supplier
  // is already reflected here as a normal assignment.)
  if (!res.assignments.length) {
    showToast('No files were assigned to a supplier.', 'warning');
    return;
  }
  await _runGroupedImport(_groupRowsBySupplier(res.assignments));
}

// Fold a flat list of per-file rows ({ file, fileName, supplierId, supplierName })
// into one group per supplier, preserving upload order. Rows without a real
// supplier id are dropped (they were skipped).
function _groupRowsBySupplier(rows) {
  const groups = new Map(); // supplierId → { supplierId, supplierName, files, fileNames }
  for (const r of rows || []) {
    const sid = parseInt(r.supplierId);
    if (!sid) continue;
    if (!groups.has(sid)) {
      groups.set(sid, { supplierId: sid, supplierName: r.supplierName || `Supplier ${sid}`, files: [], fileNames: [] });
    }
    const g = groups.get(sid);
    g.files.push(r.file);
    g.fileNames.push(r.fileName);
  }
  return [...groups.values()];
}

/**
 * Parse each supplier group as its own import and load them into the preview
 * carousel. A single group renders as a plain (chrome-less) preview.
 *
 * Robustness: a group that fails to parse (e.g. a file that isn't actually a
 * price list, or a wrong-supplier guess that produced garbage) is SKIPPED with a
 * warning rather than aborting the whole batch — the other suppliers still
 * preview. Only if every group fails do we surface a hard error.
 *
 * @param {Array<{supplierId:number, supplierName:string, files:File[], fileNames:string[]}>} groups
 */
async function _runGroupedImport(groups) {
  if (!groups || !groups.length) {
    showToast('No files were assigned to a supplier.', 'warning');
    return;
  }

  const productsPromise = _ensureInternalProductsLoaded();
  const sessions = [];
  const failed = []; // { supplierName, error }
  const n = groups.length;

  for (let g = 0; g < n; g++) {
    const grp = groups[g];
    const sid = parseInt(grp.supplierId);
    const base = Math.round((g * 100) / n);
    _updatePdfProgress(base, n > 1 ? `Parsing ${grp.supplierName} (${g + 1} of ${n})…` : 'Parsing…');

    let result;
    try {
      try {
        result = await importMatrixPDFStream(grp.files, sid, {
          signal: pdfParseAbort.signal,
          onProgress: (percent, message) => {
            const scaled = Math.round((g * 100 + Math.max(0, Math.min(100, percent))) / n);
            _updatePdfProgress(scaled, n > 1 ? `${grp.supplierName} (${g + 1}/${n}): ${message}` : message);
          },
        });
      } catch (streamErr) {
        if (streamErr.name === 'AbortError') return; // user cancelled — abort the whole batch
        if (streamErr.fromSse) throw streamErr;       // real parse error — handled below
        console.warn('[Sourcing] PDF streaming failed, falling back:', streamErr);
        result = await importMatrixPDF(grp.files, sid, { signal: pdfParseAbort.signal });
      }
    } catch (parseErr) {
      if (parseErr?.name === 'AbortError') return;
      // One supplier's files couldn't be parsed — skip it, keep the rest going.
      console.error(`[Sourcing] Failed to parse ${grp.supplierName}:`, parseErr);
      failed.push({ supplierName: grp.supplierName, error: parseErr });
      continue;
    }

    sessions.push({
      supplierId: sid,
      fileNames: grp.fileNames,
      preview: result,
      state: _defaultPdfPreviewState(result),
      confirmed: false,
    });
  }
  await productsPromise;

  if (!sessions.length) {
    // Every group failed — surface the error instead of an empty preview.
    const detail = failed[0]?.error?.message ? ` (${failed[0].error.message})` : '';
    showToast(`Couldn’t parse ${failed.map(f => f.supplierName).join(', ') || 'the PDF(s)'}${detail}.`, 'error');
    return;
  }

  if (failed.length) {
    showToast(
      `Skipped ${failed.map(f => f.supplierName).join(', ')} — couldn’t parse ${failed.length === 1 ? 'that file' : 'those files'}.`,
      'warning'
    );
  }

  document.getElementById('pdf-import-overlay')?.classList.add('active');
  pdfMultiState = { sessions, index: 0 };
  _loadPdfSession(0);
  showPdfImportStep2();
}

/**
 * Interactive per-file supplier picker shown before parsing. Each PDF gets a
 * dropdown pre-filled with its detected supplier (or "Skip" when nothing matched)
 * so the user can confirm good matches, fix wrong ones, assign the unmatched, and
 * leave out any file they don't want. Also offers an "Add a supplier" shortcut to
 * the Suppliers tab for PDFs from a supplier that doesn't exist yet.
 *
 * @param {{ rows: Array<{file:File, fileName:string, detectedName:string, matchedSupplierId:number|null, matchedSupplierName:string|null}>, suppliers: Array<{id:number, name:string, code?:string}> }} opts
 * @returns {Promise<{action:'continue', assignments:Array<{file:File, fileName:string, supplierId:number, supplierName:string}>} | {action:'cancel'} | {action:'create'}>}
 */
function _promptSupplierAssignments({ rows, suppliers }) {
  return new Promise((resolve) => {
    const supplierList = suppliers || [];
    const supplierById = new Map(supplierList.map(s => [String(s.id), s]));
    const optionFor = (s, selectedVal) =>
      `<option value="${s.id}"${String(s.id) === selectedVal ? ' selected' : ''}>` +
      `${escapeHtml(s.name)}${s.code ? ` (${escapeHtml(String(s.code))})` : ''}</option>`;

    const rowsHtml = rows.map((r, i) => {
      let detail;
      if (r.matchedSupplierId) {
        detail = `<i class="fas fa-check-circle" style="color:var(--color-success,#16a34a);"></i> Detected: <strong>${escapeHtml(r.matchedSupplierName || '')}</strong>`;
      } else if (r.detectedName) {
        detail = `<i class="fas fa-exclamation-circle" style="color:var(--color-warning,#d97706);"></i> Looks like “${escapeHtml(r.detectedName)}” — not one of your suppliers`;
      } else {
        detail = `<i class="fas fa-question-circle" style="color:var(--color-muted,#6b7280);"></i> No supplier detected — choose one`;
      }
      const selected = r.matchedSupplierId ? String(r.matchedSupplierId) : 'skip';
      const opts = supplierList.map(s => optionFor(s, selected)).join('');
      return `
        <div style="display:flex; gap:0.75rem; align-items:center; padding:0.65rem 0; border-bottom:1px solid var(--color-border,#eef0f2);">
          <div style="flex:1 1 0; min-width:0;">
            <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.fileName)}">
              <i class="fas fa-file-pdf" style="color:var(--color-muted,#9ca3af); margin-right:0.4rem;"></i>${escapeHtml(r.fileName)}
            </div>
            <div style="font-size:0.8rem; color:var(--color-muted,#6b7280); margin-top:0.15rem;">${detail}</div>
          </div>
          <select data-assign-idx="${i}" class="pdf-assign-select"
                  style="flex:0 0 auto; max-width:220px; padding:0.45rem 0.6rem; border:1px solid var(--color-border,#d1d5db); border-radius:8px; background:var(--color-bg,#fff); color:var(--color-text,#111827); font-size:0.85rem;">
            <option value="skip"${selected === 'skip' ? ' selected' : ''}>⊘ Skip this file</option>
            ${opts}
          </select>
        </div>`;
    }).join('');

    const multi = rows.length > 1;
    const title = multi ? 'Confirm suppliers' : 'Confirm supplier';
    const intro = multi
      ? 'We matched a supplier to each PDF. Check them below and fix any that are wrong — each supplier imports as its own preview. Set a file to <strong>Skip</strong> to leave it out, or use <strong>Add a supplier</strong> for one that isn’t in your list yet.'
      : 'Choose the supplier this PDF belongs to. If it isn’t one of your suppliers yet, use <strong>Add a supplier</strong> to create it here.';

    const container = document.createElement('div');
    container.id = 'pdfSupplierAssignContainer';
    container.style.position = 'relative';
    container.style.zIndex = '10001';
    container.innerHTML = `
      <div class="modal-backdrop" id="pdfSupplierAssignBackdrop">
        <div class="modal" style="max-width:560px;">
          <div class="modal-header modal-header-primary">
            <div class="modal-header-icon"><i class="fas fa-layer-group"></i></div>
            <h3 class="modal-title">${title}</h3>
          </div>
          <div class="modal-body">
            <p style="margin:0 0 0.85rem; color:var(--color-text,#374151); font-size:0.9rem;">${intro}</p>
            <div style="max-height:340px; overflow-y:auto;">${rowsHtml}</div>
          </div>
          <div class="modal-footer" style="justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-solid btn-default rounded-lg" id="pdfAssignAddSupplier" style="font-size:0.82rem;">
              <i class="fas fa-user-plus"></i> Add a supplier
            </button>
            <div style="display:flex; gap:0.5rem;">
              <button class="btn btn-solid btn-default rounded-lg" id="pdfAssignCancel">Cancel</button>
              <button class="btn btn-solid btn-primary rounded-lg" id="pdfAssignContinue">Continue</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(container);

    // Hide the import overlay while this sits on top (avoids a double-dimmed
    // backdrop); the caller re-asserts it after we resolve.
    const importOverlay = document.getElementById('pdf-import-overlay');
    importOverlay?.classList.remove('active');

    const backdrop = container.querySelector('#pdfSupplierAssignBackdrop');
    const continueBtn = container.querySelector('#pdfAssignContinue');
    const cancelBtn = container.querySelector('#pdfAssignCancel');
    const addBtn = container.querySelector('#pdfAssignAddSupplier');
    const selects = Array.from(container.querySelectorAll('.pdf-assign-select'));

    const refreshContinue = () => {
      const count = selects.filter(sel => sel.value !== 'skip').length;
      continueBtn.disabled = count === 0;
      continueBtn.style.opacity = count === 0 ? '0.5' : '1';
      continueBtn.style.cursor = count === 0 ? 'not-allowed' : '';
      continueBtn.innerHTML = count > 0
        ? `<i class="fas fa-check"></i> Continue${multi ? ` (${count})` : ''}`
        : 'Continue';
    };

    let done = false;
    const cleanup = () => {
      backdrop.classList.remove('active');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => container.remove(), 200);
    };
    const finish = (value) => { if (done) return; done = true; cleanup(); resolve(value); };
    const onKey = (e) => {
      // Ignore Escape while the Add Supplier modal is open on top of us — it
      // handles its own dismissal; this modal must stay put underneath.
      const supplierModalOpen = document.getElementById('supplier-modal-overlay')?.classList.contains('active');
      if (e.key === 'Escape' && !supplierModalOpen) {
        finish({ action: 'cancel' });
      }
    };

    selects.forEach(sel => sel.addEventListener('change', refreshContinue));
    cancelBtn.addEventListener('click', () => finish({ action: 'cancel' }));
    // Create a supplier without losing the batch: open the SAME Add Supplier
    // modal the Suppliers tab uses (hiding this modal + the import overlay while
    // it's on top), then come straight back here. The new supplier is added to
    // every dropdown and auto-assigned to the first still-skipped (unmatched)
    // file, so the already-matched files are untouched.
    addBtn.addEventListener('click', async () => {
      const importOverlay = document.getElementById('pdf-import-overlay');
      backdrop.classList.remove('active');
      importOverlay?.classList.remove('active');

      let created = null;
      try {
        created = await _createSupplierViaSuppliersModal();
      } finally {
        // Always bring the PDF assignment view back, saved or cancelled.
        importOverlay?.classList.add('active');
        backdrop.classList.add('active');
      }
      if (!created) return; // cancelled — nothing changed, matches preserved

      supplierList.push(created);
      supplierById.set(String(created.id), created);
      const label = `${created.name}${created.code ? ` (${created.code})` : ''}`;
      selects.forEach(sel => {
        const opt = document.createElement('option');
        opt.value = String(created.id);
        opt.textContent = label; // textContent — no manual escaping needed
        sel.appendChild(opt);
      });
      // Assign it to the first unmatched file (or the only file, single-PDF case).
      const target = selects.find(sel => sel.value === 'skip') || selects[0];
      if (target) target.value = String(created.id);
      refreshContinue();
    });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish({ action: 'cancel' }); });
    continueBtn.addEventListener('click', () => {
      if (continueBtn.disabled) return;
      const assignments = [];
      selects.forEach((sel, i) => {
        if (sel.value === 'skip') return;
        const s = supplierById.get(String(sel.value));
        assignments.push({
          file: rows[i].file,
          fileName: rows[i].fileName,
          supplierId: parseInt(sel.value),
          supplierName: s ? s.name : `Supplier ${sel.value}`,
        });
      });
      finish({ action: 'continue', assignments });
    });
    document.addEventListener('keydown', onKey);

    refreshContinue();
    requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('active')));
  });
}

// The interaction state renderPdfPreview() resets to: nothing resolved, all
// changed rows included, all unchanged rows pre-selected.
function _defaultPdfPreviewState(preview) {
  const included = new Set();
  (preview?.preview || []).forEach((item, idx) => {
    if (!item.has_change) included.add(idx);
  });
  return {
    conflictResolutions: new Map(),
    unmatchedResolutions: new Map(),
    unmatchedMappingType: new Map(),
    excludedRows: new Set(),
    includedNoChangeRows: included,
  };
}

// Snapshot the live (module-level) preview interaction state so a carousel
// session can be left and returned to without losing the user's choices.
function _capturePdfPreviewState() {
  return {
    conflictResolutions: new Map(conflictResolutions),
    unmatchedResolutions: new Map(unmatchedResolutions),
    unmatchedMappingType: new Map(unmatchedMappingType),
    excludedRows: new Set(pdfExcludedRows),
    includedNoChangeRows: new Set(pdfIncludedNoChangeRows),
  };
}

function _restorePdfPreviewState(st) {
  conflictResolutions.clear();
  st.conflictResolutions.forEach((v, k) => conflictResolutions.set(k, v));
  unmatchedResolutions.clear();
  st.unmatchedResolutions.forEach((v, k) => unmatchedResolutions.set(k, v));
  unmatchedMappingType.clear();
  st.unmatchedMappingType.forEach((v, k) => unmatchedMappingType.set(k, v));
  pdfExcludedRows.clear();
  st.excludedRows.forEach(v => pdfExcludedRows.add(v));
  pdfIncludedNoChangeRows.clear();
  st.includedNoChangeRows.forEach(v => pdfIncludedNoChangeRows.add(v));
}

// Re-check conflict radios / re-mark resolved cards after a re-render (the
// conflict cards are only painted by renderPdfPreview, which resets them).
function _reapplyConflictUi() {
  const conflicts = pendingPdfPreview?.conflicts || [];
  conflicts.forEach((c, idx) => {
    const chosen = conflictResolutions.get(_conflictKey(idx));
    if (chosen == null) return;
    const radio = document.querySelector(
      `input[name="conflict-${idx}"][value="${CSS.escape(String(chosen))}"]`
    );
    if (radio) radio.checked = true;
    const card = document.getElementById(`conflict-card-${idx}`);
    if (card) {
      card.style.borderColor = 'var(--color-success,#16a34a)';
      card.style.background = 'var(--color-success-bg,#f0fdf4)';
    }
  });
  _updateConflictsRemaining(conflicts.length);
}

// Make session i the active preview: render it and restore its saved choices.
function _loadPdfSession(i) {
  const session = pdfMultiState?.sessions?.[i];
  if (!session) return;
  pdfMultiState.index = i;
  pendingPdfPreview = session.preview;
  renderPdfPreview(session.preview); // resets interaction state to defaults
  _restorePdfPreviewState(session.state);
  _reapplyConflictUi();
  renderPdfMatched();
  renderPdfUnmatched();
  const n = pdfMultiState.sessions.length;
  document.getElementById('pdf-import-modal-title').textContent =
    `PDF Preview — ${session.preview.supplier_name}${n > 1 ? ` (${i + 1} of ${n})` : ''}`;
  _updatePdfCarouselChrome();
  _updateConfirmButton();
}

// Slide the preview left/right to another supplier session (delta can be ±1
// from the chevrons or a bigger jump from the indicator dots).
function pdfCarouselGo(delta) {
  if (!pdfMultiState || pdfSlideBusy || !delta) return;
  const next = pdfMultiState.index + delta;
  if (next < 0 || next >= pdfMultiState.sessions.length) return;

  // Save the active preview's choices before leaving it.
  pdfMultiState.sessions[pdfMultiState.index].state = _capturePdfPreviewState();
  closeOpenCombobox();

  const body = document.getElementById('pdf-import-step-2-body');
  if (!body) { _loadPdfSession(next); return; }

  pdfSlideBusy = true;
  const dir = delta > 0 ? 1 : -1; // 1 = moving to the next (slide left)
  body.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
  body.style.transform = `translateX(${-dir * 48}px)`;
  body.style.opacity = '0';
  setTimeout(() => {
    _loadPdfSession(next);
    // Enter from the opposite side for a continuous sliding feel.
    body.style.transition = 'none';
    body.style.transform = `translateX(${dir * 48}px)`;
    void body.offsetWidth; // force reflow so the next transition animates
    body.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
    body.style.transform = 'translateX(0)';
    body.style.opacity = '1';
    setTimeout(() => {
      body.style.transition = '';
      pdfSlideBusy = false;
    }, 240);
  }, 220);
}

// Show/refresh the carousel chrome: chevrons, position indicator dots, and the
// "Confirm & Import All/Rest" button. Hidden entirely in single-supplier mode.
function _updatePdfCarouselChrome() {
  const prevBtn = document.getElementById('pdf-carousel-prev');
  const nextBtn = document.getElementById('pdf-carousel-next');
  const indicator = document.getElementById('pdf-carousel-indicator');
  const importAllBtn = document.getElementById('btn-pdf-preview-confirm-all');

  const sessions = pdfMultiState?.sessions || [];
  const multi = sessions.length > 1;
  if (prevBtn) prevBtn.style.display = multi ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = multi ? 'inline-flex' : 'none';
  if (indicator) indicator.style.display = multi ? '' : 'none';

  if (!pdfMultiState || !multi) {
    if (importAllBtn) importAllBtn.style.display = 'none';
    return;
  }

  const index = pdfMultiState.index;
  if (prevBtn) {
    prevBtn.disabled = index === 0;
    prevBtn.style.opacity = index === 0 ? '0.35' : '1';
  }
  if (nextBtn) {
    nextBtn.disabled = index === sessions.length - 1;
    nextBtn.style.opacity = index === sessions.length - 1 ? '0.35' : '1';
  }

  if (indicator) {
    const dots = sessions.map((s, i) => {
      const bg = i === index
        ? 'var(--color-success,#16a34a)'
        : (s.confirmed ? '#86efac' : 'var(--color-border,#d1d5db)');
      const title = `${s.preview.supplier_name}${s.confirmed ? ' — imported' : ''}`;
      return `<span title="${escapeHtml(title)}" onclick="window.sourcingModule.pdfCarouselTo(${i})"
        style="width:9px; height:9px; border-radius:50%; display:inline-block; cursor:pointer;
               background:${bg}; transition:background 0.2s ease;"></span>`;
    }).join('');
    const confirmedCount = sessions.filter(s => s.confirmed).length;
    indicator.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; gap:0.6rem;">
        <span style="display:inline-flex; align-items:center; gap:5px;">${dots}</span>
        <span style="font-size:0.78rem; color:var(--color-muted,#6b7280);">
          Supplier ${index + 1} of ${sessions.length}${confirmedCount ? ` · ${confirmedCount} imported` : ''}
        </span>
      </div>`;
  }

  if (importAllBtn) {
    const remaining = sessions.filter(s => !s.confirmed).length;
    const anyConfirmed = sessions.some(s => s.confirmed);
    importAllBtn.style.display = remaining > 0 ? '' : 'none';
    importAllBtn.innerHTML = anyConfirmed
      ? `<i class="fas fa-check-double"></i> Confirm &amp; Import Rest (${remaining})`
      : `<i class="fas fa-check-double"></i> Confirm &amp; Import All (${remaining})`;
  }
}

function _resetPdfCarousel() {
  pdfMultiState = null;
  pdfSlideBusy = false;
  const body = document.getElementById('pdf-import-step-2-body');
  if (body) {
    body.style.transition = '';
    body.style.transform = '';
    body.style.opacity = '';
  }
  _updatePdfCarouselChrome();
}

// Toggle the parsing UI: disable Process button (prevent double-click), lock
// inputs, and show/hide the progress bar.
function _setPdfParsing(isParsing) {
  const processBtn = document.getElementById('btn-pdf-import-process');
  const supplierSelect = document.getElementById('pdf-import-supplier');
  const dropZone = document.getElementById('pdf-import-drop-zone');
  const progress = document.getElementById('pdf-import-progress');

  if (processBtn) {
    processBtn.disabled = isParsing;
    processBtn.innerHTML = isParsing
      ? '<i class="fas fa-spinner fa-spin"></i> Parsing…'
      : '<i class="fas fa-cog"></i> Process PDF';
  }
  if (supplierSelect) supplierSelect.disabled = isParsing;
  if (dropZone) dropZone.style.pointerEvents = isParsing ? 'none' : '';
  if (progress) progress.style.display = isParsing ? '' : 'none';
  if (isParsing) _updatePdfProgress(0, 'Starting…');
}

function _updatePdfProgress(percent, message) {
  const bar = document.getElementById('pdf-import-progress-bar');
  const pct = document.getElementById('pdf-import-progress-pct');
  const label = document.getElementById('pdf-import-progress-label');
  if (label && message) label.textContent = message;
  if (percent < 0) {
    // Indeterminate — keep the bar moving subtly.
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '…';
    return;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  if (bar) bar.style.width = `${clamped}%`;
  if (pct) pct.textContent = `${clamped}%`;
}

// Small badge describing which IDP extraction tier produced the preview.
// Deterministic = no AI used; the AI tiers are highlighted so the operator
// knows when to give the matched/unmatched lists a closer look.
function _extractionMethodBadge(result) {
  const method = result.extraction_method || 'deterministic';
  if (method === 'deterministic') return '';
  const label = method === 'ai_layout'
    ? 'AI layout assist'
    : (method === 'ai_direct' ? 'AI extraction' : method);
  return `
    <div style="text-align:center; min-width:120px; margin-left:auto;">
      <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px;
                  border-radius:999px; background:#eef2ff; color:#4338ca;
                  font-size:0.8rem; font-weight:600;">
        <span aria-hidden="true">✨</span> ${label}
      </div>
      <div style="font-size:0.72rem; color:var(--color-muted,#6b7280); margin-top:4px;">
        Parsed with AI — please verify
      </div>
    </div>`;
}

function renderPdfPreview(result) {
  conflictResolutions.clear();
  unmatchedResolutions.clear();
  unmatchedMappingType.clear();
  pdfExcludedRows.clear();
  pdfIncludedNoChangeRows.clear();
  // Pre-select all unchanged rows so everything is included by default.
  (result.preview || []).forEach((item, idx) => {
    if (!item.has_change) pdfIncludedNoChangeRows.add(idx);
  });
  pdfMatchedView = { page: 1, query: '', sortBy: null, sortOrder: 'asc', changesOnly: false };
  pdfUnmatchedView = { page: 1, query: '' };
  const matchedSearch = document.getElementById('pdf-import-changes-search');
  if (matchedSearch) matchedSearch.value = '';
  const unmatchedSearch = document.getElementById('pdf-import-unmatched-search');
  if (unmatchedSearch) unmatchedSearch.value = '';
  const changesOnly = document.getElementById('pdf-import-changes-only');
  if (changesOnly) changesOnly.checked = false;
  const selectAll = document.getElementById('pdf-import-select-all');
  if (selectAll) { selectAll.checked = true; selectAll.indeterminate = false; }

  // Summary stats
  const summaryEl = document.getElementById('pdf-import-summary');
  if (summaryEl) {
    const conflictCount = result.total_conflicts || 0;
    summaryEl.innerHTML = `
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-text,#111);">${result.total_found}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Found</div>
      </div>
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-success,#16a34a);">${result.total_matched}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Matched</div>
      </div>
      ${conflictCount > 0 ? `
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-warning,#d97706);">${conflictCount}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Conflicts</div>
      </div>` : ''}
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-danger,#dc2626);">${result.total_unmatched}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Unmatched</div>
      </div>
      ${(result.total_skipped || 0) > 0 ? `
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-muted,#6b7280);">${result.total_skipped}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Skipped</div>
      </div>` : ''}
      ${_extractionMethodBadge(result)}
    `;
  }

  // Conflicts section
  const conflictsSection = document.getElementById('pdf-import-conflicts-section');
  const conflictsBody = document.getElementById('pdf-import-conflicts-body');
  if (conflictsSection && result.conflicts?.length > 0) {
    conflictsSection.style.display = '';
    _updateConflictsRemaining(result.conflicts.length);

    conflictsBody.innerHTML = result.conflicts.map((c, idx) => {
      const key = `conflict-${idx}`;

      // Price-choice conflict: same product seen multiple times with different prices.
      if (c.kind === 'price') {
        const curSym = c.current_currency ? (CURRENCY_SYMBOLS[c.current_currency] || c.current_currency) : '';
        const currentDisplay = c.current_price != null
          ? `${curSym}${parseFloat(c.current_price).toFixed(2)}`
          : '—';
        const options = (c.price_options || []).map((opt, oi) => {
          const osym = opt.currency ? (CURRENCY_SYMBOLS[opt.currency] || opt.currency) : '';
          const dateLabel = opt.date ? formatPdfDate(opt.date) : 'N/A';
          return `
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem;">
              <input type="radio" name="${key}" value="${oi}" data-conflict="${idx}" style="flex-shrink:0;" onchange="window.sourcingModule.resolveConflict(${idx}, '${oi}')">
              <span><strong>${osym}${parseFloat(opt.price).toFixed(2)}</strong> <span style="color:var(--color-muted,#6b7280); font-size:0.8rem;">${escapeHtml(dateLabel)}</span></span>
            </label>`;
        }).join('');
        return `
          <div id="conflict-card-${idx}" style="border:1px solid var(--color-warning,#d97706); border-radius:6px; padding:0.75rem; background:var(--color-warning-bg,#fffbeb);">
            <div style="font-size:0.82rem; color:var(--color-muted,#6b7280); margin-bottom:0.4rem;">
              Same product appears multiple times with different prices — choose which to apply.<br>
              <strong>SKU:</strong> ${escapeHtml(c.sku || '')} &nbsp;|&nbsp; <strong>${escapeHtml(c.product_name || c.identifier || '')}</strong> &nbsp;|&nbsp; <strong>Current:</strong> ${currentDisplay}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:0.75rem;">${options}</div>
          </div>`;
      }

      // SKU-choice conflict (default): ref and name matched different products.
      const sym = c.currency ? (CURRENCY_SYMBOLS[c.currency] || c.currency) : '';
      const priceDisplay = `${sym}${parseFloat(c.price).toFixed(2)}`;
      return `
        <div id="conflict-card-${idx}" style="border:1px solid var(--color-warning,#d97706); border-radius:6px; padding:0.75rem; background:var(--color-warning-bg,#fffbeb);">
          <div style="font-size:0.82rem; color:var(--color-muted,#6b7280); margin-bottom:0.4rem;">
            <strong>Ref:</strong> ${escapeHtml(c.ref)} &nbsp;|&nbsp; <strong>Description:</strong> ${escapeHtml(c.identifier)} &nbsp;|&nbsp; <strong>Price:</strong> ${priceDisplay}
          </div>
          <div style="display:flex; flex-direction:column; gap:0.35rem;">
            <label style="display:flex; align-items:flex-start; gap:0.5rem; cursor:pointer; font-size:0.875rem;">
              <input type="radio" name="${key}" value="${escapeHtml(c.sku_from_ref)}" data-conflict="${idx}" style="margin-top:3px; flex-shrink:0;" onchange="window.sourcingModule.resolveConflict(${idx}, '${escapeHtml(c.sku_from_ref)}')">
              <span>
                <strong style="font-family:monospace;">${escapeHtml(c.sku_from_ref)}</strong>
                <span style="color:var(--color-muted,#6b7280);"> — ${escapeHtml(c.product_name_from_ref || c.sku_from_ref)}</span>
                <span style="font-size:0.78rem; color:var(--color-muted,#9ca3af); margin-left:0.25rem;">(matched via reference code)</span>
              </span>
            </label>
            <label style="display:flex; align-items:flex-start; gap:0.5rem; cursor:pointer; font-size:0.875rem;">
              <input type="radio" name="${key}" value="${escapeHtml(c.sku_from_name)}" data-conflict="${idx}" style="margin-top:3px; flex-shrink:0;" onchange="window.sourcingModule.resolveConflict(${idx}, '${escapeHtml(c.sku_from_name)}')">
              <span>
                <strong style="font-family:monospace;">${escapeHtml(c.sku_from_name)}</strong>
                <span style="color:var(--color-muted,#6b7280);"> — ${escapeHtml(c.product_name_from_name || c.sku_from_name)}</span>
                <span style="font-size:0.78rem; color:var(--color-muted,#9ca3af); margin-left:0.25rem;">(matched via product name)</span>
              </span>
            </label>
          </div>
        </div>`;
    }).join('');
  } else if (conflictsSection) {
    conflictsSection.style.display = 'none';
  }

  // Skipped lines — read from the PDF but dropped before matching (totals,
  // headers, noise). Listed so the visible buckets reconcile to Found and the
  // user can audit what was discarded. Collapsed by default (informational).
  const skippedSection = document.getElementById('pdf-import-skipped-section');
  const skippedBody = document.getElementById('pdf-import-skipped-body');
  if (skippedSection && skippedBody && result.skipped?.length > 0) {
    skippedSection.style.display = '';
    const countEl = document.getElementById('pdf-import-skipped-count');
    if (countEl) countEl.textContent = result.skipped.length;
    skippedBody.innerHTML = result.skipped.map((s) => {
      const sym = s.currency ? (CURRENCY_SYMBOLS[s.currency] || s.currency) : '';
      const priceDisplay = s.price != null ? `${sym}${parseFloat(s.price).toFixed(2)}` : '—';
      return `
        <tr>
          <td>${escapeHtml(s.raw_text || '')}</td>
          <td>${priceDisplay}</td>
          <td style="color:var(--color-muted,#6b7280);">${escapeHtml(s.reason || '')}</td>
        </tr>`;
    }).join('');
  } else if (skippedSection) {
    skippedSection.style.display = 'none';
    if (skippedBody) skippedBody.innerHTML = '';
  }

  // Matched changes + unmatched are rendered via dedicated paginated/searchable
  // helpers so large invoices (100+ rows) stay navigable.
  renderPdfMatched();
  renderPdfUnmatched();

  _updateConfirmButton();
}

// Client-side view state for the preview tables (search + pagination + sort).
const PDF_PAGE_SIZE = 50;
let pdfMatchedView = { page: 1, query: '', sortBy: null, sortOrder: 'asc', changesOnly: true };
let pdfUnmatchedView = { page: 1, query: '' };
// Map of unmatched item index → { sku, name } chosen by the user.
const unmatchedResolutions = new Map();
// Map of unmatched item index → mapping type 'both' | 'sku' | 'name'.
const unmatchedMappingType = new Map();
// Set of matched preview indices the user has EXCLUDED (default empty = all
// included). Tracking only exclusions keeps this tiny even for huge invoices.
const pdfExcludedRows = new Set();
// Set of unchanged matched rows explicitly opted-in by the user (default unchecked).
const pdfIncludedNoChangeRows = new Set();
// Thresholds for the "suspicious change" flag.
const PDF_SUSPICIOUS_PCT = 50;       // > ±50% price move
const PDF_SUSPICIOUS_ABS = 100;      // or an absolute jump >= 100 in row currency

// AbortController for an in-flight streaming parse (so closing/cancelling stops it).
let pdfParseAbort = null;

// Multi-supplier carousel state — null in normal single-supplier mode. When a
// multi-file upload spans several suppliers, each supplier gets a "session":
// its own parsed preview plus the user's per-preview choices, captured whenever
// the user slides away so nothing is lost while navigating.
//   { sessions: [{ supplierId, fileNames, preview, state, confirmed }], index }
let pdfMultiState = null;
// Guards against double-clicks while the slide animation is running.
let pdfSlideBusy = false;

function _pdfDefaultMappingType(u) {
  // Default to mapping by NAME only when a product name is present; fall back to
  // SKU when the line has only a reference code.
  if (u.identifier) return 'name';
  return u.ref ? 'sku' : 'name';
}

// Render both the supplier SKU (ref) and product name (identifier) from a PDF
// line so the user can see exactly which product they're mapping. Shared by the
// supplier-matrix and product-mapping importers for UI consistency.
function _pdfLineIdentityHtml(u) {
  const parts = [];
  if (u.identifier) {
    parts.push(`<div><span style="color:var(--color-muted,#9ca3af);">Name:</span> ${escapeHtml(u.identifier)}</div>`);
  }
  if (u.ref) {
    parts.push(`<div style="font-family:monospace; font-size:0.78rem; margin-top:0.15rem;"><span style="color:var(--color-muted,#9ca3af); font-family:var(--font-sans,sans-serif);">SKU:</span> ${escapeHtml(u.ref)}</div>`);
  }
  if (parts.length === 0) parts.push(escapeHtml(u.raw_text || ''));
  return parts.join('');
}

function _pdfIsSuspicious(item) {
  if (item.current_price == null) return false; // brand-new price isn't "suspicious"
  const cur = parseFloat(item.current_price);
  const next = parseFloat(item.new_price);
  if (!(cur > 0)) return false;
  const pct = Math.abs((next - cur) / cur) * 100;
  const abs = Math.abs(next - cur);
  return pct > PDF_SUSPICIOUS_PCT || abs >= PDF_SUSPICIOUS_ABS;
}

function _pdfCurrencyMismatch(item) {
  const expected = item.current_currency || pendingPdfPreview?.supplier_default_currency;
  return !!(item.new_currency && expected && item.new_currency !== expected);
}

async function _ensureInternalProductsLoaded() {
  if (cachedInternalProducts && cachedInternalProducts.length > 0) return;
  try {
    const data = await getAnalysisDashboard({ page: 1, perPage: 100000 });
    cachedInternalProducts = (data.products || []).map(p => ({
      sku: p.sku,
      name: p.product_name || p.sku,
    }));
  } catch (e) {
    console.error('[Sourcing] Could not preload products for PDF matching:', e);
  }
}

// Enhance the per-row "Search SKU or name" inputs with the nui-styled searchable
// combobox (ui/combobox.js). Rows re-render on search/pagination/selection, so this
// is called after each render; detached instances are pruned automatically.
function _enhancePdfProductPickers(rootId, inputClass) {
  pruneDetachedComboboxes();
  const root = document.getElementById(rootId);
  if (!root) return;
  const products = cachedInternalProducts || [];
  root.querySelectorAll(`.${inputClass}`).forEach(input => {
    initCombobox(input, {
      items: products,
      getLabel: (p) => `[${p.sku}] ${p.name}`,
      filter: (p, q) =>
        (p.sku && String(p.sku).toLowerCase().includes(q)) ||
        (p.name && String(p.name).toLowerCase().includes(q)),
      max: 50,
    });
  });
}

function _paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PDF_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PDF_PAGE_SIZE;
  return { slice: items.slice(start, start + PDF_PAGE_SIZE), page: safePage, totalPages, start, total: items.length };
}

function _renderPdfPagination(containerId, info, navFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (info.total <= PDF_PAGE_SIZE) { el.innerHTML = ''; return; }
  const from = info.start + 1;
  const to = Math.min(info.start + PDF_PAGE_SIZE, info.total);
  el.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.5rem 0.25rem; font-size:0.8rem;">
      <span style="color:var(--color-muted,#6b7280);">Showing <strong>${from}-${to}</strong> of <strong>${info.total}</strong></span>
      <span style="display:flex; align-items:center; gap:0.5rem;">
        <button class="btn btn-ghost btn-sm" ${info.page <= 1 ? 'disabled' : ''} onclick="window.sourcingModule.${navFn}(${info.page - 1})"><i class="fas fa-chevron-left"></i></button>
        <span>Page ${info.page} / ${info.totalPages}</span>
        <button class="btn btn-ghost btn-sm" ${info.page >= info.totalPages ? 'disabled' : ''} onclick="window.sourcingModule.${navFn}(${info.page + 1})"><i class="fas fa-chevron-right"></i></button>
      </span>
    </div>`;
}

// Returns [{ item, idx }] after search + changes-only filter + sort, where idx is
// the stable index into pendingPdfPreview.preview (used for include/exclude).
function _filteredMatched() {
  const all = pendingPdfPreview?.preview || [];
  let rows = all.map((item, idx) => ({ item, idx }));

  const q = pdfMatchedView.query.trim().toLowerCase();
  if (q) {
    rows = rows.filter(({ item }) =>
      (item.supplier_product_name || '').toLowerCase().includes(q) ||
      (item.sku || '').toLowerCase().includes(q));
  }

  if (pdfMatchedView.changesOnly) {
    rows = rows.filter(({ item }) => item.has_change);
  }

  const sb = pdfMatchedView.sortBy;
  if (sb) {
    const dir = pdfMatchedView.sortOrder === 'desc' ? -1 : 1;
    const isNew = ({ item }) => item.current_price == null || !(parseFloat(item.current_price) > 0);
    const val = ({ item }) => {
      switch (sb) {
        case 'description': return (item.supplier_product_name || '').toLowerCase();
        case 'sku': return (item.sku || '').toLowerCase();
        case 'current': return item.current_price == null ? -Infinity : parseFloat(item.current_price);
        case 'new': return parseFloat(item.new_price);
        case 'change':
          return ((parseFloat(item.new_price) - parseFloat(item.current_price)) / parseFloat(item.current_price)) * 100;
        default: return 0;
      }
    };
    rows.sort((a, b) => {
      // For "change", rows with no current price ("New") always sort last,
      // regardless of asc/desc, since a % change is undefined for them.
      if (sb === 'change') {
        const an = isNew(a), bn = isNew(b);
        if (an || bn) return an && bn ? 0 : (an ? 1 : -1);
      }
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  return rows;
}

function _updateMatchedHeaderSortIcons() {
  document.querySelectorAll('#pdf-import-changes-table th.pdf-sortable').forEach(th => {
    let icon = th.querySelector('.sort-icon');
    if (!icon) {
      icon = document.createElement('i');
      icon.className = 'fas fa-sort sort-icon';
      icon.style.marginLeft = '0.4rem';
      icon.style.fontSize = '0.7rem';
      icon.style.opacity = '0.5';
      th.appendChild(icon);
    }
    if (th.dataset.pdfSort === pdfMatchedView.sortBy) {
      icon.className = `fas fa-sort-${pdfMatchedView.sortOrder === 'asc' ? 'up' : 'down'} sort-icon`;
      icon.style.opacity = '1';
    } else {
      icon.className = 'fas fa-sort sort-icon';
      icon.style.opacity = '0.5';
    }
  });
}

function _matchedChangedIndices() {
  const all = pendingPdfPreview?.preview || [];
  const out = [];
  all.forEach((item, idx) => { if (item.has_change) out.push(idx); });
  return out;
}

function _isRowSelected(idx, item) {
  return item.has_change ? !pdfExcludedRows.has(idx) : pdfIncludedNoChangeRows.has(idx);
}

function _updateMatchedSelectionInfo() {
  const visible = _filteredMatched();
  const totalVisible = visible.length;
  const selectedVisible = visible.filter(({ item, idx }) => _isRowSelected(idx, item)).length;

  const info = document.getElementById('pdf-import-selection-info');
  if (info) {
    info.innerHTML = `<strong style="color:var(--color-text,#111);">${selectedVisible}</strong> of ${totalVisible} selected`;
  }

  const selectAll = document.getElementById('pdf-import-select-all');
  if (selectAll) {
    selectAll.checked = totalVisible > 0 && selectedVisible === totalVisible;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < totalVisible;
  }
}

function renderPdfMatched() {
  const tbody = document.getElementById('pdf-import-changes-body');
  if (!tbody) return;
  const rows = _filteredMatched();
  _updateMatchedHeaderSortIcons();

  if (rows.length === 0) {
    const totalPreview = (pendingPdfPreview?.preview || []).length;
    const msg = totalPreview === 0
      ? 'No matched items found.'
      : (pdfMatchedView.changesOnly ? 'No price changes. Untick “Changes only” to show all matched items.' : 'No matches for your search.');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-muted,#6b7280); padding:1rem;">${msg}</td></tr>`;
    _renderPdfPagination('pdf-import-changes-pagination', { total: 0 }, 'pdfMatchedPage');
    _updateMatchedSelectionInfo();
    return;
  }

  const info = _paginate(rows, pdfMatchedView.page);
  pdfMatchedView.page = info.page;
  tbody.innerHTML = info.slice.map(({ item, idx }) => {
    const currSym = item.current_currency ? (CURRENCY_SYMBOLS[item.current_currency] || item.current_currency) : '';
    const newSym = item.new_currency ? (CURRENCY_SYMBOLS[item.new_currency] || item.new_currency) : '';
    const currentDisplay = item.current_price != null
      ? `${currSym}${parseFloat(item.current_price).toFixed(2)}`
      : '<span style="color:var(--color-muted,#9ca3af);">—</span>';
    const newDisplay = `${newSym}${parseFloat(item.new_price).toFixed(2)}`;

    let changeDisplay = '';
    if (item.current_price != null) {
      const diff = parseFloat(item.new_price) - parseFloat(item.current_price);
      const pct = parseFloat(item.current_price) > 0 ? (diff / parseFloat(item.current_price)) * 100 : 0;
      const sign = diff >= 0 ? '+' : '';
      const color = diff > 0 ? 'var(--color-danger,#dc2626)' : diff < 0 ? 'var(--color-success,#16a34a)' : 'var(--color-muted,#6b7280)';
      changeDisplay = `<span style="color:${color}; font-weight:600;">${sign}${pct.toFixed(1)}%</span>`;
    } else {
      changeDisplay = '<span style="color:var(--color-muted,#9ca3af);">New</span>';
    }

    const suspicious = _pdfIsSuspicious(item);
    const curMismatch = _pdfCurrencyMismatch(item);
    const flags = [];
    if (suspicious) flags.push('<i class="fas fa-exclamation-triangle" style="color:var(--color-warning,#d97706);" title="Large change — please double-check"></i>');
    if (curMismatch) flags.push(`<i class="fas fa-coins" style="color:var(--color-danger,#dc2626);" title="Currency differs from current/default (${escapeHtml(item.new_currency || '')})"></i>`);
    const flagsHtml = flags.length ? ` <span style="margin-left:0.25rem;">${flags.join(' ')}</span>` : '';

    const deselected = item.has_change ? pdfExcludedRows.has(idx) : !pdfIncludedNoChangeRows.has(idx);
    const rowStyle = [
      deselected ? 'opacity:0.45;' : '',
      suspicious ? 'background:var(--color-warning-bg,#fffbeb);' : '',
    ].join('');

    const checkboxCell = item.has_change
      ? `<input type="checkbox" class="pdf-matched-check" data-matched-idx="${idx}" data-has-change="true" ${deselected ? '' : 'checked'}>`
      : `<input type="checkbox" class="pdf-matched-check" data-matched-idx="${idx}" data-has-change="false" ${pdfIncludedNoChangeRows.has(idx) ? 'checked' : ''}>`;

    return `<tr data-matched-idx="${idx}" style="${rowStyle}">
      <td style="text-align:center;">${checkboxCell}</td>
      <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.supplier_product_name)}">${escapeHtml(item.supplier_product_name)}${flagsHtml}</td>
      <td style="font-family:monospace;">${escapeHtml(item.sku)}</td>
      <td>${currentDisplay}</td>
      <td style="font-weight:600;">${newDisplay}</td>
      <td>${changeDisplay}</td>
    </tr>`;
  }).join('');

  _renderPdfPagination('pdf-import-changes-pagination', info, 'pdfMatchedPage');
  _updateMatchedSelectionInfo();
}

function togglePdfMatchedSort(sortBy) {
  if (pdfMatchedView.sortBy === sortBy) {
    pdfMatchedView.sortOrder = pdfMatchedView.sortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    pdfMatchedView.sortBy = sortBy;
    pdfMatchedView.sortOrder = 'asc';
  }
  pdfMatchedView.page = 1;
  renderPdfMatched();
}

function setPdfMatchedExcluded(idx, excluded) {
  if (excluded) pdfExcludedRows.add(idx);
  else pdfExcludedRows.delete(idx);
  // Reflect row dimming + selection info without a full re-render.
  const tr = document.querySelector(`#pdf-import-changes-body tr[data-matched-idx="${idx}"]`);
  if (tr) tr.style.opacity = excluded ? '0.45' : '';
  _updateMatchedSelectionInfo();
  _updateConfirmButton();
}

function setPdfNoChangeIncluded(idx, included) {
  if (included) pdfIncludedNoChangeRows.add(idx);
  else pdfIncludedNoChangeRows.delete(idx);
  const tr = document.querySelector(`#pdf-import-changes-body tr[data-matched-idx="${idx}"]`);
  if (tr) tr.style.opacity = included ? '' : '0.45';
  _updateMatchedSelectionInfo();
  _updateConfirmButton();
}

function setPdfAllExcluded(excluded) {
  // Operate only on currently visible (filtered) rows so the action matches what
  // the user sees — hidden rows (via search or changesOnly) keep their prior state.
  _filteredMatched().forEach(({ item, idx }) => {
    if (item.has_change) {
      if (excluded) pdfExcludedRows.add(idx);
      else pdfExcludedRows.delete(idx);
    } else {
      if (excluded) pdfIncludedNoChangeRows.delete(idx);
      else pdfIncludedNoChangeRows.add(idx);
    }
  });
  renderPdfMatched();
  _updateConfirmButton();
}

function _filteredUnmatchedIndices() {
  const q = pdfUnmatchedView.query.trim().toLowerCase();
  const items = pendingPdfPreview?.unmatched || [];
  const idxs = items.map((_, i) => i);
  if (!q) return idxs;
  return idxs.filter(i => {
    const u = items[i];
    return (u.raw_text || '').toLowerCase().includes(q) ||
      String(u.price).includes(q);
  });
}

function renderPdfUnmatched() {
  const section = document.getElementById('pdf-import-unmatched-section');
  const countEl = document.getElementById('pdf-import-unmatched-count');
  const tbody = document.getElementById('pdf-import-unmatched-body');
  const all = pendingPdfPreview?.unmatched || [];
  if (!section || !tbody) return;

  if (all.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  if (countEl) countEl.textContent = all.length;

  const idxs = _filteredUnmatchedIndices();
  if (idxs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--color-muted,#6b7280); padding:1rem;">No matches for your search.</td></tr>';
    _renderPdfPagination('pdf-import-unmatched-pagination', { total: 0 }, 'pdfUnmatchedPage');
    return;
  }

  const info = _paginate(idxs, pdfUnmatchedView.page);
  pdfUnmatchedView.page = info.page;
  tbody.innerHTML = info.slice.map(i => {
    const u = all[i];
    const sym = u.currency ? (CURRENCY_SYMBOLS[u.currency] || u.currency) : '';
    const chosen = unmatchedResolutions.get(i);
    const inputVal = chosen ? `[${chosen.sku}] ${chosen.name}` : '';

    let statusCell = '';
    if (chosen) {
      const hasRef = !!u.ref;
      const hasName = !!u.identifier;
      const type = unmatchedMappingType.get(i) || _pdfDefaultMappingType(u);
      let mapTypeControl = '';
      if (hasRef && hasName) {
        // User can choose which fields the saved mapping should match on.
        const opt = (val, label) => `<option value="${val}" ${type === val ? 'selected' : ''}>${label}</option>`;
        mapTypeControl = `
          <label style="display:inline-flex; align-items:center; gap:0.3rem; font-size:0.72rem; color:var(--color-muted,#6b7280); margin-top:0.25rem;">
            Map using:
            <select class="pdf-unmatched-maptype" data-unmatched-idx="${i}" style="font-size:0.72rem; padding:0.1rem 0.3rem; width:auto; max-width:140px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
              ${opt('name', 'Name')}
              ${opt('sku', `SKU (${escapeHtml(u.ref)})`)}
              ${opt('both', 'SKU + Name')}
            </select>
          </label>`;
      } else {
        mapTypeControl = `<div style="font-size:0.72rem; color:var(--color-muted,#9ca3af); margin-top:0.2rem;">Mapping by ${hasRef ? 'SKU' : 'name'}</div>`;
      }
      statusCell = `
        <div style="font-size:0.72rem; color:var(--color-success,#16a34a); margin-top:0.2rem;"><i class="fas fa-check"></i> Will map to <strong>${escapeHtml(chosen.sku)}</strong></div>
        ${mapTypeControl}`;
    }

    return `<tr data-unmatched-row="${i}">
      <td style="max-width:240px; word-break: break-word;" title="${escapeHtml(u.raw_text)}">${_pdfLineIdentityHtml(u)}</td>
      <td>${sym}${parseFloat(u.price).toFixed(2)}</td>
      <td>
        <input type="text" data-unmatched-idx="${i}"
          class="nui-input nui-input-default nui-input-sm pdf-unmatched-input" placeholder="Search SKU or name…"
          value="${escapeHtml(inputVal)}"
          style="width:100%; ${chosen ? 'border-color:var(--color-success,#16a34a);' : ''}">
        ${statusCell}
      </td>
    </tr>`;
  }).join('');

  _renderPdfPagination('pdf-import-unmatched-pagination', info, 'pdfUnmatchedPage');
  _enhancePdfProductPickers('pdf-import-unmatched-body', 'pdf-unmatched-input');
}

function setUnmatchedMappingType(idx, type) {
  unmatchedMappingType.set(idx, type);
}

function resolveUnmatched(idx, inputValue) {
  const val = (inputValue || '').trim();
  if (!val) {
    unmatchedResolutions.delete(idx);
    unmatchedMappingType.delete(idx);
    renderPdfUnmatched();
    _updateConfirmButton();
    return;
  }
  // Expected format "[SKU] Name" from the datalist; fall back to raw SKU match.
  let sku = null, name = '';
  const m = val.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) {
    sku = m[1].trim();
    name = m[2].trim();
  }
  const product = (cachedInternalProducts || []).find(p =>
    (sku && p.sku.toLowerCase() === sku.toLowerCase()) ||
    `[${p.sku}] ${p.name}`.toLowerCase() === val.toLowerCase());

  if (!product) {
    // Not a valid selection yet (user still typing) — don't record.
    return;
  }
  unmatchedResolutions.set(idx, { sku: product.sku, name: product.name });
  if (!unmatchedMappingType.has(idx)) {
    const u = (pendingPdfPreview?.unmatched || [])[idx];
    if (u) unmatchedMappingType.set(idx, _pdfDefaultMappingType(u));
  }
  renderPdfUnmatched();
  _updateConfirmButton();
}

function _conflictKey(idx) {
  return `c${idx}`;
}

function _updateConflictsRemaining(total) {
  const remaining = total - conflictResolutions.size;
  const el = document.getElementById('pdf-import-conflicts-remaining');
  if (el) el.textContent = remaining;
}

function resolveConflict(idx, chosenSku) {
  conflictResolutions.set(_conflictKey(idx), chosenSku);

  // Visually mark the card as resolved
  const card = document.getElementById(`conflict-card-${idx}`);
  if (card) {
    card.style.borderColor = 'var(--color-success,#16a34a)';
    card.style.background = 'var(--color-success-bg,#f0fdf4)';
  }

  const total = pendingPdfPreview?.conflicts?.length || 0;
  _updateConflictsRemaining(total);
  _updateConfirmButton();
}

function _pdfEffectiveUpdateCount() {
  const changedIncluded = _matchedChangedIndices().filter(idx => !pdfExcludedRows.has(idx)).length;
  const resolvedConflicts = conflictResolutions.size;
  const resolvedUnmatched = unmatchedResolutions.size;
  return changedIncluded + resolvedConflicts + resolvedUnmatched + pdfIncludedNoChangeRows.size;
}

function _updateConfirmButton() {
  const confirmBtn = document.getElementById('btn-pdf-preview-confirm');
  if (!confirmBtn) return;

  const session = pdfMultiState?.sessions?.[pdfMultiState.index];
  const multi = (pdfMultiState?.sessions?.length || 0) > 1;

  // Already-imported supplier in the carousel — nothing more to confirm here.
  if (session?.confirmed) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<i class="fas fa-check-circle"></i> Imported — ${escapeHtml(session.preview.supplier_name)}`;
    confirmBtn.title = 'This supplier has already been imported';
    return;
  }

  const totalConflicts = pendingPdfPreview?.conflicts?.length || 0;
  const allResolved = conflictResolutions.size >= totalConflicts;
  const count = _pdfEffectiveUpdateCount();

  confirmBtn.disabled = count === 0 || !allResolved;
  const supplierSuffix = multi && session
    ? ` — ${escapeHtml(session.preview.supplier_name)}`
    : '';
  confirmBtn.innerHTML = `<i class="fas fa-check"></i> Confirm &amp; Update ${count} Price${count !== 1 ? 's' : ''}${supplierSuffix}`;

  if (totalConflicts > 0 && !allResolved) {
    confirmBtn.title = 'Resolve all conflicts above before confirming';
  } else {
    confirmBtn.title = '';
  }
}

/**
 * Turn one parsed preview + its interaction state into the writes to perform.
 * ``st`` is a preview-state object (the live one via _capturePdfPreviewState(),
 * or a carousel session's saved state), so this works for the active preview
 * and for not-currently-displayed carousel sessions alike.
 * Returns { updates, newMappings, newPriceCount, samePriceCount }.
 */
function _collectPdfUpdates(preview, st) {
  const supplierId = preview?.supplier_id;
  const defaultCurrency = preview?.supplier_default_currency;

  // Collect updates keyed by SKU so the same product can't be written twice with
  // different prices (e.g. an auto-matched row AND an unmatched line resolved to
  // the same SKU). Insertion order is matched → conflicts → unmatched, and a
  // later (user-driven) entry overwrites an earlier auto-matched one.
  const updateBySku = new Map();
  const putUpdate = (sku, unit_price, currency) =>
    updateBySku.set(sku, { sku, supplier_id: supplierId, unit_price, currency: currency || defaultCurrency });

  // Auto-matched items — only changed rows the user hasn't excluded.
  (preview.preview || []).forEach((item, idx) => {
    if (!item.has_change) return;
    if (st.excludedRows.has(idx)) return;
    putUpdate(item.sku, item.new_price, item.new_currency);
  });

  // Unchanged rows the user explicitly opted in.
  (preview.preview || []).forEach((item, idx) => {
    if (item.has_change) return;
    if (!st.includedNoChangeRows.has(idx)) return;
    putUpdate(item.sku, item.new_price, item.new_currency);
  });

  // User-resolved conflicts
  (preview.conflicts || []).forEach((c, idx) => {
    const chosen = st.conflictResolutions.get(_conflictKey(idx));
    if (chosen == null) return;

    if (c.kind === 'price') {
      // chosen is the index into price_options
      const opt = (c.price_options || [])[parseInt(chosen, 10)];
      if (opt) putUpdate(c.sku, opt.price, opt.currency);
    } else {
      // SKU-choice conflict: chosen is the selected SKU; price is fixed
      putUpdate(chosen, c.price, c.currency);
    }
  });

  // User-matched "unmatched" items: apply the price AND remember the new supplier
  // mapping (using the SKU/name/both choice) so the same line auto-matches next time.
  const newMappings = [];
  st.unmatchedResolutions.forEach((choice, idx) => {
    const u = (preview.unmatched || [])[idx];
    if (!u || !choice?.sku) return;
    putUpdate(choice.sku, u.price, u.currency);

    const type = st.unmatchedMappingType.get(idx) || _pdfDefaultMappingType(u);
    const useSku = (type === 'both' || type === 'sku') && u.ref;
    const useName = (type === 'both' || type === 'name') && u.identifier;
    if (useSku || useName) {
      newMappings.push({
        supplier_id: supplierId,
        supplier_sku: useSku ? u.ref : null,
        supplier_product_name: useName ? u.identifier : null,
        internal_sku: choice.sku,
      });
    }
  });

  const updates = Array.from(updateBySku.values());

  // Classify each write for the confirmation summary: a new price (the value
  // differs from the current one, or the product had none) vs the same price
  // (re-confirming an unchanged value).
  const skuCurrent = new Map();
  (preview.preview || []).forEach(item => {
    if (item?.sku != null) skuCurrent.set(item.sku, { price: item.current_price, currency: item.current_currency });
  });
  (preview.conflicts || []).forEach(c => {
    if (c?.kind === 'price' && c.sku != null) skuCurrent.set(c.sku, { price: c.current_price, currency: c.current_currency });
  });
  let newPriceCount = 0, samePriceCount = 0;
  updates.forEach(u => {
    const cur = skuCurrent.get(u.sku);
    const same = cur && cur.price != null &&
      Math.abs(parseFloat(cur.price) - parseFloat(u.unit_price)) <= 0.001 &&
      (cur.currency || defaultCurrency) === (u.currency || defaultCurrency);
    if (same) samePriceCount += 1;
    else newPriceCount += 1;
  });

  return { updates, newMappings, newPriceCount, samePriceCount };
}

// Best-effort mapping persistence — a failure here shouldn't block prices.
async function _savePdfMappings(newMappings) {
  let saved = 0;
  for (const m of newMappings) {
    try {
      await createSupplierMapping(m);
      saved += 1;
    } catch (e) {
      console.error('[Sourcing] Failed to save mapping for', m.internal_sku, e);
    }
  }
  return saved;
}

async function confirmPdfImport() {
  const preview = pendingPdfPreview;
  if (preview?.supplier_id == null) {
    closePdfImportModal();
    return;
  }

  const multi = (pdfMultiState?.sessions?.length || 0) > 1;
  const { updates, newMappings, newPriceCount, samePriceCount } =
    _collectPdfUpdates(preview, _capturePdfPreviewState());

  if (updates.length === 0) {
    if (multi) {
      showToast('Nothing selected for this supplier', 'warning');
      return;
    }
    closePdfImportModal();
    return;
  }

  showImportConfirm({
    title: multi ? `Confirm import — ${preview.supplier_name}` : 'Confirm price import',
    confirmLabel: `Update ${updates.length} product${updates.length !== 1 ? 's' : ''}`,
    lines: [
      { count: newPriceCount, label: `product${newPriceCount !== 1 ? 's' : ''} updated with a new price`, color: 'var(--color-success,#16a34a)' },
      { count: samePriceCount, label: `product${samePriceCount !== 1 ? 's' : ''} updated with the same price`, color: 'var(--color-text,#111)' },
      { count: newMappings.length, label: `product${newMappings.length !== 1 ? 's' : ''} to be mapped`, color: 'var(--color-warning,#d97706)' },
    ],
    totalLine: { count: updates.length, label: `product${updates.length !== 1 ? 's' : ''} updated in total` },
    onConfirm: () => applyPdfImport(updates, newMappings),
  });
}

async function applyPdfImport(updates, newMappings) {
  setLoading(true);
  try {
    await bulkUpdatePricing(updates);
    const mappingsSaved = await _savePdfMappings(newMappings);

    const count = updates.length;
    const supplierName = pendingPdfPreview?.supplier_name;
    let msg = `Updated ${count} price${count !== 1 ? 's' : ''} from PDF`;
    if (pdfMultiState && supplierName) msg = `${supplierName}: updated ${count} price${count !== 1 ? 's' : ''}`;
    if (mappingsSaved > 0) msg += ` · ${mappingsSaved} new mapping${mappingsSaved !== 1 ? 's' : ''} saved`;
    showToast(msg, 'success');

    // Multi-supplier carousel: mark this supplier done and move on to the next
    // unconfirmed one instead of closing — the rest still need reviewing.
    if (pdfMultiState) {
      const { sessions, index } = pdfMultiState;
      const session = sessions[index];
      session.confirmed = true;
      session.state = _capturePdfPreviewState();

      const nextIdx = sessions.findIndex(s => !s.confirmed);
      if (nextIdx === -1) {
        closePdfImportModal();
      } else {
        // Overlay may have been dropped by the confirm dialog — re-assert it.
        document.getElementById('pdf-import-overlay')?.classList.add('active');
        _updateConfirmButton();
        _updatePdfCarouselChrome();
        pdfCarouselGo(nextIdx - index);
      }
      await loadSupplierMatrix();
      scheduleGSheetSync();
      return;
    }

    closePdfImportModal();
    await loadSupplierMatrix();
    scheduleGSheetSync();
  } catch (error) {
    console.error('[Sourcing] Error confirming PDF import:', error);
    showToast('Failed to apply price updates: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    setLoading(false);
  }
}

// "Confirm & Import All/Rest" — apply every not-yet-confirmed supplier session
// in one go (the active one included), after a single combined summary dialog.
async function confirmPdfImportAll() {
  if (!pdfMultiState) return;
  const { sessions, index } = pdfMultiState;

  // Save the active preview's choices so its session state is current.
  sessions[index].state = _capturePdfPreviewState();

  const pending = sessions.filter(s => !s.confirmed);
  if (pending.length === 0) {
    closePdfImportModal();
    return;
  }

  // Every pending supplier must have its conflicts resolved first — jump to the
  // first one that doesn't so the user can fix it.
  const blocked = pending.find(s =>
    (s.preview.conflicts?.length || 0) > s.state.conflictResolutions.size);
  if (blocked) {
    showToast(`Resolve the conflicts for ${blocked.preview.supplier_name} first`, 'warning');
    const i = sessions.indexOf(blocked);
    if (i !== pdfMultiState.index) pdfCarouselGo(i - pdfMultiState.index);
    return;
  }

  const perSupplier = pending
    .map(s => ({ session: s, ...(_collectPdfUpdates(s.preview, s.state)) }))
    .filter(x => x.updates.length > 0);

  if (perSupplier.length === 0) {
    showToast('Nothing selected to import', 'warning');
    return;
  }

  const totalUpdates = perSupplier.reduce((n, x) => n + x.updates.length, 0);
  const totalMappings = perSupplier.reduce((n, x) => n + x.newMappings.length, 0);

  showImportConfirm({
    title: `Confirm import — ${perSupplier.length} supplier${perSupplier.length !== 1 ? 's' : ''}`,
    confirmLabel: `Update ${totalUpdates} product${totalUpdates !== 1 ? 's' : ''}`,
    lines: [
      ...perSupplier.map(x => ({
        count: x.updates.length,
        label: `price${x.updates.length !== 1 ? 's' : ''} for ${x.session.preview.supplier_name}`,
        color: 'var(--color-success,#16a34a)',
      })),
      { count: totalMappings, label: `product${totalMappings !== 1 ? 's' : ''} to be mapped`, color: 'var(--color-warning,#d97706)' },
    ],
    totalLine: { count: totalUpdates, label: `product${totalUpdates !== 1 ? 's' : ''} updated in total` },
    onConfirm: async () => {
      setLoading(true);
      try {
        let done = 0;
        for (const x of perSupplier) {
          await bulkUpdatePricing(x.updates);
          await _savePdfMappings(x.newMappings);
          x.session.confirmed = true;
          done += 1;
        }
        showToast(`Imported prices for ${done} supplier${done !== 1 ? 's' : ''}`, 'success');
        closePdfImportModal();
        await loadSupplierMatrix();
        scheduleGSheetSync();
      } catch (error) {
        console.error('[Sourcing] Error applying multi-supplier import:', error);
        showToast('Failed to apply price updates: ' + (error.message || 'Unknown error'), 'error');
        // Some suppliers may have gone through — reflect what's left.
        document.getElementById('pdf-import-overlay')?.classList.add('active');
        _updateConfirmButton();
        _updatePdfCarouselChrome();
      } finally {
        setLoading(false);
      }
    },
  });
}

// ============================================================================
// PRODUCT MAPPINGS — PDF IMPORT (mappings only, no pricing)
// ============================================================================
// Reuses the same PDF parse as the supplier-matrix importer, but only surfaces
// lines that have NO existing mapping (the parser's `unmatched` list — matched
// lines resolved via the mappings table, so they're already mapped and skipped).
// The user maps each line to an internal product; prices are never written.

let pendingMapPdfFiles = [];
let pendingMapPdfPreview = null;
let mapPdfParseAbort = null;
// idx (into preview.unmatched) → { sku, name } chosen by the user.
const mapPdfResolutions = new Map();
// idx → mapping type 'both' | 'sku' | 'name'.
const mapPdfMappingType = new Map();
let mapPdfView = { page: 1, query: '' };
// idx (into preview/matched) → { sku, name } when the user remaps an already-mapped
// line to a different internal product. Absent when left on its current mapping.
const mapPdfRemaps = new Map();
let mapPdfMappedView = { page: 1, query: '' };

async function openMappingPdfModal() {
  pendingMapPdfFiles = [];
  pendingMapPdfPreview = null;

  const filenameEl = document.getElementById('mapping-pdf-filename');
  if (filenameEl) filenameEl.textContent = '';
  const processBtn = document.getElementById('btn-mapping-pdf-process');
  if (processBtn) processBtn.disabled = true;
  const fileInput = document.getElementById('mapping-pdf-file-input');
  if (fileInput) fileInput.value = '';

  showMappingPdfStep1();
  document.getElementById('mapping-pdf-overlay')?.classList.add('active');

  if (!state.suppliers || state.suppliers.length === 0) {
    try {
      state.suppliers = await getSuppliers(true);
    } catch (e) {
      console.error('[Sourcing] Could not load suppliers for mapping PDF modal:', e);
    }
  }

  const select = document.getElementById('mapping-pdf-supplier');
  if (select) {
    select.innerHTML = '<option value="">— Auto-detect from PDF —</option>';
    (state.suppliers || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.code})`;
      select.appendChild(opt);
    });
    select.value = '';
  }
}

function closeMappingPdfModal() {
  closeOpenCombobox();
  if (mapPdfParseAbort) {
    try { mapPdfParseAbort.abort(); } catch {}
    mapPdfParseAbort = null;
  }
  _setMapPdfParsing(false);
  document.getElementById('mapping-pdf-overlay')?.classList.remove('active');
  pendingMapPdfFiles = [];
  pendingMapPdfPreview = null;
}

function showMappingPdfStep1() {
  closeOpenCombobox();
  document.getElementById('mapping-pdf-step-1').style.display = '';
  document.getElementById('mapping-pdf-step-2').style.display = 'none';
  document.getElementById('mapping-pdf-modal-title').textContent = 'Import Mappings from PDF';
}

function showMappingPdfStep2() {
  document.getElementById('mapping-pdf-step-1').style.display = 'none';
  document.getElementById('mapping-pdf-step-2').style.display = '';
}

function setMapPdfFiles(fileList) {
  const pdfs = _filterPdfFiles(fileList);
  const dropped = Array.from(fileList || []).length;
  if (dropped && !pdfs.length) {
    showToast('Please choose PDF files', 'warning');
    return;
  }
  pendingMapPdfFiles = pdfs;
  const filenameEl = document.getElementById('mapping-pdf-filename');
  if (filenameEl) filenameEl.textContent = _describePdfSelection(pdfs);
  const processBtn = document.getElementById('btn-mapping-pdf-process');
  // Supplier is optional up front (the AI detects it) — enable once files exist.
  if (processBtn) processBtn.disabled = !pdfs.length;
}

function handleMapPdfFileSelect(e) {
  setMapPdfFiles(e.target.files);
}

function _setMapPdfParsing(isParsing) {
  const processBtn = document.getElementById('btn-mapping-pdf-process');
  const supplierSelect = document.getElementById('mapping-pdf-supplier');
  const dropZone = document.getElementById('mapping-pdf-drop-zone');
  const progress = document.getElementById('mapping-pdf-progress');

  if (processBtn) {
    processBtn.disabled = isParsing;
    processBtn.innerHTML = isParsing
      ? '<i class="fas fa-spinner fa-spin"></i> Parsing…'
      : '<i class="fas fa-cog"></i> Process PDF';
  }
  if (supplierSelect) supplierSelect.disabled = isParsing;
  if (dropZone) dropZone.style.pointerEvents = isParsing ? 'none' : '';
  if (progress) progress.style.display = isParsing ? '' : 'none';
  if (isParsing) _updateMapPdfProgress(0, 'Starting…');
}

function _updateMapPdfProgress(percent, message) {
  const bar = document.getElementById('mapping-pdf-progress-bar');
  const pct = document.getElementById('mapping-pdf-progress-pct');
  const label = document.getElementById('mapping-pdf-progress-label');
  if (label && message) label.textContent = message;
  if (percent < 0) {
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '…';
    return;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  if (bar) bar.style.width = `${clamped}%`;
  if (pct) pct.textContent = `${clamped}%`;
}

async function processMappingPdfImport() {
  if (!pendingMapPdfFiles.length) {
    showToast('Please choose at least one PDF file', 'warning');
    return;
  }
  const selectedId = parseInt(document.getElementById('mapping-pdf-supplier')?.value) || null;

  const processBtn = document.getElementById('btn-mapping-pdf-process');
  const supplierSelect = document.getElementById('mapping-pdf-supplier');
  _setMapPdfParsing(true);
  mapPdfParseAbort = new AbortController();

  try {
    // --- Detect + reconcile the supplier before parsing ---
    _updateMapPdfProgress(-1, 'Detecting supplier…');
    const recon = await _reconcilePdfSupplier({
      selectedId,
      files: pendingMapPdfFiles,
      signal: mapPdfParseAbort.signal,
      closeModal: closeMappingPdfModal,
    });
    if (!recon.proceed) return; // messaging/redirect already handled
    const supplierId = recon.supplierId;
    // A confirm dialog (switch/keep) can drop the modal's active class on
    // confirm — re-assert it so parsing stays visible behind the progress bar.
    document.getElementById('mapping-pdf-overlay')?.classList.add('active');
    if (supplierSelect && String(supplierSelect.value) !== String(supplierId)) {
      supplierSelect.value = String(supplierId);
    }

    const productsPromise = _ensureInternalProductsLoaded();

    let result;
    try {
      result = await importMatrixPDFStream(pendingMapPdfFiles, parseInt(supplierId), {
        signal: mapPdfParseAbort.signal,
        onProgress: (percent, message) => _updateMapPdfProgress(percent, message),
      });
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') return;
      if (streamErr.fromSse) throw streamErr;
      console.warn('[Sourcing] Mapping PDF streaming failed, falling back:', streamErr);
      _updateMapPdfProgress(-1, 'Parsing…');
      result = await importMatrixPDF(pendingMapPdfFiles, parseInt(supplierId), {
        signal: mapPdfParseAbort.signal,
      });
    }

    await productsPromise;
    pendingMapPdfPreview = result;
    renderMappingPdfPreview(result);
    document.getElementById('mapping-pdf-modal-title').textContent =
      `Map Products — ${result.supplier_name}`;
    showMappingPdfStep2();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('[Sourcing] Error processing mapping PDF:', error);
    showToast('Failed to parse PDF: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    mapPdfParseAbort = null;
    _setMapPdfParsing(false);
    // Supplier is optional up front (the AI detects it) — gate on files only.
    if (processBtn) processBtn.disabled = !pendingMapPdfFiles.length;
  }
}

function renderMappingPdfPreview(result) {
  mapPdfResolutions.clear();
  mapPdfMappingType.clear();
  mapPdfRemaps.clear();
  mapPdfView = { page: 1, query: '' };
  mapPdfMappedView = { page: 1, query: '' };
  const search = document.getElementById('mapping-pdf-unmapped-search');
  if (search) search.value = '';
  const mappedSearch = document.getElementById('mapping-pdf-mapped-search');
  if (mappedSearch) mappedSearch.value = '';

  // Already-mapped = matched lines + resolved conflicts (both already in the
  // mappings table). Surface as context so the skip is transparent.
  const alreadyMapped = (result.total_matched || 0) + (result.total_conflicts || 0);
  const toMap = result.total_unmatched || 0;
  const summaryEl = document.getElementById('mapping-pdf-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-text,#111);">${result.total_found || 0}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Found</div>
      </div>
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-muted,#6b7280);">${alreadyMapped}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">Already mapped</div>
      </div>
      <div style="text-align:center; min-width:80px;">
        <div style="font-size:1.6rem; font-weight:700; color:var(--color-warning,#d97706);">${toMap}</div>
        <div style="font-size:0.8rem; color:var(--color-muted,#6b7280);">To map</div>
      </div>
      ${_extractionMethodBadge(result)}`;
  }

  renderMapPdfUnmapped();
  renderMapPdfMapped();
  _updateMapPdfConfirmButton();
}

function _filteredMapPdfIndices() {
  const q = mapPdfView.query.trim().toLowerCase();
  const items = pendingMapPdfPreview?.unmatched || [];
  const idxs = items.map((_, i) => i);
  if (!q) return idxs;
  return idxs.filter(i => {
    const u = items[i];
    return (u.identifier || '').toLowerCase().includes(q) ||
      (u.ref || '').toLowerCase().includes(q) ||
      (u.raw_text || '').toLowerCase().includes(q);
  });
}

function renderMapPdfUnmapped() {
  const countEl = document.getElementById('mapping-pdf-unmapped-count');
  const tbody = document.getElementById('mapping-pdf-unmapped-body');
  const all = pendingMapPdfPreview?.unmatched || [];
  if (!tbody) return;
  if (countEl) countEl.textContent = all.length;

  if (all.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:var(--color-muted,#6b7280); padding:1rem;">No unmapped products — everything in this PDF is already mapped.</td></tr>';
    _renderPdfPagination('mapping-pdf-unmapped-pagination', { total: 0 }, 'mapPdfPage');
    return;
  }

  const idxs = _filteredMapPdfIndices();
  if (idxs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:var(--color-muted,#6b7280); padding:1rem;">No matches for your search.</td></tr>';
    _renderPdfPagination('mapping-pdf-unmapped-pagination', { total: 0 }, 'mapPdfPage');
    return;
  }

  const info = _paginate(idxs, mapPdfView.page);
  mapPdfView.page = info.page;
  tbody.innerHTML = info.slice.map(i => {
    const u = all[i];
    const chosen = mapPdfResolutions.get(i);
    const inputVal = chosen ? `[${chosen.sku}] ${chosen.name}` : '';

    let statusCell = '';
    if (chosen) {
      const hasRef = !!u.ref;
      const hasName = !!u.identifier;
      const type = mapPdfMappingType.get(i) || _pdfDefaultMappingType(u);
      let mapTypeControl = '';
      if (hasRef && hasName) {
        const opt = (val, label) => `<option value="${val}" ${type === val ? 'selected' : ''}>${label}</option>`;
        mapTypeControl = `
          <label style="display:inline-flex; align-items:center; gap:0.3rem; font-size:0.72rem; color:var(--color-muted,#6b7280); margin-top:0.25rem;">
            Map using:
            <select class="map-pdf-maptype" data-map-idx="${i}" style="font-size:0.72rem; padding:0.1rem 0.3rem; width:auto; max-width:140px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
              ${opt('name', 'Name')}
              ${opt('sku', `SKU (${escapeHtml(u.ref)})`)}
              ${opt('both', 'SKU + Name')}
            </select>
          </label>`;
      } else {
        mapTypeControl = `<div style="font-size:0.72rem; color:var(--color-muted,#9ca3af); margin-top:0.2rem;">Mapping by ${hasRef ? 'SKU' : 'name'}</div>`;
      }
      statusCell = `
        <div style="font-size:0.72rem; color:var(--color-success,#16a34a); margin-top:0.2rem;"><i class="fas fa-check"></i> Will map to <strong>${escapeHtml(chosen.sku)}</strong></div>
        ${mapTypeControl}`;
    }

    return `<tr data-map-row="${i}">
      <td style="max-width:240px; word-break: break-word;" title="${escapeHtml(u.raw_text)}">${_pdfLineIdentityHtml(u)}</td>
      <td>
        <input type="text" data-map-idx="${i}"
          class="nui-input nui-input-default nui-input-sm map-pdf-input" placeholder="Search SKU or name…"
          value="${escapeHtml(inputVal)}"
          style="width:100%; ${chosen ? 'border-color:var(--color-success,#16a34a);' : ''}">
        ${statusCell}
      </td>
    </tr>`;
  }).join('');

  _renderPdfPagination('mapping-pdf-unmapped-pagination', info, 'mapPdfPage');
  _enhancePdfProductPickers('mapping-pdf-unmapped-body', 'map-pdf-input');
}

function setMapPdfMappingType(idx, type) {
  mapPdfMappingType.set(idx, type);
}

function resolveMapPdf(idx, inputValue) {
  const val = (inputValue || '').trim();
  if (!val) {
    mapPdfResolutions.delete(idx);
    mapPdfMappingType.delete(idx);
    renderMapPdfUnmapped();
    _updateMapPdfConfirmButton();
    return;
  }
  let sku = null;
  const m = val.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) sku = m[1].trim();
  const product = (cachedInternalProducts || []).find(p =>
    (sku && p.sku.toLowerCase() === sku.toLowerCase()) ||
    `[${p.sku}] ${p.name}`.toLowerCase() === val.toLowerCase());

  if (!product) return; // still typing — not a valid selection yet
  mapPdfResolutions.set(idx, { sku: product.sku, name: product.name });
  if (!mapPdfMappingType.has(idx)) {
    const u = (pendingMapPdfPreview?.unmatched || [])[idx];
    if (u) mapPdfMappingType.set(idx, _pdfDefaultMappingType(u));
  }
  renderMapPdfUnmapped();
  _updateMapPdfConfirmButton();
}

// ---- Already-mapped (remap) section -------------------------------------
function _filteredMapPdfMappedIndices() {
  const q = mapPdfMappedView.query.trim().toLowerCase();
  const items = pendingMapPdfPreview?.preview || [];
  const idxs = items.map((_, i) => i);
  if (!q) return idxs;
  return idxs.filter(i => {
    const it = items[i];
    return (it.identifier || '').toLowerCase().includes(q) ||
      (it.ref || '').toLowerCase().includes(q) ||
      (it.sku || '').toLowerCase().includes(q) ||
      (it.supplier_product_name || '').toLowerCase().includes(q);
  });
}

function renderMapPdfMapped() {
  const section = document.getElementById('mapping-pdf-mapped-section');
  const countEl = document.getElementById('mapping-pdf-mapped-count');
  const tbody = document.getElementById('mapping-pdf-mapped-body');
  const all = pendingMapPdfPreview?.preview || [];
  if (!section || !tbody) return;

  // Only relevant when some PDF lines already resolve to a mapping.
  if (all.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  if (countEl) countEl.textContent = all.length;

  const idxs = _filteredMapPdfMappedIndices();
  if (idxs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:var(--color-muted,#6b7280); padding:1rem;">No matches for your search.</td></tr>';
    _renderPdfPagination('mapping-pdf-mapped-pagination', { total: 0 }, 'mapMappedPage');
    return;
  }

  const info = _paginate(idxs, mapPdfMappedView.page);
  mapPdfMappedView.page = info.page;
  tbody.innerHTML = info.slice.map(i => {
    const it = all[i];
    const remap = mapPdfRemaps.get(i);
    const internalName = (cachedInternalProducts || []).find(p => p.sku === it.sku)?.name || '';
    const currentLabel = `[${it.sku}]${internalName ? ' ' + internalName : ''}`;
    const inputVal = remap ? `[${remap.sku}] ${remap.name}` : currentLabel;
    const remapStatus = remap
      ? `<div style="font-size:0.72rem; color:var(--color-warning,#d97706); margin-top:0.2rem;"><i class="fas fa-exchange-alt"></i> Will remap to <strong>${escapeHtml(remap.sku)}</strong></div>`
      : `<div style="font-size:0.72rem; color:var(--color-muted,#9ca3af); margin-top:0.2rem;">Currently mapped to <strong>${escapeHtml(it.sku)}</strong></div>`;

    return `<tr data-remap-row="${i}">
      <td style="max-width:240px; word-break: break-word;" title="${escapeHtml(it.supplier_product_name || '')}">${_pdfLineIdentityHtml(it)}</td>
      <td>
        <input type="text" data-remap-idx="${i}"
          class="nui-input nui-input-default nui-input-sm map-pdf-remap-input" placeholder="Search SKU or name…"
          value="${escapeHtml(inputVal)}"
          style="width:100%; ${remap ? 'border-color:var(--color-warning,#d97706);' : ''}">
        ${remapStatus}
      </td>
    </tr>`;
  }).join('');

  _renderPdfPagination('mapping-pdf-mapped-pagination', info, 'mapMappedPage');
  _enhancePdfProductPickers('mapping-pdf-mapped-body', 'map-pdf-remap-input');
}

function resolveMapPdfRemap(idx, inputValue) {
  const it = (pendingMapPdfPreview?.preview || [])[idx];
  if (!it) return;
  const val = (inputValue || '').trim();
  // Cleared → treat as "keep current mapping".
  if (!val) {
    mapPdfRemaps.delete(idx);
    renderMapPdfMapped();
    _updateMapPdfConfirmButton();
    return;
  }
  let sku = null;
  const m = val.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) sku = m[1].trim();
  const product = (cachedInternalProducts || []).find(p =>
    (sku && p.sku.toLowerCase() === sku.toLowerCase()) ||
    `[${p.sku}] ${p.name}`.toLowerCase() === val.toLowerCase());

  if (!product) return; // still typing — not a valid selection yet

  if (product.sku === it.sku) {
    mapPdfRemaps.delete(idx); // back to the current mapping — not a remap
  } else {
    mapPdfRemaps.set(idx, { sku: product.sku, name: product.name });
  }
  renderMapPdfMapped();
  _updateMapPdfConfirmButton();
}

function _updateMapPdfConfirmButton() {
  const confirmBtn = document.getElementById('btn-mapping-pdf-confirm');
  if (!confirmBtn) return;
  const total = mapPdfResolutions.size + mapPdfRemaps.size;
  confirmBtn.disabled = total === 0;
  confirmBtn.innerHTML = `<i class="fas fa-check"></i> Review ${total} Change${total !== 1 ? 's' : ''}`;
}

function confirmMappingPdfImport() {
  const supplierId = pendingMapPdfPreview?.supplier_id;
  if (supplierId == null) {
    closeMappingPdfModal();
    return;
  }

  // New mappings (from the unmapped section).
  const newMappings = [];
  mapPdfResolutions.forEach((choice, idx) => {
    const u = (pendingMapPdfPreview.unmatched || [])[idx];
    if (!u || !choice?.sku) return;
    const type = mapPdfMappingType.get(idx) || _pdfDefaultMappingType(u);
    const useSku = (type === 'both' || type === 'sku') && u.ref;
    const useName = (type === 'both' || type === 'name') && u.identifier;
    if (useSku || useName) {
      newMappings.push({
        supplier_id: supplierId,
        supplier_sku: useSku ? u.ref : null,
        supplier_product_name: useName ? u.identifier : null,
        internal_sku: choice.sku,
      });
    }
  });

  // Remaps (from the already-mapped section) — re-upsert on the same supplier
  // key the line matched on so the existing mapping row is overwritten in place.
  const remaps = [];
  mapPdfRemaps.forEach((choice, idx) => {
    const it = (pendingMapPdfPreview.preview || [])[idx];
    if (!it || !choice?.sku) return;
    const useSku = (it.match_method === 'reference_code' || it.match_method === 'both') && it.ref;
    const useName = (it.match_method === 'product_name' || it.match_method === 'both') && it.identifier;
    if (useSku || useName) {
      remaps.push({
        supplier_id: supplierId,
        supplier_sku: useSku ? it.ref : null,
        supplier_product_name: useName ? it.identifier : null,
        internal_sku: choice.sku,
      });
    }
  });

  if (newMappings.length === 0 && remaps.length === 0) {
    closeMappingPdfModal();
    return;
  }

  showImportConfirm({
    title: 'Confirm mapping changes',
    confirmLabel: 'Apply changes',
    lines: [
      { count: newMappings.length, label: `new mapping${newMappings.length !== 1 ? 's' : ''}`, color: 'var(--color-success,#16a34a)' },
      { count: remaps.length, label: `remapping${remaps.length !== 1 ? 's' : ''}`, color: 'var(--color-warning,#d97706)' },
    ],
    onConfirm: () => applyMappingPdfChanges(newMappings, remaps),
  });
}

async function applyMappingPdfChanges(newMappings, remaps) {
  setLoading(true);
  try {
    let savedNew = 0, savedRemap = 0;
    const errors = [];
    for (const m of newMappings) {
      try { await createSupplierMapping(m); savedNew += 1; }
      catch (e) { console.error('[Sourcing] Failed to save mapping for', m.internal_sku, e); errors.push(m.internal_sku); }
    }
    for (const m of remaps) {
      try { await createSupplierMapping(m); savedRemap += 1; }
      catch (e) { console.error('[Sourcing] Failed to remap', m.internal_sku, e); errors.push(m.internal_sku); }
    }

    if (savedNew > 0 || savedRemap > 0) {
      const parts = [];
      if (savedNew > 0) parts.push(`${savedNew} mapping${savedNew !== 1 ? 's' : ''} created`);
      if (savedRemap > 0) parts.push(`${savedRemap} remapped`);
      let msg = parts.join(' · ');
      if (errors.length) msg += ` · ${errors.length} failed`;
      showToast(msg, errors.length ? 'warning' : 'success');
    } else {
      showToast('No mappings could be saved', 'error');
    }
    closeMappingPdfModal();
    await loadProductMappings();
  } catch (error) {
    console.error('[Sourcing] Error applying mapping changes from PDF:', error);
    showToast('Failed to save mappings: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    setLoading(false);
  }
}

// ---- Shared import confirmation summary modal ---------------------------
// Used by both the supplier-matrix and product-mapping PDF importers to show a
// final "here's what will change" step before anything is written.
let _importConfirmHandler = null;

function showImportConfirm({ title, lines, totalLine, confirmLabel, onConfirm }) {
  const overlay = document.getElementById('import-confirm-overlay');
  const titleEl = document.getElementById('import-confirm-title');
  const bodyEl = document.getElementById('import-confirm-body');
  const yesBtn = document.getElementById('btn-import-confirm-yes');
  if (!overlay || !bodyEl || !yesBtn) { onConfirm?.(); return; }

  if (titleEl) titleEl.textContent = title || 'Confirm changes';
  const visible = (lines || []).filter(l => l && l.count > 0);
  let html = visible.map(l => `
    <li style="display:flex; align-items:center; gap:0.6rem; font-size:0.9rem;">
      <span style="min-width:2rem; text-align:center; font-weight:700; font-size:1.05rem; color:${l.color || 'var(--color-text,#111)'};">${l.count}</span>
      <span>${escapeHtml(l.label)}</span>
    </li>`).join('') ||
    '<li style="font-size:0.9rem; color:var(--color-muted,#6b7280);">No changes to apply.</li>';
  // Optional total row — always shown, set apart with a divider.
  if (totalLine) {
    html += `
    <li style="display:flex; align-items:center; gap:0.6rem; font-size:0.95rem; font-weight:600; margin-top:0.35rem; padding-top:0.6rem; border-top:1px solid var(--color-border,#e5e7eb);">
      <span style="min-width:2rem; text-align:center; font-weight:700; font-size:1.1rem;">${totalLine.count}</span>
      <span>${escapeHtml(totalLine.label)}</span>
    </li>`;
  }
  bodyEl.innerHTML = html;

  yesBtn.innerHTML = `<i class="fas fa-check"></i> ${escapeHtml(confirmLabel || 'Confirm')}`;
  if (_importConfirmHandler) yesBtn.removeEventListener('click', _importConfirmHandler);
  _importConfirmHandler = async () => {
    closeImportConfirm();
    try { await onConfirm?.(); }
    catch (e) { console.error('[Sourcing] Import confirm handler failed:', e); }
  };
  yesBtn.addEventListener('click', _importConfirmHandler);
  overlay.classList.add('active');
}

function closeImportConfirm() {
  const overlay = document.getElementById('import-confirm-overlay');
  const yesBtn = document.getElementById('btn-import-confirm-yes');
  if (yesBtn && _importConfirmHandler) {
    yesBtn.removeEventListener('click', _importConfirmHandler);
    _importConfirmHandler = null;
  }
  if (overlay) overlay.classList.remove('active');
}

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
  resolveConflict,
  resolveUnmatched,
  pdfCarouselTo: (i) => pdfCarouselGo(i - (pdfMultiState?.index ?? 0)),
  pdfMatchedPage: (page) => { pdfMatchedView.page = page; renderPdfMatched(); },
  pdfUnmatchedPage: (page) => { pdfUnmatchedView.page = page; renderPdfUnmatched(); },
  mapPdfPage: (page) => { mapPdfView.page = page; renderMapPdfUnmapped(); },
  mapMappedPage: (page) => { mapPdfMappedView.page = page; renderMapPdfMapped(); },
  goToAnalysisPage: async (page) => {
    state.analysisPage = page;
    // Client-side pagination from cached data — no API call needed
    applyAnalysisClientFilters();
    renderAnalysisTable();
    renderAnalysisPagination();
  },
  goToMatrixPage: async (page) => {
    state.matrixPage = page;
    // Server-side pagination: fetch the requested page.
    const colCount = 4 + (state.matrixSuppliers?.length || 5);
    showTableLoading('matrix-table-body', colCount, 'Loading');
    await loadSupplierMatrix({ skipLoadingOverlay: true });
  }
};

window._testMapPdfUnmapped = renderMapPdfUnmapped;
window._setPendingMapPdf = (v) => { pendingMapPdfPreview = v; };
window._testMapPdfUnmapped = renderMapPdfUnmapped;
window._setPendingMapPdf = (v) => { pendingMapPdfPreview = v; };
