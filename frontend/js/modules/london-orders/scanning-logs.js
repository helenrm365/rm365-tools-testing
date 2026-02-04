// frontend/js/modules/london-orders/scanning-logs.js
// London Orders - Scanning Logs Module
// Displays scanner submission history with filtering and search

import { getApiUrl } from '../../config.js';
import { getToken } from '../../services/state/sessionStore.js';
import { showToast } from '../../ui/toast.js';

// Branch configuration
const BRANCH_CONFIG = {
  branchId: 'uk-london',
  branchName: 'UK London',
  apiPrefix: '/v1/inventory/scanning-logs/uk-london'
};

// Helper to get auth headers
function getAuthHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

class ScanningLogsManager {
  constructor() {
    this.submissions = [];
    this.currentPage = 1;
    this.totalPages = 1;
    this.perPage = 20;
    this.total = 0;
    
    this.initializeElements();
    this.attachEventListeners();
    this.loadSubmissions();
  }

  initializeElements() {
    // Filter inputs
    this.productSearch = document.getElementById('productSearch');
    this.userFilter = document.getElementById('userFilter');
    this.dateFrom = document.getElementById('dateFrom');
    this.dateTo = document.getElementById('dateTo');
    this.searchBtn = document.getElementById('searchBtn');
    this.clearFiltersBtn = document.getElementById('clearFiltersBtn');

    // Results elements
    this.loadingState = document.getElementById('loadingState');
    this.emptyState = document.getElementById('emptyState');
    this.submissionsList = document.getElementById('submissionsList');
    this.resultsSubtitle = document.getElementById('resultsSubtitle');

    // Pagination
    this.pagination = document.getElementById('pagination');
    this.prevPageBtn = document.getElementById('prevPageBtn');
    this.nextPageBtn = document.getElementById('nextPageBtn');
    this.paginationInfo = document.getElementById('paginationInfo');

    // Detail modal
    this.detailModal = document.getElementById('detailModal');
    this.closeDetailModalBtn = document.getElementById('closeDetailModalBtn');
    this.closeDetailBtn = document.getElementById('closeDetailBtn');
    this.detailId = document.getElementById('detailId');
    this.detailUser = document.getElementById('detailUser');
    this.detailDate = document.getElementById('detailDate');
    this.detailReason = document.getElementById('detailReason');
    this.detailAdded = document.getElementById('detailAdded');
    this.detailRemoved = document.getElementById('detailRemoved');
    this.detailTotal = document.getElementById('detailTotal');
    this.detailItemsBody = document.getElementById('detailItemsBody');
  }

  attachEventListeners() {
    // Search button
    this.searchBtn?.addEventListener('click', () => this.loadSubmissions());
    
    // Enter key in filter inputs
    this.productSearch?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadSubmissions();
    });
    this.userFilter?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadSubmissions();
    });

    // Clear filters
    this.clearFiltersBtn?.addEventListener('click', () => this.clearFilters());

    // Pagination
    this.prevPageBtn?.addEventListener('click', () => this.changePage(-1));
    this.nextPageBtn?.addEventListener('click', () => this.changePage(1));

    // Modal close
    this.closeDetailModalBtn?.addEventListener('click', () => this.closeDetailModal());
    this.closeDetailBtn?.addEventListener('click', () => this.closeDetailModal());
    this.detailModal?.addEventListener('click', (e) => {
      if (e.target === this.detailModal) this.closeDetailModal();
    });

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.detailModal?.classList.contains('active')) {
        this.closeDetailModal();
      }
    });
  }

  async loadSubmissions() {
    // Show loading state
    this.showLoadingState();

    try {
      const params = new URLSearchParams();
      
      // Add filters
      if (this.productSearch?.value?.trim()) {
        params.set('search', this.productSearch.value.trim());
      }
      if (this.userFilter?.value?.trim()) {
        params.set('user', this.userFilter.value.trim());
      }
      if (this.dateFrom?.value) {
        params.set('date_from', new Date(this.dateFrom.value).toISOString());
      }
      if (this.dateTo?.value) {
        // Set to end of day
        const endDate = new Date(this.dateTo.value);
        endDate.setHours(23, 59, 59, 999);
        params.set('date_to', endDate.toISOString());
      }
      
      params.set('page', this.currentPage.toString());
      params.set('per_page', this.perPage.toString());

      const url = `${getApiUrl()}${BRANCH_CONFIG.apiPrefix}/logs?${params.toString()}`;
      
      const response = await fetch(url, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load submissions: ${response.status}`);
      }

      const data = await response.json();
      
      this.submissions = data.submissions || [];
      this.total = data.total || 0;
      this.totalPages = data.total_pages || 1;
      this.currentPage = data.page || 1;

      this.renderSubmissions();
      
    } catch (error) {
      console.error('Error loading submissions:', error);
      showToast('Failed to load scanning logs', 'error');
      this.showEmptyState('Error loading submissions');
    }
  }

  showLoadingState() {
    if (this.loadingState) this.loadingState.style.display = 'flex';
    if (this.emptyState) this.emptyState.style.display = 'none';
    if (this.submissionsList) this.submissionsList.style.display = 'none';
    if (this.pagination) this.pagination.style.display = 'none';
  }

  showEmptyState(message = 'No submissions found') {
    if (this.loadingState) this.loadingState.style.display = 'none';
    if (this.emptyState) {
      this.emptyState.style.display = 'flex';
      const emptyText = this.emptyState.querySelector('p');
      if (emptyText) emptyText.textContent = message;
    }
    if (this.submissionsList) this.submissionsList.style.display = 'none';
    if (this.pagination) this.pagination.style.display = 'none';
    if (this.resultsSubtitle) this.resultsSubtitle.textContent = '0 submissions found';
  }

  renderSubmissions() {
    if (this.loadingState) this.loadingState.style.display = 'none';

    if (this.submissions.length === 0) {
      this.showEmptyState();
      return;
    }

    if (this.emptyState) this.emptyState.style.display = 'none';
    if (this.submissionsList) this.submissionsList.style.display = 'block';
    
    // Update subtitle
    if (this.resultsSubtitle) {
      this.resultsSubtitle.textContent = `${this.total} submission${this.total !== 1 ? 's' : ''} found`;
    }

    // Build submissions HTML
    let html = '';
    for (const submission of this.submissions) {
      html += this.buildSubmissionCard(submission);
    }
    
    if (this.submissionsList) {
      this.submissionsList.innerHTML = html;
      
      // Attach click listeners
      this.submissionsList.querySelectorAll('.submission-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.id;
          if (id) this.showSubmissionDetail(parseInt(id));
        });
      });
    }

    // Update pagination
    this.updatePagination();
  }

  buildSubmissionCard(submission) {
    const date = new Date(submission.submitted_at);
    const formattedDate = date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
    const formattedTime = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <div class="submission-card" data-id="${submission.id}">
        <div class="submission-header">
          <div class="submission-meta">
            <span class="submission-id">#${submission.id}</span>
            <span class="submission-date">${formattedDate} ${formattedTime}</span>
          </div>
          <div class="submission-user">
            <i class="fas fa-user"></i>
            ${this.escapeHtml(submission.submitted_by || 'Unknown')}
          </div>
        </div>
        <div class="submission-body">
          <div class="submission-reason">
            <strong>Reason:</strong> ${this.escapeHtml(submission.reason || 'No reason provided')}
          </div>
          <div class="submission-stats">
            <span class="stat-badge added">
              <i class="fas fa-plus"></i>
              +${submission.total_added || 0}
            </span>
            <span class="stat-badge removed">
              <i class="fas fa-minus"></i>
              -${submission.total_removed || 0}
            </span>
            <span class="stat-badge total">
              <i class="fas fa-box"></i>
              ${submission.total_items || 0} items
            </span>
          </div>
        </div>
        <div class="submission-footer">
          <span class="view-details">
            <i class="fas fa-eye"></i>
            View Details
          </span>
        </div>
      </div>
    `;
  }

  updatePagination() {
    if (!this.pagination) return;

    if (this.totalPages <= 1) {
      this.pagination.style.display = 'none';
      return;
    }

    this.pagination.style.display = 'flex';
    
    if (this.prevPageBtn) {
      this.prevPageBtn.disabled = this.currentPage <= 1;
    }
    if (this.nextPageBtn) {
      this.nextPageBtn.disabled = this.currentPage >= this.totalPages;
    }
    if (this.paginationInfo) {
      this.paginationInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
    }
  }

  changePage(delta) {
    const newPage = this.currentPage + delta;
    if (newPage >= 1 && newPage <= this.totalPages) {
      this.currentPage = newPage;
      this.loadSubmissions();
    }
  }

  async showSubmissionDetail(submissionId) {
    try {
      const url = `${getApiUrl()}${BRANCH_CONFIG.apiPrefix}/logs/${submissionId}`;
      
      const response = await fetch(url, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load submission: ${response.status}`);
      }

      const submission = await response.json();
      this.populateDetailModal(submission);
      this.openDetailModal();

    } catch (error) {
      console.error('Error loading submission detail:', error);
      showToast('Failed to load submission details', 'error');
    }
  }

  populateDetailModal(submission) {
    const date = new Date(submission.submitted_at);
    const formattedDate = date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (this.detailId) this.detailId.textContent = `#${submission.id}`;
    if (this.detailUser) this.detailUser.textContent = submission.submitted_by || 'Unknown';
    if (this.detailDate) this.detailDate.textContent = formattedDate;
    if (this.detailReason) this.detailReason.textContent = submission.reason || 'No reason provided';
    if (this.detailAdded) this.detailAdded.textContent = `+${submission.total_added || 0} added`;
    if (this.detailRemoved) this.detailRemoved.textContent = `-${submission.total_removed || 0} removed`;
    if (this.detailTotal) this.detailTotal.textContent = `${submission.total_items || 0} items`;

    // Build items table
    if (this.detailItemsBody) {
      let html = '';
      const items = submission.items || [];
      
      for (const item of items) {
        const quantityClass = item.quantity > 0 ? 'positive' : 'negative';
        const quantityPrefix = item.quantity > 0 ? '+' : '';
        
        // Format allocation details
        let allocationHtml = '-';
        if (item.allocation_details) {
          const details = item.allocation_details;
          if (Array.isArray(details)) {
            allocationHtml = details.map(d => 
              `${this.getShelfLabel(d.shelf)}: ${d.quantity > 0 ? '+' : ''}${d.quantity}`
            ).join('<br>');
          } else if (typeof details === 'object') {
            allocationHtml = Object.entries(details)
              .map(([shelf, qty]) => `${this.getShelfLabel(shelf)}: ${qty > 0 ? '+' : ''}${qty}`)
              .join('<br>');
          }
        }

        html += `
          <tr>
            <td class="sku-cell">${this.escapeHtml(item.sku)}</td>
            <td class="product-cell">${this.escapeHtml(item.product_name || '-')}</td>
            <td class="quantity-cell ${quantityClass}">${quantityPrefix}${item.quantity}</td>
            <td class="shelf-cell">${this.getShelfLabel(item.shelf_field)}</td>
            <td class="allocation-cell">${allocationHtml}</td>
          </tr>
        `;
      }

      if (items.length === 0) {
        html = '<tr><td colspan="5" class="empty-row">No items in this submission</td></tr>';
      }

      this.detailItemsBody.innerHTML = html;
    }
  }

  getShelfLabel(shelfField) {
    const labels = {
      'auto': 'Auto',
      'shelf_lt1_qty': '<1 Year',
      'shelf_gt1_qty': '>1 Year',
      'top_floor_total': 'Top Floor'
    };
    return labels[shelfField] || shelfField || '-';
  }

  openDetailModal() {
    if (this.detailModal) {
      this.detailModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  closeDetailModal() {
    if (this.detailModal) {
      this.detailModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  clearFilters() {
    if (this.productSearch) this.productSearch.value = '';
    if (this.userFilter) this.userFilter.value = '';
    if (this.dateFrom) this.dateFrom.value = '';
    if (this.dateTo) this.dateTo.value = '';
    this.currentPage = 1;
    this.loadSubmissions();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
}

// Initialize on page load
let scanningLogsManager = null;

export function init() {
  console.log('[ScanningLogs] Initializing London Scanning Logs module');
  scanningLogsManager = new ScanningLogsManager();
}

export function cleanup() {
  console.log('[ScanningLogs] Cleaning up London Scanning Logs module');
  scanningLogsManager = null;
}

export default { init, cleanup };
