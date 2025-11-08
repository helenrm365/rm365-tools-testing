// js/modules/labels/generator.js
import { getProductsToPrint, createPrintJob, downloadPDF, downloadCSV } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';
import { getToken } from '../../services/state/sessionStore.js';

// Status filter preferences key
const STATUS_FILTERS_KEY = 'labels_status_filters';

// Default status filters (Active, Temporarily OOS, Pre Order, Samples checked by default)
const DEFAULT_STATUS_FILTERS = ['Active', 'Temporarily OOS', 'Pre Order', 'Samples'];

let state = {
  allProducts: [],       // All products from API
  filteredProducts: [],  // Products after applying discontinued status filters
  displayedProducts: [], // Products after applying search filter
  selectedProducts: new Set(),
  selectAll: false,
  statusFilters: [],
  region: "uk"           // Default region preference for prices/names
};

// Get saved status filters from localStorage
function getSavedStatusFilters() {
  try {
    const saved = localStorage.getItem(STATUS_FILTERS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('[Labels] Error loading saved filters:', e);
  }
  return DEFAULT_STATUS_FILTERS;
}

// Save status filters to localStorage
function saveStatusFilters(filters) {
  try {
    localStorage.setItem(STATUS_FILTERS_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error('[Labels] Error saving filters:', e);
  }
}

export async function initLabelGenerator() {
  console.log('[Labels] Initializing label generator');
  
  // Load saved filters
  state.statusFilters = getSavedStatusFilters();
  
  // Setup status filter checkboxes
  setupStatusFilterCheckboxes();
  
  // Setup region selection
  setupRegionSelection();
  
  await loadProducts();
  setupEventListeners();
  updateUI();
}

function setupStatusFilterCheckboxes() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = state.statusFilters.includes(checkbox.value);
    
    // Add change listener for visual feedback AND auto-apply filters
    checkbox.addEventListener('change', handleStatusFilterChange);
  });
  
  // Initial visual update
  updateStatusFilterVisuals();
}

async function handleStatusFilterChange() {
  // Update visuals immediately
  updateStatusFilterVisuals();
  
  // Get current filter state
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  const selectedFilters = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  console.log('[Labels] Status filter changed, new filters:', selectedFilters);
  
  // Save preferences
  state.statusFilters = selectedFilters;
  saveStatusFilters(selectedFilters);
  
  // Show loading state
  const applyBtn = document.getElementById('applyStatusFilters');
  if (applyBtn) {
    const originalText = applyBtn.textContent;
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
        applyBtn.textContent = 'Apply Filters';
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
        applyBtn.textContent = 'Apply Filters';
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
        console.log('[Labels] Region preference changed to:', state.region);
        // Reload products with new region preference
        loadProducts();
      }
    });
  });
}

async function loadProducts() {
  const loadingEl = document.querySelector('#loadingIndicator');
  const errorEl = document.querySelector('#errorMessage');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (errorEl) errorEl.style.display = 'none';
  
  try {
    // Debug: Log what filters are being sent
    console.log(`[Labels] Loading products with filters:`, {
      statusFilters: state.statusFilters,
      region: state.region,
      filterCount: state.statusFilters.length
    });
    
    // Fetch products with current status filters and region preference
    state.allProducts = await getProductsToPrint(state.statusFilters, state.region);
    state.filteredProducts = [...state.allProducts];
    state.displayedProducts = [...state.allProducts];
    
    console.log(`[Labels] Successfully loaded ${state.allProducts.length} products with filters:`, state.statusFilters, 'Region:', state.region);
    
    // Auto-select all products when using default filters
    const isDefaultFilters = 
      state.statusFilters.length === 4 &&
      state.statusFilters.includes('Active') &&
      state.statusFilters.includes('Temporarily OOS') &&
      state.statusFilters.includes('Pre Order') &&
      state.statusFilters.includes('Samples');
    
    if (isDefaultFilters) {
      console.log('[Labels] Auto-selecting all products with default filters');
      state.selectedProducts.clear();
      state.allProducts.forEach(p => state.selectedProducts.add(p.item_id));
      
      // Update select all checkbox
      const selectAllCheckbox = document.querySelector('#selectAllCheckbox');
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = true;
      }
    }
    
    if (loadingEl) loadingEl.style.display = 'none';
    renderProductTable();
    updateStats();
  } catch (error) {
    console.error('[Labels] Error loading products:', error);
    if (loadingEl) loadingEl.style.display = 'none';
    
    // Check if error is about missing sales data tables
    const errorMessage = error.message || '';
    if (errorMessage.includes('Sales data tables not initialized')) {
      // Show a helpful error message with action button
      showSalesDataInitError();
    } else {
      // Show generic error toast
      showToast('Failed to load products: ' + errorMessage, 'error');
    }
  }
}

// Show specific error UI for sales data initialization
function showSalesDataInitError() {
  // Create or update error message element
  let errorEl = document.querySelector('#salesDataError');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.id = 'salesDataError';
    errorEl.className = 'sales-data-error';
    
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
        <h3>Sales Data Not Initialized</h3>
      </div>
      <div class="error-body">
        <p>The label generator requires sales data tables to be set up first. This provides pricing information and sales history for your products.</p>
        <div class="error-actions">
          <button class="action-btn primary-btn" onclick="window.location.href='/salesdata'">
            <i class="fas fa-database"></i>
            Go to Sales Data Module
          </button>
          <button class="action-btn secondary-btn" onclick="initSalesDataFromLabels()">
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

// Initialize sales data from labels module
async function initSalesDataFromLabels() {
  const button = document.querySelector('#salesDataError .action-btn');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';
  }
  
  try {
    const response = await fetch('/api/v1/labels/init-dependencies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      }
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
      showToast('Sales data initialized successfully! Reloading products...', 'success');
      // Hide error and reload
      const errorEl = document.querySelector('#salesDataError');
      if (errorEl) errorEl.style.display = 'none';
      await loadProducts();
    } else {
      throw new Error(result.message || 'Failed to initialize');
    }
  } catch (error) {
    console.error('[Labels] Error initializing sales data:', error);
    showToast('Failed to initialize sales data: ' + error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-magic"></i> Initialize Here';
    }
  }
}

// Retry loading products
async function retryLoadProducts() {
  const errorEl = document.querySelector('#salesDataError');
  if (errorEl) errorEl.style.display = 'none';
  await loadProducts();
}

// Make functions available globally for onclick handlers
window.initSalesDataFromLabels = initSalesDataFromLabels;
window.retryLoadProducts = retryLoadProducts;

function setupEventListeners() {
  // Search
  const searchInput = document.querySelector('#searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
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
  
  console.log('[Labels] Manually applying filters:', selectedFilters);
  
  // Save preferences
  state.statusFilters = selectedFilters;
  saveStatusFilters(selectedFilters);
  
  // Clear selections when changing filters
  state.selectedProducts.clear();
  
  // Visual feedback on button
  const applyBtn = document.getElementById('applyStatusFilters');
  if (applyBtn) {
    const originalText = applyBtn.textContent;
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
        applyBtn.textContent = originalText;
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
        applyBtn.textContent = originalText;
        applyBtn.style.background = '';
        applyBtn.disabled = false;
      }, 3000);
    }
    
    showToast('Error applying status filters: ' + error.message, 'error');
  }
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    state.displayedProducts = [...state.filteredProducts];
  } else {
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
  <td class="sales-data">${escapeHtml(String(product.uk_6m_data ?? '0'))}</td>
  <td class="sales-data">${escapeHtml(String(product.fr_6m_data ?? '0'))}</td>
      </tr>
    `;
  }).join('');
  
  // Attach checkbox listeners
  tbody.querySelectorAll('.product-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      handleProductSelect(e.target.dataset.itemId, e.target.checked);
    });
  });
}

function updateStats() {
  const totalEl = document.querySelector('#totalProducts');
  const selectedEl = document.querySelector('#selectedProducts');
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  
  if (totalEl) totalEl.textContent = state.displayedProducts.length;
  if (selectedEl) selectedEl.textContent = state.selectedProducts.size;
  if (generatePdfBtn) {
    generatePdfBtn.disabled = state.selectedProducts.size === 0;
  }
}

function updateUI() {
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    generatePdfBtn.disabled = state.selectedProducts.size === 0;
  }
}

async function handleGeneratePdf() {
  if (state.selectedProducts.size === 0) {
    showToast('Please select at least one product', 'error');
    return;
  }
  
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    generatePdfBtn.disabled = true;
    generatePdfBtn.textContent = '⏳ Creating Job...';
  }
  
  try {
    // Create print job with selected item IDs
    const payload = {
      created_by: 'user@example.com', // TODO: Get from session
      item_ids: Array.from(state.selectedProducts)
    };
    
    console.log('[Labels] Creating print job with', payload.item_ids.length, 'items');
    
    const result = await createPrintJob(payload);
    const jobId = result.job_id;
    const itemCount = result.item_count || state.selectedProducts.size;
    
    console.log(`[Labels] Created job ${jobId} with ${itemCount} items`);
    
    if (itemCount === 0) {
      showToast('Warning: Print job created but no items were added', 'warning');
      return;
    }
    
    showToast(`Print job created with ${itemCount} labels!`, 'success');
    
    // Automatically start PDF download
    console.log('[Labels] Automatically downloading PDF for job:', jobId);
    
    try {
      if (generatePdfBtn) {
        generatePdfBtn.textContent = '⏳ Generating PDF...';
      }
      
      await downloadPDF(jobId);
      showToast('PDF downloaded successfully!', 'success');
      
      // Show modal for additional downloads (CSV) if needed
      console.log('[Labels] Opening modal for additional options');
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
  console.log('[Labels] showPdfPreviewModal called with jobId:', jobId, 'itemCount:', itemCount);
  
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
  console.log('[Labels] Modal appended to body');
  
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
      console.log('[Labels] Attempting to download PDF for job:', jobId);
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
