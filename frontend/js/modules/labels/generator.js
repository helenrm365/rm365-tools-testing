// js/modules/labels/generator.js
import { getProductsToPrint, createPrintJob, downloadPDF, downloadCSV, initDependencies } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';
import { getToken } from '../../services/state/sessionStore.js';
import { syncUKMagentoData, syncFRMagentoData, syncNLMagentoData } from '../../services/api/magentoDataApi.js';
import { post } from '../../services/api/http.js';

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
  selectAll: false,
  statusFilters: DEFAULT_STATUS_FILTERS,  // Always start with all filters
  region: "uk"           // Default region preference for prices/names
};

export async function initLabelGenerator() {
  // Setup status filter checkboxes (all checked by default)
  setupStatusFilterCheckboxes();
  
  // Setup region selection
  setupRegionSelection();
  
  // Setup event listeners immediately so search works while loading
  setupEventListeners();
  
  // Setup product table event delegation once
  setupProductTableDelegation();

  // Load initial data
  await loadProducts();

  // Auto sync in background
  initAutoSync();
  
  updateUI();
}

// Update filter count display
function updateFilterCount() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  const countElement = document.getElementById('labelActiveFiltersCount');
  if (countElement) {
    countElement.textContent = checkedCount;
  }
}

function setupStatusFilterCheckboxes() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = state.statusFilters.includes(checkbox.value);
    
    // Add change listener for visual feedback AND auto-apply filters
    checkbox.addEventListener('change', handleStatusFilterChange);
    // Add listener to update count
    checkbox.addEventListener('change', updateFilterCount);
  });
  
  // Initial visual update
  updateStatusFilterVisuals();
  // Initial count update
  updateFilterCount();
}

async function handleStatusFilterChange() {
  // Update visuals immediately
  updateStatusFilterVisuals();
  
  // Get current filter state
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  const selectedFilters = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  // Update state (no localStorage saving)
  state.statusFilters = selectedFilters;
  
  // Show loading state
  const applyBtn = document.getElementById('applyStatusFilters');
  let originalText = '';
  if (applyBtn) {
    originalText = applyBtn.textContent;
    applyBtn.textContent = 'Applying...';
    applyBtn.disabled = true;
  }
  
  // Clear selections when changing filters
  state.selectedProducts.clear();
  
  try {
    // Auto-reload products with new filters
    await loadProducts();
    
    // Show success feedback
    if (applyBtn) {
      applyBtn.textContent = '✓ Applied';
      applyBtn.style.background = '#10b981';
      setTimeout(() => {
        applyBtn.textContent = originalText || 'Apply Filters';
        applyBtn.style.background = '';
        applyBtn.disabled = false;
      }, 1500);
    }
    
    // Show toast notification
    showToast(`Applied ${selectedFilters.length} status filters`, 'success');
    
  } catch (error) {
    console.error('[Labels] Error applying filters:', error);
    if (applyBtn) {
      applyBtn.textContent = 'Error - Retry';
      applyBtn.style.background = '#ef4444';
      setTimeout(() => {
        applyBtn.textContent = originalText || 'Apply Filters';
        applyBtn.style.background = '';
        applyBtn.disabled = false;
      }, 2000);
    }
    showToast('Error applying filters', 'error');
  }
}

function updateStatusFilterVisuals() {
  const filters = document.querySelectorAll('.status-filter');
  
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

async function loadProducts(isBackground = false) {
  const loadingEl = document.querySelector('#loadingIndicator');
  const errorEl = document.querySelector('#errorMessage');
  
  if (loadingEl && !isBackground) loadingEl.style.display = 'block';
  if (errorEl) errorEl.style.display = 'none';
  
  try {
    // Fetch products with current status filters and region preference
    state.allProducts = await getProductsToPrint(state.statusFilters, state.region);
    state.filteredProducts = [...state.allProducts];
    
    console.log(`[Labels Load] Loaded ${state.allProducts.length} products from API`);
    
    // Re-apply search filter if exists
    const searchInput = document.querySelector('#searchInput');
    if (searchInput && searchInput.value.trim()) {
      const query = searchInput.value.toLowerCase().trim();
      console.log(`[Labels Load] Re-applying search filter: "${query}"`);
      
      state.displayedProducts = state.filteredProducts.filter(p => {
        const priceText = formatPrice(p.price).toLowerCase();
        return (
          (p.sku || '').toLowerCase().includes(query) ||
          (p.product_name || '').toLowerCase().includes(query) ||
          (p.item_id || '').toLowerCase().includes(query) ||
          priceText.includes(query) ||
          (p.uk_6m_data ?? '').toString().toLowerCase().includes(query) ||
          (p.fr_6m_data ?? '').toString().toLowerCase().includes(query)
        );
      });
      console.log(`[Labels Load] After search filter: ${state.displayedProducts.length} products`);
    } else {
      state.displayedProducts = [...state.filteredProducts];
      console.log(`[Labels Load] No search filter active, showing all ${state.displayedProducts.length} products`);
    }
    
    // IMPORTANT: Don't auto-select products - causes lag with large product lists
    // Products remain unchecked by default
    // If user generates labels without selecting any, we'll print all filtered products
    state.selectedProducts.clear();
    
    // Ensure select all checkbox is unchecked
    const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
    }
    
    if (loadingEl) loadingEl.style.display = 'none';
    renderProductTable();
    updateStats();
  } catch (error) {
    console.error('[Labels] Error loading products:', error);
    if (loadingEl) loadingEl.style.display = 'none';
    
    // Check if error is about missing magento data tables
    const errorMessage = error.message || '';
    if (errorMessage.includes('Magento data tables not initialized')) {
      // Show a helpful error message with action button
      showMagentoDataInitError();
    } else {
      // Show generic error toast
      showToast('Failed to load products: ' + errorMessage, 'error');
    }
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
    
    // Insert after loading indicator
    const loadingEl = document.querySelector('#loadingIndicator');
    if (loadingEl && loadingEl.parentNode) {
      loadingEl.parentNode.insertBefore(errorEl, loadingEl.nextSibling);
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
          <button class="action-btn primary-btn" onclick="window.location.href='/magentodata'">
            <i class="fas fa-database"></i>
            Go to Magento Data Module
          </button>
          <button class="action-btn secondary-btn" onclick="initMagentoDataFromLabels()">
            <i class="fas fa-magic"></i>
            Initialize Here
          </button>
          <button class="action-btn secondary-btn" onclick="retryLoadProducts()">
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
  const button = document.querySelector('#magentoDataError .action-btn');
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

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function setupEventListeners() {
  // Search
  const searchInput = document.querySelector('#searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleSearch, 300));
  }
  
  // Select all checkbox
  const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', handleSelectAll);
  }
  
  // Deselect all button
  const deselectAllBtn = document.querySelector('#deselectAllBtn');
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', handleDeselectAll);
  }
  
  // Generate PDF button
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    generatePdfBtn.addEventListener('click', handleGeneratePdf);
  }
  
  // Refresh button
  const refreshBtn = document.querySelector('#refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadProducts);
  }
  
  // Apply status filters button
  const applyBtn = document.getElementById('applyStatusFilters');
  if (applyBtn) {
    applyBtn.addEventListener('click', handleApplyStatusFilters);
  }
}

async function handleApplyStatusFilters() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  const selectedFilters = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  // Update state (no localStorage saving)
  state.statusFilters = selectedFilters;
  
  // Clear selections when changing filters
  state.selectedProducts.clear();
  
  // Visual feedback on button
  const applyBtn = document.getElementById('applyStatusFilters');
  let originalText = '';
  if (applyBtn) {
    originalText = applyBtn.textContent;
    applyBtn.textContent = 'Applying...';
    applyBtn.disabled = true;
  }
  
  try {
    // Reload products from API with new filters
    await loadProducts();
    
    // Success feedback
    if (applyBtn) {
      applyBtn.textContent = '✓ Filters Applied';
      applyBtn.style.background = '#10b981';
      setTimeout(() => {
        applyBtn.textContent = originalText || 'Apply Filters';
        applyBtn.style.background = '';
        applyBtn.disabled = false;
      }, 2000);
    }
    
    showToast(`Applied ${selectedFilters.length} status filters - Found ${state.allProducts.length} products`, 'success');
    
  } catch (error) {
    console.error('[Labels] Error applying filters:', error);
    if (applyBtn) {
      applyBtn.textContent = 'Error - Retry';
      applyBtn.style.background = '#ef4444';
      setTimeout(() => {
        applyBtn.textContent = originalText || 'Apply Filters';
        applyBtn.style.background = '';
        applyBtn.disabled = false;
      }, 3000);
    }
    
    showToast('Error applying status filters: ' + error.message, 'error');
  }
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  console.log(`[Labels Search] Query: "${query}"`);
  console.log(`[Labels Search] Filtering from ${state.filteredProducts.length} products`);
  
  if (!query) {
    state.displayedProducts = [...state.filteredProducts];
    console.log(`[Labels Search] No query - showing all ${state.displayedProducts.length} products`);
  } else {
    // Log first few products to debug
    if (state.filteredProducts.length > 0) {
      const sample = state.filteredProducts[0];
      console.log('[Labels Search] Sample product fields:', {
        sku: sample.sku,
        product_name: sample.product_name,
        item_id: sample.item_id,
        price: sample.price,
        uk_6m_data: sample.uk_6m_data,
        fr_6m_data: sample.fr_6m_data
      });
    }
    
    state.displayedProducts = state.filteredProducts.filter(p => {
      const priceText = formatPrice(p.price).toLowerCase();
      const skuMatch = (p.sku || '').toLowerCase().includes(query);
      const nameMatch = (p.product_name || '').toLowerCase().includes(query);
      const itemIdMatch = (p.item_id || '').toLowerCase().includes(query);
      const priceMatch = priceText.includes(query);
      const uk6mMatch = (p.uk_6m_data ?? '').toString().toLowerCase().includes(query);
      const fr6mMatch = (p.fr_6m_data ?? '').toString().toLowerCase().includes(query);
      
      const matches = skuMatch || nameMatch || itemIdMatch || priceMatch || uk6mMatch || fr6mMatch;
      
      // Log first match for debugging
      if (matches && state.displayedProducts.length === 0) {
        console.log(`[Labels Search] First match found:`, {
          sku: p.sku,
          name: p.product_name,
          skuMatch,
          nameMatch,
          itemIdMatch,
          priceMatch,
          uk6mMatch,
          fr6mMatch
        });
      }
      
      return matches;
    });
    
    console.log(`[Labels Search] Found ${state.displayedProducts.length} matching products`);
  }
  
  renderProductTable();
  updateStats();
}

function handleSelectAll(e) {
  state.selectAll = e.target.checked;
  
  if (state.selectAll) {
    // Select all displayed products (filtered + searched)
    state.displayedProducts.forEach(p => state.selectedProducts.add(p.item_id));
  } else {
    // Deselect all
    state.selectedProducts.clear();
  }
  
  renderProductTable();
  updateStats();
}

function handleDeselectAll() {
  state.selectedProducts.clear();
  state.selectAll = false;
  
  const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = false;
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
  
  // Update select all checkbox
  const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = state.selectedProducts.size === state.displayedProducts.length && state.displayedProducts.length > 0;
  }
  
  updateStats();
}

function renderProductTable() {
  const tbody = document.querySelector('#productsTableBody');
  if (!tbody) return;
  
  console.log(`[Labels Render] Rendering ${state.displayedProducts.length} products`);
  
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
  
  console.log(`[Labels Stats] Displayed: ${state.displayedProducts.length}, Selected: ${state.selectedProducts.size}`);
  
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
    // - If products are specifically selected, use those
    // - If nothing selected but filters/search applied, use all displayed products
    let itemIdsToUse;
    if (state.selectedProducts.size > 0) {
      // User selected specific products
      itemIdsToUse = Array.from(state.selectedProducts);
    } else {
      // No selection - use all displayed/filtered products
      itemIdsToUse = state.displayedProducts.map(p => p.item_id);
      
      // Check if filters or search are active
      const hasActiveFilters = state.statusFilters.length > 0;
      const searchInput = document.querySelector('#searchInput');
      const hasSearch = searchInput && searchInput.value.trim().length > 0;
      
      if (hasActiveFilters || hasSearch) {
        console.log(`[Labels] No selection - printing all ${itemIdsToUse.length} filtered products`);
      }
    }
    
    // Create print job with item IDs
    const payload = {
      created_by: 'user@example.com', // TODO: Get from session
      item_ids: itemIdsToUse
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
      generatePdfBtn.textContent = '📄 Generate PDF Labels';
    }
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
          Click below to download the PDF with your labels, or export as CSV.
        </p>
        <div style="display: flex; gap: 1rem; flex-direction: column;">
          <button class="modern-button" id="downloadPdfBtn" style="width: 100%; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; font-weight: 600; padding: 1rem; font-size: 1.1rem;">
            📄 Download PDF Labels
          </button>
          <button class="modern-button" id="downloadCsvBtn" style="width: 100%; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 0.75rem;">
            📊 Download CSV Export
          </button>
          <button class="modern-button" onclick="this.closest('.modal-overlay').remove()" style="width: 100%; background: #6b7280; color: white; padding: 0.75rem;">
            Close
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
  
  // PDF download
  modal.querySelector('#downloadPdfBtn').addEventListener('click', async () => {
    const btn = modal.querySelector('#downloadPdfBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Generating PDF...';
    btn.disabled = true;
    
    try {
      await downloadPDF(jobId);
      showToast('PDF downloaded successfully!', 'success');
      // Keep modal open so user can download CSV too if needed
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
  
  // CSV download
  modal.querySelector('#downloadCsvBtn').addEventListener('click', async () => {
    const btn = modal.querySelector('#downloadCsvBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Generating CSV...';
    btn.disabled = true;
    
    try {
      await downloadCSV(jobId);
      showToast('CSV downloaded successfully!', 'success');
      btn.textContent = '✓ Downloaded';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } catch (error) {
      showToast('Failed to download CSV: ' + error.message, 'error');
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

  if (typeof price === 'number') {
    if (!Number.isFinite(price)) {
      return '-';
    }
    const symbol = state.region === 'uk' ? '£' : '€';
    return `${symbol}${price.toFixed(2)}`;
  }

  const text = String(price).trim();
  return text.length ? text : '-';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
