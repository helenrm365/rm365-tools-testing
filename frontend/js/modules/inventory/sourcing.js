/**
 * Product Sourcing Module - Command Center
 * 
 * Implements the 4-sheet architecture:
 * 1. DB_Magento - Product data (from Magento sync)
 * 2. FX_Rates - Currency exchange rates
 * 3. Supplier_Matrix - Supplier pricing by SKU
 * 4. Analysis_Dashboard - Best price & margin calculations
 */

import { showToast } from '../../ui/toast.js';
import { getToken } from '../../services/state/sessionStore.js';
import { showLoading, hideLoading } from '../../router.js';
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
  syncMatrixFromGSheet
} from '../../services/api/sourcingApi.js';

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
  matrixSuppliers: [],
  matrixPage: 1,
  matrixPerPage: 100,
  matrixTotal: 0,
  pendingMatrixChanges: new Map(), // Track unsaved edits
  
  // Analysis
  analysisData: [],
  analysisSummary: {},
  analysisPage: 1,
  analysisPerPage: 100,
  analysisTotal: 0,
  analysisSearch: '',
  analysisMarginFilter: '',
  
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
  console.log('[Sourcing] Initializing Product Sourcing module');
  
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
    
    // Load initial data based on active tab
    await loadActiveTabData();
    
  } catch (error) {
    console.error('[Sourcing] Initialization error:', error);
    showToast('Failed to initialize sourcing module', 'error');
  }
}

/**
 * Cleanup function called when leaving the module
 */
export function destroy() {
  console.log('[Sourcing] Cleaning up sourcing module');
  
  // Warn about unsaved changes
  if (state.pendingMatrixChanges.size > 0) {
    console.warn('[Sourcing] Discarding unsaved matrix changes');
  }
  
  // Reset state
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
    pendingMatrixChanges: new Map(),
    analysisData: [],
    analysisSummary: {},
    analysisPage: 1,
    analysisPerPage: 100,
    analysisTotal: 0,
    analysisSearch: '',
    analysisMarginFilter: '',
    isLoading: false
  };
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.sub-tab-button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  
  // Analysis Dashboard
  document.getElementById('btn-refresh-analysis')?.addEventListener('click', loadAnalysisDashboard);
  document.getElementById('analysis-search')?.addEventListener('input', debounce(handleAnalysisSearch, 300));
  document.getElementById('analysis-margin-filter')?.addEventListener('change', handleMarginFilterChange);
  
  // Matrix
  document.getElementById('btn-save-matrix')?.addEventListener('click', saveMatrixChanges);
  document.getElementById('btn-export-matrix')?.addEventListener('click', exportMatrix);
  document.getElementById('btn-import-matrix')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  });
  document.getElementById('import-file-input')?.addEventListener('change', handleImportFile);
  document.getElementById('btn-gsheet-sync')?.addEventListener('click', openGSheetModal);
  document.getElementById('matrix-search')?.addEventListener('input', debounce(handleMatrixSearch, 300));
  
  // GSheets Modal
  document.getElementById('btn-gsheet-export')?.addEventListener('click', handleGSheetExport);
  document.getElementById('btn-gsheet-import')?.addEventListener('click', handleGSheetImport);
  document.querySelector('#modal-gsheets .close-modal')?.addEventListener('click', closeGSheetModal);
  document.getElementById('modal-gsheets')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGSheetModal();
  });
  
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
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================

async function switchTab(tabId) {
  // Update UI
  document.querySelectorAll('.sub-tab-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.sourcing-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });
  
  state.activeTab = tabId;
  await loadActiveTabData();
}

async function loadActiveTabData() {
  switch (state.activeTab) {
    case 'dashboard':
      await loadAnalysisDashboard();
      break;
    case 'matrix':
      await loadSupplierMatrix();
      break;
    case 'suppliers':
      await loadSuppliers();
      break;
    case 'fx-rates':
      await loadFXRates();
      break;
  }
}

// ============================================================================
// ANALYSIS DASHBOARD (Sheet 4: The Brain)
// ============================================================================

async function loadAnalysisDashboard() {
  setLoading(true);
  showToast('Loading analysis dashboard...', 'info');
  
  try {
    const data = await getAnalysisDashboard({
      page: state.analysisPage,
      perPage: state.analysisPerPage,
      search: state.analysisSearch,
      marginStatus: state.analysisMarginFilter
    });
    
    state.analysisData = data.products || [];
    state.analysisSummary = data.summary || {};
    state.analysisTotal = data.total || 0;
    state.matrixSuppliers = data.suppliers || [];
    
    renderAnalysisSummary();
    renderAnalysisTable();
    renderAnalysisPagination();
    
  } catch (error) {
    console.error('[Sourcing] Error loading analysis:', error);
    showToast('Failed to load analysis data', 'error');
  } finally {
    setLoading(false);
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
        <td class="col-sku"><strong>${escapeHtml(row.sku)}</strong></td>
        <td class="col-product">${escapeHtml(row.product_name || '')}</td>
        <td class="col-status"><span class="status-badge ${statusClass}">${escapeHtml(row.status || 'Unknown')}</span></td>
        <td class="col-magento">${magentoDisplay}</td>
        <td class="col-best-price ${row.best_price ? 'has-value' : ''}">${row.best_price ? formatCurrency(row.best_price, 'GBP') : '—'}</td>
        <td class="col-winner">${row.winning_supplier ? `<span class="winner-badge">${escapeHtml(row.winning_supplier)}</span>` : '—'}</td>
        <td class="col-margin ${marginClass}">${marginDisplay}</td>
        <td class="col-suppliers">${supplierChips || '—'}</td>
        <td class="col-actions">
          <button class="btn-icon" title="Edit Pricing" onclick="window.sourcingModule.openPricingModal('${escapeHtml(row.sku)}')">
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
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <button class="btn btn-secondary" ${state.analysisPage <= 1 ? 'disabled' : ''} onclick="window.sourcingModule.goToAnalysisPage(${state.analysisPage - 1})">
      <i class="fas fa-chevron-left"></i>
    </button>
    <span class="page-info">Page ${state.analysisPage} of ${totalPages}</span>
    <button class="btn btn-secondary" ${state.analysisPage >= totalPages ? 'disabled' : ''} onclick="window.sourcingModule.goToAnalysisPage(${state.analysisPage + 1})">
      <i class="fas fa-chevron-right"></i>
    </button>
  `;
}

function handleAnalysisSearch(e) {
  state.analysisSearch = e.target.value.trim();
  state.analysisPage = 1;
  loadAnalysisDashboard();
}

function handleMarginFilterChange(e) {
  state.analysisMarginFilter = e.target.value;
  state.analysisPage = 1;
  loadAnalysisDashboard();
}

// ============================================================================
// SUPPLIER MATRIX (Sheet 3)
// ============================================================================

async function loadSupplierMatrix() {
  setLoading(true);
  showToast('Loading supplier matrix...', 'info');
  
  try {
    const data = await getSupplierMatrix({
      page: state.matrixPage,
      perPage: state.matrixPerPage
    });
    
    state.matrixData = data.matrix || [];
    state.matrixSuppliers = data.suppliers || [];
    state.matrixTotal = data.total || 0;
    
    renderMatrixTable();
    renderMatrixPagination();
    
  } catch (error) {
    console.error('[Sourcing] Error loading matrix:', error);
    showToast('Failed to load supplier matrix', 'error');
  } finally {
    setLoading(false);
  }
}

function renderMatrixTable() {
  const thead = document.getElementById('matrix-table-head');
  const tbody = document.getElementById('matrix-table-body');
  if (!thead || !tbody) return;
  
  // Build dynamic headers based on suppliers
  const headerRow = thead.querySelector('tr');
  headerRow.innerHTML = `
    <th class="col-sku sticky-col">SKU</th>
    <th class="col-product">Product Name</th>
    <th class="col-magento">Magento Price</th>
    <th class="col-status">Status</th>
    ${state.matrixSuppliers.map(s => `
      <th class="col-supplier" data-supplier="${s.code}">
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
            data-supplier-code="${s.code}">
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
        <td class="col-product">${escapeHtml(row.product_name || '')}</td>
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
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <button class="btn btn-secondary" ${state.matrixPage <= 1 ? 'disabled' : ''} onclick="window.sourcingModule.goToMatrixPage(${state.matrixPage - 1})">
      <i class="fas fa-chevron-left"></i>
    </button>
    <span class="page-info">Page ${state.matrixPage} of ${totalPages}</span>
    <button class="btn btn-secondary" ${state.matrixPage >= totalPages ? 'disabled' : ''} onclick="window.sourcingModule.goToMatrixPage(${state.matrixPage + 1})">
      <i class="fas fa-chevron-right"></i>
    </button>
  `;
}

function handleMatrixCellEdit(cell) {
  const newValue = cell.textContent.trim();
  const originalValue = cell.dataset.original || '';
  const originalCurrency = cell.dataset.currency || '';
  
  const td = cell.closest('td');
  const sku = td.dataset.sku;
  const supplierId = parseInt(td.dataset.supplierId);
  
  if (newValue === '') {
    // Mark for deletion
    state.pendingMatrixChanges.set(`${sku}-${supplierId}`, { 
      sku, supplierId, action: 'delete' 
    });
    td.classList.add('pending-delete');
    updateSaveButtonState();
    return;
  }
  
  // Parse the input - might contain currency symbol
  const { price, currency: detectedCurrency } = parsePriceWithCurrency(newValue);
  
  if (price === null) {
    // Invalid input - restore original display
    cell.textContent = formatPriceDisplay(originalValue, originalCurrency);
    showToast('Invalid price value', 'error');
    return;
  }
  
  // Determine final currency:
  // - If user typed a symbol (£10), use that currency
  // - If user typed just a number (10), keep as placeholder (no currency)
  const finalCurrency = detectedCurrency || null;
  
  // Check if value actually changed
  const priceChanged = parseFloat(originalValue) !== price;
  const currencyChanged = originalCurrency !== (finalCurrency || '');
  
  if (!priceChanged && !currencyChanged) {
    // No change - restore display
    cell.textContent = formatPriceDisplay(price, finalCurrency);
    return;
  }
  
  // Update the display to show parsed value with symbol
  cell.textContent = formatPriceDisplay(price, finalCurrency);
  cell.dataset.currency = finalCurrency || '';
  
  state.pendingMatrixChanges.set(`${sku}-${supplierId}`, {
    sku,
    supplier_id: supplierId,
    unit_price: price,
    currency: finalCurrency  // null = placeholder
  });
  td.classList.add('pending-change');
  td.classList.remove('pending-delete');
  
  updateSaveButtonState();
}

function updateSaveButtonState() {
  const saveBtn = document.getElementById('btn-save-matrix');
  if (saveBtn) {
    const hasChanges = state.pendingMatrixChanges.size > 0;
    saveBtn.disabled = !hasChanges;
    saveBtn.classList.toggle('has-changes', hasChanges);
    
    if (hasChanges) {
      saveBtn.innerHTML = `<i class="fas fa-save"></i> Save (${state.pendingMatrixChanges.size})`;
    } else {
      saveBtn.innerHTML = `<i class="fas fa-save"></i> Save Changes`;
    }
  }
}

async function saveMatrixChanges() {
  if (state.pendingMatrixChanges.size === 0) return;
  
  setLoading(true);
  showToast('Saving changes...', 'info');
  
  try {
    const updates = [];
    const deletes = [];
    
    state.pendingMatrixChanges.forEach((change, key) => {
      if (change.action === 'delete') {
        deletes.push(change);
      } else {
        updates.push(change);
      }
    });
    
    // Process updates
    if (updates.length > 0) {
      await bulkUpdatePricing(updates);
    }
    
    // Process deletes
    for (const del of deletes) {
      await deletePricing(del.sku, del.supplierId);
    }
    
    state.pendingMatrixChanges.clear();
    updateSaveButtonState();
    
    showToast(`Saved ${updates.length + deletes.length} changes`, 'success');
    await loadSupplierMatrix();
    
  } catch (error) {
    console.error('[Sourcing] Error saving matrix:', error);
    showToast('Failed to save changes', 'error');
  } finally {
    setLoading(false);
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

async function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  
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
    
    // Show detailed import results
    let message = `Updated ${result.imported || 0} pricing entries`;
    if (result.skipped_invalid_skus > 0) {
      message += ` | Skipped ${result.skipped_invalid_skus} invalid SKUs`;
    }
    if (result.errors > 0) {
      message += ` | ${result.errors} errors`;
    }
    
    showToast(message, result.errors > 0 ? 'warning' : 'success');
    
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
    showToast('Import failed', 'error');
  }
  
  // Reset file input
  e.target.value = '';
}

// ============================================================================
// GOOGLE SHEETS SYNC
// ============================================================================

function openGSheetModal() {
  const modal = document.getElementById('modal-gsheets');
  if (modal) {
    modal.classList.add('active'); // Add active class for transition
    // Restore last used sheet ID from local storage
    const lastId = localStorage.getItem('rm365_gsheet_id');
    if (lastId) {
        document.getElementById('gsheet-id-input').value = lastId;
    }
  }
}

function closeGSheetModal() {
  const modal = document.getElementById('modal-gsheets');
  if (modal) {
      modal.classList.remove('active');
  }
  document.getElementById('gsheet-status').textContent = '';
}

async function handleGSheetExport() {
  const sheetId = document.getElementById('gsheet-id-input').value.trim();
  if (!sheetId) {
    showToast('Please enter a Google Sheet ID', 'warning');
    return;
  }
  
  // Save ID
  localStorage.setItem('rm365_gsheet_id', sheetId);
  
  const statusEl = document.getElementById('gsheet-status');
  statusEl.textContent = 'Exporting... This may take a few seconds.';
  statusEl.style.color = '#0066cc';
  
  setLoading(true);
  try {
    const result = await syncMatrixToGSheet(sheetId);
    showToast('Successfully exported to Google Sheet', 'success');
    statusEl.textContent = 'Export successful!';
    statusEl.style.color = 'green';
    setTimeout(closeGSheetModal, 2000);
  } catch (error) {
    console.error('GSheet Export Error:', error);
    showToast('Export failed: ' + error.message, 'error');
    statusEl.textContent = 'Error: ' + error.message;
    statusEl.style.color = 'red';
  } finally {
    setLoading(false);
  }
}

async function handleGSheetImport() {
  const sheetId = document.getElementById('gsheet-id-input').value.trim();
  if (!sheetId) {
    showToast('Please enter a Google Sheet ID', 'warning');
    return;
  }
  
   // Save ID
  localStorage.setItem('rm365_gsheet_id', sheetId);
  
  const statusEl = document.getElementById('gsheet-status');
  statusEl.textContent = 'Importing... This may take a few seconds.';
  statusEl.style.color = '#0066cc';

  setLoading(true);
  try {
    const result = await syncMatrixFromGSheet(sheetId);
    showToast(`Imported ${result.imported} prices`, 'success');
    statusEl.textContent = `Import successful! Updated ${result.imported} prices.`;
    statusEl.style.color = 'green';
    
    // Refresh matrix
    loadSupplierMatrix();
    setTimeout(closeGSheetModal, 2000);
  } catch (error) {
    console.error('GSheet Import Error:', error);
    showToast('Import failed: ' + error.message, 'error');
    statusEl.textContent = 'Error: ' + error.message;
    statusEl.style.color = 'red';
  } finally {
    setLoading(false);
  }
}

function handleMatrixSearch(e) {
  // TODO: Implement search filtering
  console.log('[Sourcing] Matrix search:', e.target.value);
}

// ============================================================================
// SUPPLIERS
// ============================================================================

async function loadSuppliers() {
  setLoading(true);
  showToast('Loading suppliers...', 'info');
  
  try {
    state.suppliers = await getSuppliers(false); // Include inactive
    renderSupplierGrid();
    
  } catch (error) {
    console.error('[Sourcing] Error loading suppliers:', error);
    showToast('Failed to load suppliers', 'error');
  } finally {
    setLoading(false);
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
        <button class="btn btn-primary" onclick="window.sourcingModule.openAddSupplierModal()">
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
        <button class="btn btn-secondary btn-sm" onclick="window.sourcingModule.openEditSupplierModal(${s.id})">
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
    
  } catch (error) {
    console.error('[Sourcing] Error deleting supplier:', error);
    showToast('Failed to delete supplier', 'error');
  }
}

// ============================================================================
// FX RATES (Sheet 2: Currency Engine)
// ============================================================================

async function loadFXRates() {
  setLoading(true);
  showToast('Loading FX rates...', 'info');
  
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
    setLoading(false);
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
          <button class="btn-icon btn-remove-override" title="Remove Override" 
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
  
  // Create entries for all suppliers
  container.innerHTML = supplierList.map(supplier => {
    const existing = pricing.find(p => p.supplier_id === supplier.id);
    
    return `
      <div class="pricing-entry" data-supplier-id="${supplier.id}">
        <div class="pricing-supplier">
          <span class="supplier-code">${escapeHtml(supplier.code)}</span>
          <span class="supplier-name">${escapeHtml(supplier.name)}</span>
        </div>
        <div class="pricing-fields">
          <div class="field-group">
            <label>Price</label>
            <input type="number" class="price-input" step="0.01" 
                   value="${existing?.unit_price || ''}" 
                   data-original="${existing?.unit_price || ''}">
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
            <input type="number" class="moq-input" min="1" value="${existing?.moq || ''}">
          </div>
          <div class="field-group notes-field">
            <label>Notes</label>
            <input type="text" class="notes-input" value="${escapeHtml(existing?.notes || '')}">
          </div>
        </div>
      </div>
    `;
  }).join('');
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
    
  } catch (error) {
    console.error('[Sourcing] Error saving pricing:', error);
    showToast('Failed to save pricing', 'error');
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function setLoading(isLoading) {
  state.isLoading = isLoading;
  document.querySelector('.product-sourcing')?.classList.toggle('loading', isLoading);
  
  // Use global loading overlay for proper page-level loading indicator
  if (isLoading) {
    showLoading();
  } else {
    hideLoading();
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

// EXPOSE TO WINDOW FOR ONCLICK HANDLERS
// ============================================================================

window.sourcingModule = {
  openPricingModal,
  openAddSupplierModal,
  openEditSupplierModal,
  handleMatrixCellEdit,
  handleRemoveFXOverride,
  openGSheetModal,
  goToAnalysisPage: async (page) => {
    state.analysisPage = page;
    await loadAnalysisDashboard();
  },
  goToMatrixPage: async (page) => {
    state.matrixPage = page;
    await loadSupplierMatrix();
  }
};

