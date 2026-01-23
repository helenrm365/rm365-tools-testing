/**
 * Product Sourcing Module
 * Manages supplier pricing, product mappings, and margin analysis
 */
import { get, post, patch, put } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';

// Module state
let suppliers = [];
let supplierProducts = [];
let priceHistory = [];
let comparison = [];
let currentTab = 'comparison';
let exchangeRates = null;

// Import conflict resolution state
let importConflictState = {
  validationResult: null,  // Full validation response from API
  resolvableConflicts: [], // Conflicts that need user resolution
  currentConflictIndex: 0, // Which conflict we're currently showing
  resolutions: {},         // Map of row_index -> resolution ('skip' | 'update' | 'overwrite')
  isActive: false          // Whether conflict resolution workflow is active
};

// DOM element references
let elements = {};

/**
 * Convert amount from any currency to GBP
 */
function convertToGBP(amount, fromCurrency) {
  if (!amount || !fromCurrency || fromCurrency === 'GBP') {
    return null;
  }
  
  if (!exchangeRates || !exchangeRates[fromCurrency]) {
    return null;
  }
  
  const rate = exchangeRates[fromCurrency];
  return amount / rate;
}

/**
 * Initialize the sourcing module
 */
export async function init(path = '/inventory/sourcing') {
  showToast('Initializing Product Sourcing...', 'info');
  console.log('[Sourcing] Initializing Product Sourcing module with path:', path);
  
  // Cache DOM elements
  cacheElements();
  
  // Setup event listeners
  setupEventListeners();
  
  // Determine which tab to show based on path
  const tabMap = {
    '/inventory/sourcing': 'dashboard',
    '/inventory/sourcing/dashboard': 'dashboard',
    '/inventory/sourcing/comparison': 'comparison',
    '/inventory/sourcing/suppliers': 'suppliers',
    '/inventory/sourcing/mappings': 'mappings',
    '/inventory/sourcing/prices': 'prices',
    '/inventory/sourcing/pending': 'pending',
    '/inventory/sourcing/import': 'import',
    '/inventory/sourcing/margins': 'margins'
  };
  
  const targetTab = tabMap[path] || 'dashboard';
  
  // Load initial data
  await loadInitialData();
  
  // Switch to the appropriate tab
  switchTab(targetTab);
  
  console.log('[Sourcing] Module initialized with tab:', targetTab);
}

/**
 * Cache DOM elements for performance
 */
function cacheElements() {
  elements = {
    // Stats
    totalSuppliers: document.getElementById('totalSuppliers'),
    totalMappings: document.getElementById('totalMappings'),
    unmappedProducts: document.getElementById('unmappedProducts'),
    avgMargin: document.getElementById('avgMargin'),
    
    // Sub-tabs
    subTabButtons: document.querySelectorAll('.sub-tab-button'),
    tabPanels: document.querySelectorAll('.sourcing-tab-panel'),
    
    // Comparison tab
    comparisonSearch: document.getElementById('comparisonSearch'),
    comparisonTableBody: document.getElementById('comparisonTableBody'),
    refreshComparison: document.getElementById('refreshComparison'),
    
    // Suppliers tab
    suppliersTableBody: document.getElementById('suppliersTableBody'),
    addSupplierBtn: document.getElementById('addSupplierBtn'),
    
    // Mappings tab
    mappingsTableBody: document.getElementById('mappingsTableBody'),
    mappingSupplierFilter: document.getElementById('mappingSupplierFilter'),
    addMappingBtn: document.getElementById('addMappingBtn'),
    
    // Price history tab
    priceHistorySearch: document.getElementById('priceHistorySearch'),
    priceHistoryTableBody: document.getElementById('priceHistoryTableBody'),
    addPriceBtn: document.getElementById('addPriceBtn'),
    
    // Import tab
    importSupplierSelect: document.getElementById('importSupplierSelect'),
    csvDropZone: document.getElementById('csvDropZone'),
    csvFileInput: document.getElementById('csvFileInput'),
    startCsvImport: document.getElementById('startCsvImport'),
    downloadCsvTemplate: document.getElementById('downloadCsvTemplate'),
    openManualEntryBtn: document.getElementById('openManualEntryBtn'),
    
    // Modals container
    modalsContainer: document.getElementById('sourcingModals'),
    
    // Dashboard elements
    recentPriceUpdates: document.getElementById('recentPriceUpdates'),
    topSuppliers: document.getElementById('topSuppliers'),
    dashAvgMargin: document.getElementById('dashAvgMargin'),
    dashBestMargin: document.getElementById('dashBestMargin'),
    dashWorstMargin: document.getElementById('dashWorstMargin'),
    dashLowMarginCount: document.getElementById('dashLowMarginCount'),
    dashUnmappedCount: document.getElementById('dashUnmappedCount'),
    unmappedAlert: document.getElementById('unmappedAlert'),
    systemStatus: document.getElementById('systemStatus')
  };
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Setup global dropdown handlers
  setupGlobalDropdownFunctions();
  
  // Sub-tab navigation - now handled by onclick in HTML for URL-based navigation
  // Keep this for any programmatic tab switching
  elements.subTabButtons?.forEach(btn => {
    // Navigation is handled by onclick="location.href=..." in HTML
    // But we still need the data-tab attribute for determining active state
  });
  
  // Comparison tab
  elements.comparisonSearch?.addEventListener('input', debounce(filterComparison, 300));
  elements.refreshComparison?.addEventListener('click', loadComparison);
  
  // Suppliers tab
  elements.addSupplierBtn?.addEventListener('click', openAddSupplierModal);
  
  // Mappings tab
  elements.mappingSupplierFilter?.addEventListener('change', filterMappings);
  elements.addMappingBtn?.addEventListener('click', openAddMappingModal);
  
  // Price history tab
  elements.priceHistorySearch?.addEventListener('input', debounce(filterPriceHistory, 300));
  elements.addPriceBtn?.addEventListener('click', openAddPriceModal);
  
  // Import tab - CSV upload
  if (elements.csvDropZone && elements.csvFileInput) {
    elements.csvDropZone.addEventListener('click', () => elements.csvFileInput.click());
    elements.csvDropZone.addEventListener('dragover', handleDragOver);
    elements.csvDropZone.addEventListener('dragleave', handleDragLeave);
    elements.csvDropZone.addEventListener('drop', handleFileDrop);
    elements.csvFileInput.addEventListener('change', handleFileSelect);
  }
  
  elements.startCsvImport?.addEventListener('click', startCsvImport);
  elements.downloadCsvTemplate?.addEventListener('click', downloadCsvTemplate);
  elements.openManualEntryBtn?.addEventListener('click', openManualEntryModal);
  
  // Modal click-outside-to-close
  setupModalCloseOnBackdropClick();
}

/**
 * Setup modal backdrop click to close
 */
function setupModalCloseOnBackdropClick() {
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      // Clicked on backdrop (not on modal-content)
      const modalId = e.target.id;
      if (modalId) {
        closeModal(modalId);
      }
    }
  });
}

/**
 * Load initial data
 */
async function loadInitialData() {
  try {
    showToast('Checking database tables...', 'info');
    // First, ensure tables are initialized via health check
    await initializeTables();
    
    showToast('Loading exchange rates...', 'info');
    // Load exchange rates first
    await loadExchangeRates();
    
    showToast('Loading suppliers & products...', 'info');
    // Load in parallel
    await Promise.all([
      loadSuppliers(),
      loadSupplierProducts(),
      loadComparison()
    ]);
    
    // Update stats
    updateStats();
    
  } catch (error) {
    console.error('[Sourcing] Error loading initial data:', error);
    showToast('Failed to load sourcing data', 'error');
  }
}

/**
 * Initialize database tables via health check
 */
async function initializeTables() {
  try {
    console.log('[Sourcing] Checking/initializing database tables...');
    const response = await get('/v1/inventory/sourcing/health');
    
    if (response?.status === 'error') {
      console.error('[Sourcing] Table initialization error:', response.detail);
      showToast('Database initialization failed', 'error');
      return false;
    }
    
    console.log('[Sourcing] Database tables ready:', response);
    return true;
  } catch (error) {
    console.error('[Sourcing] Failed to initialize tables:', error);
    // Don't show toast for auth errors - the API will handle that
    if (!error.message?.includes('401')) {
      showToast('Failed to connect to sourcing API', 'error');
    }
    return false;
  }
}

/**
 * Switch between sub-tabs
 */
function switchTab(tabId) {
  currentTab = tabId;
  
  // Update button states
  elements.subTabButtons?.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  
  // Update panel visibility
  elements.tabPanels?.forEach(panel => {
    const panelId = panel.id.replace('panel-', '');
    panel.classList.toggle('active', panelId === tabId);
  });
  
  // Load tab-specific data if needed
  switch (tabId) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'prices':
      loadPriceHistory();
      break;
    case 'pending':
      loadPendingPrices();
      break;
    case 'margins':
      loadMargins();
      break;
  }
}

// ====== Data Loading Functions ======

async function loadExchangeRates() {
  try {
    const response = await get('/v1/inventory/sourcing/currency/rates');
    if (response && response.rates) {
      exchangeRates = response.rates;
      console.log('[Sourcing] Exchange rates loaded:', exchangeRates);
    }
  } catch (error) {
    console.error('[Sourcing] Error loading exchange rates:', error);
  }
}

async function loadSuppliers() {
  try {
    const response = await get('/v1/inventory/sourcing/suppliers');
    suppliers = response || [];
    renderSuppliers();
    populateSupplierDropdowns();
  } catch (error) {
    console.error('[Sourcing] Error loading suppliers:', error);
    suppliers = [];
  }
}

async function loadSupplierProducts() {
  try {
    const response = await get('/v1/inventory/sourcing/products');
    supplierProducts = response || [];
    console.log('[Sourcing] Loaded supplier products:', supplierProducts);
    if (supplierProducts.length > 0) {
      const firstProduct = supplierProducts[0];
      console.log('[Sourcing] First product details:', {
        id: firstProduct.id,
        supplier_sku: firstProduct.supplier_sku,
        current_buy_price: firstProduct.current_buy_price,
        currency: firstProduct.currency,
        currency_type: typeof firstProduct.currency
      });
    }
    renderMappings();
  } catch (error) {
    console.error('[Sourcing] Error loading supplier products:', error);
    supplierProducts = [];
  }
}

async function loadDashboard() {
  try {
    // Load recent price updates
    if (elements.recentPriceUpdates) {
      const recentPrices = priceHistory.slice(0, 5);
      if (recentPrices.length > 0) {
        elements.recentPriceUpdates.innerHTML = recentPrices.map(price => `
          <div class="dashboard-list-item">
            <span class="item-title">${price.supplier_name} - ${price.product_name}</span>
            <span class="item-meta">£${price.price} on ${new Date(price.date).toLocaleDateString()}</span>
          </div>
        `).join('');
      } else {
        elements.recentPriceUpdates.innerHTML = '<p class="text-muted">No recent price updates</p>';
      }
    }

    // Load top suppliers
    if (elements.topSuppliers) {
      const supplierCounts = {};
      supplierProducts.forEach(product => {
        supplierCounts[product.supplier_name] = (supplierCounts[product.supplier_name] || 0) + 1;
      });
      
      const topSuppliersList = Object.entries(supplierCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      if (topSuppliersList.length > 0) {
        elements.topSuppliers.innerHTML = topSuppliersList.map(([name, count]) => `
          <div class="dashboard-list-item">
            <span class="item-title">${name}</span>
            <span class="item-badge">${count} products</span>
          </div>
        `).join('');
      } else {
        elements.topSuppliers.innerHTML = '<p class="text-muted">No suppliers found</p>';
      }
    }

    // Load margin insights from margin-reports API (uses active prices only)
    try {
      const marginResponse = await get('/v1/inventory/sourcing/margin-reports?report_type=all&limit=500');
      const products = marginResponse?.products || [];
      
      if (products.length > 0) {
        const margins = products
          .filter(item => item.margin_percent !== null && item.margin_percent !== undefined)
          .map(item => parseFloat(item.margin_percent));
        
        if (margins.length > 0) {
          const avgMargin = (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1);
          const bestMargin = Math.max(...margins).toFixed(1);
          const worstMargin = Math.min(...margins).toFixed(1);
          const lowMarginCount = margins.filter(m => m < 20).length;
          
          if (elements.dashAvgMargin) elements.dashAvgMargin.textContent = `${avgMargin}%`;
          if (elements.dashBestMargin) elements.dashBestMargin.textContent = `${bestMargin}%`;
          if (elements.dashWorstMargin) elements.dashWorstMargin.textContent = `${worstMargin}%`;
          if (elements.dashLowMarginCount) elements.dashLowMarginCount.textContent = lowMarginCount;
        }
      }
    } catch (marginError) {
      console.warn('[Sourcing] Could not load margin insights from API:', marginError);
      // Fallback to comparison data if API not available
      if (comparison.length > 0) {
        const margins = comparison
          .filter(item => item.margin_percent !== null && item.margin_percent !== undefined)
          .map(item => parseFloat(item.margin_percent));
        
        if (margins.length > 0) {
          const avgMargin = (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1);
          const bestMargin = Math.max(...margins).toFixed(1);
          const worstMargin = Math.min(...margins).toFixed(1);
          const lowMarginCount = margins.filter(m => m < 20).length;
          
          if (elements.dashAvgMargin) elements.dashAvgMargin.textContent = `${avgMargin}%`;
          if (elements.dashBestMargin) elements.dashBestMargin.textContent = `${bestMargin}%`;
          if (elements.dashWorstMargin) elements.dashWorstMargin.textContent = `${worstMargin}%`;
          if (elements.dashLowMarginCount) elements.dashLowMarginCount.textContent = lowMarginCount;
        }
      }
    }

    // Show unmapped products alert if needed
    const unmappedCount = parseInt(elements.unmappedProducts?.textContent || '0');
    if (unmappedCount > 0 && elements.unmappedAlert) {
      elements.unmappedAlert.style.display = 'block';
      if (elements.dashUnmappedCount) {
        elements.dashUnmappedCount.textContent = unmappedCount;
      }
    }

    // System status
    if (elements.systemStatus) {
      const status = await get('/v1/inventory/sourcing/health').catch(() => null);
      if (status) {
        elements.systemStatus.innerHTML = `
          <div class="status-item status-ok">
            <i class="fas fa-check-circle"></i>
            <span>All systems operational</span>
          </div>
        `;
      } else {
        elements.systemStatus.innerHTML = `
          <div class="status-item status-warning">
            <i class="fas fa-exclamation-circle"></i>
            <span>Unable to verify system status</span>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('[Sourcing] Error loading dashboard:', error);
  }
}

async function loadComparison() {
  try {
    // Use the new endpoint that includes pending price indicators
    // This ensures ranking uses only ACTIVE prices while showing pending indicators
    const response = await get('/v1/inventory/sourcing/comparison-with-pending');
    comparison = response?.products || [];
    renderComparison();
  } catch (error) {
    console.error('[Sourcing] Error loading comparison:', error);
    // Fallback to old endpoint if new one fails
    try {
      const fallback = await get('/v1/inventory/sourcing/comparison-with-inventory');
      comparison = fallback?.products || [];
      renderComparison();
    } catch (fallbackError) {
      console.error('[Sourcing] Fallback also failed:', fallbackError);
      comparison = [];
    }
  }
}

async function loadPriceHistory() {
  try {
    const response = await get('/v1/inventory/sourcing/prices/history');
    priceHistory = response?.prices || [];
    renderPriceHistory();
  } catch (error) {
    console.error('[Sourcing] Error loading price history:', error);
    priceHistory = [];
  }
}

// Pending prices state
let pendingPrices = [];

// Margin reports state
let marginReportData = [];
let currentMarginReportType = 'low-margin';

async function loadMargins(reportType = null) {
  try {
    if (reportType) {
      currentMarginReportType = reportType;
    }
    
    const container = document.querySelector('.margin-report-content');
    if (container) {
      container.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <span>Loading margin report...</span>
        </div>
      `;
    }
    
    const response = await get(`/v1/inventory/sourcing/margin-reports?report_type=${currentMarginReportType}&limit=50`);
    marginReportData = response?.products || [];
    renderMarginReports();
  } catch (error) {
    console.error('[Sourcing] Error loading margin reports:', error);
    marginReportData = [];
    renderMarginReports();
  }
}

function renderMarginReports() {
  const container = document.querySelector('.margin-report-content');
  if (!container) return;
  
  if (marginReportData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-chart-pie"></i>
        <h3>No Data Available</h3>
        <p>No margin data found for this report type. Ensure you have products with supplier pricing set up.</p>
      </div>
    `;
    return;
  }
  
  const reportTitles = {
    'low-margin': 'Low Margin Products',
    'top-margin': 'Top Margin Products',
    'margin-drops': 'Biggest Margin Changes',
    'trends': 'Margin Trends'
  };
  
  container.innerHTML = `
    <div class="margin-report-table-wrapper">
      <table class="data-table margin-report-table">
        <thead>
          <tr>
            <th>Internal SKU</th>
            <th>Product Name</th>
            <th>Supplier</th>
            <th>Buy Price</th>
            <th>Sell Price</th>
            <th>Margin</th>
            <th>Margin %</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="marginReportTableBody">
          ${marginReportData.map(product => {
            const marginClass = (product.margin_percent || 0) >= 30 ? 'text-success' : 
                                (product.margin_percent || 0) >= 15 ? 'text-warning' : 'text-danger';
            const statusBadge = getMarginStatusBadge(product.margin_percent);
            
            return `
              <tr>
                <td class="sku-cell">${escapeHtml(product.internal_sku)}</td>
                <td>${escapeHtml(product.product_name || product.internal_sku)}</td>
                <td>${escapeHtml(product.supplier_name || '-')}</td>
                <td class="price-cell">
                  ${product.active_buy_price ? formatCurrency(product.active_buy_price, product.currency || 'GBP') : '-'}
                </td>
                <td class="price-cell">
                  ${product.sell_price ? formatCurrency(product.sell_price, 'GBP') : '-'}
                </td>
                <td class="price-cell">
                  ${product.margin !== null ? formatCurrency(product.margin, 'GBP') : '-'}
                </td>
                <td class="${marginClass}">
                  <strong>${product.margin_percent !== null ? product.margin_percent.toFixed(1) + '%' : '-'}</strong>
                </td>
                <td>${statusBadge}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function getMarginStatusBadge(marginPercent) {
  if (marginPercent === null || marginPercent === undefined) {
    return '<span class="status-badge inactive">No Data</span>';
  }
  if (marginPercent >= 30) {
    return '<span class="status-badge active">Healthy</span>';
  }
  if (marginPercent >= 15) {
    return '<span class="status-badge warning">Monitor</span>';
  }
  return '<span class="status-badge danger">Low</span>';
}

// Global function for dropdown selection in HTML
window.selectMarginReport = function(element, reportType, label) {
  const dropdown = element.closest('.custom-dropdown');
  const selected = dropdown.querySelector('.dropdown-selected');
  const options = dropdown.querySelectorAll('.dropdown-option');
  
  // Update selected display
  selected.innerHTML = `<i class="fas fa-chart-bar"></i> ${label}`;
  
  // Update hidden input
  const hiddenInput = dropdown.querySelector('#marginReportType');
  if (hiddenInput) hiddenInput.value = reportType;
  
  // Update option states
  options.forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  
  // Close dropdown
  dropdown.classList.remove('open');
  
  // Load new report
  loadMargins(reportType);
};

async function loadPendingPrices() {
  try {
    const tableBody = document.getElementById('pendingPricesTableBody');
    const emptyState = document.getElementById('pendingEmptyState');
    
    // Show loading state
    if (tableBody) {
      tableBody.innerHTML = `
        <tr class="loading-row">
          <td colspan="10">
            <div class="loading-state">
              <div class="loading-spinner"></div>
              <span>Loading pending prices...</span>
            </div>
          </td>
        </tr>
      `;
    }
    
    const response = await get('/v1/inventory/sourcing/prices/pending');
    pendingPrices = response?.pending_prices || [];
    renderPendingPrices();
  } catch (error) {
    console.error('[Sourcing] Error loading pending prices:', error);
    pendingPrices = [];
    renderPendingPrices();
  }
}

function renderPendingPrices() {
  const tableBody = document.getElementById('pendingPricesTableBody');
  const emptyState = document.getElementById('pendingEmptyState');
  const tableContainer = tableBody?.closest('.table-container');
  
  if (!tableBody) return;
  
  if (pendingPrices.length === 0) {
    // Show empty state, hide table
    if (tableContainer) tableContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  
  // Show table, hide empty state
  if (tableContainer) tableContainer.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';
  
  tableBody.innerHTML = pendingPrices.map(price => {
    const countdown = renderCountdown(price.effective_date);
    const statusBadge = renderPriceStatusBadge('pending');
    
    return `
    <tr class="pending-row" data-price-id="${price.id}">
      <td>${escapeHtml(price.supplier_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(price.supplier_sku)}</td>
      <td>${escapeHtml(price.supplier_product_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(price.internal_sku || '-')}</td>
      <td class="price-cell">${formatCurrency(price.buy_price, price.currency || 'GBP')}</td>
      <td>${escapeHtml(price.currency || 'GBP')}</td>
      <td>${formatDate(price.effective_date)}</td>
      <td>${countdown}</td>
      <td>${statusBadge}</td>
      <td class="actions-cell">
        <button class="btn btn-icon btn-ghost btn-sm" onclick="window.sourcingModule.editPendingPrice(${price.id})" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-icon btn-ghost btn-sm cancel-price-btn" onclick="window.sourcingModule.cancelPendingPrice(${price.id})" title="Cancel">
          <i class="fas fa-times"></i>
        </button>
      </td>
    </tr>
  `}).join('');
}

async function cancelPendingPrice(priceId) {
  if (!confirm('Are you sure you want to cancel this pending price? This action cannot be undone.')) {
    return;
  }
  
  try {
    await post(`/v1/inventory/sourcing/prices/${priceId}/cancel`, {});
    showSuccess('Pending price cancelled successfully');
    await loadPendingPrices();
    await loadPriceHistory(); // Refresh price history to show cancelled status
  } catch (error) {
    console.error('[Sourcing] Error cancelling pending price:', error);
    showError('Failed to cancel pending price: ' + (error.message || 'Unknown error'));
  }
}

async function editPendingPrice(priceId) {
  // Find the pending price
  const price = pendingPrices.find(p => p.id === priceId);
  if (!price) {
    showError('Price not found');
    return;
  }
  
  // For now, show a simple prompt to edit the effective date
  const newDate = prompt('Enter new effective date (YYYY-MM-DD):', price.effective_date);
  if (!newDate) return;
  
  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(newDate)) {
    showError('Invalid date format. Please use YYYY-MM-DD.');
    return;
  }
  
  // Check if date is in the future
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const newEffectiveDate = new Date(newDate);
  if (newEffectiveDate <= today) {
    showError('Effective date must be in the future.');
    return;
  }
  
  try {
    await put(`/v1/inventory/sourcing/prices/${priceId}`, {
      effective_date: newDate
    });
    showSuccess('Pending price updated successfully');
    await loadPendingPrices();
  } catch (error) {
    console.error('[Sourcing] Error updating pending price:', error);
    showError('Failed to update pending price: ' + (error.message || 'Unknown error'));
  }
}

// ====== Rendering Functions ======

function renderSuppliers() {
  if (!elements.suppliersTableBody) return;
  
  if (suppliers.length === 0) {
    elements.suppliersTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <i class="fas fa-building"></i>
            <p>No suppliers found. Add your first supplier to get started.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  elements.suppliersTableBody.innerHTML = suppliers.map(supplier => `
    <tr data-id="${supplier.id}">
      <td class="name-cell">${escapeHtml(supplier.name)}</td>
      <td>${escapeHtml(supplier.code || '-')}</td>
      <td>${escapeHtml(supplier.contact_email || '-')}</td>
      <td>${escapeHtml(supplier.contact_phone || '-')}</td>
      <td class="products-count">${supplier.product_count || 0}</td>
      <td>
        <span class="status-badge ${supplier.is_active ? 'active' : 'inactive'}">
          ${supplier.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td class="actions-cell">
        <button class="btn btn-icon btn-ghost btn-sm" onclick="window.sourcingModule.editSupplier(${supplier.id})" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function renderMappings(filteredProducts = null) {
  if (!elements.mappingsTableBody) return;
  
  const products = filteredProducts || supplierProducts;
  
  if (products.length === 0) {
    elements.mappingsTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          <div class="empty-state">
            <i class="fas fa-project-diagram"></i>
            <p>No product mappings found. Add mappings to link supplier products to internal SKUs.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  elements.mappingsTableBody.innerHTML = products.map(product => {
    // Debug currency
    if (product.current_buy_price) {
      console.log(`[Sourcing] Rendering product ${product.id} (${product.supplier_sku}): price=${product.current_buy_price}, currency='${product.currency}', type=${typeof product.currency}`);
      const formattedPrice = formatCurrency(product.current_buy_price, product.currency || 'GBP');
      console.log(`[Sourcing] Formatted price result: '${formattedPrice}'`);
    }
    
    return `
    <tr data-id="${product.id}">
      <td>${escapeHtml(product.supplier_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(product.supplier_sku)}</td>
      <td>${escapeHtml(product.supplier_product_name)}</td>
      <td class="sku-cell ${!product.internal_sku ? 'unmapped' : ''}">
        ${product.internal_sku ? escapeHtml(product.internal_sku) : '<span class="unmapped-badge">Not Mapped</span>'}
      </td>
      <td class="price-cell">
        ${product.current_buy_price ? (() => {
          const currency = product.currency || 'GBP';
          const gbpEquivalent = currency !== 'GBP' ? convertToGBP(parseFloat(product.current_buy_price), currency) : null;
          return `
            <div>
              ${formatCurrency(product.current_buy_price, currency)}
              ${gbpEquivalent ? `<br><small class="text-muted">≈ ${formatCurrency(gbpEquivalent, 'GBP')}</small>` : ''}
            </div>
          `;
        })() : '-'}
      </td>
      <td>${product.pack_size || 1}</td>
      <td>
        <span class="status-badge ${product.is_active ? 'active' : 'inactive'}">
          ${product.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td class="actions-cell">
        <button class="btn btn-icon btn-ghost btn-sm" onclick="window.sourcingModule.editMapping(${product.id})" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
      </td>
    </tr>
  `;
  }).join('');
}

function renderComparison() {
  if (!elements.comparisonTableBody) return;
  
  if (comparison.length === 0) {
    elements.comparisonTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          <div class="empty-state">
            <i class="fas fa-balance-scale"></i>
            <p>No comparison data available. Add supplier products with internal SKUs to see comparisons.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  elements.comparisonTableBody.innerHTML = comparison.map(product => {
    const cheapestSuppliers = product.suppliers?.filter(s => s.is_cheapest) || [];
    const others = product.suppliers?.filter(s => !s.is_cheapest) || [];
    const allSuppliers = product.suppliers || [];
    
    // If no cheapest supplier (no prices), show the first supplier anyway
    const displaySupplier = cheapestSuppliers.length > 0 ? cheapestSuppliers[0] : (allSuppliers.length > 0 ? allSuppliers[0] : null);
    
    // Use product name from Magento catalog, fallback to SKU
    const hasProductName = product.product_name && product.product_name.trim() !== '';
    const productName = hasProductName ? product.product_name : `<span class="text-muted">${product.internal_sku}</span>`;
    const currentStock = product.quantity_available !== undefined && product.quantity_available !== null ? product.quantity_available : '-';
    const inventoryStatus = product.inventory_status || 'Unknown';
    
    // Check if product exists in inventory (has quantity data or status)
    const hasInventoryData = product.quantity_available !== undefined || product.inventory_status;
    
    // Format sell price
    const sellPrice = product.sell_price ? formatCurrency(product.sell_price, 'GBP') : '<span class="text-muted">No price</span>';
    
    // Format margin
    let marginDisplay = '<span class="text-muted">-</span>';
    if (displaySupplier && displaySupplier.buy_price && displaySupplier.margin_percent !== null && displaySupplier.margin_percent !== undefined) {
      const marginClass = displaySupplier.margin_percent >= 30 ? 'text-success' : displaySupplier.margin_percent >= 15 ? 'text-warning' : 'text-danger';
      marginDisplay = `
        <div class="${marginClass}">
          <strong>${displaySupplier.margin_percent.toFixed(1)}%</strong>
        </div>
        <small class="text-muted">${formatCurrency(displaySupplier.margin, displaySupplier.currency)}</small>
      `;
    } else if (!product.sell_price) {
      marginDisplay = '<span class="text-muted" title="No sell price in Magento">N/A</span>';
    } else if (!displaySupplier || !displaySupplier.buy_price) {
      marginDisplay = '<span class="text-muted" title="No supplier pricing">N/A</span>';
    }
    
    // Count other suppliers (excluding all cheapest ones if multiple)
    const otherCount = others.length;
    
    // Show button if there are other suppliers OR if there are multiple tied for cheapest
    const hasMultipleSuppliers = allSuppliers.length > 1;
    const showOtherSuppliersButton = hasMultipleSuppliers && (otherCount > 0 || cheapestSuppliers.length > 1);
    
    // Create clickable supplier display if there are multiple tied cheapest
    const supplierDisplay = cheapestSuppliers.length > 1 ? 
      `<div class="cheapest-badge clickable" 
            onclick="window.sourcingModule.cycleCheapestSupplier('${product.internal_sku}')" 
            style="cursor: pointer;"
            title="Click to see other suppliers with same price">
        <i class="fas fa-crown"></i>
        <span id="supplier-${product.internal_sku}">${escapeHtml(displaySupplier.supplier_name)}</span>
        <small class="text-muted">(1 of ${cheapestSuppliers.length})</small>
      </div>` :
      cheapestSuppliers.length === 1 ?
      `<div class="cheapest-badge" title="Cheapest supplier">
        <i class="fas fa-crown"></i>
        ${escapeHtml(displaySupplier.supplier_name)}
      </div>` :
      `<div>${escapeHtml(displaySupplier.supplier_name)}</div>`;
    
    // Build pending price indicator for this supplier
    let pendingIndicator = '';
    if (displaySupplier && displaySupplier.pending_price_info) {
      const pending = displaySupplier.pending_price_info;
      const indicatorClass = pending.is_cheaper ? 'pending-cheaper' : 'pending-change';
      const iconClass = pending.is_cheaper ? 'fa-arrow-down text-success' : 'fa-clock text-warning';
      pendingIndicator = `
        <div class="pending-price-indicator ${indicatorClass}" title="${pending.indicator_text}">
          <i class="fas ${iconClass}"></i>
          <span>${pending.indicator_text}</span>
          <small>${formatCurrency(pending.pending_price, pending.pending_currency)}</small>
        </div>
      `;
    }
    
    // Check if product has cheaper pending prices from any supplier
    let productPendingNote = '';
    if (product.has_cheaper_pending && product.cheaper_pending_suppliers?.length > 0) {
      const cheaperList = product.cheaper_pending_suppliers.map(s => 
        `${s.supplier_name}: ${formatCurrency(s.pending_price, 'GBP')} in ${s.days_until} day${s.days_until !== 1 ? 's' : ''}`
      ).join(', ');
      productPendingNote = `
        <div class="product-pending-note" title="Upcoming cheaper prices">
          <i class="fas fa-calendar-arrow-down text-info"></i>
          <small>Cheaper price${product.cheaper_pending_suppliers.length > 1 ? 's' : ''} coming</small>
        </div>
      `;
    }
    
    return `
      <tr data-sku="${product.internal_sku}" class="${product.has_cheaper_pending ? 'has-pending-cheaper' : ''}">
        <td class="sku-cell">
          <div>${escapeHtml(product.internal_sku)}</div>
          ${hasInventoryData ? '' : '<small class="text-warning">Not in inventory</small>'}
          ${productPendingNote}
        </td>
        <td>
          <div>${productName}</div>
          ${inventoryStatus !== 'Active' ? `<small class="text-warning">Status: ${inventoryStatus}</small>` : ''}
        </td>
        <td class="stock-cell">${currentStock}</td>
        <td class="price-cell">${sellPrice}</td>
        <td class="supplier-cell ${cheapestSuppliers.length > 0 ? 'cheapest' : ''}">
          ${displaySupplier ? `
            ${supplierDisplay}
            ${displaySupplier.pack_size > 1 ? `<small class="text-muted">Pack of ${displaySupplier.pack_size}</small>` : ''}
            ${!cheapestSuppliers.length ? '<small class="text-warning">No price set</small>' : ''}
          ` : '<span class="text-muted">No suppliers</span>'}
        </td>
        <td class="price-cell buy-price">
          ${displaySupplier && displaySupplier.buy_price ? `
            <div>
              ${formatCurrency(displaySupplier.buy_price, displaySupplier.currency)}
              ${displaySupplier.currency !== 'GBP' && displaySupplier.buy_price_gbp ? `<br><small class="text-muted">≈ ${formatCurrency(displaySupplier.buy_price_gbp, 'GBP')}</small>` : ''}
            </div>
            ${displaySupplier.pack_size > 1 && displaySupplier.price_per_unit ? 
              `<small class="text-muted">${formatCurrency(displaySupplier.price_per_unit, 'GBP')}/unit</small>` : ''}
            ${pendingIndicator}
          ` : displaySupplier ? '<span class="text-warning">No price set</span>' : '<span class="text-muted">-</span>'}
        </td>
        <td class="margin-cell">${marginDisplay}</td>
        <td class="other-suppliers-cell">
          ${showOtherSuppliersButton ? `
            <button class="action-btn info-btn btn-sm" onclick="window.sourcingModule.showAllSuppliers('${product.internal_sku}')">
              <i class="fas fa-eye"></i>
              <span>${otherCount > 0 ? `+${otherCount} more` : `View all (${allSuppliers.length})`}</span>
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function renderPriceHistory() {
  if (!elements.priceHistoryTableBody) return;
  
  if (priceHistory.length === 0) {
    elements.priceHistoryTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="10">
          <div class="empty-state">
            <i class="fas fa-history"></i>
            <p>No price history found. Prices will appear here as they are added or imported.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  elements.priceHistoryTableBody.innerHTML = priceHistory.map(price => {
    const status = price.computed_status || 'active';
    const rowClass = getPriceRowClass(status);
    const statusBadge = renderPriceStatusBadge(status);
    const effectiveDateDisplay = status === 'pending' 
      ? renderCountdown(price.effective_date) 
      : formatDate(price.effective_date);
    
    return `
    <tr class="${rowClass}" data-price-id="${price.id}">
      <td>${escapeHtml(price.supplier_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(price.supplier_sku)}</td>
      <td>${escapeHtml(price.supplier_product_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(price.internal_sku || '-')}</td>
      <td class="price-cell">${formatCurrency(price.buy_price, price.currency || 'GBP')}</td>
      <td>${escapeHtml(price.currency || 'GBP')}</td>
      <td>${effectiveDateDisplay}</td>
      <td>${statusBadge}</td>
      <td>${escapeHtml(price.created_by || '-')}</td>
      <td>
        ${price.import_batch_id ? 
          '<span class="source-badge csv">CSV Import</span>' : 
          '<span class="source-badge manual">Manual</span>'}
      </td>
    </tr>
  `}).join('');
}

function updateStats() {
  if (elements.totalSuppliers) {
    elements.totalSuppliers.textContent = suppliers.length;
  }
  if (elements.totalMappings) {
    elements.totalMappings.textContent = supplierProducts.length;
  }
  if (elements.unmappedProducts) {
    const unmapped = supplierProducts.filter(p => !p.internal_sku).length;
    elements.unmappedProducts.textContent = unmapped;
  }
  // Avg margin would need more data - placeholder for now
  if (elements.avgMargin) {
    elements.avgMargin.textContent = '--';
  }
}

function populateSupplierDropdowns() {
  // Populate mapping supplier dropdown
  const mappingDropdown = document.getElementById('mappingSupplierDropdown');
  if (mappingDropdown) {
    const optionsContainer = mappingDropdown.querySelector('.dropdown-options');
    if (optionsContainer) {
      // Keep the "All Suppliers" option and add supplier options
      let optionsHTML = '<div class="dropdown-option selected" onclick="selectMappingSupplier(this, \'\', \'All Suppliers\')">All Suppliers</div>';
      
      suppliers.forEach(supplier => {
        optionsHTML += `<div class="dropdown-option" onclick="selectMappingSupplier(this, '${supplier.id}', '${escapeHtml(supplier.name)}')">${escapeHtml(supplier.name)}</div>`;
      });
      
      optionsContainer.innerHTML = optionsHTML;
    }
  }
  
  // Populate import supplier dropdown
  const importDropdown = document.getElementById('importSupplierDropdown');
  if (importDropdown) {
    const optionsContainer = importDropdown.querySelector('.dropdown-options');
    if (optionsContainer) {
      let optionsHTML = '';
      
      suppliers.forEach(supplier => {
        optionsHTML += `<div class="dropdown-option" onclick="selectImportSupplier(this, '${supplier.id}', '${escapeHtml(supplier.name)}')">${escapeHtml(supplier.name)}</div>`;
      });
      
      optionsContainer.innerHTML = optionsHTML;
    }
  }
}

// ====== Filter Functions ======

function filterComparison() {
  const search = elements.comparisonSearch?.value.toLowerCase() || '';
  if (!search) {
    renderComparison();
    return;
  }
  
  const filtered = comparison.filter(p => 
    p.internal_sku?.toLowerCase().includes(search) ||
    p.internal_product_name?.toLowerCase().includes(search)
  );
  
  // Render filtered (we'd need to modify renderComparison to accept filtered data)
  // For now, just re-render with highlighting
  renderComparison();
}

function filterMappings() {
  const supplierId = elements.mappingSupplierFilter?.value;
  if (!supplierId) {
    renderMappings();
    return;
  }
  
  const filtered = supplierProducts.filter(p => p.supplier_id == supplierId);
  renderMappings(filtered);
}

function filterPriceHistory() {
  // Similar implementation
  renderPriceHistory();
}

// ====== Modal Functions ======

/**
 * Open Add Supplier Modal
 */
function openAddSupplierModal() {
  const modal = document.getElementById('addSupplierModal');
  if (modal) {
    // Reset form
    const form = document.getElementById('addSupplierForm');
    if (form) form.reset();
    
    // Set default today's date if needed
    modal.classList.add('active');
  }
}

/**
 * Open Add Mapping Modal
 */
function openAddMappingModal() {
  const modal = document.getElementById('addMappingModal');
  if (modal) {
    // Reset form
    const form = document.getElementById('addMappingForm');
    if (form) {
      form.reset();
      form.dataset.mode = 'add';
      delete form.dataset.mappingId;
    }
    
    // Hide price history section for new mappings
    const historySection = document.getElementById('mappingPriceHistory');
    if (historySection) historySection.style.display = 'none';
    
    // Update modal title
    const title = modal.querySelector('.modal-title');
    if (title) title.textContent = 'Add Product Mapping';
    
    // Populate supplier dropdown
    populateModalSupplierDropdown('mappingModalSupplierDropdown', 'mappingModalSupplierId');
    
    // Setup SKU autocomplete for internal_sku field
    const internalSkuInput = form?.querySelector('[name="internal_sku"]');
    if (internalSkuInput) {
      setupSkuAutocomplete(internalSkuInput);
      
      // Add duplicate check on blur
      internalSkuInput.addEventListener('blur', checkForDuplicateMapping);
      internalSkuInput.addEventListener('change', checkForDuplicateMapping);
    }
    
    // Add duplicate check when supplier is selected
    const supplierInput = form?.querySelector('[name="supplier_id"]');
    if (supplierInput) {
      supplierInput.addEventListener('change', checkForDuplicateMapping);
    }
    
    modal.classList.add('active');
  }
}

/**
 * Open Edit Mapping Modal
 */
async function openEditMappingModal(mappingId) {
  const mapping = supplierProducts.find(p => p.id === mappingId);
  if (!mapping) {
    showToast('Mapping not found', 'error');
    return;
  }
  
  console.log('[Sourcing] Editing mapping:', mapping);
  console.log('[Sourcing] Mapping currency:', mapping.currency);
  
  const modal = document.getElementById('addMappingModal');
  if (!modal) return;
  
  const form = document.getElementById('addMappingForm');
  if (!form) return;
  
  // Set form to edit mode
  form.dataset.mode = 'edit';
  form.dataset.mappingId = mappingId;
  
  // Store original values for change detection
  const originalDataObj = {
    supplier_id: mapping.supplier_id,
    supplier_sku: mapping.supplier_sku,
    internal_sku: mapping.internal_sku || '',
    supplier_product_name: mapping.supplier_product_name || '',
    pack_size: mapping.pack_size || 1,
    notes: mapping.notes || '',
    is_active: mapping.is_active !== false,
    buy_price: mapping.current_buy_price || '',
    currency: mapping.currency || 'GBP'
  };
  
  console.log('[Sourcing] Storing original data for change detection:', originalDataObj);
  console.log('[Sourcing] Original buy_price type:', typeof originalDataObj.buy_price, 'Value:', originalDataObj.buy_price);
  
  form.dataset.originalData = JSON.stringify(originalDataObj);
  
  // Update modal title
  const title = modal.querySelector('.modal-title');
  if (title) title.textContent = 'Edit Product Mapping';
  
  // Populate supplier dropdown
  populateModalSupplierDropdown('mappingModalSupplierDropdown', 'mappingModalSupplierId');
  
  // Set the supplier dropdown display to show the current supplier
  const supplierDropdown = document.getElementById('mappingModalSupplierDropdown');
  const supplierHiddenInput = document.getElementById('mappingModalSupplierId');
  if (supplierDropdown && supplierHiddenInput && mapping.supplier_id) {
    const supplier = suppliers.find(s => s.id === mapping.supplier_id);
    if (supplier) {
      const selectedDisplay = supplierDropdown.querySelector('.dropdown-selected');
      if (selectedDisplay) {
        selectedDisplay.innerHTML = `<i class="fas fa-truck"></i> ${escapeHtml(supplier.name)}`;
      }
      supplierHiddenInput.value = mapping.supplier_id;
      
      // Mark the option as selected
      supplierDropdown.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.textContent.trim() === supplier.name) {
          opt.classList.add('selected');
        }
      });
    }
  }
  
  // Fill in form with existing data
  const supplierIdInput = form.querySelector('[name="supplier_id"]');
  const supplierSkuInput = form.querySelector('[name="supplier_sku"]');
  const internalSkuInput = form.querySelector('[name="internal_sku"]');
  const productNameInput = form.querySelector('[name="supplier_product_name"]');
  const packSizeInput = form.querySelector('[name="pack_size"]');
  const buyPriceInput = form.querySelector('[name="buy_price"]');
  const notesInput = form.querySelector('[name="notes"]');
  const isActiveInput = form.querySelector('[name="is_active"]');
  
  if (supplierIdInput) supplierIdInput.value = mapping.supplier_id || '';
  if (supplierSkuInput) supplierSkuInput.value = mapping.supplier_sku || '';
  if (internalSkuInput) internalSkuInput.value = mapping.internal_sku || '';
  if (productNameInput) productNameInput.value = mapping.supplier_product_name || '';
  if (packSizeInput) packSizeInput.value = mapping.pack_size || 1;
  if (notesInput) notesInput.value = mapping.notes || '';
  if (isActiveInput) isActiveInput.checked = mapping.is_active !== false;
  
  // Fill in current buy price and currency if available
  if (buyPriceInput && mapping.current_buy_price) {
    buyPriceInput.value = mapping.current_buy_price;
  }
  
  // Set currency dropdown
  console.log('[Sourcing] editMapping - Full mapping object:', mapping);
  console.log('[Sourcing] editMapping - currency field:', mapping.currency, 'type:', typeof mapping.currency);
  
  const currentCurrency = mapping.currency || 'GBP';
  console.log('[Sourcing] editMapping - Using currency:', currentCurrency);
  
  const currencyDropdown = document.getElementById('mappingModalCurrencyDropdown');
  const currencyHiddenInput = document.getElementById('mappingModalCurrency');
  
  if (currencyDropdown && currencyHiddenInput) {
    // Map currency codes to display text and icons
    const currencyMap = {
      'GBP': { text: 'GBP (£)', icon: 'fa-pound-sign' },
      'EUR': { text: 'EUR (€)', icon: 'fa-euro-sign' },
      'USD': { text: 'USD ($)', icon: 'fa-dollar-sign' },
      'CAD': { text: 'CAD ($)', icon: 'fa-dollar-sign' },
      'AUD': { text: 'AUD ($)', icon: 'fa-dollar-sign' },
      'JPY': { text: 'JPY (¥)', icon: 'fa-yen-sign' },
      'CHF': { text: 'CHF', icon: 'fa-franc-sign' },
      'CNY': { text: 'CNY (¥)', icon: 'fa-yen-sign' },
      'SEK': { text: 'SEK', icon: 'fa-coins' },
      'NOK': { text: 'NOK', icon: 'fa-coins' },
      'DKK': { text: 'DKK', icon: 'fa-coins' },
      'PLN': { text: 'PLN', icon: 'fa-coins' }
    };
    
    const currencyInfo = currencyMap[currentCurrency] || currencyMap['GBP'];
    const selectedDisplay = currencyDropdown.querySelector('.dropdown-selected');
    
    if (selectedDisplay) {
      selectedDisplay.innerHTML = `<i class="fas ${currencyInfo.icon}"></i> ${currencyInfo.text}`;
      console.log('[Sourcing] Set dropdown display to:', currencyInfo.text);
    }
    currencyHiddenInput.value = currentCurrency;
    console.log('[Sourcing] Set hidden input to:', currentCurrency);
    
    // Update selected option - need to match by checking the onclick attribute
    let foundMatch = false;
    currencyDropdown.querySelectorAll('.dropdown-option').forEach(opt => {
      opt.classList.remove('selected');
      const onclickAttr = opt.getAttribute('onclick');
      console.log('[Sourcing] Checking option onclick:', onclickAttr);
      if (onclickAttr && onclickAttr.includes(`'${currentCurrency}'`)) {
        opt.classList.add('selected');
        foundMatch = true;
        console.log('[Sourcing] Found matching option for:', currentCurrency);
      }
    });
    
    if (!foundMatch) {
      console.warn('[Sourcing] No matching dropdown option found for currency:', currentCurrency);
    }
    
    console.log('[Sourcing] Currency dropdown set to:', currentCurrency, 'Display:', currencyInfo.text);
  }
  
  // Setup SKU autocomplete
  if (internalSkuInput) {
    setupSkuAutocomplete(internalSkuInput);
    
    // Add duplicate check on blur (but skip if SKU hasn't changed)
    const originalSku = mapping.internal_sku;
    internalSkuInput.addEventListener('blur', function() {
      if (this.value !== originalSku) {
        checkForDuplicateMapping.call(this);
      }
    });
  }
  
  // Add duplicate check when supplier changes
  const originalSupplierId = mapping.supplier_id;
  const supplierInput = form?.querySelector('[name="supplier_id"]');
  if (supplierInput) {
    supplierInput.addEventListener('change', function() {
      if (this.value !== originalSupplierId.toString()) {
        checkForDuplicateMapping.call(this);
      }
    });
  }
  
  // Load and display price history
  await loadPriceHistoryForMapping(mappingId);
  
  modal.classList.add('active');
}

/**
 * Check for duplicate mapping when SKU is selected
 */
function checkForDuplicateMapping() {
  const form = document.getElementById('addMappingForm');
  if (!form) return;
  
  const supplierIdInput = form.querySelector('[name="supplier_id"]');
  const internalSkuInput = form.querySelector('[name="internal_sku"]');
  const mappingId = form.dataset.mappingId;
  
  const supplierId = supplierIdInput?.value;
  const internalSku = internalSkuInput?.value?.trim();
  
  if (!supplierId || !internalSku) return;
  
  // Check if this supplier already has a mapping for this SKU
  const existingMapping = supplierProducts.find(p => 
    p.supplier_id === parseInt(supplierId) && 
    p.internal_sku === internalSku &&
    p.id !== parseInt(mappingId) // Exclude current mapping if editing
  );
  
  if (existingMapping) {
    showDuplicateMappingWarning(existingMapping);
  }
}

/**
 * Show duplicate mapping warning modal
 */
function showDuplicateMappingWarning(existingMapping) {
  const modal = document.getElementById('duplicateMappingWarning');
  if (!modal) return;
  
  const messageEl = document.getElementById('duplicateWarningMessage');
  const detailsEl = document.getElementById('existingMappingDetails');
  
  if (messageEl) {
    messageEl.textContent = `This supplier already has a mapping for SKU "${existingMapping.internal_sku}".`;
  }
  
  if (detailsEl) {
    detailsEl.innerHTML = `
      <div><strong>Supplier SKU:</strong> ${escapeHtml(existingMapping.supplier_sku)}</div>
      <div><strong>Product:</strong> ${escapeHtml(existingMapping.supplier_product_name || '-')}</div>
      ${existingMapping.current_buy_price ? `<div><strong>Current Price:</strong> ${formatCurrency(existingMapping.current_buy_price, 'GBP')}</div>` : ''}
    `;
  }
  
  modal.classList.add('active');
}

/**
 * Handle duplicate mapping warning choice
 */
function handleDuplicateChoice(choice) {
  const warningModal = document.getElementById('duplicateMappingWarning');
  const mappingModal = document.getElementById('addMappingModal');
  const form = document.getElementById('addMappingForm');
  const internalSkuInput = form?.querySelector('[name="internal_sku"]');
  
  if (warningModal) {
    warningModal.classList.remove('active');
  }
  
  switch (choice) {
    case 'cancel':
      // Close both modals
      if (mappingModal) mappingModal.classList.remove('active');
      break;
      
    case 'change':
      // Keep mapping modal open, focus on SKU field, clear it
      if (internalSkuInput) {
        internalSkuInput.value = '';
        internalSkuInput.focus();
      }
      break;
  }
}

/**
 * Load and display price history for a mapping
 */
async function loadPriceHistoryForMapping(mappingId) {
  const historySection = document.getElementById('mappingPriceHistory');
  const historyList = document.getElementById('mappingPriceHistoryList');
  
  if (!historySection || !historyList) return;
  
  try {
    // Fetch price history for this supplier product
    const history = await get(`/v1/inventory/sourcing/prices?supplier_product_id=${mappingId}`);
    
    if (history && history.length > 0) {
      historySection.style.display = 'block';
      
      historyList.innerHTML = history.map((entry) => {
        const date = new Date(entry.effective_date).toLocaleDateString();
        // Use computed_status from the API to determine the actual current/active price
        const status = entry.computed_status || 'unknown';
        const isActive = status === 'active';
        const isPending = status === 'pending';
        const isSuperseded = status === 'superseded';
        const isCancelled = status === 'cancelled';
        
        // Build status badge
        let statusBadge = '';
        if (isActive) {
          statusBadge = '<span class="status-badge active">Active</span>';
        } else if (isPending) {
          statusBadge = '<span class="status-badge pending">Pending</span>';
        } else if (isSuperseded) {
          statusBadge = '<span class="status-badge inactive">Superseded</span>';
        } else if (isCancelled) {
          statusBadge = '<span class="status-badge danger">Cancelled</span>';
        }
        
        return `
          <div class="price-history-item ${isActive ? 'current' : ''} ${isPending ? 'pending' : ''} ${isSuperseded ? 'superseded' : ''} ${isCancelled ? 'cancelled' : ''}">
            <div class="price-info">
              <div class="price-value">${formatCurrency(entry.buy_price, entry.currency)}</div>
              <div class="price-date">${date}</div>
            </div>
            ${statusBadge}
          </div>
        `;
      }).join('');
    } else {
      historySection.style.display = 'block';
      historyList.innerHTML = '<div class="price-history-empty">No price history available</div>';
    }
  } catch (error) {
    console.error('[Sourcing] Error loading price history:', error);
    historySection.style.display = 'none';
  }
}

/**
 * Show confirmation dialog for pending price conflict
 * @returns {Promise<'add'|'replace'|'cancel'>}
 */
function showPendingPriceConfirmation(pendingAmount, pendingDate, newAmount) {
  return new Promise((resolve) => {
    // Create modal dynamically
    const modalId = 'pendingPriceConfirmModal';
    let modal = document.getElementById(modalId);
    
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
      <div class="modal-content modal-md">
        <div class="modal-header">
          <div class="modal-header-icon warning">
            <i class="fas fa-clock"></i>
          </div>
          <h2 class="modal-title">Pending Price Exists</h2>
        </div>
        
        <div class="modal-body">
          <div class="pending-price-conflict-info">
            <div class="conflict-alert">
              <i class="fas fa-exclamation-triangle"></i>
              <p>This product mapping has a <strong>scheduled price change</strong>:</p>
            </div>
            
            <div class="pending-price-details">
              <div class="price-detail-row">
                <span class="label">Scheduled Price:</span>
                <span class="value scheduled">${pendingAmount}</span>
              </div>
              <div class="price-detail-row">
                <span class="label">Effective Date:</span>
                <span class="value">${pendingDate}</span>
              </div>
              <div class="price-detail-row">
                <span class="label">Your New Price:</span>
                <span class="value new">${newAmount}</span>
              </div>
            </div>
            
            <p class="conflict-explanation">
              What would you like to do?
            </p>
          </div>
        </div>
        
        <div class="modal-footer pending-price-actions">
          <button class="action-btn secondary-btn" id="pendingConfirmCancel">
            <i class="fas fa-times"></i>
            <span>Don't Save</span>
          </button>
          <button class="action-btn warning-btn" id="pendingConfirmAdd">
            <i class="fas fa-plus"></i>
            <span>Add Both</span>
          </button>
          <button class="action-btn primary-btn" id="pendingConfirmReplace">
            <i class="fas fa-exchange-alt"></i>
            <span>Replace Scheduled</span>
          </button>
        </div>
      </div>
    `;
    
    modal.classList.add('active');
    
    // Button handlers
    document.getElementById('pendingConfirmCancel').onclick = () => {
      modal.classList.remove('active');
      resolve('cancel');
    };
    
    document.getElementById('pendingConfirmAdd').onclick = () => {
      modal.classList.remove('active');
      resolve('add');
    };
    
    document.getElementById('pendingConfirmReplace').onclick = () => {
      modal.classList.remove('active');
      resolve('replace');
    };
  });
}

/**
 * Open Add Price Modal
 */
function openAddPriceModal() {
  const modal = document.getElementById('addPriceModal');
  if (modal) {
    // Reset form
    const form = document.getElementById('addPriceForm');
    if (form) form.reset();
    
    // Set today's date
    const dateInput = form.querySelector('[name="effective_date"]');
    if (dateInput) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
    
    // Populate product dropdown
    populateModalProductDropdown();
    
    modal.classList.add('active');
  }
}

/**
 * Open Manual Entry Modal
 */
function openManualEntryModal() {
  const modal = document.getElementById('manualEntryModal');
  if (modal) {
    // Reset form
    const form = document.getElementById('manualEntryForm');
    if (form) form.reset();
    
    // Set today's date
    const dateInput = form.querySelector('[name="effective_date"]');
    if (dateInput) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
    
    // Populate supplier dropdown
    populateModalSupplierDropdown('manualEntrySupplierDropdown', 'manualEntrySupplierId');
    
    modal.classList.add('active');
  }
}

/**
 * Close modal
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Populate supplier dropdown in modals
 */
function populateModalSupplierDropdown(dropdownId, hiddenInputId) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const optionsContainer = dropdown.querySelector('.dropdown-options');
  if (!optionsContainer) return;
  
  let optionsHTML = '';
  suppliers.forEach(supplier => {
    optionsHTML += `<div class="dropdown-option" onclick="window.sourcingModule.selectModalSupplier('${dropdownId}', '${hiddenInputId}', this, '${supplier.id}', '${escapeHtml(supplier.name)}')">${escapeHtml(supplier.name)}</div>`;
  });
  
  optionsContainer.innerHTML = optionsHTML;
}

/**
 * Populate product dropdown in price modal
 */
function populateModalProductDropdown() {
  const dropdown = document.getElementById('priceModalProductDropdown');
  if (!dropdown) return;
  
  const optionsContainer = dropdown.querySelector('.dropdown-options');
  if (!optionsContainer) return;
  
  let optionsHTML = '';
  supplierProducts.forEach(product => {
    const supplier = suppliers.find(s => s.id === product.supplier_id);
    const label = `${supplier?.name || 'Unknown'} - ${product.supplier_sku}${product.supplier_product_name ? ' (' + product.supplier_product_name + ')' : ''}`;
    optionsHTML += `<div class="dropdown-option" onclick="window.sourcingModule.selectModalProduct(this, '${product.id}', '${escapeHtml(label)}')">${escapeHtml(label)}</div>`;
  });
  
  optionsContainer.innerHTML = optionsHTML;
}

/**
 * Submit Add Supplier Form
 */
async function submitSupplierForm() {
  const form = document.getElementById('addSupplierForm');
  if (!form || !form.checkValidity()) {
    showToast('Please fill in all required fields', 'warning');
    form?.reportValidity();
    return;
  }
  
  const formData = new FormData(form);
  const data = {
    name: formData.get('name'),
    code: formData.get('code') || null,
    contact_email: formData.get('contact_email') || null,
    contact_phone: formData.get('contact_phone') || null,
    currency: formData.get('currency') || 'GBP',
    notes: formData.get('notes') || null,
    is_active: formData.get('is_active') === 'on'
  };
  
  try {
    await post('/v1/inventory/sourcing/suppliers', data);
    showToast('Supplier added successfully', 'success');
    closeModal('addSupplierModal');
    await loadSuppliers();
  } catch (error) {
    console.error('[Sourcing] Error adding supplier:', error);
    showToast('Failed to add supplier', 'error');
  }
}

/**
 * Submit Add Mapping Form
 */
async function submitMappingForm() {
  const form = document.getElementById('addMappingForm');
  if (!form || !form.checkValidity()) {
    showToast('Please fill in all required fields', 'warning');
    form?.reportValidity();
    return;
  }
  
  const isEditMode = form.dataset.mode === 'edit';
  const mappingId = form.dataset.mappingId;
  
  const formData = new FormData(form);
  const data = {
    supplier_id: parseInt(formData.get('supplier_id')),
    supplier_sku: formData.get('supplier_sku'),
    internal_sku: formData.get('internal_sku') || null,
    supplier_product_name: formData.get('supplier_product_name') || null,
    pack_size: formData.get('pack_size') ? parseInt(formData.get('pack_size')) : 1,
    notes: formData.get('notes') || null,
    is_active: formData.get('is_active') === 'on'
  };
  
  // Extract price data if provided
  const buyPrice = formData.get('buy_price') ? parseFloat(formData.get('buy_price')) : null;
  const currency = formData.get('currency') || 'GBP';
  
  // Check for changes in edit mode
  let hasMappingChanges = true;
  let hasPriceChanges = true;
  
  if (isEditMode && form.dataset.originalData) {
    try {
      const originalData = JSON.parse(form.dataset.originalData);
      console.log('[Sourcing] Original data:', originalData);
      console.log('[Sourcing] Current data object:', data);
      console.log('[Sourcing] Current price:', buyPrice, 'Currency:', currency);
      
      // Check mapping fields (excluding price and currency)
      const mappingFields = ['supplier_id', 'supplier_sku', 'internal_sku', 'supplier_product_name', 'pack_size', 'notes', 'is_active'];
      hasMappingChanges = mappingFields.some(key => {
        const originalValue = String(originalData[key] || '');
        const currentValue = String(
          key === 'supplier_id' ? data.supplier_id :
          key === 'supplier_sku' ? data.supplier_sku :
          key === 'internal_sku' ? (data.internal_sku || '') :
          key === 'supplier_product_name' ? (data.supplier_product_name || '') :
          key === 'pack_size' ? data.pack_size :
          key === 'notes' ? (data.notes || '') :
          key === 'is_active' ? data.is_active : ''
        );
        const changed = originalValue !== currentValue;
        if (changed) {
          console.log(`[Sourcing] Field ${key} changed: "${originalValue}" -> "${currentValue}"`);
        }
        return changed;
      });
      
      // Check price fields separately
      // Convert to numbers for comparison to avoid "62.0000" vs "62" mismatch
      const originalPrice = originalData.buy_price ? parseFloat(originalData.buy_price) : null;
      const currentPrice = buyPrice ? parseFloat(buyPrice) : null;
      const originalCurrency = String(originalData.currency || 'GBP');
      const currentCurrency = String(currency || 'GBP');
      
      console.log(`[Sourcing] Price comparison:`);
      console.log(`  - Original price: ${originalPrice} (type: ${typeof originalPrice}, raw: ${originalData.buy_price})`);
      console.log(`  - Current price: ${currentPrice} (type: ${typeof currentPrice}, raw: ${buyPrice})`);
      console.log(`  - Prices equal: ${originalPrice === currentPrice}`);
      console.log(`[Sourcing] Currency comparison:`);
      console.log(`  - Original currency: "${originalCurrency}"`);
      console.log(`  - Current currency: "${currentCurrency}"`);
      console.log(`  - Currencies equal: ${originalCurrency === currentCurrency}`);
      
      hasPriceChanges = (originalPrice !== currentPrice) || (originalCurrency !== currentCurrency);
      
      console.log('[Sourcing] Has mapping changes:', hasMappingChanges);
      console.log('[Sourcing] Has price changes:', hasPriceChanges);
      
      // If no changes at all, show dialog
      if (!hasMappingChanges && !hasPriceChanges) {
        if (confirm('No changes detected. Would you like to continue editing?\n\nClick OK to continue editing, or Cancel to close without saving.')) {
          return;
        } else {
          closeModal('addMappingModal');
          return;
        }
      }
    } catch (e) {
      console.error('[Sourcing] Error checking for changes:', e);
      // If error checking changes, allow save to proceed
      hasMappingChanges = true;
      hasPriceChanges = true;
    }
  }
  
  try {
    let productId;
    let mappingSaved = false;
    
    if (isEditMode && mappingId) {
      // Only update mapping if mapping fields changed
      if (hasMappingChanges) {
        await patch(`/v1/inventory/sourcing/products/${mappingId}`, data);
        mappingSaved = true;
        console.log('[Sourcing] Mapping updated');
      }
      productId = parseInt(mappingId);
    } else {
      // Create new mapping
      const result = await post('/v1/inventory/sourcing/products', data);
      productId = result.id;
      mappingSaved = true;
    }
    
    // Only save price if it changed (or if this is a new mapping)
    let priceSaved = false;
    if (buyPrice && productId && (!isEditMode || hasPriceChanges)) {
      // Check for pending prices before saving (edit mode only)
      let proceedWithPriceSave = true;
      if (isEditMode) {
        try {
          const pendingResponse = await get(`/v1/inventory/sourcing/prices/pending?supplier_product_id=${productId}`);
          const pendingPrices = pendingResponse?.pending_prices || [];
          
          if (pendingPrices.length > 0) {
            const pendingPrice = pendingPrices[0]; // Get the nearest pending price
            const pendingDate = new Date(pendingPrice.effective_date).toLocaleDateString();
            const pendingAmount = formatCurrency(pendingPrice.buy_price, pendingPrice.currency);
            
            const userChoice = await showPendingPriceConfirmation(
              pendingAmount,
              pendingDate,
              formatCurrency(buyPrice, currency)
            );
            
            if (userChoice === 'cancel') {
              // User chose not to save
              proceedWithPriceSave = false;
            } else if (userChoice === 'replace') {
              // User chose to cancel pending and add new
              try {
                await post(`/v1/inventory/sourcing/prices/${pendingPrice.id}/cancel`, {});
                console.log('[Sourcing] Cancelled pending price:', pendingPrice.id);
              } catch (cancelError) {
                console.error('[Sourcing] Error cancelling pending price:', cancelError);
                showToast('Failed to cancel pending price', 'error');
                proceedWithPriceSave = false;
              }
            }
            // If userChoice === 'add', proceed without cancelling (both will exist)
          }
        } catch (pendingCheckError) {
          console.error('[Sourcing] Error checking for pending prices:', pendingCheckError);
          // If we can't check, proceed anyway
        }
      }
      
      if (proceedWithPriceSave) {
        try {
          const priceData = {
            supplier_product_id: productId,
            buy_price: buyPrice,
            currency: currency,
            effective_date: new Date().toISOString().split('T')[0]
          };
          
          console.log('[Sourcing] Creating price entry (price changed):', priceData);
          
          await post('/v1/inventory/sourcing/prices', priceData);
          priceSaved = true;
        } catch (priceError) {
          console.error('[Sourcing] Error adding price:', priceError);
          showToast(`Mapping ${isEditMode ? 'updated' : 'saved'} but failed to add price: ${priceError.message || priceError}`, 'warning');
        }
      }
    }
    
    // Show appropriate success message
    if (isEditMode) {
      if (mappingSaved && priceSaved) {
        showToast('Mapping and price updated successfully', 'success');
      } else if (mappingSaved) {
        showToast('Mapping updated successfully', 'success');
      } else if (priceSaved) {
        showToast('Price updated successfully', 'success');
      }
    } else {
      if (priceSaved) {
        showToast('Mapping and price added successfully', 'success');
      } else {
        showToast('Product mapping added successfully', 'success');
      }
    }
    
    closeModal('addMappingModal');
    await Promise.all([
      loadSupplierProducts(),
      loadComparison()
    ]);
  } catch (error) {
    console.error('[Sourcing] Error saving mapping:', error);
    showToast(`Failed to ${isEditMode ? 'update' : 'add'} product mapping`, 'error');
  }
}

/**
 * Submit Add Price Form
 */
async function submitPriceForm() {
  const form = document.getElementById('addPriceForm');
  if (!form || !form.checkValidity()) {
    showToast('Please fill in all required fields', 'warning');
    form?.reportValidity();
    return;
  }
  
  const formData = new FormData(form);
  const data = {
    supplier_product_id: parseInt(formData.get('supplier_product_id')),
    buy_price: parseFloat(formData.get('buy_price')),
    currency: formData.get('currency') || 'GBP',
    effective_date: formData.get('effective_date') || new Date().toISOString().split('T')[0],
    notes: formData.get('notes') || null
  };
  
  try {
    await post('/v1/inventory/sourcing/prices', data);
    showToast('Price entry added successfully', 'success');
    closeModal('addPriceModal');
    await loadPriceHistory();
  } catch (error) {
    console.error('[Sourcing] Error adding price:', error);
    showToast('Failed to add price entry', 'error');
  }
}

/**
 * Submit Manual Entry Form
 */
async function submitManualEntryForm() {
  const form = document.getElementById('manualEntryForm');
  if (!form || !form.checkValidity()) {
    showToast('Please fill in all required fields', 'warning');
    form?.reportValidity();
    return;
  }
  
  const formData = new FormData(form);
  
  // First create the product mapping
  const productData = {
    supplier_id: parseInt(formData.get('supplier_id')),
    supplier_sku: formData.get('supplier_sku'),
    internal_sku: formData.get('internal_sku') || null,
    supplier_product_name: formData.get('product_name') || null,
    is_active: true
  };
  
  try {
    const product = await post('/v1/inventory/sourcing/products', productData);
    
    // Then add the price
    const priceData = {
      supplier_product_id: product.id,
      buy_price: parseFloat(formData.get('buy_price')),
      currency: formData.get('currency') || 'GBP',
      effective_date: formData.get('effective_date') || new Date().toISOString().split('T')[0],
      notes: formData.get('notes') || null
    };
    
    await post('/v1/inventory/sourcing/prices', priceData);
    
    showToast('Manual entry added successfully', 'success');
    closeModal('manualEntryModal');
    await Promise.all([loadSupplierProducts(), loadPriceHistory()]);
  } catch (error) {
    console.error('[Sourcing] Error adding manual entry:', error);
    showToast('Failed to add manual entry', 'error');
  }
}

/**
 * Select supplier in modal dropdown
 */
function selectModalSupplier(dropdownId, hiddenInputId, element, value, text) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = document.getElementById(hiddenInputId);
  
  if (selectedDisplay) {
    const icon = selectedDisplay.querySelector('i');
    const iconHTML = icon ? icon.outerHTML : '';
    selectedDisplay.innerHTML = `${iconHTML} ${text}`;
  }
  if (hiddenInput) hiddenInput.value = value;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
}

/**
 * Select product in modal dropdown
 */
function selectModalProduct(element, value, text) {
  const dropdown = document.getElementById('priceModalProductDropdown');
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = document.getElementById('priceModalProductId');
  
  if (selectedDisplay) {
    const icon = selectedDisplay.querySelector('i');
    const iconHTML = icon ? icon.outerHTML : '';
    selectedDisplay.innerHTML = `${iconHTML} ${text}`;
  }
  if (hiddenInput) hiddenInput.value = value;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
}

// ====== CSV Import Functions ======

let selectedFile = null;

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  elements.csvDropZone?.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  elements.csvDropZone?.classList.remove('drag-over');
}

function handleFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  elements.csvDropZone?.classList.remove('drag-over');
  
  const files = e.dataTransfer?.files;
  if (files?.length > 0) {
    handleFileSelection(files[0]);
  }
}

function handleFileSelect(e) {
  const files = e.target?.files;
  if (files?.length > 0) {
    handleFileSelection(files[0]);
  }
}

function handleFileSelection(file) {
  if (!file.name.endsWith('.csv')) {
    showToast('Please select a CSV file', 'error');
    return;
  }
  
  selectedFile = file;
  elements.csvDropZone.innerHTML = `
    <i class="fas fa-file-csv"></i>
    <span>${escapeHtml(file.name)}</span>
    <small>${formatFileSize(file.size)}</small>
  `;
  elements.csvDropZone.classList.add('file-selected');
  
  // Enable import button if supplier is selected
  updateImportButtonState();
}

function updateImportButtonState() {
  const supplierSelected = elements.importSupplierSelect?.value;
  if (elements.startCsvImport) {
    elements.startCsvImport.disabled = !(selectedFile && supplierSelected);
  }
}

async function startCsvImport() {
  if (!selectedFile || !elements.importSupplierSelect?.value) {
    showToast('Please select a supplier and file', 'error');
    return;
  }
  
  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('supplier_id', elements.importSupplierSelect.value);
  
  try {
    elements.startCsvImport.disabled = true;
    elements.startCsvImport.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validating...';
    
    // Step 1: Validate CSV and detect conflicts
    const response = await fetch(`${window.location.origin}/api/v1/inventory/sourcing/import/validate`, {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showToast(`Validation failed: ${result.detail || 'Unknown error'}`, 'error');
      return;
    }
    
    // Check for data errors (blocks import)
    const dataErrors = result.conflicts.filter(c => c.conflict_type === 'data_error');
    if (dataErrors.length > 0) {
      showDataErrorsModal(dataErrors);
      return;
    }
    
    // Check for resolvable conflicts
    const resolvableConflicts = result.conflicts.filter(c => c.requires_resolution);
    
    if (resolvableConflicts.length > 0) {
      // Start conflict resolution workflow
      importConflictState = {
        validationResult: result,
        resolvableConflicts: resolvableConflicts,
        currentConflictIndex: 0,
        resolutions: {},
        isActive: true
      };
      showConflictModal(0);
    } else {
      // No conflicts requiring resolution - proceed directly to import
      await executeImport(result);
    }
    
  } catch (error) {
    console.error('[Sourcing] Validation error:', error);
    showToast('Validation failed', 'error');
  } finally {
    elements.startCsvImport.disabled = false;
    elements.startCsvImport.innerHTML = '<i class="fas fa-upload"></i> Start Import';
  }
}

/**
 * Show data errors modal (blocks import until CSV is fixed)
 */
function showDataErrorsModal(errors) {
  const modal = document.getElementById('importDataErrorsModal');
  if (!modal) {
    // Fallback to toast if modal doesn't exist
    showToast(`CSV has ${errors.length} data error(s). Please fix and re-upload.`, 'error');
    console.error('[Sourcing] Data errors:', errors);
    return;
  }
  
  const errorListBody = document.getElementById('dataErrorsListBody');
  if (errorListBody) {
    errorListBody.innerHTML = errors.map(e => `
      <div class="data-error-item">
        <span class="error-row">Row ${e.row_number}</span>
        <span class="error-message">${escapeHtml(e.message)}</span>
      </div>
    `).join('');
  }
  
  modal.classList.add('active');
  console.error('[Sourcing] Data errors:', errors);
}

/**
 * Show conflict resolution modal for a specific conflict
 */
function showConflictModal(index) {
  const conflicts = importConflictState.resolvableConflicts;
  if (index >= conflicts.length) {
    // All conflicts resolved - proceed to import
    executeImportWithResolutions();
    return;
  }
  
  const conflict = conflicts[index];
  const modal = document.getElementById('importConflictModal');
  if (!modal) return;
  
  // Update progress
  document.getElementById('conflictProgressText').textContent = 
    `Conflict ${index + 1} of ${conflicts.length}`;
  document.getElementById('conflictProgressFill').style.width = 
    `${((index + 1) / conflicts.length) * 100}%`;
  
  // Update message based on conflict type
  const messageEl = document.getElementById('conflictMessage');
  const messageIcon = getConflictIcon(conflict.conflict_type);
  messageEl.innerHTML = `<i class="${messageIcon}"></i><span>${escapeHtml(conflict.message)}</span>`;
  
  // Update row info
  document.getElementById('conflictRowNumber').textContent = conflict.row_number;
  document.getElementById('conflictSupplierSku').textContent = conflict.row_data.supplier_sku;
  
  // Update current data
  const currentDataEl = document.getElementById('conflictCurrentData');
  if (conflict.current_data) {
    const current = conflict.current_data;
    const mapping = current.mapping || {};
    const price = current.price || {};
    
    currentDataEl.innerHTML = `
      <div class="data-row">
        <span class="data-label">Supplier SKU:</span>
        <span class="data-value">${escapeHtml(mapping.supplier_sku || '-')}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Internal SKU:</span>
        <span class="data-value">${escapeHtml(mapping.internal_sku || '-')}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Product Name:</span>
        <span class="data-value">${escapeHtml(mapping.supplier_product_name || '-')}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Buy Price:</span>
        <span class="data-value">${price.buy_price ? formatCurrency(price.buy_price, price.currency || 'GBP') : '-'}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Currency:</span>
        <span class="data-value">${escapeHtml(price.currency || 'GBP')}</span>
      </div>
    `;
  } else {
    currentDataEl.innerHTML = '<p class="text-muted">No existing data</p>';
  }
  
  // Update new data (from CSV)
  const newDataEl = document.getElementById('conflictNewData');
  const newRow = conflict.row_data;
  newDataEl.innerHTML = `
    <div class="data-row">
      <span class="data-label">Supplier SKU:</span>
      <span class="data-value">${escapeHtml(newRow.supplier_sku || '-')}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Internal SKU:</span>
      <span class="data-value ${hasChanged(conflict, 'internal_sku') ? 'highlight' : ''}">${escapeHtml(newRow.internal_sku || '-')}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Product Name:</span>
      <span class="data-value">${escapeHtml(newRow.product_name || '-')}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Buy Price:</span>
      <span class="data-value ${hasChanged(conflict, 'buy_price') ? 'highlight' : ''}">${formatCurrency(parseFloat(newRow.buy_price), newRow.currency || 'GBP')}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Currency:</span>
      <span class="data-value">${escapeHtml(newRow.currency || 'GBP')}</span>
    </div>
  `;
  
  // Show/hide pending change warning and disclaimer
  const pendingWarning = document.getElementById('pendingChangeWarning');
  const updateDisclaimer = document.getElementById('updateDisclaimer');
  
  if (conflict.conflict_type === 'pending_change' && conflict.current_data?.pending_price) {
    const pending = conflict.current_data.pending_price;
    document.getElementById('pendingChangeDetails').textContent = 
      `A price change to ${formatCurrency(pending.buy_price, pending.currency)} is scheduled for ${pending.effective_date}`;
    pendingWarning.style.display = 'flex';
    if (updateDisclaimer) updateDisclaimer.style.display = 'flex';
  } else {
    pendingWarning.style.display = 'none';
    if (updateDisclaimer) updateDisclaimer.style.display = 'none';
  }
  
  // Show modal
  modal.classList.add('active');
}

/**
 * Check if a field has changed between current and new data
 */
function hasChanged(conflict, field) {
  if (!conflict.current_data) return false;
  
  const current = conflict.current_data;
  const newData = conflict.row_data;
  
  if (field === 'buy_price') {
    const currentPrice = current.price?.buy_price;
    const newPrice = newData.buy_price;
    return currentPrice && newPrice && String(currentPrice) !== String(newPrice);
  }
  
  if (field === 'internal_sku') {
    return current.mapping?.internal_sku !== newData.internal_sku;
  }
  
  return false;
}

/**
 * Get icon class for conflict type
 */
function getConflictIcon(type) {
  switch (type) {
    case 'existing_mapping': return 'fas fa-sync-alt';
    case 'pending_change': return 'fas fa-clock';
    case 'duplicate_exact': return 'fas fa-copy';
    default: return 'fas fa-exclamation-triangle';
  }
}

/**
 * Handle user resolution of a conflict
 */
function resolveConflict(resolution) {
  const conflict = importConflictState.resolvableConflicts[importConflictState.currentConflictIndex];
  
  if (resolution === 'amend') {
    // User wants to amend CSV - exit workflow
    cancelImportConflict();
    showToast('Import cancelled. Please amend your CSV and re-upload.', 'info');
    return;
  }
  
  // Record the resolution
  importConflictState.resolutions[conflict.row_index] = resolution;
  
  // Move to next conflict
  importConflictState.currentConflictIndex++;
  
  if (importConflictState.currentConflictIndex >= importConflictState.resolvableConflicts.length) {
    // All conflicts resolved - close modal and execute import
    closeModal('importConflictModal');
    executeImportWithResolutions();
  } else {
    // Show next conflict
    showConflictModal(importConflictState.currentConflictIndex);
  }
}

/**
 * Cancel import conflict resolution workflow
 */
function cancelImportConflict() {
  importConflictState = {
    validationResult: null,
    resolvableConflicts: [],
    currentConflictIndex: 0,
    resolutions: {},
    isActive: false
  };
  closeModal('importConflictModal');
  resetImportForm();
}

/**
 * Execute import with user-provided resolutions
 */
async function executeImportWithResolutions() {
  const { validationResult, resolutions } = importConflictState;
  
  try {
    elements.startCsvImport.disabled = true;
    elements.startCsvImport.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    
    const response = await post('/v1/inventory/sourcing/import/execute', {
      rows: validationResult.rows,
      supplier_id: validationResult.supplier_id,
      filename: validationResult.filename,
      resolutions: resolutions
    });
    
    showImportSummary(response);
    
    // Refresh data
    await loadSupplierProducts();
    await loadPriceHistory();
    await loadComparison();
    
    // Reset form and state
    resetImportForm();
    importConflictState = {
      validationResult: null,
      resolvableConflicts: [],
      currentConflictIndex: 0,
      resolutions: {},
      isActive: false
    };
    
  } catch (error) {
    console.error('[Sourcing] Import error:', error);
    showToast('Import failed: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    elements.startCsvImport.disabled = false;
    elements.startCsvImport.innerHTML = '<i class="fas fa-upload"></i> Start Import';
  }
}

/**
 * Execute import directly (no conflicts to resolve)
 */
async function executeImport(validationResult) {
  try {
    elements.startCsvImport.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    
    const response = await post('/v1/inventory/sourcing/import/execute', {
      rows: validationResult.rows,
      supplier_id: validationResult.supplier_id,
      filename: validationResult.filename,
      resolutions: {}
    });
    
    showImportSummary(response);
    
    // Refresh data
    await loadSupplierProducts();
    await loadPriceHistory();
    await loadComparison();
    
    // Reset form
    resetImportForm();
    
  } catch (error) {
    console.error('[Sourcing] Import error:', error);
    showToast('Import failed: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    elements.startCsvImport.disabled = false;
    elements.startCsvImport.innerHTML = '<i class="fas fa-upload"></i> Start Import';
  }
}

/**
 * Show import summary modal
 */
function showImportSummary(result) {
  const modal = document.getElementById('importSummaryModal');
  if (!modal) {
    showToast(`Import complete: ${result.processed_rows} processed, ${result.skipped_rows || 0} skipped, ${result.error_rows} errors`, 'success');
    return;
  }
  
  document.getElementById('summaryTotalRows').textContent = result.total_rows;
  document.getElementById('summaryProcessed').textContent = result.processed_rows;
  document.getElementById('summarySkipped').textContent = result.skipped_rows || 0;
  document.getElementById('summaryErrors').textContent = result.error_rows;
  
  // Show error details if any
  const errorsList = document.getElementById('importErrorsList');
  const errorsBody = document.getElementById('importErrorsListBody');
  
  if (result.errors && result.errors.length > 0) {
    errorsBody.innerHTML = result.errors.map(e => 
      `<li><strong>Row ${e.row}:</strong> ${escapeHtml(e.error)}</li>`
    ).join('');
    errorsList.style.display = 'block';
  } else {
    errorsList.style.display = 'none';
  }
  
  modal.classList.add('active');
}

/**
 * Close import summary and refresh
 */
function closeImportSummary() {
  closeModal('importSummaryModal');
}

function resetImportForm() {
  selectedFile = null;
  if (elements.csvDropZone) {
    elements.csvDropZone.innerHTML = `
      <i class="fas fa-cloud-upload-alt"></i>
      <span>Drag & drop CSV file here or click to browse</span>
    `;
    elements.csvDropZone.classList.remove('file-selected');
  }
  if (elements.csvFileInput) {
    elements.csvFileInput.value = '';
  }
  updateImportButtonState();
}

/**
 * Download a template CSV file with correct column headers and sample data
 */
function downloadCsvTemplate() {
  // Define the template with headers and example rows
  const headers = ['supplier_sku', 'buy_price', 'currency', 'internal_sku', 'product_name', 'effective_date'];
  
  // Example rows to demonstrate expected format
  // Required: supplier_sku, buy_price, currency, internal_sku
  // Optional: product_name, effective_date
  const exampleRows = [
    ['SUP-001', '12.50', 'GBP', 'RM-WGT-001', 'Widget A - Standard Size', '2025-01-15'],
    ['SUP-002', '25.00', 'EUR', 'RM-GDG-002', 'Gadget B - Premium', '2025-01-15'],
    ['SUP-003', '8.75', 'USD', 'RM-CMP-003', 'Component C Pack of 10', ''],
    ['SUP-004', '150.00', 'GBP', 'RM-EQP-004', '', ''],
  ];
  
  // Build CSV content
  const csvContent = [
    headers.join(','),
    ...exampleRows.map(row => row.map(cell => {
      // Escape cells containing commas, quotes, or newlines
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(','))
  ].join('\n');
  
  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', 'supplier_pricing_template.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  showToast('Template CSV downloaded', 'success');
}

// ====== Utility Functions ======

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatCurrency(amount, currency = 'GBP') {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB');
}

/**
 * Calculate days until a future date
 * @param {string} dateStr - ISO date string (e.g., "2026-01-20")
 * @returns {number|null} - Days until date, or null if invalid/past
 */
function getDaysUntil(dateStr) {
  if (!dateStr) return null;
  
  const targetDate = new Date(dateStr);
  const today = new Date();
  
  // Reset time to midnight for accurate day calculation
  targetDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  const diffTime = targetDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays > 0 ? diffDays : null;
}

/**
 * Generate countdown HTML for pending prices
 * @param {string} effectiveDate - ISO date string
 * @returns {string} - HTML for countdown label
 */
function renderCountdown(effectiveDate) {
  const days = getDaysUntil(effectiveDate);
  
  if (days === null) return '';
  
  const isImminent = days <= 3;
  const imminentClass = isImminent ? 'imminent' : '';
  
  if (days === 1) {
    return `<span class="countdown-label ${imminentClass}"><i class="fas fa-clock"></i> Starts tomorrow</span>`;
  } else if (days <= 7) {
    return `<span class="countdown-label ${imminentClass}"><i class="fas fa-clock"></i> Starts in ${days} days</span>`;
  } else if (days <= 30) {
    const weeks = Math.floor(days / 7);
    return `<span class="countdown-label"><i class="fas fa-calendar-alt"></i> Starts in ${weeks} week${weeks > 1 ? 's' : ''}</span>`;
  } else {
    return `<span class="countdown-label"><i class="fas fa-calendar"></i> ${formatDate(effectiveDate)}</span>`;
  }
}

/**
 * Generate status badge HTML for price status
 * @param {string} status - 'active', 'pending', 'superseded', 'cancelled'
 * @returns {string} - HTML for status badge
 */
function renderPriceStatusBadge(status) {
  const statusLabels = {
    'active': 'Active',
    'pending': 'Pending',
    'superseded': 'Superseded',
    'cancelled': 'Cancelled'
  };
  
  const label = statusLabels[status] || status || 'Unknown';
  const statusClass = `status-${status || 'unknown'}`;
  
  return `<span class="price-status-badge ${statusClass}">${label}</span>`;
}

/**
 * Get CSS row class based on price status
 * @param {string} status - 'active', 'pending', 'superseded', 'cancelled'
 * @returns {string} - CSS class name for the row
 */
function getPriceRowClass(status) {
  switch (status) {
    case 'pending': return 'pending-row';
    case 'superseded': return 'superseded-row';
    case 'cancelled': return 'cancelled-row';
    default: return '';
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getMarginClass(marginPercent) {
  if (marginPercent >= 40) return 'margin-high';
  if (marginPercent >= 20) return 'margin-medium';
  if (marginPercent >= 10) return 'margin-low';
  return 'margin-critical';
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ====== Custom Dropdown Functions ======

/**
 * Setup global dropdown functions for onclick handlers
 */
let dropdownDocListenerBound = false;

function setupGlobalDropdownFunctions() {
  // Toggle dropdown open/close
  window.toggleDropdown = function(id) {
    const dropdown = document.getElementById(id);
    if (!dropdown) return;
    
    // Close other dropdowns
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      if (d.id !== id) d.classList.remove('open');
    });
    dropdown.classList.toggle('open');
  };
  
  // Close dropdowns when clicking outside (bind only once)
  if (!dropdownDocListenerBound) {
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
      }
    });
    dropdownDocListenerBound = true;
  }
  
  // Select mapping supplier filter
  window.selectMappingSupplier = function(element, value, text) {
    const dropdown = document.getElementById('mappingSupplierDropdown');
    if (!dropdown) return;
    
    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    
    if (selectedDisplay) {
      const icon = selectedDisplay.querySelector('i');
      const iconHTML = icon ? icon.outerHTML : '';
      selectedDisplay.innerHTML = `${iconHTML} ${text}`;
    }
    if (hiddenInput) hiddenInput.value = value;
    
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    dropdown.classList.remove('open');
    
    // Trigger filter update
    filterMappingsBySupplier(value);
  };
  
  // Select import supplier
  window.selectImportSupplier = function(element, value, text) {
    const dropdown = document.getElementById('importSupplierDropdown');
    if (!dropdown) return;
    
    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    
    if (selectedDisplay) {
      const icon = selectedDisplay.querySelector('i');
      const iconHTML = icon ? icon.outerHTML : '';
      selectedDisplay.innerHTML = `${iconHTML} ${text}`;
    }
    if (hiddenInput) hiddenInput.value = value;
    
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    dropdown.classList.remove('open');
    
    // Enable/disable import button
    const importBtn = document.getElementById('startCsvImport');
    if (importBtn) {
      importBtn.disabled = !value || !selectedFile;
    }
  };
  
  // Select margin report type
  window.selectMarginReport = function(element, value, text) {
    const dropdown = document.getElementById('marginReportDropdown');
    if (!dropdown) return;
    
    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    
    if (selectedDisplay) {
      const icon = selectedDisplay.querySelector('i');
      const iconHTML = icon ? icon.outerHTML : '';
      selectedDisplay.innerHTML = `${iconHTML} ${text}`;
    }
    if (hiddenInput) hiddenInput.value = value;
    
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    dropdown.classList.remove('open');
    
    // Load selected report
    loadMarginReport(value);
  };
  
  // Select mapping currency
  window.selectMappingCurrency = function(element, value, text, iconClass) {
    const dropdown = document.getElementById('mappingModalCurrencyDropdown');
    if (!dropdown) return;
    
    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = document.getElementById('mappingModalCurrency');
    
    if (selectedDisplay) {
      selectedDisplay.innerHTML = `<i class="fas ${iconClass}"></i> ${text}`;
    }
    if (hiddenInput) hiddenInput.value = value;
    
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    dropdown.classList.remove('open');
    
    console.log('[Sourcing] Currency selected:', value);
  };
  
  // Select price currency
  window.selectPriceCurrency = function(element, value, text, iconClass) {
    const dropdown = document.getElementById('priceModalCurrencyDropdown');
    if (!dropdown) return;
    
    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = document.getElementById('priceModalCurrency');
    
    if (selectedDisplay) {
      selectedDisplay.innerHTML = `<i class="fas ${iconClass}"></i> ${text}`;
    }
    if (hiddenInput) hiddenInput.value = value;
    
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    dropdown.classList.remove('open');
    
    console.log('[Sourcing] Price currency selected:', value);
  };
}

/**
 * Filter mappings by supplier
 */
function filterMappingsBySupplier(supplierId) {
  console.log('[Sourcing] Filtering mappings by supplier:', supplierId);
  // TODO: Implement mapping filter logic
  showToast(`Filtering mappings by supplier: ${supplierId || 'All'}`, 'info');
}

/**
 * Load margin report by type
 */
function loadMarginReport(reportType) {
  console.log('[Sourcing] Loading margin report:', reportType);
  // TODO: Implement margin report loading
  showToast(`Loading ${reportType} report...`, 'info');
}

/**
 * Search available SKUs from inventory_metadata
 */
async function searchAvailableSkus(query) {
  try {
    const response = await get(`/v1/inventory/sourcing/available-skus?search=${encodeURIComponent(query)}&limit=50`);
    return response?.skus || [];
  } catch (error) {
    console.error('[Sourcing] Error searching SKUs:', error);
    return [];
  }
}

/**
 * Setup SKU autocomplete for internal_sku inputs
 */
function setupSkuAutocomplete(inputElement) {
  if (!inputElement) return;
  
  let debounceTimeout;
  const dropdown = document.createElement('div');
  dropdown.className = 'sku-autocomplete-dropdown';
  dropdown.style.cssText = 'position:absolute;background:var(--surface-1);border:1px solid var(--border);border-radius:4px;max-height:300px;overflow-y:auto;z-index:1000;display:none;';
  inputElement.parentElement.style.position = 'relative';
  inputElement.parentElement.appendChild(dropdown);
  
  inputElement.addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    
    clearTimeout(debounceTimeout);
    
    if (query.length < 2) {
      dropdown.style.display = 'none';
      return;
    }
    
    debounceTimeout = setTimeout(async () => {
      const skus = await searchAvailableSkus(query);
      
      if (skus.length === 0) {
        dropdown.style.display = 'none';
        return;
      }
      
      dropdown.innerHTML = skus.map(sku => `
        <div class="sku-option" data-sku="${escapeHtml(sku.sku)}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle);">
          <div style="font-weight:500;">${escapeHtml(sku.sku)}</div>
          <div style="font-size:0.85em;color:var(--text-2);">Stock: ${sku.quantity_available ?? 'N/A'}</div>
          <div style="font-size:0.75em;color:var(--text-3);">Status: ${sku.status || 'Unknown'}</div>
        </div>
      `).join('');
      
      dropdown.style.display = 'block';
      
      // Handle selection
      dropdown.querySelectorAll('.sku-option').forEach(opt => {
        opt.addEventListener('click', () => {
          inputElement.value = opt.dataset.sku;
          dropdown.style.display = 'none';
          
          // Trigger change event to activate duplicate check
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
        });
      });
    }, 300);
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!inputElement.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// ====== Public API ======

// Expose functions for inline onclick handlers
window.sourcingModule = {
  // Modal functions
  closeModal,
  submitSupplierForm,
  submitMappingForm,
  submitPriceForm,
  submitManualEntryForm,
  selectModalSupplier,
  selectModalProduct,
  
  // Edit functions
  editSupplier: (id) => {
    showToast(`Edit supplier ${id} - Coming soon`, 'info');
  },
  editMapping: async (id) => {
    await openEditMappingModal(id);
  },
  showAllSuppliers: (sku) => {
    const product = comparison.find(p => p.internal_sku === sku);
    if (!product || !product.suppliers || product.suppliers.length === 0) {
      showToast('No suppliers found for this product', 'warning');
      return;
    }
    
    const modal = document.getElementById('allSuppliersModal');
    if (!modal) return;
    
    // Update modal title with product info
    const title = modal.querySelector('.modal-title');
    if (title) {
      title.textContent = `All Suppliers for ${sku}`;
    }
    
    // Show product details
    const details = document.getElementById('allSuppliersDetails');
    if (details) {
      const productName = product.product_name || sku;
      const sellPrice = product.sell_price ? formatCurrency(product.sell_price, 'GBP') : 'N/A';
      details.innerHTML = `
        <div style="margin-bottom: 1rem;">
          <strong>Product:</strong> ${escapeHtml(productName)}<br>
          <strong>SKU:</strong> ${escapeHtml(sku)}<br>
          <strong>Sell Price:</strong> ${sellPrice}<br>
          <strong>Current Stock:</strong> ${product.quantity_available !== undefined ? product.quantity_available : 'N/A'}
        </div>
      `;
    }
    
    // Populate suppliers table
    const tbody = document.getElementById('allSuppliersTableBody');
    if (!tbody) return;
    
    // Sort suppliers: cheapest first, then by price
    const sortedSuppliers = [...product.suppliers].sort((a, b) => {
      // Cheapest badges first
      if (a.is_cheapest && !b.is_cheapest) return -1;
      if (!a.is_cheapest && b.is_cheapest) return 1;
      
      // Then by price (if both have prices)
      if (a.buy_price_gbp && b.buy_price_gbp) {
        const aPerUnit = a.price_per_unit || a.buy_price_gbp;
        const bPerUnit = b.price_per_unit || b.buy_price_gbp;
        return aPerUnit - bPerUnit;
      }
      
      // Suppliers with prices before those without
      if (a.buy_price && !b.buy_price) return -1;
      if (!a.buy_price && b.buy_price) return 1;
      
      // Finally by supplier name
      return (a.supplier_name || '').localeCompare(b.supplier_name || '');
    });
    
    tbody.innerHTML = sortedSuppliers.map(supplier => {
      const buyPriceDisplay = supplier.buy_price ? 
        `<div>
          ${formatCurrency(supplier.buy_price, supplier.currency)}
          ${supplier.currency !== 'GBP' && supplier.buy_price_gbp ? `<br><small class="text-muted">≈ ${formatCurrency(supplier.buy_price_gbp, 'GBP')}</small>` : ''}
        </div>` : 
        '<span class="text-warning">No price</span>';
      
      const pricePerUnit = supplier.price_per_unit ? 
        formatCurrency(supplier.price_per_unit, 'GBP') : 
        (supplier.buy_price_gbp ? formatCurrency(supplier.buy_price_gbp, 'GBP') : '-');
      
      const statusBadge = supplier.is_cheapest ? 
        '<span class="status-badge active"><i class="fas fa-crown"></i> Cheapest</span>' : 
        '<span class="status-badge">Alternative</span>';
      
      return `
        <tr>
          <td>${escapeHtml(supplier.supplier_name)}</td>
          <td class="sku-cell">${escapeHtml(supplier.supplier_sku)}</td>
          <td class="price-cell">${buyPriceDisplay}</td>
          <td>${supplier.pack_size || 1}</td>
          <td class="price-cell">${pricePerUnit}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
    
    modal.classList.add('active');
  },
  
  // Refresh functions
  refreshMappings: async () => {
    await loadSupplierProducts();
    showToast('Mappings refreshed', 'success');
  },
  refreshComparison: async () => {
    await loadComparison();
    showToast('Comparison refreshed', 'success');
  },
  
  // Duplicate mapping handling
  handleDuplicateChoice: (choice) => {
    handleDuplicateChoice(choice);
  },
  
  // Cycle through cheapest suppliers for a product
  cycleCheapestSupplier: (sku) => {
    const product = comparison.find(p => p.internal_sku === sku);
    if (!product) return;
    
    const cheapestSuppliers = product.suppliers?.filter(s => s.is_cheapest) || [];
    if (cheapestSuppliers.length <= 1) return;
    
    // Get current index from the element's data attribute, or start at 0
    const supplierElement = document.getElementById(`supplier-${sku}`);
    const parentBadge = supplierElement?.closest('.cheapest-badge');
    if (!parentBadge) return;
    
    let currentIndex = parseInt(parentBadge.dataset.currentIndex || '0');
    currentIndex = (currentIndex + 1) % cheapestSuppliers.length;
    parentBadge.dataset.currentIndex = currentIndex;
    
    const newSupplier = cheapestSuppliers[currentIndex];
    
    // Update the supplier name and counter
    supplierElement.textContent = newSupplier.supplier_name;
    const counter = parentBadge.querySelector('.text-muted');
    if (counter) {
      counter.textContent = `(${currentIndex + 1} of ${cheapestSuppliers.length})`;
    }
  },
  
  // CSV Import conflict resolution
  resolveConflict,
  cancelImportConflict,
  closeImportSummary,
  downloadCsvTemplate,
  
  // Pending price management
  cancelPendingPrice,
  editPendingPrice
};

/**
 * Cleanup when leaving the module
 */
export function cleanup() {
  console.log('[Sourcing] Cleaning up module...');
  
  // Clear state
  suppliers = [];
  supplierProducts = [];
  priceHistory = [];
  pendingPrices = [];
  comparison = [];
  selectedFile = null;
  
  // Clear element references
  elements = {};
  
  // Remove global reference
  delete window.sourcingModule;
}
