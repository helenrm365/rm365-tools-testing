// js/modules/sales-imports/nlSales.js
import { http, get } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';
import { formatDate } from '../../utils/formatters.js';

let currentPage = 1;
let currentSearch = '';
const pageSize = 50;
let currentView = 'full'; // 'full' or 'condensed'

function switchView(view) {
    currentView = view;
    
    // Update button states
    const viewFullBtn = document.getElementById('viewFullBtn');
    const viewCondensedBtn = document.getElementById('viewCondensedBtn');
    
    if (viewFullBtn && viewCondensedBtn) {
        if (view === 'full') {
            viewFullBtn.classList.add('active');
            viewCondensedBtn.classList.remove('active');
        } else {
            viewFullBtn.classList.remove('active');
            viewCondensedBtn.classList.add('active');
        }
    }
    
    // Reset to page 1 and reload data
    currentPage = 1;
    loadSalesData();
}

export async function init() {
    console.log('[NL Sales] Initializing NL Sales module');
    
    // Verify table body exists
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) {
        console.error('[NL Sales] salesTableBody element not found in DOM!');
    } else {
        console.log('[NL Sales] salesTableBody element found');
    }
    
    // Set up event listeners
    document.getElementById('uploadForm')?.addEventListener('submit', handleUpload);
    document.getElementById('searchBtn')?.addEventListener('click', handleSearch);
    document.getElementById('clearSearchBtn')?.addEventListener('click', handleClearSearch);
    document.getElementById('prevPageBtn')?.addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageBtn')?.addEventListener('click', () => changePage(1));
    
    // View toggle buttons
    document.getElementById('viewFullBtn')?.addEventListener('click', () => switchView('full'));
    document.getElementById('viewCondensedBtn')?.addEventListener('click', () => switchView('condensed'));
    
    // Load initial data
    console.log('[NL Sales] About to load initial data...');
    await loadSalesData();
    console.log('[NL Sales] Initial data load complete');
}

async function loadSalesData() {
    console.log('[NL Sales] Loading sales data...');
    const tbody = document.getElementById('salesTableBody');
    
    try {
        const offset = (currentPage - 1) * pageSize;
        const params = new URLSearchParams({
            limit: pageSize,
            offset: offset
        });
        
        if (currentSearch) {
            params.append('search', currentSearch);
        }
        
        const endpoint = currentView === 'condensed'
            ? `/api/v1/sales-imports/nl-sales/condensed`
            : `/api/v1/sales-imports/nl-sales`;
        
        console.log('[NL Sales] Fetching from:', `${endpoint}?${params}`);
        const response = await get(`${endpoint}?${params}`);
        console.log('[NL Sales] Response received:', response);
        
        if (currentView === 'condensed') {
            displayCondensedData(response.data);
        } else {
            displaySalesData(response.data);
        }
        
        updatePagination(response);
    } catch (error) {
        console.error('[NL Sales] Error loading data:', error);
        showToast('Failed to load NL sales data', 'error');
        
        // Show error in table
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem; color: red;">Error loading data: ${error.message}</td></tr>`;
        }
    }
}

function displaySalesData(data) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) {
        console.error('[NL Sales] salesTableBody element not found!');
        return;
    }
    
    console.log('[NL Sales] Displaying sales data, rows:', data?.length || 0);
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem;">No data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${row.id || '-'}</td>
            <td>${row.order_number || '-'}</td>
            <td>${row.created_at ? formatDate(row.created_at) : '-'}</td>
            <td>${row.sku || '-'}</td>
            <td>${row.name || '-'}</td>
            <td>${row.qty || 0}</td>
            <td>${row.price ? '€' + parseFloat(row.price).toFixed(2) : '-'}</td>
            <td>${row.status || '-'}</td>
            <td>${row.imported_at ? formatDate(row.imported_at) : '-'}</td>
            <td>${row.updated_at ? formatDate(row.updated_at) : '-'}</td>
        </tr>
    `).join('');
    
    console.log('[NL Sales] Table updated successfully');
}

function displayCondensedData(data) {
    const tbody = document.getElementById('salesTableBody');
    const thead = document.querySelector('#salesTable thead tr');
    
    // Update headers to 7 columns for condensed view
    thead.innerHTML = `
        <th>ID</th>
        <th>SKU</th>
        <th>Product Name</th>
        <th>Total Quantity (6M)</th>
        <th>Start Date</th>
        <th>End Date</th>
        <th>Updated At</th>
    `;
    
    // Render condensed data
    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${row.id || '-'}</td>
            <td>${row.sku || '-'}</td>
            <td>${row.product_name || '-'}</td>
            <td><strong>${row.total_qty || 0}</strong></td>
            <td>${row.start_date ? formatDate(row.start_date) : '-'}</td>
            <td>${row.end_date ? formatDate(row.end_date) : '-'}</td>
            <td>${row.updated_at ? formatDate(row.updated_at) : '-'}</td>
        </tr>
    `).join('');
}

function updatePagination(response) {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const thead = document.querySelector('#salesTable thead tr');
    
    // Update table headers based on current view
    if (currentView === 'condensed') {
        thead.innerHTML = `
            <th>ID</th>
            <th>SKU</th>
            <th>Product Name</th>
            <th>Total Quantity (6M)</th>
            <th>Start Date</th>
            <th>End Date</th>
            <th>Updated At</th>
        `;
    } else {
        thead.innerHTML = `
            <th>ID</th>
            <th>Order #</th>
            <th>Order Date</th>
            <th>SKU</th>
            <th>Product Name</th>
            <th>Quantity</th>
            <th>Price</th>
            <th>Status</th>
            <th>Imported At</th>
            <th>Updated At</th>
        `;
    }
    
    // Calculate pagination info from response
    const total = response.total || 0;
    const totalPages = Math.ceil(total / pageSize);
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${total} total)`;
    }
    
    if (prevBtn) {
        prevBtn.disabled = currentPage <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = currentPage >= totalPages;
    }
}

async function handleUpload(event) {
    event.preventDefault();
    
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showToast('Please select a file', 'error');
        return;
    }
    
    console.log('[NL Sales] Starting upload for file:', file.name, 'Size:', file.size, 'bytes');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        showToast('Uploading file...', 'info');
        console.log('[NL Sales] Uploading file to:', '/api/v1/sales-imports/upload?region=nl');
        
        // Use raw http function for multipart form data
        // Don't set Content-Type header - browser will set it with boundary
        const response = await http(`/api/v1/sales-imports/upload?region=nl`, {
            method: 'POST',
            body: formData,
            headers: {} // Let browser set Content-Type with boundary
        });
        
        console.log('[NL Sales] Upload response:', response);
        
        if (response.status === 'success') {
            const message = response.has_errors 
                ? `Uploaded with ${response.errors?.length || 0} errors. Imported ${response.imported_count} of ${response.total_rows} rows.`
                : `Successfully uploaded ${response.imported_count} rows to NL sales table.`;
            showToast(message, response.has_errors ? 'warning' : 'success');
        } else {
            showToast(response.message || 'Upload completed with errors', 'error');
        }
        
        fileInput.value = '';
        currentPage = 1;
        console.log('[NL Sales] Reloading table data after upload...');
        await loadSalesData();
    } catch (error) {
        console.error('[NL Sales] Upload error:', error);
        showToast(error.message || 'Failed to upload file', 'error');
    }
}

function handleSearch() {
    const searchInput = document.getElementById('searchInput');
    currentSearch = searchInput?.value.trim() || '';
    currentPage = 1;
    loadSalesData();
}

function handleClearSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    currentSearch = '';
    currentPage = 1;
    loadSalesData();
}

function changePage(direction) {
    currentPage += direction;
    loadSalesData();
}

export function cleanup() {
    console.log('[NL Sales] Cleaning up');
}
