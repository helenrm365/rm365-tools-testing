// js/modules/sales-imports/ukSales.js
import { http, get } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';
import { formatDate } from '../../utils/formatters.js';

let currentPage = 1;
let currentSearch = '';
let currentView = 'full'; // 'full' or 'condensed'
const pageSize = 50;

export async function init() {
    console.log('[UK Sales] Initializing UK Sales module');
    
    // Verify table body exists
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) {
        console.error('[UK Sales] salesTableBody element not found in DOM!');
    } else {
        console.log('[UK Sales] salesTableBody element found');
    }
    
    // Set up event listeners
    document.getElementById('uploadForm')?.addEventListener('submit', handleUpload);
    document.getElementById('searchBtn')?.addEventListener('click', handleSearch);
    document.getElementById('clearSearchBtn')?.addEventListener('click', handleClearSearch);
    document.getElementById('prevPageBtn')?.addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageBtn')?.addEventListener('click', () => changePage(1));
    document.getElementById('viewFullBtn')?.addEventListener('click', () => switchView('full'));
    document.getElementById('viewCondensedBtn')?.addEventListener('click', () => switchView('condensed'));
    
    // Load initial data
    console.log('[UK Sales] About to load initial data...');
    await loadSalesData();
    console.log('[UK Sales] Initial data load complete');
}

function switchView(view) {
    currentView = view;
    currentPage = 1; // Reset to first page when switching views
    
    // Update button states
    const fullBtn = document.getElementById('viewFullBtn');
    const condensedBtn = document.getElementById('viewCondensedBtn');
    
    if (view === 'full') {
        fullBtn?.classList.add('active');
        condensedBtn?.classList.remove('active');
    } else {
        fullBtn?.classList.remove('active');
        condensedBtn?.classList.add('active');
    }
    
    loadSalesData();
}

async function loadSalesData() {
    console.log('[UK Sales] Loading sales data...');
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
            ? `/api/v1/sales-imports/uk-sales/condensed`
            : `/api/v1/sales-imports/uk-sales`;
        
        console.log('[UK Sales] Fetching from:', `${endpoint}?${params}`);
        const response = await get(`${endpoint}?${params}`);
        console.log('[UK Sales] Response received:', response);
        
        if (currentView === 'condensed') {
            displayCondensedData(response.data);
        } else {
            displaySalesData(response.data);
        }
        
        updatePagination(response);
    } catch (error) {
        console.error('[UK Sales] Error loading data:', error);
        showToast('Failed to load UK sales data', 'error');
        
        // Show error in table
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem; color: red;">Error loading data: ${error.message}</td></tr>`;
        }
    }
}

function displaySalesData(data) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) {
        console.error('[UK Sales] salesTableBody element not found!');
        return;
    }
    
    console.log('[UK Sales] Displaying sales data, rows:', data?.length || 0);
    
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
            <td>${row.price ? '£' + parseFloat(row.price).toFixed(2) : '-'}</td>
            <td>${row.status || '-'}</td>
            <td>${row.imported_at ? formatDate(row.imported_at) : '-'}</td>
            <td>${row.updated_at ? formatDate(row.updated_at) : '-'}</td>
        </tr>
    `).join('');
    
    console.log('[UK Sales] Table updated successfully');
}

function displayCondensedData(data) {
    const tbody = document.getElementById('salesTableBody');
    const thead = document.querySelector('#salesTable thead tr');
    
    if (!tbody) return;
    
    // Update table headers for condensed view
    if (thead) {
        thead.innerHTML = `
            <th>ID</th>
            <th>SKU</th>
            <th>Product Name</th>
            <th>Total Quantity (6M)</th>
            <th>Start Date</th>
            <th>End Date</th>
            <th>Updated At</th>
        `;
    }
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No condensed data available</td></tr>';
        return;
    }
    
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
    
    // Update table headers back to full view if needed
    const thead = document.querySelector('#salesTable thead tr');
    if (currentView === 'full' && thead && !thead.innerHTML.includes('Order Number')) {
        thead.innerHTML = `
            <th>ID</th>
            <th>Order Number</th>
            <th>Created At</th>
            <th>SKU</th>
            <th>Name</th>
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
    
    console.log('[UK Sales] Starting upload for file:', file.name, 'Size:', file.size, 'bytes');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        showToast('Uploading file...', 'info');
        console.log('[UK Sales] Uploading file to:', '/api/v1/sales-imports/upload?region=uk');
        
        // Use raw http function for multipart form data
        // Don't set Content-Type header - browser will set it with boundary
        const response = await http(`/api/v1/sales-imports/upload?region=uk`, {
            method: 'POST',
            body: formData,
            headers: {} // Let browser set Content-Type with boundary
        });
        
        console.log('[UK Sales] Upload response:', response);
        
        if (response.status === 'success') {
            const message = response.has_errors 
                ? `Uploaded with ${response.errors?.length || 0} errors. Imported ${response.imported_count} of ${response.total_rows} rows.`
                : `Successfully uploaded ${response.imported_count} rows to UK sales table.`;
            showToast(message, response.has_errors ? 'warning' : 'success');
        } else {
            showToast(response.message || 'Upload completed with errors', 'error');
        }
        
        fileInput.value = '';
        currentPage = 1;
        console.log('[UK Sales] Reloading table data after upload...');
        await loadSalesData();
    } catch (error) {
        console.error('[UK Sales] Upload error:', error);
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
    console.log('[UK Sales] Cleaning up');
}
