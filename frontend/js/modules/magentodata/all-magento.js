// frontend/js/modules/magentodata/all-magento.js
import { getAllRegionsData, getAllRegionsAggregatedMerged, getAllRegionsCustomRangeMerged, getShippingMethods, checkTablesStatus, initializeTables } from '../../services/api/magentoDataApi.js?v=9';
import { showToast } from '../../ui/toast.js';
import { showCustomRangeModal } from './aggregated-filters.js?v=3';
import { initDropdown } from '../../ui/dropdown.js';
import { exportToPDF } from '../../utils/pdfExport.js';
import { exportToCSV, exportFullDataToCSV } from '../../utils/csvExport.js';
import {
  showFullDataFilterModal,
  renderFullDataFilterBar,
  syncControlGroups,
  emptyFullDataFilters,
  hasActiveFullDataFilters,
  describeFullDataFilters,
  filtersFilenameSlug
} from './full-data-filters.js?v=5';

let currentPage = 0;
const pageSize = 100;
let currentSearch = '';
let viewMode = 'full'; // 'full', 'aggregated', or 'custom'
let allData = [];
let totalRecords = 0;
let isSearchMode = false;
let customRangeLabel = '';
let currentSortColumn = null;
let currentSortDirection = 'asc';
// Custom range params stored for re-queries (search/sort/page)
let customRangeParams = null;
let _onCustomRangeApplied = null; // Stored handler ref to avoid listener duplication
let fullDataFilters = emptyFullDataFilters(); // Date range + order status filters for the Full Data view
const MAX_EXPORT_ROWS = 50000; // Safety cap on CSV export size

/**
 * Initialize All Magento page
 */
export async function initAllMagentoData(path = '/sales/all') {
  showToast('Initializing All Magento...', 'info');

  // Reset state
  currentPage = 0;
  currentSearch = '';
  isSearchMode = false;
  currentSortColumn = null;
  currentSortDirection = 'asc';
  allData = [];
  totalRecords = 0;
  fullDataFilters = emptyFullDataFilters();

  // Determine initial view mode from URL
  if (path.includes('/6-month')) {
    viewMode = 'aggregated';
    customRangeLabel = '';
  } else if (path.includes('/custom-range')) {
    viewMode = 'custom';
  } else {
    viewMode = 'full';
    customRangeLabel = '';
    history.replaceState({ path: '/sales/all/full-data' }, '', '/sales/all/full-data');
  }

  await new Promise(resolve => setTimeout(resolve, 0));

  showTableLoading();
  setupEventListeners();
  updateViewButtons();
  updateViewLayout();

  // Check tables
  try {
    const status = await checkTablesStatus();
    if (!status.all_tables_exist) {
      showToast('Initializing database tables...', 'info');
      await initializeTables();
    }
  } catch (error) {
    console.error('[All Magento] Error checking tables:', error);
  }

  // Load data based on view mode
  if (viewMode === 'custom') {
    if (window.customRangeActive && window.customRangeActive.region === 'all') {
      customRangeLabel = window.customRangeActive.rangeLabel || 'Custom Range';
      customRangeParams = {
        rangeType: window.customRangeActive.rangeType,
        rangeValue: window.customRangeActive.rangeValue,
        useExclusions: window.customRangeActive.useExclusions,
        shippingMethod: window.customRangeActive.shippingMethod || ''
      };
      await loadCustomRangeData();
    } else {
      showToast('No custom range data. Loading full data.', 'warning');
      viewMode = 'full';
      customRangeLabel = '';
      customRangeParams = null;
      history.replaceState({ path: '/sales/all/full-data' }, '', '/sales/all/full-data');
      updateViewButtons();
      updateViewLayout();
      await loadMagentoData();
    }
  } else if (viewMode === 'aggregated') {
    showToast('Loading 6-month aggregated data...', 'info');
    await loadAggregatedData();
  } else {
    showToast('Loading All Magento data...', 'info');
    await loadMagentoData();
  }
}

/**
 * Toggle visibility of full-data vs aggregated layout
 */
function updateViewLayout() {
  // Single table approach - no separate blocks to toggle.
  // The aggregatedDataBlock is kept as an empty placeholder for compatibility.
  const aggBlock = document.getElementById('aggregatedDataBlock');
  if (aggBlock) aggBlock.style.display = 'none';
}

function updateViewButtons() {
  const viewFullBtn = document.getElementById('viewFullBtn');
  const viewAggregatedBtn = document.getElementById('viewAggregatedBtn');
  const customRangeBtn = document.getElementById('customRangeBtn');
  const orderDataTitle = document.getElementById('orderDataTitle');

  viewFullBtn?.classList.remove('active');
  viewAggregatedBtn?.classList.remove('active');
  customRangeBtn?.classList.remove('active');

  if (viewMode === 'full') {
    viewFullBtn?.classList.add('active');
    if (orderDataTitle) orderDataTitle.textContent = 'Full Data';
  } else if (viewMode === 'aggregated') {
    viewAggregatedBtn?.classList.add('active');
    if (orderDataTitle) orderDataTitle.textContent = '6-Month Data';
  } else if (viewMode === 'custom') {
    customRangeBtn?.classList.add('active');
    if (orderDataTitle) orderDataTitle.textContent = 'Custom Range Data';
  }

  updateFullDataFilterUI();
}

function setupEventListeners() {
  const viewFullBtn = document.getElementById('viewFullBtn');
  const viewAggregatedBtn = document.getElementById('viewAggregatedBtn');

  if (viewFullBtn) {
    viewFullBtn.addEventListener('click', () => {
      window.navigate('/sales/all/full-data');
    });
  }

  if (viewAggregatedBtn) {
    viewAggregatedBtn.addEventListener('click', () => {
      window.navigate('/sales/all/6-month');
    });
  }

  // Search
  const searchInput = document.getElementById('magentoSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  let searchTimeout = null;

  const performSearch = async () => {
    const inputElement = document.getElementById('magentoSearchInput');
    if (!inputElement) return;

    const searchValue = inputElement.value.trim();
    currentSearch = searchValue;
    currentPage = 0;

    if (searchValue.length > 0) {
      isSearchMode = true;
      await loadDataForCurrentView();
    } else {
      isSearchMode = false;
      await loadDataForCurrentView();
    }
  };

  const debouncedSearch = () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(), 400);
  };

  const clearSearch = () => {
    const inputElement = document.getElementById('magentoSearchInput');
    if (inputElement) inputElement.value = '';
    currentSearch = '';
    currentPage = 0;
    isSearchMode = false;
    if (searchTimeout) { clearTimeout(searchTimeout); searchTimeout = null; }
    loadDataForCurrentView();
  };

  if (searchInput) {
    searchInput.addEventListener('input', () => debouncedSearch());
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchTimeout) clearTimeout(searchTimeout);
        performSearch();
      }
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      clearSearch();
    });
  }

  // Pagination
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        loadDataForCurrentView();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(totalRecords / pageSize);
      if (currentPage < totalPages - 1) {
        currentPage++;
        loadDataForCurrentView();
      }
    });
  }

  // Custom Range button - opens a custom range modal for 'all'
  let retryCount = 0;
  const setupCustomRangeButton = () => {
    const customRangeBtn = document.getElementById('customRangeBtn');
    if (customRangeBtn) {
      const newBtn = customRangeBtn.cloneNode(true);
      customRangeBtn.parentNode.replaceChild(newBtn, customRangeBtn);
      newBtn.addEventListener('click', () => {
        showAllCustomRangeModal();
      });
    } else if (retryCount < 5) {
      retryCount++;
      setTimeout(setupCustomRangeButton, 100);
    }
  };
  setupCustomRangeButton();

  // Export PDF
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
      await handleExportPDF();
    });
  }

  // Export CSV
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', async () => {
      await handleExportCSV();
    });
  }

  // Full Data filter button (date range + order status)
  const fullDataFilterBtn = document.getElementById('fullDataFilterBtn');
  if (fullDataFilterBtn) {
    fullDataFilterBtn.addEventListener('click', () => {
      showFullDataFilterModal('all', fullDataFilters, applyFullDataFilters);
    });
  }

  // Listen for custom range applied
  if (_onCustomRangeApplied) window.removeEventListener('customRangeApplied', _onCustomRangeApplied);
  _onCustomRangeApplied = (e) => {
    if (e.detail.region === 'all') {
      window.navigate('/sales/all/custom-range');
    }
  };
  window.addEventListener('customRangeApplied', _onCustomRangeApplied);

  // Set up table sorting for full data view
  setupTableSorting();
}

/**
 * Show a custom range modal specifically for the "All" page.
 * It fetches /all/aggregated/custom-range and stores results.
 */
function showAllCustomRangeModal() {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width: 500px;">
      <div class="modal-header">
        <div class="modal-header-icon"><i class="fas fa-calendar-day"></i></div>
        <h2 class="modal-title">Custom Range Analysis - All Regions</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="nui-field">
          <div class="nui-label"><span>Select Time Range</span></div>
          <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 12px;">
            <label class="radio-option">
              <input type="radio" name="rangeType" value="days" checked>
              <span>Last</span>
              <input type="number" id="rangeDays" class="nui-input nui-input-default" value="30" min="1" style="width: 80px; margin: 0 8px;">
              <span>Days</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="rangeType" value="months">
              <span>Last</span>
              <input type="number" id="rangeMonths" class="nui-input nui-input-default" value="6" min="1" disabled style="width: 80px; margin: 0 8px; opacity: 0.5;">
              <span>Months</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="rangeType" value="since">
              <span>Since</span>
              <input type="date" id="rangeSince" class="nui-input nui-input-default" disabled style="margin-left: 8px; opacity: 0.5;">
            </label>
          </div>
        </div>
        
        <div class="nui-field" style="margin-top: 24px; border-top: 1px solid var(--bg-light); padding-top: 24px;">
          <div class="nui-label"><span>Shipping Method</span></div>
          <div style="margin-top: 12px;">
            <select id="shippingMethodSelect" class="nui-input nui-input-default" style="width: 100%;">
              <option value="">All Shipping Methods</option>
            </select>
            <p class="filter-description" style="margin-top: 8px;">
              Filter results to only show products sold via a specific shipping method.
            </p>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; padding: 16px;">
        <button class="btn btn-solid btn-default rounded-lg" id="cancelRangeBtn">Cancel</button>
        <button class="btn btn-solid btn-success" id="applyRangeBtn">
          <i class="fas fa-check"></i> Apply
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Init the shipping method dropdown immediately so it's styled from the start
  const shippingSelect = overlay.querySelector('#shippingMethodSelect');
  if (shippingSelect) {
    initDropdown(shippingSelect, { color: 'default' });
  }

  // Load shipping methods async — MutationObserver on the dropdown will auto-sync
  (async () => {
    try {
      const result = await getShippingMethods('all');
      if (result.status === 'success' && result.shipping_methods) {
        const select = overlay.querySelector('#shippingMethodSelect');
        if (select) {
          result.shipping_methods.forEach(method => {
            const option = document.createElement('option');
            option.value = method;
            option.textContent = method;
            select.appendChild(option);
          });
        }
      }
    } catch (e) {
      console.warn('Could not load shipping methods:', e);
    }
  })();

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Toggle radio inputs
  const radioButtons = overlay.querySelectorAll('input[name="rangeType"]');
  radioButtons.forEach(radio => {
    radio.addEventListener('change', () => {
      const daysInput = overlay.querySelector('#rangeDays');
      const monthsInput = overlay.querySelector('#rangeMonths');
      const sinceInput = overlay.querySelector('#rangeSince');
      daysInput.disabled = radio.value !== 'days';
      daysInput.style.opacity = radio.value === 'days' ? '1' : '0.5';
      monthsInput.disabled = radio.value !== 'months';
      monthsInput.style.opacity = radio.value === 'months' ? '1' : '0.5';
      sinceInput.disabled = radio.value !== 'since';
      sinceInput.style.opacity = radio.value === 'since' ? '1' : '0.5';
    });
  });

  // Cancel
  overlay.querySelector('#cancelRangeBtn').addEventListener('click', () => overlay.remove());

  // Apply
  overlay.querySelector('#applyRangeBtn').addEventListener('click', async () => {
    const selectedRadio = overlay.querySelector('input[name="rangeType"]:checked');
    const rangeType = selectedRadio.value;
    const shippingMethodSelect = overlay.querySelector('#shippingMethodSelect');
    const shippingMethod = shippingMethodSelect ? shippingMethodSelect.value : '';
    let rangeValue, rangeLabel;

    if (rangeType === 'days') {
      rangeValue = overlay.querySelector('#rangeDays').value;
      rangeLabel = `Last ${rangeValue} Days`;
    } else if (rangeType === 'months') {
      rangeValue = overlay.querySelector('#rangeMonths').value;
      rangeLabel = `Last ${rangeValue} Months`;
    } else {
      rangeValue = overlay.querySelector('#rangeSince').value;
      if (!rangeValue) { showToast('Please select a date', 'warning'); return; }
      rangeLabel = `Since ${rangeValue}`;
    }

    const shippingLabel = shippingMethod ? ` (${shippingMethod})` : '';

    const applyBtn = overlay.querySelector('#applyRangeBtn');
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

    try {
      const response = await getAllRegionsCustomRangeMerged(rangeType, rangeValue, true, 100, 0, '', '', 'desc', shippingMethod);

      if (response.status === 'success') {
        customRangeParams = { rangeType, rangeValue, useExclusions: true, shippingMethod };
        window.customRangeActive = {
          region: 'all',
          rangeType,
          rangeValue,
          useExclusions: true,
          shippingMethod,
          rangeLabel: rangeLabel + shippingLabel
        };

        overlay.remove();

        window.dispatchEvent(new CustomEvent('customRangeApplied', {
          detail: { region: 'all', rangeLabel: rangeLabel + shippingLabel }
        }));

        showToast(`Custom range applied: ${rangeLabel}${shippingLabel}`, 'success');
      } else {
        showToast(`Error: ${response.message || 'Failed to load data'}`, 'error');
        applyBtn.disabled = false;
        applyBtn.innerHTML = '<i class="fas fa-check"></i> Apply';
      }
    } catch (error) {
      console.error('Error running custom analysis:', error);
      showToast(`Error: ${error.message}`, 'error');
      applyBtn.disabled = false;
      applyBtn.innerHTML = '<i class="fas fa-check"></i> Apply';
    }
  });
}

// ===== FULL DATA VIEW FUNCTIONS =====

async function loadMagentoData() {
  const tbody = document.getElementById('magentoTableBody');
  if (!tbody) return;

  showTableLoading();

  try {
    const offset = currentPage * pageSize;
    const result = await getAllRegionsData(pageSize, offset, '', currentSortColumn || '', currentSortDirection, fullDataFilters);

    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      displayCurrentPage();
    } else {
      allData = [];
      totalRecords = 0;
      displayCurrentPage();
      showToast('No data available', 'info');
    }
  } catch (error) {
    console.error('[All Magento] Error loading data:', error);
    allData = [];
    totalRecords = 0;
    displayCurrentPage();
    showToast('Error loading data: ' + error.message, 'error');
  }
}

async function loadSearchResults(searchTerm) {
  const tbody = document.getElementById('magentoTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; padding: 2rem;">Searching for "${escapeHtml(searchTerm)}"...</td></tr>`;

  try {
    const offset = currentPage * pageSize;
    const result = await getAllRegionsData(pageSize, offset, searchTerm, currentSortColumn || '', currentSortDirection, fullDataFilters);

    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      displayCurrentPage();
    } else {
      tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; padding: 2rem; color: red;">Search error: ${escapeHtml(result.message || 'Unknown')}</td></tr>`;
    }
  } catch (error) {
    console.error('[All Magento] Error searching data:', error);
    tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; padding: 2rem; color: red;">Search error: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function displayCurrentPage() {
  const tbody = document.getElementById('magentoTableBody');
  const pageInfo = document.getElementById('pageInfo');
  const paginationInfo = document.getElementById('paginationInfo');

  if (!tbody) return;

  if (!allData || allData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" style="text-align: center; padding: 2rem;">No data available</td></tr>';
    if (pageInfo) pageInfo.textContent = 'No data loaded';
    if (paginationInfo) paginationInfo.innerHTML = 'Showing <strong>0</strong> of <strong>0</strong> items';
    updatePaginationButtons();
    updateFullDataFilterUI();
    return;
  }

  const pageData = allData;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  displayFullData(pageData);

  // PDF export stays aggregated-only; CSV is available in Full Data too
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) exportPdfBtn.style.display = 'none';
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.style.display = '';

  updateFullDataFilterUI();

  const startItem = currentPage * pageSize + 1;
  const endItem = Math.min((currentPage + 1) * pageSize, totalRecords);

  if (paginationInfo) {
    paginationInfo.innerHTML = `Showing <strong>${startItem}-${endItem}</strong> of <strong>${totalRecords}</strong> items`;
  }
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages}`;
  }

  updatePaginationButtons();
  updateSortIndicators();
}

/**
 * Reset the search box and its state without triggering a reload - the caller
 * decides how to refresh so removing a chip only costs one request.
 */
function clearSearchTerm() {
  const input = document.getElementById('magentoSearchInput');
  if (input) input.value = '';
  currentSearch = '';
  isSearchMode = false;
  currentPage = 0;
}

/**
 * Show/hide the Full Data filter button and the active filter summary bar
 */
function updateFullDataFilterUI() {
  const filterBtn = document.getElementById('fullDataFilterBtn');
  if (filterBtn) {
    filterBtn.style.display = viewMode === 'full' ? '' : 'none';
  }

  // Chips only make sense in Full Data view; null collapses the bar
  renderFullDataFilterBar(viewMode === 'full' ? fullDataFilters : null, {
    search: currentSearch,
    onChange: applyFullDataFilters,
    onClearSearch: () => {
      clearSearchTerm();
      loadDataForCurrentView();
    },
    onClearAll: () => {
      clearSearchTerm();
      applyFullDataFilters(emptyFullDataFilters());
    }
  });

  // Drop any control group left with no visible buttons in this view
  syncControlGroups();
}

/**
 * Apply new Full Data filters and reload from the first page
 */
async function applyFullDataFilters(filters) {
  fullDataFilters = filters;
  currentPage = 0;
  updateFullDataFilterUI();

  await loadDataForCurrentView();

  if (hasActiveFullDataFilters(filters)) {
    showToast(`Filters applied: ${describeFullDataFilters(filters)}`, 'success');
  } else {
    showToast('Filters cleared', 'info');
  }
}

function updatePaginationButtons() {
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');

  if (prevBtn) prevBtn.disabled = currentPage === 0;
  if (nextBtn) {
    const totalPages = Math.ceil(totalRecords / pageSize);
    nextBtn.disabled = currentPage >= totalPages - 1 || totalRecords === 0;
  }
}

function displayFullData(data) {
  const tbody = document.getElementById('magentoTableBody');
  const thead = document.querySelector('#magentoTable thead tr');

  if (!tbody) return;

  if (thead) {
    thead.innerHTML = `
      <th><i class="fas fa-globe"></i> Region</th>
      <th><i class="fas fa-hashtag"></i> Order Number</th>
      <th><i class="fas fa-calendar"></i> Created At</th>
      <th><i class="fas fa-barcode"></i> Product SKU</th>
      <th><i class="fas fa-box"></i> Product Name</th>
      <th><i class="fas fa-sort-numeric-up"></i> Product Qty</th>
      <th><i class="fas fa-pound-sign"></i> Original Price</th>
      <th><i class="fas fa-tag"></i> Special Price</th>
      <th><i class="fas fa-info-circle"></i> Status</th>
      <th><i class="fas fa-money-bill"></i> Currency</th>
      <th><i class="fas fa-calculator"></i> Grand Total</th>
      <th><i class="fas fa-envelope"></i> Customer Email</th>
      <th><i class="fas fa-user"></i> Customer Full Name</th>
      <th><i class="fas fa-map-marker-alt"></i> Billing Address</th>
      <th><i class="fas fa-shipping-fast"></i> Shipping Address</th>
      <th><i class="fas fa-truck"></i> Shipping Method</th>
      <th><i class="fas fa-users"></i> Customer Group Code</th>
    `;
    updateSortIndicators();
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" style="text-align: center; padding: 2rem;">No data found</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(row => {
    const regionBadge = getRegionBadge(row.region);
    return `
    <tr>
      <td>${regionBadge}</td>
      <td>${escapeHtml(row.order_number || '')}</td>
      <td>${escapeHtml(row.created_at || '')}</td>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${row.qty || 0}</td>
      <td>${row.original_price ? getCurrencySymbol(row.currency) + parseFloat(row.original_price).toFixed(2) : ''}</td>
      <td>${row.special_price ? getCurrencySymbol(row.currency) + parseFloat(row.special_price).toFixed(2) : ''}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${row.grand_total ? getCurrencySymbol(row.currency) + parseFloat(row.grand_total).toFixed(2) : ''}</td>
      <td>${escapeHtml(row.customer_email || '')}</td>
      <td>${escapeHtml(row.customer_full_name || '')}</td>
      <td>${escapeHtml(row.billing_address || '')}</td>
      <td>${escapeHtml(row.shipping_address || '')}</td>
      <td>${escapeHtml(row.shipping_method || '')}</td>
      <td>${escapeHtml(row.customer_group_code || '')}</td>
    </tr>
  `}).join('');
}

function getRegionBadge(region) {
  const colors = {
    'UK': 'var(--accent-color, #0078d4)',
    'FR': '#e74c3c',
    'NL': '#f39c12'
  };
  const color = colors[region] || '#666';
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; background: ${color}20; color: ${color}; border: 1px solid ${color}40;">${escapeHtml(region || '')}</span>`;
}

// ===== AGGREGATED DATA VIEW FUNCTIONS =====

/**
 * Unified data loader — routes to the correct API based on viewMode.
 */
async function loadDataForCurrentView() {
  if (viewMode === 'aggregated') {
    await loadAggregatedData();
  } else if (viewMode === 'custom') {
    await loadCustomRangeData();
  } else {
    if (currentSearch) {
      await loadSearchResults(currentSearch);
    } else {
      await loadMagentoData();
    }
  }
}

async function loadAggregatedData() {
  showTableLoading();

  try {
    const offset = currentPage * pageSize;
    const result = await getAllRegionsAggregatedMerged(pageSize, offset, currentSearch, currentSortColumn || '', currentSortDirection);

    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      displayAggregatedPage();
    } else {
      allData = [];
      totalRecords = 0;
      displayAggregatedPage();
      showToast('Failed to load aggregated data: ' + (result.message || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('[All Magento] Error loading aggregated data:', error);
    allData = [];
    totalRecords = 0;
    displayAggregatedPage();
    showToast('Error loading aggregated data: ' + error.message, 'error');
  }
}

async function loadCustomRangeData() {
  if (!customRangeParams) {
    showToast('No custom range parameters set', 'warning');
    return;
  }

  showTableLoading();

  try {
    const offset = currentPage * pageSize;
    const result = await getAllRegionsCustomRangeMerged(
      customRangeParams.rangeType,
      customRangeParams.rangeValue,
      customRangeParams.useExclusions,
      pageSize, offset, currentSearch,
      currentSortColumn || '', currentSortDirection,
      customRangeParams.shippingMethod || ''
    );

    if (result.status === 'success' && result.data) {
      allData = result.data;
      totalRecords = result.total_count || 0;
      displayAggregatedPage();
    } else {
      allData = [];
      totalRecords = 0;
      displayAggregatedPage();
      showToast('Failed to load custom range data: ' + (result.message || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('[All Magento] Error loading custom range data:', error);
    allData = [];
    totalRecords = 0;
    displayAggregatedPage();
    showToast('Error loading custom range data: ' + error.message, 'error');
  }
}

function showTableLoading() {
  const tbody = document.getElementById('magentoTableBody');
  if (!tbody) return;
  const colSpan = viewMode === 'full' ? '17' : '6';
  tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 2rem;">
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px;">
      <div class="loader" style="margin: 0;">
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
        <div class="dot" style="background: var(--accent-color, #0078d4);"></div>
      </div>
    </div>
  </td></tr>`;
}

function displayAggregatedPage() {
  const tbody = document.getElementById('magentoTableBody');
  const thead = document.querySelector('#magentoTable thead tr');
  const pageInfo = document.getElementById('pageInfo');
  const paginationInfo = document.getElementById('paginationInfo');

  if (!tbody) return;

  // Swap headers to aggregated columns
  const headerLabel = viewMode === 'custom' ? customRangeLabel : '6 Months';
  if (thead) {
    thead.innerHTML = `
      <th><i class="fas fa-barcode"></i> SKU</th>
      <th><i class="fas fa-box"></i> Product Name</th>
      <th><i class="fas fa-flag"></i> UK Qty (${escapeHtml(headerLabel)})</th>
      <th><i class="fas fa-flag"></i> FR Qty (${escapeHtml(headerLabel)})</th>
      <th><i class="fas fa-globe"></i> Total Qty (${escapeHtml(headerLabel)})</th>
      <th><i class="fas fa-clock"></i> Last Updated</th>
    `;
  }

  if (!allData || allData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">No data available</td></tr>';
    if (pageInfo) pageInfo.textContent = 'No data loaded';
    if (paginationInfo) paginationInfo.innerHTML = 'Showing <strong>0</strong> of <strong>0</strong> items';
    updatePaginationButtons();
    updateSortIndicators();
    return;
  }

  tbody.innerHTML = allData.map(row => `
    <tr>
      <td>${escapeHtml(row.sku || '')}</td>
      <td>${escapeHtml(row.name || '')}</td>
      <td><strong>${row.uk_qty || 0}</strong></td>
      <td><strong>${row.fr_qty || 0}</strong></td>
      <td><strong>${row.total_qty || 0}</strong></td>
      <td>${formatDateTime(row.last_updated)}</td>
    </tr>
  `).join('');

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startItem = currentPage * pageSize + 1;
  const endItem = Math.min((currentPage + 1) * pageSize, totalRecords);

  if (paginationInfo) {
    paginationInfo.innerHTML = `Showing <strong>${startItem}-${endItem}</strong> of <strong>${totalRecords}</strong> items`;
  }
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages}`;
  }

  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) exportPdfBtn.style.display = '';
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.style.display = '';

  updateFullDataFilterUI();
  updatePaginationButtons();
  updateSortIndicators();
}

// ===== UTILITY FUNCTIONS =====

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getCurrencySymbol(currencyCode) {
  const symbols = {
    'GBP': '£', 'EUR': '€', 'USD': '$', 'CAD': 'C$', 'AUD': 'A$',
    'JPY': '¥', 'CNY': '¥', 'CHF': 'Fr', 'SEK': 'kr', 'NOK': 'kr',
    'DKK': 'kr', 'PLN': 'zł', 'CZK': 'Kč', 'HUF': 'Ft'
  };
  return symbols[currencyCode?.toUpperCase()] || currencyCode || '';
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch { return dateStr; }
}

/**
 * Fetch all data for export (loops through pages in batches of 1000)
 */
async function fetchAllDataForExport() {
  const batchSize = 1000;
  let allExportData = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let result;
    if (viewMode === 'aggregated') {
      result = await getAllRegionsAggregatedMerged(batchSize, offset, currentSearch, currentSortColumn || '', currentSortDirection);
    } else if (viewMode === 'custom' && customRangeParams) {
      result = await getAllRegionsCustomRangeMerged(
        customRangeParams.rangeType,
        customRangeParams.rangeValue,
        customRangeParams.useExclusions,
        batchSize, offset, currentSearch,
        currentSortColumn || '', currentSortDirection,
        customRangeParams.shippingMethod || ''
      );
    } else if (viewMode === 'full') {
      result = await getAllRegionsData(batchSize, offset, currentSearch, currentSortColumn || '', currentSortDirection, fullDataFilters);
    } else {
      break;
    }

    if (result.status === 'success' && result.data && result.data.length > 0) {
      allExportData = allExportData.concat(result.data);
      offset += batchSize;
      if (result.data.length < batchSize) hasMore = false;
      if (allExportData.length >= MAX_EXPORT_ROWS) {
        showToast(`Export capped at ${MAX_EXPORT_ROWS.toLocaleString()} rows - narrow your filters for the rest`, 'warning');
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  return allExportData;
}

async function handleExportPDF() {
  if (viewMode !== 'aggregated' && viewMode !== 'custom') {
    showToast('PDF export is only available for aggregated views', 'warning');
    return;
  }

  if (!allData || allData.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  try {
    showToast('Fetching all data for export...', 'info');
    const exportData = await fetchAllDataForExport();
    if (!exportData || exportData.length === 0) {
      showToast('No data to export', 'warning');
      return;
    }

    showToast(`Generating PDF with ${exportData.length} items...`, 'info');
    const viewLabel = viewMode === 'custom' ? customRangeLabel : '6-Month';
    await exportToPDF(exportData, 'all', viewLabel, currentSearch);
    showToast('PDF exported successfully!', 'success');
  } catch (error) {
    console.error('Error exporting PDF:', error);
    showToast(`Failed to export PDF: ${error.message}`, 'error');
  }
}

async function handleExportCSV() {
  if (!allData || allData.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const originalBtnContent = exportCsvBtn ? exportCsvBtn.innerHTML : '';
  if (exportCsvBtn) {
    exportCsvBtn.disabled = true;
    exportCsvBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
  }

  try {
    showToast('Fetching all data for export...', 'info');
    const exportData = await fetchAllDataForExport();
    if (!exportData || exportData.length === 0) {
      showToast('No data to export', 'warning');
      return;
    }

    if (viewMode === 'full') {
      exportFullDataToCSV(exportData, 'all', filtersFilenameSlug(fullDataFilters), currentSearch);
    } else {
      const viewLabel = viewMode === 'custom' ? customRangeLabel : '6-Month';
      exportToCSV(exportData, 'all', viewLabel, currentSearch);
    }
    showToast(`CSV exported successfully (${exportData.length} items)!`, 'success');
  } catch (error) {
    console.error('Error exporting CSV:', error);
    showToast(`Failed to export CSV: ${error.message}`, 'error');
  } finally {
    if (exportCsvBtn) {
      exportCsvBtn.disabled = false;
      exportCsvBtn.innerHTML = originalBtnContent;
    }
  }
}

// ===== TABLE SORTING (Full data view only) =====

function setupTableSorting() {
  const table = document.getElementById('magentoTable');
  if (!table) return;

  table.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th || !th.closest('thead')) return;

    const columnIndex = Array.from(th.parentElement.children).indexOf(th);

    const columns = getColumnKeys();
    const columnKey = columns[columnIndex];

    if (!columnKey) return;

    if (currentSortColumn === columnKey) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortColumn = columnKey;
      currentSortDirection = 'asc';
    }

    sortAndRenderData();
  });

  updateSortIndicators();
}

function getColumnKeys() {
  if (viewMode === 'aggregated' || viewMode === 'custom') {
    return ['sku', 'name', 'uk_qty', 'fr_qty', 'total_qty', 'last_updated'];
  }
  return [
    'region', 'order_number', 'created_at', 'sku', 'name', 'qty',
    'original_price', 'special_price', 'status', 'currency', 'grand_total',
    'customer_email', 'customer_full_name', 'billing_address', 'shipping_address', 'shipping_method', 'customer_group_code'
  ];
}

async function sortAndRenderData() {
  currentPage = 0;
  showTableLoading();
  await loadDataForCurrentView();
  updateSortIndicators();
}

function updateSortIndicators() {
  const thead = document.querySelector('#magentoTable thead tr');
  if (!thead) return;

  const ths = thead.querySelectorAll('th');
  const columns = getColumnKeys();
  const columnIndex = columns.indexOf(currentSortColumn);

  ths.forEach((th, index) => {
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';

    const existingSortIcon = th.querySelector('.sort-indicator');
    if (existingSortIcon) existingSortIcon.remove();

    const sortIcon = document.createElement('i');
    sortIcon.style.marginLeft = '5px';
    sortIcon.style.fontSize = '0.8em';

    if (index === columnIndex && currentSortColumn) {
      sortIcon.className = `fas fa-sort-${currentSortDirection === 'asc' ? 'up' : 'down'} sort-indicator`;
      sortIcon.style.opacity = '1';
    } else {
      sortIcon.className = 'fas fa-sort sort-indicator';
      sortIcon.style.opacity = '0.5';
    }

    th.appendChild(sortIcon);
  });
}

export function destroy() {
  allData = [];
  customRangeParams = null;
}
