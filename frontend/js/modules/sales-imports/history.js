// js/modules/sales-imports/history.js
import { http } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';
import { formatDate } from '../../utils/formatters.js';

let currentPage = 1;
let currentRegionFilter = '';
const pageSize = 50;

export async function init() {
    console.log('[Import History] Initializing Import History module');
    
    // Set up event listeners
    document.getElementById('regionFilter')?.addEventListener('change', handleRegionFilter);
    document.getElementById('refreshBtn')?.addEventListener('click', () => loadHistory());
    document.getElementById('prevPageBtn')?.addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageBtn')?.addEventListener('click', () => changePage(1));
    
    // Load initial data
    await loadHistory();
}

async function loadHistory() {
    try {
        const params = new URLSearchParams({
            page: currentPage,
            page_size: pageSize
        });
        
        if (currentRegionFilter) {
            params.append('region', currentRegionFilter);
        }
        
        const response = await http.get(`/api/sales-imports/history?${params}`);
        displayHistory(response.data);
        updatePagination(response.pagination);
    } catch (error) {
        console.error('[Import History] Error loading data:', error);
        showToast('Failed to load import history', 'error');
    }
}

function displayHistory(data) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">No import history available</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(row => {
        const statusClass = row.status === 'completed' ? 'status-completed' : 
                           row.status === 'partial' ? 'status-partial' : 'status-error';
        
        const regionClass = `region-${row.region}`;
        const regionLabel = row.region ? row.region.toUpperCase() : '-';
        
        const errorDetails = row.error_details && row.errors_count > 0 ? 
            `<button class="error-details-btn" onclick="showErrorDetails(${row.id}, '${escapeHtml(row.error_details)}')">View</button>` :
            '-';
        
        return `
            <tr>
                <td>${row.id || '-'}</td>
                <td>${row.imported_at ? formatDate(row.imported_at) : '-'}</td>
                <td title="${escapeHtml(row.filename)}">${truncate(row.filename, 30)}</td>
                <td><span class="region-badge ${regionClass}">${regionLabel}</span></td>
                <td>${row.uploaded_by || 'Unknown'}</td>
                <td>${row.user_email || '-'}</td>
                <td>${row.total_rows || 0}</td>
                <td>${row.imported_rows || 0}</td>
                <td>${row.errors_count || 0}</td>
                <td><span class="status-badge ${statusClass}">${row.status || 'unknown'}</span></td>
                <td>${errorDetails}</td>
            </tr>
        `;
    }).join('');
}

function updatePagination(pagination) {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${pagination.page} of ${pagination.total_pages} (${pagination.total} total)`;
    }
    
    if (prevBtn) {
        prevBtn.disabled = pagination.page <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = pagination.page >= pagination.total_pages;
    }
}

function handleRegionFilter(event) {
    currentRegionFilter = event.target.value;
    currentPage = 1;
    loadHistory();
}

function changePage(direction) {
    currentPage += direction;
    loadHistory();
}

function truncate(str, maxLength) {
    if (!str) return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Make showErrorDetails available globally for onclick handler
window.showErrorDetails = function(id, details) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;
    
    modal.innerHTML = `
        <div style="
            background: white;
            padding: 2rem;
            border-radius: 8px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        ">
            <h3 style="margin-top: 0;">Import Error Details (ID: ${id})</h3>
            <pre style="
                background: #f8f9fa;
                padding: 1rem;
                border-radius: 4px;
                overflow-x: auto;
                white-space: pre-wrap;
                word-wrap: break-word;
            ">${details}</pre>
            <button onclick="this.closest('div[style*=\"fixed\"]').remove()" style="
                padding: 0.5rem 1rem;
                background: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                margin-top: 1rem;
            ">Close</button>
        </div>
    `;
    
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };
    
    document.body.appendChild(modal);
};

export function cleanup() {
    console.log('[Import History] Cleaning up');
    delete window.showErrorDetails;
}
