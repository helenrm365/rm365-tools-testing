/**
 * Product Sourcing Module
 * Manages supplier pricing, product mappings, and margin analysis
 */
import { get, post, patch } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';

// Module state
let suppliers = [];
let supplierProducts = [];
let priceHistory = [];
let comparison = [];
let currentTab = 'comparison';

// DOM element references
let elements = {};

/**
 * Initialize the sourcing module
 */
export async function init(path = '/inventory/sourcing') {
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
    // First, ensure tables are initialized via health check
    await initializeTables();
    
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
  }
}

// ====== Data Loading Functions ======

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

    // Calculate margin insights from comparison data
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
    const response = await get('/v1/inventory/sourcing/comparison');
    comparison = response?.products || [];
    renderComparison();
  } catch (error) {
    console.error('[Sourcing] Error loading comparison:', error);
    comparison = [];
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
      <td class="products-count">--</td>
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
  
  elements.mappingsTableBody.innerHTML = products.map(product => `
    <tr data-id="${product.id}">
      <td>${escapeHtml(product.supplier_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(product.supplier_sku)}</td>
      <td>${escapeHtml(product.supplier_product_name)}</td>
      <td class="sku-cell ${!product.internal_sku ? 'unmapped' : ''}">
        ${product.internal_sku ? escapeHtml(product.internal_sku) : '<span class="unmapped-badge">Not Mapped</span>'}
      </td>
      <td class="price-cell">
        ${product.current_buy_price ? formatCurrency(product.current_buy_price) : '-'}
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
  `).join('');
}

function renderComparison() {
  if (!elements.comparisonTableBody) return;
  
  if (comparison.length === 0) {
    elements.comparisonTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          <div class="empty-state">
            <i class="fas fa-balance-scale"></i>
            <p>No comparison data available. Add supplier products and prices to see comparisons.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  elements.comparisonTableBody.innerHTML = comparison.map(product => {
    const cheapest = product.suppliers?.find(s => s.is_cheapest);
    const others = product.suppliers?.filter(s => !s.is_cheapest) || [];
    
    return `
      <tr data-sku="${product.internal_sku}">
        <td class="sku-cell">${escapeHtml(product.internal_sku)}</td>
        <td>${escapeHtml(product.internal_product_name || product.internal_sku)}</td>
        <td class="stock-cell">${product.current_stock ?? '-'}</td>
        <td class="price-cell">${product.magento_sell_price ? formatCurrency(product.magento_sell_price) : '-'}</td>
        <td class="supplier-cell cheapest">
          ${cheapest ? `
            <span class="cheapest-badge" title="Cheapest supplier">
              <i class="fas fa-crown"></i>
              ${escapeHtml(cheapest.supplier_name)}
            </span>
          ` : '-'}
        </td>
        <td class="price-cell buy-price">
          ${cheapest ? formatCurrency(cheapest.buy_price) : '-'}
        </td>
        <td class="margin-cell">
          ${product.best_margin_percent != null ? `
            <span class="${getMarginClass(product.best_margin_percent)}">
              ${product.best_margin_percent.toFixed(1)}%
            </span>
          ` : '-'}
        </td>
        <td class="other-suppliers-cell">
          ${others.length > 0 ? `
            <button class="btn btn-ghost btn-xs" onclick="window.sourcingModule.showAllSuppliers('${product.internal_sku}')">
              +${others.length} more
            </button>
          ` : '-'}
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
        <td colspan="9">
          <div class="empty-state">
            <i class="fas fa-history"></i>
            <p>No price history found. Prices will appear here as they are added or imported.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  elements.priceHistoryTableBody.innerHTML = priceHistory.map(price => `
    <tr>
      <td>${escapeHtml(price.supplier_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(price.supplier_sku)}</td>
      <td>${escapeHtml(price.supplier_product_name || '-')}</td>
      <td class="sku-cell">${escapeHtml(price.internal_sku || '-')}</td>
      <td class="price-cell">${formatCurrency(price.buy_price)}</td>
      <td>${escapeHtml(price.currency || 'GBP')}</td>
      <td>${formatDate(price.effective_date)}</td>
      <td>${escapeHtml(price.created_by || '-')}</td>
      <td>
        ${price.import_batch_id ? 
          '<span class="source-badge csv">CSV Import</span>' : 
          '<span class="source-badge manual">Manual</span>'}
      </td>
    </tr>
  `).join('');
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
    if (form) form.reset();
    
    // Populate supplier dropdown
    populateModalSupplierDropdown('mappingModalSupplierDropdown', 'mappingModalSupplierId');
    
    modal.classList.add('active');
  }
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
  
  const formData = new FormData(form);
  const data = {
    supplier_id: parseInt(formData.get('supplier_id')),
    supplier_sku: formData.get('supplier_sku'),
    internal_sku: formData.get('internal_sku') || null,
    supplier_product_name: formData.get('supplier_product_name') || null,
    buy_price: formData.get('buy_price') ? parseFloat(formData.get('buy_price')) : null,
    currency: formData.get('currency') || 'GBP',
    notes: formData.get('notes') || null,
    is_active: formData.get('is_active') === 'on'
  };
  
  try {
    await post('/v1/inventory/sourcing/products', data);
    showToast('Product mapping added successfully', 'success');
    closeModal('addMappingModal');
    await loadSupplierProducts();
  } catch (error) {
    console.error('[Sourcing] Error adding mapping:', error);
    showToast('Failed to add product mapping', 'error');
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
    elements.startCsvImport.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    
    const response = await fetch(`${window.location.origin}/api/v1/inventory/sourcing/import/csv`, {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const result = await response.json();
    
    if (response.ok) {
      showToast(`Import complete: ${result.processed_rows} processed, ${result.error_rows} errors`, 'success');
      
      // Refresh data
      await loadSupplierProducts();
      await loadComparison();
      
      // Reset form
      resetImportForm();
    } else {
      showToast(`Import failed: ${result.detail || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Sourcing] Import error:', error);
    showToast('Import failed', 'error');
  } finally {
    elements.startCsvImport.disabled = false;
    elements.startCsvImport.innerHTML = '<i class="fas fa-upload"></i> Start Import';
  }
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
  editMapping: (id) => {
    showToast(`Edit mapping ${id} - Coming soon`, 'info');
  },
  showAllSuppliers: (sku) => {
    showToast(`Show all suppliers for ${sku} - Coming soon`, 'info');
  }
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
  comparison = [];
  selectedFile = null;
  
  // Clear element references
  elements = {};
  
  // Remove global reference
  delete window.sourcingModule;
}
