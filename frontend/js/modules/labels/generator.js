// js/modules/labels/generator.js
import { getProductsToPrint, createPrintJob, downloadPDF, downloadCSV, initDependencies, getPresets, createPreset, updatePreset, deletePreset, checkTablesStatus, initializeTables } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';
import { getToken } from '../../services/state/sessionStore.js';
import { getUserData } from '../../services/state/userStore.js';
import { syncUKMagentoData, syncFRMagentoData, syncNLMagentoData } from '../../services/api/magentoDataApi.js';
import { post } from '../../services/api/http.js';
import { confirmModal } from '../../ui/confirmationModal.js';
import { getApiUrl } from '../../config.js';
import { initDropdown } from '../../ui/dropdown.js';

// Default status filters (ALL statuses checked by default)
const DEFAULT_STATUS_FILTERS = [
  'Active', 
  'Temporarily OOS', 
  'Pre Order', 
  'Samples',
  'Discontinued (Supplier)',
  'Discontinued (RM)',
  'Special Offer',
  'Special Item'
];

let state = {
  allProducts: [],       // All products from API
  filteredProducts: [],  // Products after applying discontinued status filters
  displayedProducts: [], // Products after applying search filter
  selectedProducts: new Set(),
  statusFilters: DEFAULT_STATUS_FILTERS,  // Always start with all filters
  region: "uk",          // Default region preference for prices/names
  currentPresetId: null, // Track currently loaded preset
  showOrphaned: false,   // Whether to show orphaned SKUs (products without names)
  editingPresetSkus: []  // SKUs being edited in the edit preset modal
};

// Utility functions
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text?.replace(/[&<>"']/g, m => map[m]) || '';
}

function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Format status names for display (shorten long ones)
function formatStatusDisplay(status) {
  const displayMap = {
    'Discontinued (Supplier)': 'Disc. (Supp)',
    'Discontinued (RM)': 'Disc. (RM)',
    'Temporarily OOS': 'Temp. OOS'
  };
  return displayMap[status] || status;
}

// Debounce utility for instant filtering with delay
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

export async function initLabelGenerator() {
  showToast('Initializing Label Generator...', 'info');
  
  // Check tables status and initialize if needed (like Magento Data)
  try {
    showToast('Checking database tables...', 'info');
    const statusResult = await checkTablesStatus();
    if (statusResult.status === 'success' && !statusResult.all_tables_exist) {
      showToast('Initializing label tables...', 'info');
      console.log('[Labels] Some tables missing, initializing...', statusResult.tables_status);
      await initializeTables();
      console.log('[Labels] Tables initialized successfully');
    }
  } catch (error) {
    console.error('[Labels] Error checking/initializing tables:', error);
    // Continue anyway - loadProducts will handle errors
  }
  
  showToast('Setting up filters & controls...', 'info');
  // Setup status filter checkboxes (all checked by default)
  setupStatusFilterCheckboxes();
  initDropdown('#overwritePresetSelect');
  
  // Setup region selection
  setupRegionSelection();
  
  // Setup unified filter panel
  setupUnifiedFilterPanel();
  
  // Setup event listeners immediately so search works while loading
  setupEventListeners();
  
  // Setup product table event delegation once
  setupProductTableDelegation();

  showToast('Loading product catalog...', 'info');
  // Load initial data
  await loadProducts();
  
  updateUI();
}

// Update filter count display
function updateFilterCount() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  const countElement = document.getElementById('labelActiveFiltersCount');
  if (countElement) {
    countElement.textContent = `${checkedCount} of ${totalCount}`;
  }
}

function setupStatusFilterCheckboxes() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  
  // Create debounced filter apply function
  const debouncedApplyFilters = debounce(async () => {
    // Get current filter state
    const selectedFilters = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    
    // Update state
    state.statusFilters = selectedFilters;
    
    // Clear selections when changing filters
    state.selectedProducts.clear();
    
    try {
      // Reload products with new filters
      await loadProducts();
      
    } catch (error) {
      console.error('[Labels] Error applying filters:', error);
      showToast('Error applying filters', 'error');
    }
  }, 500); // 500ms debounce
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = state.statusFilters.includes(checkbox.value);
    
    // Add change listener for instant visual feedback and debounced filtering
    checkbox.addEventListener('change', () => {
      // Instant visual update
      updateStatusFilterVisuals();
      updateFilterCount();
      
      // Debounced filter application
      debouncedApplyFilters();
    });
  });
  
  // Initial visual update
  updateStatusFilterVisuals();
  // Initial count update
  updateFilterCount();
}

function updateStatusFilterVisuals() {
  const filters = document.querySelectorAll('.status-filter, .status-filter-compact');
  
  filters.forEach(filter => {
    const checkbox = filter.querySelector('.status-filter-checkbox');
    if (checkbox && checkbox.checked) {
      filter.classList.add('checked');
    } else {
      filter.classList.remove('checked');
    }
  });
}

function setupRegionSelection() {
  const regionRadios = document.querySelectorAll('.region-radio');
  
  regionRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.region = e.target.value;
        // Reload products with new region preference
        loadProducts();
      }
    });
  });
}

// === Unified Filter Panel Setup ===
function setupUnifiedFilterPanel() {
  // Initialize FilterControlPanel component
  window.labelsFilterPanel = FilterControlPanel.init('filterPanelCollapseBtn', 'filterPanelBody');
  
  // Search input — Enter key handler
  const searchInput = document.getElementById('productSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch({ target: searchInput });
      }
    });
  }
  
  // Make product search icon clickable
  const productSearchIcon = document.getElementById('productSearchIcon');
  if (productSearchIcon && searchInput) {
    productSearchIcon.addEventListener('click', () => {
      handleSearch({ target: searchInput });
    });
  }
  
  // Preset search functionality
  const presetSearchInput = document.getElementById('presetSearchInput');
  const presetSearchIcon = document.querySelector('.preset-search-icon');
  
  if (presetSearchInput) {
    presetSearchInput.addEventListener('input', debounce((e) => {
      filterPresets(e.target.value.trim().toLowerCase());
    }, 300));
    
    // Add Enter key handler for preset search
    presetSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        filterPresets(e.target.value.trim().toLowerCase());
      }
    });
  }
  
  // Make preset search icon clickable
  if (presetSearchIcon && presetSearchInput) {
    presetSearchIcon.addEventListener('click', () => {
      filterPresets(presetSearchInput.value.trim().toLowerCase());
    });
  }
  
  // Update preset count badge
  updatePresetCountBadge();
}

// Filter presets based on search query
function filterPresets(query) {
  const presetCards = document.querySelectorAll('.preset-card');
  
  if (!query) {
    // Show all presets
    presetCards.forEach(card => {
      card.style.display = 'flex';
    });
    return;
  }
  
  // Filter presets
  presetCards.forEach(card => {
    const name = card.querySelector('.preset-name')?.textContent.toLowerCase() || '';
    const description = card.querySelector('.preset-description')?.textContent.toLowerCase() || '';
    
    if (name.includes(query) || description.includes(query)) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

function updatePresetCountBadge() {
  const badge = document.getElementById('presetCountBadge');
  if (badge) {
    const count = presets.length;
    badge.textContent = count === 0 ? 'No presets' : `${count} saved`;
  }
}

async function loadProducts(isBackground = false) {
  const errorEl = document.querySelector('#errorMessage');
  
  if (errorEl) errorEl.style.display = 'none';
  
  try {
    // Save current selections by SKU (SKUs are consistent across regions)
    const previouslySelectedSKUs = new Set(
      Array.from(state.selectedProducts).map(itemId => {
        const product = state.allProducts.find(p => p.item_id === itemId);
        return product ? product.sku : null;
      }).filter(sku => sku !== null)
    );
    
    // Fetch products with current status filters, region preference, and orphaned setting
    state.allProducts = await getProductsToPrint(state.statusFilters, state.region, state.showOrphaned);
    state.filteredProducts = [...state.allProducts];
    
    // Re-apply search filter if exists
    const searchInput = document.querySelector('#productSearchInput');
    if (searchInput && searchInput.value.trim()) {
      const query = searchInput.value.toLowerCase().trim();
      
      state.displayedProducts = state.filteredProducts.filter(p => {
        return (
          (p.sku || '').toLowerCase().includes(query) ||
          (p.product_name || '').toLowerCase().includes(query) ||
          (p.item_id || '').toLowerCase().includes(query)
        );
      });
    } else {
      state.displayedProducts = [...state.filteredProducts];
    }
    
    // Restore selections based on SKUs that were previously selected
    state.selectedProducts.clear();
    if (previouslySelectedSKUs.size > 0) {
      state.allProducts.forEach(product => {
        if (previouslySelectedSKUs.has(product.sku)) {
          state.selectedProducts.add(product.item_id);
        }
      });
    }
    
    // Update select all checkbox based on whether all visible products are selected
    const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
    if (selectAllCheckbox) {
      const allSelected = state.displayedProducts.length > 0 && 
        state.displayedProducts.every(p => state.selectedProducts.has(p.item_id));
      selectAllCheckbox.checked = allSelected;
    }
    
    renderProductTable();
    updateStats();
  } catch (error) {
    console.error('[Labels] Error loading products:', error);
    
    // Check if error is about missing magento data tables
    const errorMessage = error.message || '';
    if (errorMessage.includes('Magento data tables not initialized')) {
      // Show a helpful error message with action button
      showMagentoDataInitError();
    } else {
      // Show generic error toast
      showToast('Connection failed - Using sample data', 'error');
    }
    
    // Fallback: Use sample data for testing
    state.allProducts = [
      {
        sku: 'SAMPLE001',
        product_name: 'Sample Product 1',
        uk_6m_data: 150,
        fr_6m_data: 85,
        uk_price: '29.99',
        fr_price: '34.99',
        discontinued_status: 'Active',
        categories: 'Sample Category'
      },
      {
        sku: 'SAMPLE002',
        product_name: 'Sample Product 2',
        uk_6m_data: 220,
        fr_6m_data: 120,
        uk_price: '19.99',
        fr_price: '22.99',
        discontinued_status: 'Active',
        categories: 'Sample Category'
      },
      {
        sku: 'SAMPLE003',
        product_name: 'Sample Product 3 (Discontinued)',
        uk_6m_data: 45,
        fr_6m_data: 20,
        uk_price: '15.99',
        fr_price: '18.99',
        discontinued_status: 'Discontinued (RM)',
        categories: 'Sample Category'
      }
    ];
    state.filteredProducts = [...state.allProducts];
    
    // Re-apply search filter if exists
    const searchInput = document.querySelector('#productSearchInput');
    if (searchInput && searchInput.value.trim()) {
      handleSearch({ target: searchInput });
    } else {
      state.displayedProducts = [...state.filteredProducts];
    }
    
    // Clear selections when loading fails
    state.selectedProducts.clear();
    
    // Ensure select all checkbox is unchecked
    const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
    }
    
    renderProductTable();
    updateStats();
  }
}

// Show specific error UI for magento data initialization
function showMagentoDataInitError() {
  // Create or update error message element
  let errorEl = document.querySelector('#magentoDataError');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.id = 'magentoDataError';
    errorEl.className = 'magento-data-error';
    
    // Insert at the top of generator-content
    const contentEl = document.querySelector('.generator-content');
    if (contentEl) {
      contentEl.insertBefore(errorEl, contentEl.firstChild);
    }
  }
  
  errorEl.innerHTML = `
    <div class="error-card">
      <div class="error-header">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Magento Data Not Initialized</h3>
      </div>
      <div class="error-body">
        <p>The label generator requires magento data tables to be set up first. This provides pricing information and sales history for your products.</p>
        <div class="error-actions">
          <button class="btn btn-solid btn-success" onclick="window.location.href='/magentodata'">
            <i class="fas fa-database"></i>
            Go to Magento Data Module
          </button>
          <button class="btn btn-flat btn-primary" onclick="initMagentoDataFromLabels()">
            <i class="fas fa-magic"></i>
            Initialize Here
          </button>
          <button class="btn btn-flat btn-default" onclick="retryLoadProducts()">
            <i class="fas fa-redo"></i>
            Retry
          </button>
        </div>
      </div>
    </div>
  `;
  
  errorEl.style.display = 'block';
}

// Initialize magento data from labels module
async function initMagentoDataFromLabels() {
  const button = document.querySelector('#magentoDataError .btn');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';
  }
  
  try {
    const result = await initDependencies();
    
    if (result.status === 'success') {
      showToast('Magento data initialized successfully! Reloading products...', 'success');
      // Hide error and reload
      const errorEl = document.querySelector('#magentoDataError');
      if (errorEl) errorEl.style.display = 'none';
      await loadProducts();
    } else {
      throw new Error(result.message || 'Failed to initialize');
    }
  } catch (error) {
    console.error('[Labels] Error initializing magento data:', error);
    showToast('Failed to initialize magento data: ' + error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-magic"></i> Initialize Here';
    }
  }
}

// Retry loading products
async function retryLoadProducts() {
  const errorEl = document.querySelector('#magentoDataError');
  if (errorEl) errorEl.style.display = 'none';
  await loadProducts();
}

// Make functions available globally for onclick handlers
window.initMagentoDataFromLabels = initMagentoDataFromLabels;
window.retryLoadProducts = retryLoadProducts;

function setupEventListeners() {
  // Search
  const searchInput = document.querySelector('#productSearchInput');
  
  if (searchInput) {
    // Add debounced handler for search
    const debouncedSearch = debounce(handleSearch, 300);
    searchInput.addEventListener('input', debouncedSearch);
  }
  
  // Show orphaned checkbox
  const showOrphanedCheckbox = document.getElementById('showOrphanedCheckbox');
  if (showOrphanedCheckbox) {
    showOrphanedCheckbox.addEventListener('change', async (e) => {
      state.showOrphaned = e.target.checked;
      console.log('[Labels] Show orphaned toggled:', state.showOrphaned);
      
      // Show loading feedback
      const totalEl = document.querySelector('#totalProducts');
      const originalTotal = totalEl?.textContent || '0';
      if (totalEl) {
        totalEl.textContent = '...';
      }
      
      try {
        await loadProducts();
        showToast(
          state.showOrphaned 
            ? 'Showing orphaned products' 
            : 'Hiding orphaned products',
          'success'
        );
      } catch (error) {
        console.error('[Labels] Error reloading products:', error);
        showToast('Failed to reload products', 'error');
        // Restore original count on error
        if (totalEl) {
          totalEl.textContent = originalTotal;
        }
      }
    });
  }
  
  // Select all checkbox
  const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', handleSelectAll);
  }
  
  // Generate PDF button
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    generatePdfBtn.addEventListener('click', handleGeneratePdf);
  }
  
  // Refresh button
  const refreshBtn = document.querySelector('#refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const icon = refreshBtn.querySelector('i');
      if (!icon) return;
      
      // Disable button and animate icon
      refreshBtn.disabled = true;
      icon.className = 'fas fa-sync-alt fa-spin';
      
      try {
        await loadProducts();
        showToast('Products refreshed', 'success');
      } catch (error) {
        showToast('Failed to refresh', 'error');
      } finally {
        // Re-enable button and stop animation
        refreshBtn.disabled = false;
        icon.className = 'fas fa-sync-alt';
      }
    });
  }
  
  // Preset buttons
  const savePresetBtn = document.getElementById('savePresetBtn');
  console.log('[Labels] savePresetBtn found:', !!savePresetBtn);
  if (savePresetBtn) {
    savePresetBtn.addEventListener('click', () => {
      console.log('[Labels] Save preset button clicked');
      showSavePresetModal();
    });
  }
  
  const managePresetsBtn = document.getElementById('managePresetsBtn');
  console.log('[Labels] managePresetsBtn found:', !!managePresetsBtn);
  if (managePresetsBtn) {
    managePresetsBtn.addEventListener('click', () => {
      console.log('[Labels] Manage presets button clicked');
      showManagePresetsModal();
    });
  }
  
  const confirmSavePresetBtn = document.getElementById('confirmSavePresetBtn');
  if (confirmSavePresetBtn) {
    confirmSavePresetBtn.addEventListener('click', savePreset);
  }
  
  const confirmEditPresetBtn = document.getElementById('confirmEditPresetBtn');
  if (confirmEditPresetBtn) {
    confirmEditPresetBtn.addEventListener('click', editPreset);
  }
  
  // Save option toggle
  const saveOptionRadios = document.querySelectorAll('input[name="saveOption"]');
  saveOptionRadios.forEach(radio => {
    radio.addEventListener('change', handleSaveOptionChange);
  });
  
  // Overwrite preset dropdown change handler
  const overwritePresetSelect = document.getElementById('overwritePresetSelect');
  if (overwritePresetSelect) {
    overwritePresetSelect.addEventListener('change', handleOverwritePresetChange);
  }
  
  // Update preset contents checkbox
  const updateContentsCheckbox = document.getElementById('updatePresetContents');
  if (updateContentsCheckbox) {
    updateContentsCheckbox.addEventListener('change', handleUpdateContentsToggle);
  }
  
  // Load presets initially
  loadPresets();
}

function handleSearch(e) {
  console.log('[Labels Search] === HANDLE SEARCH CALLED ===');
  const query = e.target.value.toLowerCase().trim();
  
  console.log(`[Labels Search] Query: "${query}"`);
  console.log(`[Labels Search] Filtering from ${state.filteredProducts.length} products`);
  console.log(`[Labels Search] State allProducts: ${state.allProducts.length}`);
  console.log(`[Labels Search] State filteredProducts: ${state.filteredProducts.length}`);
  console.log(`[Labels Search] State displayedProducts: ${state.displayedProducts.length}`);
  
  
  if (!query) {
    state.displayedProducts = [...state.filteredProducts];
    console.log(`[Labels Search] No query - showing all ${state.displayedProducts.length} products`);
  } else {
    state.displayedProducts = state.filteredProducts.filter(p => {
      const skuMatch = (p.sku || '').toLowerCase().includes(query);
      const nameMatch = (p.product_name || '').toLowerCase().includes(query);
      const itemIdMatch = (p.item_id || '').toLowerCase().includes(query);
      return skuMatch || nameMatch || itemIdMatch;
    });
    
    console.log(`[Labels Search] Found ${state.displayedProducts.length} matching products`);
  }
  
  renderProductTable();
  updateStats();
}

function handleSelectAll(e) {
  const selectAllCheckbox = e.target;
  
  // When change event fires, checked property is already in the NEW state
  // If now checked → select all
  // If now unchecked → deselect all
  if (selectAllCheckbox.checked) {
    // Select all displayed products (filtered + searched)
    state.displayedProducts.forEach(p => state.selectedProducts.add(p.item_id));
  } else {
    // Deselect all displayed products
    state.displayedProducts.forEach(p => state.selectedProducts.delete(p.item_id));
  }
  
  renderProductTable();
  updateStats();
}

function handleProductSelect(itemId, checked) {
  if (checked) {
    state.selectedProducts.add(itemId);
  } else {
    state.selectedProducts.delete(itemId);
  }
  
  // Update the row's selected class
  const checkbox = document.querySelector(`.product-checkbox[data-item-id="${itemId}"]`);
  if (checkbox) {
    const row = checkbox.closest('tr');
    if (row) {
      if (checked) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    }
  }
  
  // Update select all checkbox based on whether all displayed products are selected
  updateSelectAllCheckbox();
  
  updateStats();
}

function updateSelectAllCheckbox() {
  const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
  if (!selectAllCheckbox || state.displayedProducts.length === 0) {
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
    return;
  }
  
  // Count how many displayed products are selected
  const selectedCount = state.displayedProducts.filter(p => 
    state.selectedProducts.has(p.item_id)
  ).length;
  
  const totalCount = state.displayedProducts.length;
  
  if (selectedCount === 0) {
    // Nothing selected - unchecked
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (selectedCount === totalCount) {
    // Everything selected - checked
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    // Some selected - indeterminate (dash)
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

function renderProductTable() {
  const tbody = document.querySelector('#productsTableBody');
  if (!tbody) return;
  
  if (state.displayedProducts.length === 0) {
    tbody.innerHTML = `
      <tr>
  <td colspan="7" class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-message">No products found</div>
          <div class="empty-submessage">Try adjusting your filters or search criteria</div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = state.displayedProducts.map(product => {
    const isChecked = state.selectedProducts.has(product.item_id);
    return `
      <tr class="${isChecked ? 'selected' : ''}">
        <td>
          <input 
            type="checkbox" 
            class="product-checkbox" 
            data-item-id="${product.item_id}"
            ${isChecked ? 'checked' : ''}
          >
        </td>
        <td class="product-sku">${escapeHtml(product.sku || '-')}</td>
        <td class="product-name" title="${escapeHtml(product.product_name || '-')}">${escapeHtml(product.product_name || '-')}</td>
  <td class="price-data">${escapeHtml(formatPrice(product.price))}</td>
        <td>${escapeHtml(product.item_id || '-')}</td>
  <td class="magento-data">${escapeHtml(String(product.uk_6m_data ?? '0'))}</td>
  <td class="magento-data">${escapeHtml(String(product.fr_6m_data ?? '0'))}</td>
      </tr>
    `;
  }).join('');
  
  // Update select all checkbox state after rendering
  updateSelectAllCheckbox();
  
  // Re-initialize table sorting after rendering new content
  if (typeof initializeTableSorting !== 'undefined') {
    initializeTableSorting('.products-table');
  }
}

// Set up event delegation for product checkboxes once
function setupProductTableDelegation() {
  const tbody = document.querySelector('#productsTableBody');
  if (!tbody) return;
  
  // Use event delegation - single listener for all checkboxes
  tbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('product-checkbox')) {
      handleProductSelect(e.target.dataset.itemId, e.target.checked);
    }
  });
}

function updateStats() {
  const totalEl = document.querySelector('#totalProducts');
  const selectedEl = document.querySelector('#selectedProducts');
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  
  if (totalEl) totalEl.textContent = state.displayedProducts.length;
  if (selectedEl) selectedEl.textContent = state.selectedProducts.size;
  
  // Enable button if there are products (either selected or filtered)
  // If nothing is selected, we'll print all filtered products
  if (generatePdfBtn) {
    generatePdfBtn.disabled = state.displayedProducts.length === 0;
    
    // Update button text to indicate what will be printed
    if (state.selectedProducts.size === 0 && state.displayedProducts.length > 0) {
      generatePdfBtn.textContent = `📄 Generate PDF Labels (All ${state.displayedProducts.length})`;
    } else if (state.selectedProducts.size > 0) {
      generatePdfBtn.textContent = `📄 Generate PDF Labels (${state.selectedProducts.size} Selected)`;
    } else {
      generatePdfBtn.textContent = '📄 Generate PDF Labels';
    }
  }
}

function updateUI() {
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    // Enable button if there are products (either selected or filtered)
    generatePdfBtn.disabled = state.displayedProducts.length === 0;
    
    // Update button text to indicate what will be printed
    if (state.selectedProducts.size === 0 && state.displayedProducts.length > 0) {
      generatePdfBtn.textContent = `📄 Generate PDF Labels (All ${state.displayedProducts.length})`;
    } else if (state.selectedProducts.size > 0) {
      generatePdfBtn.textContent = `📄 Generate PDF Labels (${state.selectedProducts.size} Selected)`;
    } else {
      generatePdfBtn.textContent = '📄 Generate PDF Labels';
    }
  }
}

async function handleGeneratePdf() {
  // Check if there are any products to print
  if (state.displayedProducts.length === 0) {
    showToast('No products available to print', 'error');
    return;
  }
  
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    generatePdfBtn.disabled = true;
    generatePdfBtn.textContent = '⏳ Creating Job...';
  }
  
  try {
    // Determine which products to print:
    // Get item IDs in the current visual/sorted order from the DOM
    // This preserves whatever column sort the user applied
    const allRowsInOrder = Array.from(document.querySelectorAll('#productsTableBody tr .product-checkbox'))
      .map(checkbox => checkbox.dataset.itemId)
      .filter(id => id); // Filter out any undefined/null
    
    let itemIdsToUse;
    if (state.selectedProducts.size > 0) {
      // User selected specific products - filter to selected ones but preserve DOM sort order
      const selectedSet = state.selectedProducts;
      itemIdsToUse = allRowsInOrder.filter(id => selectedSet.has(id));
    } else {
      // No selection - use all products in their current sorted order
      itemIdsToUse = allRowsInOrder;
    }
    
    // Get current user email
    const userData = getUserData();
    const userEmail = userData?.email || userData?.username || 'unknown';
    
    // Create print job with item IDs, status filters, and region
    const payload = {
      created_by: userEmail,
      item_ids: itemIdsToUse,
      discontinued_statuses: state.statusFilters,
      region: state.region
    };
    const result = await createPrintJob(payload);
    const jobId = result.job_id;
    const itemCount = result.item_count || state.selectedProducts.size;
    if (itemCount === 0) {
      showToast('Warning: Print job created but no items were added', 'warning');
      return;
    }
    
    showToast(`Print job created with ${itemCount} labels!`, 'success');
    
    // Automatically start PDF download
    try {
      if (generatePdfBtn) {
        generatePdfBtn.textContent = '⏳ Generating PDF...';
      }
      
      await downloadPDF(jobId);
      showToast('PDF downloaded successfully!', 'success');
      
      // Show modal for additional downloads (CSV) if needed
      showPdfPreviewModal(jobId, itemCount);
      
    } catch (pdfError) {
      console.error('[Labels] PDF download failed:', pdfError);
      showToast('PDF created but download failed: ' + pdfError.message, 'error');
      
      // Still show modal so user can try again
      showPdfPreviewModal(jobId, itemCount);
    }
    
  } catch (error) {
    console.error('[Labels] Error creating print job:', error);
    showToast('Failed to create print job: ' + error.message, 'error');
  } finally {
    if (generatePdfBtn) {
      generatePdfBtn.disabled = false;
    }
    // Update button text properly to show selection count
    updateStats();
  }
}

function showPdfPreviewModal(jobId, itemCount) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex'; // Ensure it's visible
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h3>✅ Label Job Created</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 1.5rem;">
          Your label print job <strong>#${jobId}</strong> has been created with <strong>${itemCount}</strong> products.
        </p>
        <p style="margin-bottom: 1.5rem; color: #666; font-size: 0.9rem;">
          Choose an option below to view or print your labels.
        </p>
        <div style="display: flex; gap: 1rem; flex-direction: column;">
          <button class="modern-button" id="openPdfBtn" style="width: 100%; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; font-weight: 600; padding: 1rem; font-size: 1.1rem;">
            📖 Open PDF
          </button>
          <button class="modern-button" id="printPdfBtn" style="width: 100%; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; padding: 0.75rem;">
            🖨️ Print PDF
          </button>
          <button class="modern-button" id="manualDownloadBtn" style="width: 100%; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 0.75rem;">
            💾 Manual Download
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  // Ensure modal is visible
  setTimeout(() => {
    modal.style.display = 'flex';
    modal.style.opacity = '1';
  }, 10);
  
  // Helper function to fetch PDF with authentication and create blob URL
  const getPdfBlobUrl = async () => {
    const BASE = getApiUrl().replace(/\/+$/, '');
    const API = '/v1/labels';
    const url = `${BASE}${API}/job/${jobId}/pdf`;
    const token = getToken();
    
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch PDF: ${response.statusText}. ${errorText}`);
    }
    
    const blob = await response.blob();
    if (blob.size === 0) {
      throw new Error('Received empty PDF file');
    }
    
    return window.URL.createObjectURL(blob);
  };
  
  // Open PDF in new tab
  modal.querySelector('#openPdfBtn').addEventListener('click', async () => {
    const btn = modal.querySelector('#openPdfBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Loading PDF...';
    btn.disabled = true;
    
    try {
      const blobUrl = await getPdfBlobUrl();
      window.open(blobUrl, '_blank');
      showToast('PDF opened in new tab', 'success');
      
      // Clean up blob URL after a delay
      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
      }, 30000);
      
    } catch (error) {
      console.error('[Labels] PDF open error:', error);
      showToast('Failed to open PDF: ' + error.message, 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
  
  // Print PDF directly
  modal.querySelector('#printPdfBtn').addEventListener('click', async () => {
    const btn = modal.querySelector('#printPdfBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Loading PDF...';
    btn.disabled = true;
    
    try {
      const blobUrl = await getPdfBlobUrl();
      const printWindow = window.open(blobUrl, '_blank');
      
      if (printWindow) {
        // Wait for PDF to load then trigger print
        printWindow.addEventListener('load', () => {
          setTimeout(() => {
            printWindow.print();
          }, 1000);
        });
        showToast('PDF opened for printing', 'success');
        
        // Clean up blob URL after a delay
        setTimeout(() => {
          window.URL.revokeObjectURL(blobUrl);
        }, 60000);
        
      } else {
        showToast('Please allow pop-ups to print the PDF', 'error');
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch (error) {
      console.error('[Labels] PDF print error:', error);
      showToast('Failed to open PDF for printing: ' + error.message, 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
  
  // Manual download
  modal.querySelector('#manualDownloadBtn').addEventListener('click', async () => {
    const btn = modal.querySelector('#manualDownloadBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Downloading...';
    btn.disabled = true;
    
    try {
      await downloadPDF(jobId);
      showToast('PDF downloaded successfully!', 'success');
      btn.textContent = '✓ Downloaded';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } catch (error) {
      console.error('[Labels] PDF download error:', error);
      showToast('Failed to download PDF: ' + error.message, 'error');
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function formatPrice(price) {
  if (price === null || price === undefined) {
    return '-';
  }

  // Backend returns formatted strings: "£24.99", "€24.99", or "N/A"
  // Return as-is to preserve the correct currency symbol
  if (typeof price === 'string') {
    const text = price.trim();
    return text.length ? text : '-';
  }

  // Legacy support: if price is a number, format with region-appropriate symbol
  if (typeof price === 'number') {
    if (!Number.isFinite(price)) {
      return '-';
    }
    const symbol = state.region === 'uk' ? '£' : '€';
    return `${symbol}${price.toFixed(2)}`;
  }

  return '-';
}

function handleSaveOptionChange(e) {
  const option = e.target.value;
  
  // Show/hide fields based on selected option
  document.getElementById('newPresetFields').style.display = option === 'new' ? 'block' : 'none';
  document.getElementById('overwriteOtherPresetField').style.display = option === 'overwrite-other' ? 'block' : 'none';
  document.getElementById('currentPresetInfo').style.display = option === 'overwrite-current' ? 'block' : 'none';
  
  // Handle specific options
  if (option === 'overwrite-other') {
    // Populate overwrite dropdown with all presets except current
    const selectEl = document.getElementById('overwritePresetSelect');
    
    // Reset the dropdown
    selectEl.value = '';
    
    // Build select options
    const availablePresets = presets.filter(p => p.id !== state.currentPresetId);
    selectEl.innerHTML = 
      `<option value="" disabled selected>-- Select a preset --</option>` +
      availablePresets
        .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
        .join('');
    
    document.getElementById('presetDescription').value = '';
  } else if (option === 'overwrite-current') {
    // Show current preset info
    const currentPreset = presets.find(p => p.id === state.currentPresetId);
    if (currentPreset) {
      document.getElementById('currentPresetName').textContent = currentPreset.name;
      document.getElementById('currentPresetDescription').textContent = currentPreset.description || 'No description';
      document.getElementById('presetDescription').value = currentPreset.description || '';
    }
  } else {
    // New preset - clear fields
    document.getElementById('presetDescription').value = '';
  }
}

function handleOverwritePresetChange(e) {
  const presetId = parseInt(e.target.value);
  if (presetId) {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      // Populate the description field with the existing preset's description
      document.getElementById('presetDescription').value = preset.description || '';
      
      // Show products in the preset
      renderOverwritePresetProductList(preset);
    }
  } else {
    // Clear description if no preset selected
    document.getElementById('presetDescription').value = '';
    
    // Show current selection instead
    renderSavePresetProductList();
  }
}

function renderOverwritePresetProductList(preset) {
  const listContainer = document.getElementById('savePresetProductList');
  if (!listContainer) return;
  
  const skus = preset.product_skus || [];
  
  if (skus.length === 0) {
    listContainer.innerHTML = '<div class="preset-product-empty">No products in this preset</div>';
    return;
  }
  
  listContainer.innerHTML = skus.map(sku => `
    <div class="preset-product-item">
      <span class="preset-product-sku">${escapeHtml(sku)}</span>
      <span class="preset-product-name">Will be replaced with current selection</span>
    </div>
  `).join('');
}

function handleUpdateContentsToggle(e) {
  const summaryDiv = document.getElementById('currentSelectionSummary');
  if (e.target.checked) {
    // Show current selection summary
    document.getElementById('currentStatusCount').textContent = state.statusFilters.length;
    document.getElementById('currentRegion').textContent = state.region.toUpperCase();
    document.getElementById('currentProductCount').textContent = state.selectedProducts.size;
    summaryDiv.style.display = 'flex';
  } else {
    summaryDiv.style.display = 'none';
  }
}

// State management for sync
let isSyncing = false;

/**
* Auto-sync on page load (but avoid repeat syncs via cooldown)
*/
async function initAutoSync() {
  const lastSync = localStorage.getItem('lastLabelsSync');
  if (lastSync) {
    const diffMins = (new Date() - new Date(lastSync)) / 60000;
    if (diffMins < 5) {
      return;
    }
  }
  await syncMagentoData(false); // false = don’t show alert
  localStorage.setItem('lastLabelsSync', new Date().toISOString());
}

/**
* Unified magento sync function
*/
async function syncMagentoData(showNotification = true) {
  if (isSyncing) return;
  
  try {
    isSyncing = true;
    if (showNotification) {
      showToast('Starting Magento sync...', 'info');
    }

    // 1. Sync UK, FR, NL Magento Data (Live -> Cache -> Aggregated)
    try {
        if (showNotification) showToast('Syncing UK Magento data...', 'info');
        await syncUKMagentoData();
    } catch (e) {
        console.error('Failed to sync UK data:', e);
        if (showNotification) showToast('Failed to sync UK data', 'error');
    }

    try {
        if (showNotification) showToast('Syncing FR Magento data...', 'info');
        await syncFRMagentoData();
    } catch (e) {
        console.error('Failed to sync FR data:', e);
        if (showNotification) showToast('Failed to sync FR data', 'error');
    }

    try {
        if (showNotification) showToast('Syncing NL Magento data...', 'info');
        await syncNLMagentoData();
    } catch (e) {
        console.error('Failed to sync NL data:', e);
        if (showNotification) showToast('Failed to sync NL data', 'error');
    }

    // 2. Sync Inventory Metadata (Aggregated -> Inventory Metadata)
    if (showNotification) showToast('Updating inventory metadata...', 'info');
    const res = await post('/v1/inventory/management/sync-magento-data', {
      dry_run: false
    });
    
    if (res && res.status === 'success') {
      const updated = res.stats?.updated_records ?? 0;
      if (showNotification) {
        showToast(`Magento data synced! ${updated} records updated`, 'success');
      }
      
      // Reload products to show latest data
      await loadProducts(true);
      
      localStorage.setItem('lastLabelsSync', new Date().toISOString());
    } else {
      throw new Error(res?.detail || 'Sync failed');
    }
  } catch (err) {
    console.error('[Sync] Failed:', err);
    if (showNotification) {
      showToast('Sync failed: ' + err.message, 'error');
    }
  } finally {
    isSyncing = false;
  }
}

// === Preset Management ===

let presets = [];

async function loadPresets() {
  try {
    const response = await getPresets();
    presets = response.presets || [];
    renderPresetList();
  } catch (error) {
    console.error('[Presets] Failed to load:', error);
    // Fallback: Use sample presets for testing
    const userData = getUserData();
    const username = userData?.username || 'sample_user';
    presets = [
      {
        id: 1,
        name: 'Sample Preset - Active Products',
        description: 'Sample preset showing active products only',
        created_by: username,
        created_at: new Date().toISOString(),
        status_filters: ['Active'],
        region: 'uk',
        product_skus: ['SAMPLE001', 'SAMPLE002']
      },
      {
        id: 2,
        name: 'Sample Preset - All Products',
        description: 'Sample preset with all sample products',
        created_by: username,
        created_at: new Date().toISOString(),
        status_filters: DEFAULT_STATUS_FILTERS,
        region: 'uk',
        product_skus: ['SAMPLE001', 'SAMPLE002', 'SAMPLE003', 'SAMPLE004', 'SAMPLE005', 'SAMPLE006', 'SAMPLE007', 'SAMPLE008', 'SAMPLE009', 'SAMPLE010', 'SAMPLE011', 'SAMPLE012', 'SAMPLE013', 'SAMPLE014', 'SAMPLE015']
      },
      {
        id: 3,
        name: 'Sample Preset - Pre-Orders Only',
        description: 'Products with pre-order status',
        created_by: username,
        created_at: new Date().toISOString(),
        status_filters: ['Pre Order'],
        region: 'uk',
        product_skus: ['SAMPLE001']
      },
      {
        id: 4,
        name: 'Sample Preset - France Region',
        description: 'Products for French market',
        created_by: username,
        created_at: new Date().toISOString(),
        status_filters: ['Active', 'Special Offer'],
        region: 'fr',
        product_skus: ['SAMPLE002', 'SAMPLE003']
      },
      {
        id: 5,
        name: 'Sample Preset - Discontinued Items',
        description: 'Products discontinued by supplier or RM',
        created_by: username,
        created_at: new Date().toISOString(),
        status_filters: ['Discontinued (Supplier)', 'Discontinued (RM)'],
        region: 'uk',
        product_skus: ['SAMPLE003']
      }
    ];
    renderPresetList();
  }
}

function renderPresetList() {
  const presetList = document.getElementById('presetList');
  if (!presetList) return;
  
  // Update preset count badge
  updatePresetCountBadge();
  
  if (presets.length === 0) {
    presetList.innerHTML = `
      <div class="preset-empty">
        <i class="fas fa-bookmark"></i>
        <p>No presets saved yet</p>
        <p class="preset-empty-hint">Select products and click the save button to create your first preset</p>
      </div>
    `;
    return;
  }
  
  presetList.innerHTML = presets.map(preset => {
    const isActive = preset.id === state.currentPresetId;
    const filterCount = preset.status_filters ? preset.status_filters.length : 0;
    return `
    <div class="preset-card-horizontal ${isActive ? 'active' : ''}" data-preset-id="${preset.id}">
      <h4 class="preset-name">
        ${isActive ? '<i class="fas fa-check-circle" style="color: var(--accent); margin-right: 4px;"></i>' : ''}
        ${escapeHtml(preset.name)}
      </h4>
      <div class="preset-meta">
        <span><i class="fas fa-filter"></i> ${filterCount} filters</span>
        <span><i class="fas fa-globe"></i> ${preset.region ? preset.region.toUpperCase() : 'UK'}</span>
      </div>
      <div class="preset-actions">
        <button class="btn btn-solid btn-success btn-sm" onclick="window.labelGenerator.loadPreset(${preset.id})" title="${isActive ? 'Reload this preset' : 'Load this preset'}">
          <i class="fas fa-${isActive ? 'sync-alt' : 'check-circle'}"></i>
          ${isActive ? 'Reload' : 'Load'}
        </button>
        <button class="btn btn-flat btn-default btn-sm" onclick="window.labelGenerator.viewPresetDetails(${preset.id})" title="View preset details">
          <i class="fas fa-eye"></i>
          View
        </button>
      </div>
    </div>
  `;
  }).join('');
}

function renderManagePresetsList() {
  const manageList = document.getElementById('managePresetsList');
  if (!manageList) return;
  
  if (presets.length === 0) {
    manageList.innerHTML = `
      <div class="preset-empty">
        <i class="fas fa-bookmark"></i>
        <p>No presets available</p>
      </div>
    `;
    return;
  }
  
  manageList.innerHTML = presets.map(preset => `
    <div class="card manage-preset-item" data-preset-id="${preset.id}">
      <div class="manage-preset-header">
        <div class="manage-preset-info">
          <h4 class="preset-name">${escapeHtml(preset.name)}</h4>
          ${preset.description ? `<p class="preset-description">${escapeHtml(preset.description)}</p>` : ''}
          <div class="preset-meta">
            <span><i class="fas fa-user"></i> ${escapeHtml(preset.created_by || 'Unknown')}</span>
            <span><i class="fas fa-clock"></i> ${formatDate(preset.created_at)}</span>
          </div>
        </div>
        <div class="manage-preset-stats">
          <span class="preset-stat">
            <i class="fas fa-filter"></i> ${preset.status_filters?.length || 0} filters
          </span>
          <span class="preset-stat">
            <i class="fas fa-globe"></i> ${(preset.region || 'uk').toUpperCase()}
          </span>
          <span class="preset-stat">
            <i class="fas fa-box"></i> ${preset.product_skus?.length || 0} products
          </span>
        </div>
      </div>
      <div class="manage-preset-actions">
        <button class="btn btn-solid btn-success btn-sm" onclick="window.labelGenerator.loadPreset(${preset.id}); document.getElementById('managePresetsModal').classList.remove('active');">
          <i class="fas fa-check"></i>
          Load
        </button>
        <button class="btn btn-flat btn-default btn-sm" onclick="window.labelGenerator.showEditPresetModal(${preset.id})">
          <i class="fas fa-edit"></i>
          Edit
        </button>
        <button class="btn btn-solid btn-danger btn-sm" onclick="window.labelGenerator.deletePresetConfirm(${preset.id})">
          <i class="fas fa-trash"></i>
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

async function loadPreset(presetId) {
  const preset = presets.find(p => p.id === presetId);
  if (!preset) {
    showToast('Preset not found', 'error');
    return;
  }
  
  try {
    // Track current preset
    state.currentPresetId = presetId;
    
    // Apply status filters
    state.statusFilters = preset.status_filters || [];
    const checkboxes = document.querySelectorAll('.status-filter-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = state.statusFilters.includes(checkbox.value);
    });
    updateStatusFilterVisuals();
    updateFilterCount();
    
    // Apply region
    state.region = preset.region || 'uk';
    const regionRadios = document.querySelectorAll('.region-radio');
    regionRadios.forEach(radio => {
      radio.checked = radio.value === state.region;
    });
    
    // Reload products with new filters
    await loadProducts();
    
    // Select products from preset
    state.selectedProducts.clear();
    const presetSkus = new Set(preset.product_skus || []);
    state.displayedProducts.forEach(product => {
      if (presetSkus.has(product.sku)) {
        state.selectedProducts.add(product.item_id);
      }
    });
    
    // Re-render table to show checkboxes and update stats
    renderProductTable();
    updateStats();
    
    // Update preset list to show active state
    renderPresetList();
    
    showToast(`Loaded preset: ${preset.name}`, 'success');
  } catch (error) {
    console.error('[Presets] Failed to load preset:', error);
    showToast('Failed to load preset', 'error');
  }
}

function showSavePresetModal() {
  // Show/hide overwrite current option based on whether a preset is loaded
  const overwriteCurrentOption = document.getElementById('overwriteCurrentOption');
  if (state.currentPresetId && presets.find(p => p.id === state.currentPresetId)) {
    overwriteCurrentOption.style.display = 'block';
  } else {
    overwriteCurrentOption.style.display = 'none';
  }
  
  // Reset to new preset mode
  document.querySelector('input[name="saveOption"][value="new"]').checked = true;
  document.getElementById('newPresetFields').style.display = 'block';
  document.getElementById('overwriteOtherPresetField').style.display = 'none';
  document.getElementById('currentPresetInfo').style.display = 'none';
  
  // Update summary in modal
  document.getElementById('presetStatusCount').textContent = state.statusFilters.length;
  document.getElementById('presetRegion').textContent = state.region.toUpperCase();
  document.getElementById('presetProductCount').textContent = state.selectedProducts.size;
  
  // Clear previous values
  document.getElementById('presetName').value = '';
  document.getElementById('presetDescription').value = '';
  document.getElementById('overwritePresetSelect').value = '';
  
  // Populate product list with currently selected products
  renderSavePresetProductList();
  
  // Show modal
  document.getElementById('savePresetModal').classList.add('active');
}

function renderSavePresetProductList() {
  const listContainer = document.getElementById('savePresetProductList');
  if (!listContainer) return;
  
  // Get selected products
  const selectedProductsArray = Array.from(state.selectedProducts).map(itemId => {
    return state.displayedProducts.find(p => p.item_id === itemId);
  }).filter(p => p);
  
  if (selectedProductsArray.length === 0) {
    listContainer.innerHTML = '<div class="preset-product-empty">No products selected</div>';
    return;
  }
  
  listContainer.innerHTML = selectedProductsArray.map(product => `
    <div class="preset-product-item">
      <span class="preset-product-sku">${escapeHtml(product.sku || '-')}</span>
      <span class="preset-product-name">${escapeHtml(product.product_name || '-')}</span>
    </div>
  `).join('');
}

async function savePreset() {
  const saveOption = document.querySelector('input[name="saveOption"]:checked').value;
  
  // Get selected product SKUs
  const selectedSkus = Array.from(state.selectedProducts).map(itemId => {
    const product = state.displayedProducts.find(p => p.item_id === itemId);
    return product?.sku;
  }).filter(sku => sku);
  
  try {
    if (saveOption === 'new') {
      // Save as new preset
      const name = document.getElementById('presetName').value.trim();
      const description = document.getElementById('presetDescription').value.trim();
      
      if (!name) {
        showToast('Please enter a preset name', 'error');
        return;
      }
      
      const preset = {
        name,
        description: description || null,
        status_filters: state.statusFilters,
        region: state.region,
        product_skus: selectedSkus
      };
      
      await createPreset(preset);
      showToast('Preset saved successfully', 'success');
    } else if (saveOption === 'overwrite-current') {
      // Overwrite current preset
      const currentPreset = presets.find(p => p.id === state.currentPresetId);
      if (!currentPreset) {
        showToast('Current preset not found', 'error');
        return;
      }
      
      // Confirm before overwriting
      const confirmed = await confirmModal({
        title: 'Overwrite Current Preset',
        message: `Are you sure you want to overwrite the preset "${currentPreset.name}"?\n\nThis will replace all settings and products with your current selection.`,
        confirmText: 'Overwrite',
        cancelText: 'Cancel',
        confirmVariant: 'primary',
        icon: '⚠️'
      });
      
      if (!confirmed) {
        return;
      }
      
      const description = document.getElementById('presetDescription').value.trim();
      
      await updatePreset(state.currentPresetId, {
        description: description || null,
        status_filters: state.statusFilters,
        region: state.region,
        product_skus: selectedSkus
      });
      
      showToast(`Preset "${currentPreset.name}" overwritten successfully`, 'success');
    } else if (saveOption === 'overwrite-other') {
      // Overwrite other preset
      const presetId = parseInt(document.getElementById('overwritePresetSelect').value);
      
      if (!presetId) {
        showToast('Please select a preset to overwrite', 'error');
        return;
      }
      
      const existingPreset = presets.find(p => p.id === presetId);
      if (!existingPreset) {
        showToast('Preset not found', 'error');
        return;
      }
      
      // Confirm before overwriting
      const confirmed = await confirmModal({
        title: 'Overwrite Preset',
        message: `Are you sure you want to overwrite the preset "${existingPreset.name}"?\n\nThis will replace all settings and products with your current selection.`,
        confirmText: 'Overwrite',
        cancelText: 'Cancel',
        confirmVariant: 'primary',
        icon: '⚠️'
      });
      
      if (!confirmed) {
        return;
      }
      
      const description = document.getElementById('presetDescription').value.trim();
      
      await updatePreset(presetId, {
        description: description || null,
        status_filters: state.statusFilters,
        region: state.region,
        product_skus: selectedSkus
      });
      
      showToast(`Preset "${existingPreset.name}" overwritten successfully`, 'success');
    }
    
    // Reload presets
    await loadPresets();
    
    // Close modal
    document.getElementById('savePresetModal').classList.remove('active');
  } catch (error) {
    console.error('[Presets] Failed to save:', error);
    showToast('Failed to save preset', 'error');
  }
}

function showManagePresetsModal() {
  renderManagePresetsList();
  document.getElementById('managePresetsModal').classList.add('active');
}

function showEditPresetModal(presetId) {
  const preset = presets.find(p => p.id === presetId);
  if (!preset) {
    showToast('Preset not found', 'error');
    return;
  }
  
  // Populate form
  document.getElementById('editPresetId').value = preset.id;
  document.getElementById('editPresetName').value = preset.name;
  document.getElementById('editPresetDescription').value = preset.description || '';
  
  // Update preset summary
  document.getElementById('editPresetStatusCount').textContent = preset.status_filters?.length || 0;
  document.getElementById('editPresetRegion').textContent = (preset.region || 'uk').toUpperCase();
  document.getElementById('editPresetProductCount').textContent = preset.product_skus?.length || 0;
  
  // Show products in preset
  renderEditPresetProductList(preset);
  
  // Reset and hide update contents option
  const checkbox = document.getElementById('updatePresetContents');
  checkbox.checked = false;
  document.getElementById('currentSelectionSummary').style.display = 'none';
  
  // Update current selection summary
  document.getElementById('currentStatusCount').textContent = state.statusFilters.length;
  document.getElementById('currentRegion').textContent = state.region.toUpperCase();
  document.getElementById('currentProductCount').textContent = state.selectedProducts.size;
  
  // Close manage modal if open
  document.getElementById('managePresetsModal').classList.remove('active');
  
  // Show edit modal
  document.getElementById('editPresetModal').classList.add('active');
}

function renderEditPresetProductList(preset) {
  const listContainer = document.getElementById('editPresetProductList');
  if (!listContainer) return;
  
  // Initialize editing SKUs from preset if not already set
  if (preset) {
    state.editingPresetSkus = [...(preset.product_skus || [])];
  }
  
  const skus = state.editingPresetSkus;
  
  // Update product count display
  const countEl = document.getElementById('editPresetProductCount');
  if (countEl) countEl.textContent = skus.length;
  
  if (skus.length === 0) {
    listContainer.innerHTML = '<div class="preset-product-empty">No products in this preset</div>';
    return;
  }
  
  listContainer.innerHTML = skus.map((sku, index) => `
    <div class="preset-product-item" data-sku="${escapeHtml(sku)}">
      <span class="preset-product-sku">${escapeHtml(sku)}</span>
      <span class="preset-product-name">Product SKU</span>
      <button type="button" class="preset-product-remove" onclick="window.labelGenerator.removeEditPresetProduct('${escapeHtml(sku)}')" title="Remove from preset">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

// Remove a product from the editing preset
function removeEditPresetProduct(sku) {
  state.editingPresetSkus = state.editingPresetSkus.filter(s => s !== sku);
  renderEditPresetProductList(null); // Re-render without resetting the list
}

async function editPreset() {
  const presetId = parseInt(document.getElementById('editPresetId').value);
  const name = document.getElementById('editPresetName').value.trim();
  const description = document.getElementById('editPresetDescription').value.trim();
  const updateContents = document.getElementById('updatePresetContents').checked;
  
  if (!name) {
    showToast('Please enter a preset name', 'error');
    return;
  }
  
  try {
    const updates = {
      name,
      description: description || null
    };
    
    // If user wants to update contents with current selection
    if (updateContents) {
      const selectedSkus = Array.from(state.selectedProducts).map(itemId => {
        const product = state.displayedProducts.find(p => p.item_id === itemId);
        return product?.sku;
      }).filter(sku => sku);
      
      updates.status_filters = state.statusFilters;
      updates.region = state.region;
      updates.product_skus = selectedSkus;
    } else {
      // Save the edited product list (with any removals)
      updates.product_skus = state.editingPresetSkus;
    }
    
    await updatePreset(presetId, updates);
    
    // Reload presets
    await loadPresets();
    
    // Close modal
    document.getElementById('editPresetModal').classList.remove('active');
    
    const message = updateContents ? 'Preset updated with current selection' : 'Preset updated successfully';
    showToast(message, 'success');
  } catch (error) {
    console.error('[Presets] Failed to update:', error);
    showToast('Failed to update preset', 'error');
  }
}

async function deletePresetConfirm(presetId) {
  const preset = presets.find(p => p.id === presetId);
  if (!preset) return;
  
  const confirmDelete = await confirmModal({
    title: 'Delete Preset',
    message: `Are you sure you want to delete the preset "${preset.name}"?\n\nThis action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
  
  if (!confirmDelete) {
    return;
  }
  
  try {
    await deletePreset(presetId);
    
    // Reload presets data
    await loadPresets();
    
    // Check if manage presets modal is open and refresh it
    const manageModal = document.getElementById('managePresetsModal');
    if (manageModal && manageModal.classList.contains('active')) {
      renderManagePresetsList();
    }
    
    showToast('Preset deleted successfully', 'success');
  } catch (error) {
    console.error('[Presets] Failed to delete:', error);
    showToast('Failed to delete preset', 'error');
  }
}

function viewPresetDetails(presetId) {
  const preset = presets.find(p => p.id === presetId);
  if (!preset) {
    showToast('Preset not found', 'error');
    return;
  }
  
  // Populate modal with preset details
  document.getElementById('viewPresetName').textContent = preset.name;
  document.getElementById('viewPresetDescription').textContent = preset.description || 'No description provided';
  document.getElementById('viewPresetCreatedBy').textContent = preset.created_by || 'Unknown';
  document.getElementById('viewPresetCreatedAt').textContent = formatDate(preset.created_at);
  document.getElementById('viewPresetRegion').textContent = (preset.region || 'uk').toUpperCase();
  
  // Update counts in labels
  const statusCount = preset.status_filters ? preset.status_filters.length : 0;
  const productCount = preset.product_skus ? preset.product_skus.length : 0;
  
  const statusLabel = document.getElementById('viewPresetStatusFiltersLabel');
  if (statusLabel) {
    statusLabel.innerHTML = `<i class="fas fa-filter"></i> Status Filters (${statusCount})`;
  }
  
  const productsLabel = document.getElementById('viewPresetProductsLabel');
  if (productsLabel) {
    productsLabel.innerHTML = `<i class="fas fa-box"></i> Products in Preset (${productCount})`;
  }
  
  // Show status filters
  const filtersContainer = document.getElementById('viewPresetFilters');
  if (preset.status_filters && preset.status_filters.length > 0) {
    filtersContainer.innerHTML = preset.status_filters.map(filter => 
      `<span class="filter-badge">${escapeHtml(formatStatusDisplay(filter))}</span>`
    ).join('');
  } else {
    filtersContainer.innerHTML = '<span class="empty-text">No filters</span>';
  }
  
  // Show products
  const productsContainer = document.getElementById('viewPresetProducts');
  if (preset.product_skus && preset.product_skus.length > 0) {
    productsContainer.innerHTML = preset.product_skus.map(sku => 
      `<div class="product-sku-item">${escapeHtml(sku)}</div>`
    ).join('');
  } else {
    productsContainer.innerHTML = '<div class="empty-text">No products in this preset</div>';
  }
  
  // Show modal
  document.getElementById('viewPresetModal').classList.add('active');
}

// Export functions for global access
window.labelGenerator = {
  loadPreset,
  showEditPresetModal,
  deletePresetConfirm,
  viewPresetDetails,
  removeEditPresetProduct
};
