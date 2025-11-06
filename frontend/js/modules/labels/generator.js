// js/modules/labels/generator.js
import { getProductsToPrint, createPrintJob, downloadPDF, downloadCSV } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';

let state = {
  products: [],
  filteredProducts: [],
  selectedProducts: new Set(),
  selectAll: false
};

export async function initLabelGenerator() {
  console.log('[Labels] Initializing label generator');
  
  await loadProducts();
  setupEventListeners();
  updateUI();
}

async function loadProducts() {
  const loadingEl = document.querySelector('#loadingIndicator');
  const errorEl = document.querySelector('#errorMessage');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (errorEl) errorEl.style.display = 'none';
  
  try {
    state.products = await getProductsToPrint();
    state.filteredProducts = [...state.products];
    console.log(`[Labels] Loaded ${state.products.length} products`);
    
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
  
  // Line date input
  const lineDateInput = document.querySelector('#lineDateInput');
  if (lineDateInput) {
    // Set default to today
    lineDateInput.value = new Date().toISOString().split('T')[0];
  }
  
  // Generate button
  const generateBtn = document.querySelector('#generateBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerate);
  }
  
  // Refresh button
  const refreshBtn = document.querySelector('#refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadProducts);
  }
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    state.filteredProducts = [...state.products];
  } else {
    state.filteredProducts = state.products.filter(p => 
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
    // Select all filtered products
    state.filteredProducts.forEach(p => state.selectedProducts.add(p.item_id));
  } else {
    // Deselect all
    state.selectedProducts.clear();
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
    selectAllCheckbox.checked = state.selectedProducts.size === state.filteredProducts.length;
  }
  
  updateStats();
}

function renderProductTable() {
  const tbody = document.querySelector('#productsTableBody');
  if (!tbody) return;
  
  if (state.filteredProducts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2rem; color: #666;">
          No products found
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = state.filteredProducts.map(product => {
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
        <td>${product.uk_6m_data || '0'}</td>
        <td>${product.fr_6m_data || '0'}</td>
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
  const generateBtn = document.querySelector('#generateBtn');
  
  if (totalEl) totalEl.textContent = state.filteredProducts.length;
  if (selectedEl) selectedEl.textContent = state.selectedProducts.size;
  if (generateBtn) {
    generateBtn.disabled = state.selectedProducts.size === 0;
  }
}

function updateUI() {
  const generateBtn = document.querySelector('#generateBtn');
  if (generateBtn) {
    generateBtn.disabled = state.selectedProducts.size === 0;
  }
}

async function handleGenerate() {
  if (state.selectedProducts.size === 0) {
    showToast('Please select at least one product', 'error');
    return;
  }
  
  const lineDateInput = document.querySelector('#lineDateInput');
  const lineDate = lineDateInput ? lineDateInput.value : null;
  
  const generateBtn = document.querySelector('#generateBtn');
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Creating Job...';
  }
  
  try {
    // Create print job with selected item IDs
    const payload = {
      line_date: lineDate || undefined,
      created_by: 'user@example.com', // TODO: Get from session
      item_ids: Array.from(state.selectedProducts)
    };
    
    const result = await createPrintJob(payload);
    const jobId = result.job_id;
    
    console.log(`[Labels] Created job ${jobId}`);
    showToast('Print job created successfully!', 'success');
    
    // Show download options modal
    showDownloadModal(jobId);
    
  } catch (error) {
    console.error('[Labels] Error creating print job:', error);
    showToast('Failed to create print job: ' + error.message, 'error');
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = '🏷️ Generate Labels';
    }
  }
}

function showDownloadModal(jobId) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h3>✅ Label Job Created</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 1.5rem;">
          Your label print job <strong>#${jobId}</strong> has been created with <strong>${state.selectedProducts.size}</strong> products.
        </p>
        <div style="display: flex; gap: 1rem; flex-direction: column;">
          <button class="modern-button" id="downloadPdfBtn" style="width: 100%;">
            📄 Download PDF Labels
          </button>
          <button class="modern-button" id="downloadCsvBtn" style="width: 100%; background: #10b981;">
            📊 Download CSV Export
          </button>
          <button class="modern-button" onclick="this.closest('.modal-overlay').remove()" style="width: 100%; background: #6b7280;">
            Close
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // PDF download
  modal.querySelector('#downloadPdfBtn').addEventListener('click', async () => {
    try {
      await downloadPDF(jobId);
      showToast('PDF download started', 'success');
    } catch (error) {
      showToast('Failed to download PDF: ' + error.message, 'error');
    }
  });
  
  // CSV download
  modal.querySelector('#downloadCsvBtn').addEventListener('click', async () => {
    try {
      await downloadCSV(jobId);
      showToast('CSV download started', 'success');
    } catch (error) {
      showToast('Failed to download CSV: ' + error.message, 'error');
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
