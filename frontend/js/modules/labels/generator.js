// js/modules/labels/generator.js
import { getProductsToPrint, createPrintJob, downloadPDF, downloadCSV, initDependencies, getPresets, createPreset, updatePreset, deletePreset } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';
import { getToken } from '../../services/state/sessionStore.js';
import { getUserData } from '../../services/state/userStore.js';
import { syncUKMagentoData, syncFRMagentoData, syncNLMagentoData } from '../../services/api/magentoDataApi.js';
import { post } from '../../services/api/http.js';
import { confirmModal } from '../../ui/confirmationModal.js';

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
  const errorEl = document.querySelector('#errorMessage');
  
  if (errorEl) errorEl.style.display = 'none';
  
  try {
    // Fetch products with current status filters and region preference
    state.allProducts = await getProductsToPrint(state.statusFilters, state.region);
    state.filteredProducts = [...state.allProducts];
    
    // Re-apply search filter if exists
    const searchInput = document.querySelector('#productSearchInput');
    if (searchInput && searchInput.value.trim()) {
      const query = searchInput.value.toLowerCase().trim();
      
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
    } else {
      state.displayedProducts = [...state.filteredProducts];
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
  const searchInput = document.querySelector('#productSearchInput');
  
  if (searchInput) {
    // Add debounced handler for search
    const debouncedSearch = debounce(handleSearch, 300);
    searchInput.addEventListener('input', debouncedSearch);
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
  
  // Preset buttons
  const savePresetBtn = document.getElementById('savePresetBtn');
  if (savePresetBtn) {
    savePresetBtn.addEventListener('click', showSavePresetModal);
  }
  
  const managePresetsBtn = document.getElementById('managePresetsBtn');
  if (managePresetsBtn) {
    managePresetsBtn.addEventListener('click', showManagePresetsModal);
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

function handleSaveOptionChange(e) {
  const isOverwrite = e.target.value === 'overwrite';
  document.getElementById('newPresetFields').style.display = isOverwrite ? 'none' : 'block';
  document.getElementById('overwritePresetField').style.display = isOverwrite ? 'block' : 'none';
  
  // Populate overwrite dropdown if switching to overwrite mode
  if (isOverwrite) {
    const select = document.getElementById('overwritePresetSelect');
    select.innerHTML = '<option value="">-- Select a preset --</option>' + 
      presets.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    // Clear description when switching to overwrite mode
    document.getElementById('presetDescription').value = '';
  } else {
    // Clear description when switching to new mode
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
    // Don't show error toast - table might not exist yet on first load
    // Just initialize with empty presets
    presets = [];
    renderPresetList();
  }
}

function renderPresetList() {
  const presetList = document.getElementById('presetList');
  if (!presetList) return;
  
  if (presets.length === 0) {
    presetList.innerHTML = `
      <div class="preset-empty">
        <i class="fas fa-bookmark"></i>
        <p>No presets saved yet</p>
        <p class="preset-empty-hint">Select products and click "Save Current Selection" to create a preset</p>
      </div>
    `;
    return;
  }
  
  presetList.innerHTML = presets.map(preset => `
    <div class="preset-card" data-preset-id="${preset.id}">
      <div class="preset-card-header">
        <div class="preset-info">
          <h4 class="preset-name">${escapeHtml(preset.name)}</h4>
          ${preset.description ? `<p class="preset-description">${escapeHtml(preset.description)}</p>` : ''}
        </div>
        <div class="preset-stats">
          <span class="preset-stat" title="Status filters">
            <i class="fas fa-filter"></i> ${preset.status_filters?.length || 0}
          </span>
          <span class="preset-stat" title="Region">
            <i class="fas fa-globe"></i> ${(preset.region || 'uk').toUpperCase()}
          </span>
          <span class="preset-stat" title="Products">
            <i class="fas fa-box"></i> ${preset.product_skus?.length || 0}
          </span>
        </div>
      </div>
      <div class="preset-card-footer">
        <button class="preset-action-btn load" onclick="window.labelGenerator.loadPreset(${preset.id})">
          <i class="fas fa-check"></i>
          Load Preset
        </button>
        <button class="preset-action-btn secondary" onclick="window.labelGenerator.showEditPresetModal(${preset.id})">
          <i class="fas fa-edit"></i>
          Edit
        </button>
      </div>
    </div>
  `).join('');
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
    <div class="manage-preset-item" data-preset-id="${preset.id}">
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
      <div class="manage-preset-actions">
        <button class="preset-action-btn load" onclick="window.labelGenerator.loadPreset(${preset.id}); document.getElementById('managePresetsModal').style.display='none';">
          <i class="fas fa-check"></i>
          Load
        </button>
        <button class="preset-action-btn secondary" onclick="window.labelGenerator.showEditPresetModal(${preset.id})">
          <i class="fas fa-edit"></i>
          Edit
        </button>
        <button class="preset-action-btn danger" onclick="window.labelGenerator.deletePresetConfirm(${preset.id})">
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
    
    showToast(`Loaded preset: ${preset.name}`, 'success');
  } catch (error) {
    console.error('[Presets] Failed to load preset:', error);
    showToast('Failed to load preset', 'error');
  }
}

function showSavePresetModal() {
  // Reset to new preset mode
  document.querySelector('input[name="saveOption"][value="new"]').checked = true;
  document.getElementById('newPresetFields').style.display = 'block';
  document.getElementById('overwritePresetField').style.display = 'none';
  
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
  document.getElementById('savePresetModal').style.display = 'flex';
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
    } else {
      // Overwrite existing preset
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
      
      // Get the description (user may have modified it)
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
    document.getElementById('savePresetModal').style.display = 'none';
  } catch (error) {
    console.error('[Presets] Failed to save:', error);
    showToast('Failed to save preset', 'error');
  }
}

function showManagePresetsModal() {
  renderManagePresetsList();
  document.getElementById('managePresetsModal').style.display = 'flex';
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
  document.getElementById('managePresetsModal').style.display = 'none';
  
  // Show edit modal
  document.getElementById('editPresetModal').style.display = 'flex';
}

function renderEditPresetProductList(preset) {
  const listContainer = document.getElementById('editPresetProductList');
  if (!listContainer) return;
  
  const skus = preset.product_skus || [];
  
  if (skus.length === 0) {
    listContainer.innerHTML = '<div class="preset-product-empty">No products in this preset</div>';
    return;
  }
  
  listContainer.innerHTML = skus.map(sku => `
    <div class="preset-product-item">
      <span class="preset-product-sku">${escapeHtml(sku)}</span>
      <span class="preset-product-name">Product SKU</span>
    </div>
  `).join('');
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
    
    // If user wants to update contents, include current selection
    if (updateContents) {
      const selectedSkus = Array.from(state.selectedProducts).map(itemId => {
        const product = state.displayedProducts.find(p => p.item_id === itemId);
        return product?.sku;
      }).filter(sku => sku);
      
      updates.status_filters = state.statusFilters;
      updates.region = state.region;
      updates.product_skus = selectedSkus;
    }
    
    await updatePreset(presetId, updates);
    
    // Reload presets
    await loadPresets();
    
    // Close modal
    document.getElementById('editPresetModal').style.display = 'none';
    
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
    if (manageModal && manageModal.style.display === 'flex') {
      renderManagePresetsList();
    }
    
    showToast('Preset deleted successfully', 'success');
  } catch (error) {
    console.error('[Presets] Failed to delete:', error);
    showToast('Failed to delete preset', 'error');
  }
}

// Export functions for global access
window.labelGenerator = {
  loadPreset,
  showEditPresetModal,
  deletePresetConfirm
};
