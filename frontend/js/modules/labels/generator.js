// js/modules/labels/generator.js
import { getProductsToPrint, createPrintJob, downloadPDF, downloadCSV } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';

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
  statusFilters: []
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
  
  await loadProducts();
  setupEventListeners();
  updateUI();
}

function setupStatusFilterCheckboxes() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = state.statusFilters.includes(checkbox.value);
  });
}

async function loadProducts() {
  const loadingEl = document.querySelector('#loadingIndicator');
  const errorEl = document.querySelector('#errorMessage');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (errorEl) errorEl.style.display = 'none';
  
  try {
    // Fetch products with current status filters
    state.allProducts = await getProductsToPrint(state.statusFilters);
    state.filteredProducts = [...state.allProducts];
    state.displayedProducts = [...state.allProducts];
    
    console.log(`[Labels] Loaded ${state.allProducts.length} products with filters:`, state.statusFilters);
    
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
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = `Failed to load products: ${error.message}`;
    }
    showToast('Failed to load products: ' + error.message, 'error');
  }
}

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
  
  // Line date input
  const lineDateInput = document.querySelector('#lineDateInput');
  if (lineDateInput) {
    // Set default to today
    lineDateInput.value = new Date().toISOString().split('T')[0];
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
  
  console.log('[Labels] Applying filters:', selectedFilters);
  
  // Save preferences
  state.statusFilters = selectedFilters;
  saveStatusFilters(selectedFilters);
  
  // Clear selections when changing filters
  state.selectedProducts.clear();
  
  // Reload products from API with new filters
  await loadProducts();
  
  // Visual feedback on button
  const applyBtn = document.getElementById('applyStatusFilters');
  if (applyBtn) {
    const originalText = applyBtn.textContent;
    const originalBg = applyBtn.style.background;
    applyBtn.textContent = '✓ Filters Applied';
    applyBtn.style.background = '#10b981';
    setTimeout(() => {
      applyBtn.textContent = originalText;
      applyBtn.style.background = originalBg;
    }, 2000);
  }
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    state.displayedProducts = [...state.filteredProducts];
  } else {
    state.displayedProducts = state.filteredProducts.filter(p => 
      (p.sku || '').toLowerCase().includes(query) ||
      (p.product_name || '').toLowerCase().includes(query) ||
      (p.item_id || '').toLowerCase().includes(query)
    );
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
        <td colspan="6" style="text-align: center; padding: 2rem; color: #666;">
          No products found
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = state.displayedProducts.map(product => {
    const isChecked = state.selectedProducts.has(product.item_id);
    return `
      <tr>
        <td>
          <input 
            type="checkbox" 
            class="product-checkbox" 
            data-item-id="${product.item_id}"
            ${isChecked ? 'checked' : ''}
          >
        </td>
        <td>${escapeHtml(product.sku || '-')}</td>
        <td>${escapeHtml(product.product_name || '-')}</td>
        <td>${escapeHtml(product.item_id || '-')}</td>
        <td style="text-align: right;">${product.uk_6m_data || '0'}</td>
        <td style="text-align: right;">${product.fr_6m_data || '0'}</td>
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
  
  const lineDateInput = document.querySelector('#lineDateInput');
  const lineDate = lineDateInput ? lineDateInput.value : null;
  
  const generatePdfBtn = document.querySelector('#generatePdfBtn');
  if (generatePdfBtn) {
    generatePdfBtn.disabled = true;
    generatePdfBtn.textContent = '⏳ Creating Job...';
  }
  
  try {
    // Create print job with selected item IDs
    const payload = {
      line_date: lineDate || undefined,
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
