// js/modules/sales-imports/regionalSales.js
import { get, post } from '../../services/api/http.js';
import { config } from '../../config.js';

let currentRegion = 'uk';
let currentPage = 1;
let pageSize = 50;
let searchTerm = '';
let totalRecords = 0;

const regionConfig = {
  uk: {
    title: '🇬🇧 UK Sales Data',
    currency: '£',
    endpoint: '/api/v1/sales-imports/uk-sales'
  },
  fr: {
    title: '🇫🇷 FR Sales Data',
    currency: '€',
    endpoint: '/api/v1/sales-imports/fr-sales'
  },
  nl: {
    title: '🇳🇱 NL Sales Data',
    currency: '€',
    endpoint: '/api/v1/sales-imports/nl-sales'
  }
};

export async function init() {
  console.log('[Regional Sales] Initializing...');
  
  // Set up global namespace for tab switching
  window.salesImports = {
    switchRegion: switchRegion
  };
  
  // Load UK by default
  await switchRegion('uk');
}

export async function switchRegion(region) {
  console.log(`[Regional Sales] Switching to region: ${region}`);
  
  // Update active tab
  document.querySelectorAll('.region-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`[data-region="${region}"]`)?.classList.add('active');
  
  if (region === 'history') {
    // Show history, hide sales data
    document.getElementById('regionalSalesContainer').style.display = 'none';
    document.getElementById('historyContainer').style.display = 'block';
    await loadImportHistory();
  } else {
    // Show sales data, hide history
    document.getElementById('regionalSalesContainer').style.display = 'block';
    document.getElementById('historyContainer').style.display = 'none';
    
    currentRegion = region;
    currentPage = 1;
    searchTerm = '';
    
    // Update title
    const titleEl = document.getElementById('regionTitle');
    if (titleEl) {
      titleEl.textContent = regionConfig[region].title;
    }
    
    // Reset search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = '';
    }
    
    await loadSalesData();
    setupEventListeners();
  }
}

async function loadSalesData() {
  try {
    const offset = (currentPage - 1) * pageSize;
    const endpoint = regionConfig[currentRegion].endpoint;
    
    const url = `${endpoint}?limit=${pageSize}&offset=${offset}&search=${encodeURIComponent(searchTerm)}`;
    const result = await get(url);
    
    if (result.status === 'success') {
      displaySalesData(result.data);
      updateStats(result);
      totalRecords = result.total;
      updatePaginationControls();
    } else {
      showError(result.message || 'Failed to load sales data');
    }
  } catch (error) {
    console.error('[Regional Sales] Error loading data:', error);
    showError('Error loading sales data: ' + error.message);
  }
}

function displaySalesData(data) {
  const tbody = document.getElementById('salesTableBody');
  
  if (!tbody) {
    console.error('[Regional Sales] Table body not found');
    return;
  }
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading-row">No sales data found</td></tr>';
    return;
  }

  const currency = regionConfig[currentRegion].currency;
  
  tbody.innerHTML = data.map(item => {
    const statusClass = getStatusClass(item.status);
    const formattedPrice = item.price ? `${currency}${parseFloat(item.price).toFixed(2)}` : '-';
    const formattedCreatedAt = formatDate(item.created_at);
    const formattedImportedAt = formatDate(item.imported_at);
    const formattedUpdatedAt = formatDate(item.updated_at);
    
    return `
      <tr>
        <td>${item.id || '-'}</td>
        <td><strong>${escapeHtml(item.order_number)}</strong></td>
        <td>${formattedCreatedAt}</td>
        <td><code>${escapeHtml(item.sku)}</code></td>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.qty}</td>
        <td>${formattedPrice}</td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(item.status || 'N/A')}</span></td>
        <td>${formattedImportedAt}</td>
        <td>${formattedUpdatedAt}</td>
      </tr>
    `;
  }).join('');
}

function updateStats(result) {
  const totalRecordsEl = document.getElementById('totalRecords');
  const totalQtyEl = document.getElementById('totalQty');
  const totalValueEl = document.getElementById('totalValue');
  const currency = regionConfig[currentRegion].currency;
  
  if (totalRecordsEl) {
    totalRecordsEl.textContent = result.total.toLocaleString();
  }
  
  // Calculate totals from current page data
  let totalQty = 0;
  let totalValue = 0;
  
  result.data.forEach(item => {
    totalQty += item.qty || 0;
    totalValue += (item.qty || 0) * (item.price || 0);
  });
  
  if (totalQtyEl) {
    totalQtyEl.textContent = totalQty.toLocaleString();
  }
  
  if (totalValueEl) {
    totalValueEl.textContent = `${currency}${totalValue.toFixed(2)}`;
  }
}

function updatePaginationControls() {
  const totalPages = Math.ceil(totalRecords / pageSize);
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const pageInfo = document.getElementById('pageInfo');
  
  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }
  
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }
  
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  }
}

function setupEventListeners() {
  // Only set up once per region switch
  const searchInput = document.getElementById('searchInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const validateBtn = document.getElementById('validateBtn');
  const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
  
  // Remove old listeners by cloning and replacing
  if (searchInput) {
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);
    newSearchInput.addEventListener('input', debounce(handleSearch, 300));
  }
  
  if (refreshBtn) {
    const newRefreshBtn = refreshBtn.cloneNode(true);
    refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
    newRefreshBtn.addEventListener('click', () => loadSalesData());
  }
  
  if (prevBtn) {
    const newPrevBtn = prevBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
    newPrevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadSalesData();
      }
    });
  }
  
  if (nextBtn) {
    const newNextBtn = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
    newNextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(totalRecords / pageSize);
      if (currentPage < totalPages) {
        currentPage++;
        loadSalesData();
      }
    });
  }
  
  if (uploadBtn) {
    const newUploadBtn = uploadBtn.cloneNode(true);
    uploadBtn.parentNode.replaceChild(newUploadBtn, uploadBtn);
    newUploadBtn.addEventListener('click', handleUpload);
  }
  
  if (validateBtn) {
    const newValidateBtn = validateBtn.cloneNode(true);
    validateBtn.parentNode.replaceChild(newValidateBtn, validateBtn);
    newValidateBtn.addEventListener('click', handleValidate);
  }
  
  if (downloadTemplateBtn) {
    const newDownloadBtn = downloadTemplateBtn.cloneNode(true);
    downloadTemplateBtn.parentNode.replaceChild(newDownloadBtn, downloadTemplateBtn);
    newDownloadBtn.addEventListener('click', handleDownloadTemplate);
  }
}

function handleSearch(e) {
  searchTerm = e.target.value;
  currentPage = 1;
  loadSalesData();
}

async function handleUpload() {
  const fileInput = document.getElementById('csvFileInput');
  const statusDiv = document.getElementById('uploadStatus');
  
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showUploadStatus('Please select a CSV file', 'error');
    return;
  }
  
  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  formData.append('region', currentRegion);
  
  try {
    showUploadStatus('Uploading...', '');
    
    const response = await fetch(`${config.API}/api/v1/sales-imports/upload?region=${currentRegion}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: formData
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
      showUploadStatus(`✅ Successfully imported ${result.imported_count} records!`, 'success');
      fileInput.value = '';
      await loadSalesData();
    } else {
      showUploadStatus(`❌ Upload failed: ${result.message || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Regional Sales] Upload error:', error);
    showUploadStatus(`❌ Upload error: ${error.message}`, 'error');
  }
}

async function handleValidate() {
  const fileInput = document.getElementById('csvFileInput');
  
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showUploadStatus('Please select a CSV file', 'error');
    return;
  }
  
  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    showUploadStatus('Validating...', '');
    
    const response = await fetch(`${config.API}/api/v1/sales-imports/validate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: formData
    });
    
    const result = await response.json();
    
    if (result.valid) {
      showUploadStatus(`✅ CSV is valid! Found ${result.row_count} rows.`, 'success');
    } else {
      showUploadStatus(`❌ Validation failed: ${result.message || 'Invalid format'}`, 'error');
    }
  } catch (error) {
    console.error('[Regional Sales] Validation error:', error);
    showUploadStatus(`❌ Validation error: ${error.message}`, 'error');
  }
}

async function handleDownloadTemplate() {
  try {
    const response = await fetch(`${config.API}/api/v1/sales-imports/template`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sales_import_template.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('[Regional Sales] Download error:', error);
    showUploadStatus(`❌ Download error: ${error.message}`, 'error');
  }
}

async function loadImportHistory() {
  const historyContent = document.getElementById('historyContent');
  
  try {
    const result = await get('/api/v1/sales-imports/history?limit=50');
    
    if (result.history && result.history.length > 0) {
      historyContent.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Region</th>
              <th>Imported At</th>
              <th>Total Rows</th>
              <th>Imported</th>
              <th>Errors</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${result.history.map(item => `
              <tr>
                <td>${escapeHtml(item.filename)}</td>
                <td>${escapeHtml((item.region || 'UK').toUpperCase())}</td>
                <td>${formatDate(item.imported_at)}</td>
                <td>${item.total_rows}</td>
                <td>${item.imported_rows}</td>
                <td>${item.errors_count || 0}</td>
                <td><span class="status-badge ${item.status === 'completed' ? 'completed' : 'pending'}">${escapeHtml(item.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      historyContent.innerHTML = '<p>No import history found.</p>';
    }
  } catch (error) {
    console.error('[Regional Sales] Error loading history:', error);
    historyContent.innerHTML = '<p class="error">Error loading import history.</p>';
  }
}

function showUploadStatus(message, type) {
  const statusDiv = document.getElementById('uploadStatus');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = type;
  }
}

function showError(message) {
  const tbody = document.getElementById('salesTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-row" style="color: #dc3545;">${escapeHtml(message)}</td></tr>`;
  }
}

function getStatusClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('complet') || s.includes('success')) return 'completed';
  if (s.includes('cancel') || s.includes('fail')) return 'cancelled';
  return 'pending';
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
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

export function cleanup() {
  console.log('[Regional Sales] Cleaning up');
  if (window.salesImports) {
    delete window.salesImports;
  }
}
