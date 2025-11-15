import { get, post, patch, http } from '../../services/api/http.js';
import { config } from '../../config.js';
import { showToast } from '../../ui/toast.js';

const API = config.API;

console.log('[Inventory Management] Using API:', API);
console.log('[Inventory Management] Window location:', window.location.href);

// Discontinued status filter preferences key (for checkboxes)
const DISCONTINUED_STATUS_FILTERS_KEY = 'inventory_discontinued_status_filters';

// Default discontinued status filters (all checked by default)
const DEFAULT_DISCONTINUED_STATUS_FILTERS = ['Active', 'Temporarily OOS', 'Pre Order', 'Samples'];

// Get saved discontinued status filters from localStorage
function getSavedDiscontinuedStatusFilters() {
  try {
    const saved = localStorage.getItem(DISCONTINUED_STATUS_FILTERS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('[Inventory] Error loading saved discontinued filters:', e);
  }
  return DEFAULT_DISCONTINUED_STATUS_FILTERS;
}

// Save discontinued status filters to localStorage
function saveDiscontinuedStatusFilters(filters) {
  try {
    localStorage.setItem(DISCONTINUED_STATUS_FILTERS_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error('[Inventory] Error saving discontinued filters:', e);
  }
}

// Test backend connectivity
async function testBackendConnectivity() {
  console.log('[Test] Testing backend connectivity...');
  console.log('[Test] Config API:', config.API);
  console.log('[Test] Window location:', window.location.origin);
  
  try {
    // Test with a simple fetch to check CORS - use the http service
    const testPath = `/api/health`;
    console.log('[Test] Testing path:', testPath);
    
    const data = await get(testPath);
    console.log('[Test] Backend is accessible:', data);
  } catch (error) {
    console.error('[Test] Backend connectivity test failed:', error);
  }
}

// Call test on module load
testBackendConnectivity();

let inventoryData = [];
let metadataIndex = new Map();
let magentoProductsIndex = new Map(); // NEW: Index for magento_product_list data
let dropdownDocListenersBound = false;
let dropdownBackdrop;
let _filterSeq = 0;

// Discontinued status filter set
let discontinuedFilterSet = new Set(DEFAULT_DISCONTINUED_STATUS_FILTERS);

// Pagination settings
const ITEMS_PER_PAGE = 100;
let currentPage = 0;
let totalFilteredItems = 0;
let totalItemsFromAPI = 0; // Total items from Zoho (not filtered)

// Fast search helpers
const rowEntryByEl = new WeakMap();

function tokenize(str) {
  return String(str).toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function buildTokens(row) {
  const sku = row.dataset.sku || '';
  const brand = (sku.match(/^[A-Za-z]+/) || [''])[0];
  const preferred = [
    row.dataset.product,
    row.dataset.sku,
    row.dataset.location,
    row.dataset.status,
    brand
  ].filter(Boolean).join(' ');

  const fullText = (row.textContent || '').trim();
  const blended = preferred + ' ' + fullText;

  const seen = new Set();
  const out = [];
  for (const t of tokenize(blended)) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function makeSearchFnFromTokens(tokens) {
  const normTokens = tokens.map(s => s.toLowerCase());
  return function match(query) {
    if (!query) return true;
    const qTokens = String(query)
      .split(/\s+/)
      .map(s => s.toLowerCase())
      .filter(Boolean);

    for (const qt of qTokens) {
      if (!normTokens.some(nt => nt.includes(qt))) {
        return false;
      }
    }
    return true;
  };
}

export async function init() {
  console.log('[Inventory Management] Initializing management module');
  
  try {
    await setupInventoryManagement();
  } catch (error) {
    console.error('[Inventory Management] Failed to initialize:', error);
    throw error;
  }
}

async function setupInventoryManagement() {
  const view = document.querySelector('#view');
  if (!view) return;

  console.log('[Inventory Management] Setting up interface');
  
  // Load initial data
  await loadInventoryData();
  
  setupDropdowns();
  setupTable();
  setupSearchAndFilters();
  setupZoomControls();
  bindGlobalHandlers();

  // Auto sync
    await initAutoSync();
}

async function loadInventoryData() {
  console.log('[Inventory Management] Loading paginated data from Zoho and PostgreSQL');
  
  try {
    // Try multiple possible API paths
    const possiblePaths = [
      { items: `/api/v1/inventory/management/items`, metadata: `/api/v1/inventory/management/metadata` },
      { items: `/api/inventory/management/items`, metadata: `/api/inventory/management/metadata` },
      { items: `/inventory/items`, metadata: `/inventory/metadata` },
      { items: `/api/inventory/items`, metadata: `/api/inventory/metadata` }
    ];
    
    let itemsData = null;
    let metadata = [];
    let workingPath = null;
    
    for (const pathSet of possiblePaths) {
      try {
        console.log(`[Inventory Management] Trying paths: ${pathSet.items}, ${pathSet.metadata}`);
        
        // Get search query
        const searchInput = document.getElementById('inventorySearch');
        const searchQuery = searchInput?.value?.trim() || '';
        
        // Get discontinued status filters
        const discontinuedFilters = Array.from(discontinuedFilterSet).join(',');
        
        // Build URL with search and discontinued status parameters
        let itemsUrl = `${pathSet.items}?page=${currentPage + 1}&per_page=${ITEMS_PER_PAGE}`;
        if (searchQuery) {
          itemsUrl += `&search=${encodeURIComponent(searchQuery)}`;
        }
        if (discontinuedFilters) {
          itemsUrl += `&discontinued_status=${encodeURIComponent(discontinuedFilters)}`;
        }
        
        // Fetch items with search and metadata
        const itemsResponse = await http(itemsUrl, { timeout: 120000 }); // 2 minutes for slow inventory fetch
        const metadataResponse = await get(pathSet.metadata);
        
        if (itemsResponse && metadataResponse) {
          itemsData = itemsResponse;
          metadata = metadataResponse;
          workingPath = pathSet;
          console.log(`[Inventory Management] Successfully connected using: ${pathSet.items}`);
          break;
        }
      } catch (err) {
        console.log(`[Inventory Management] Failed with ${pathSet.items}: ${err.message}`);
        continue;
      }
    }
    
    if (!workingPath) {
      throw new Error('No working API endpoints found');
    }
    
    // Load magento_product_list for discontinued status filtering
    try {
      const magentoProducts = await get(`/api/v1/inventory/management/magento-products`);
      magentoProductsIndex.clear();
      if (Array.isArray(magentoProducts)) {
        magentoProducts.forEach(product => {
          if (product.sku) {
            magentoProductsIndex.set(product.sku, product);
          }
        });
        console.log(`[Inventory Management] Loaded ${magentoProducts.length} magento products`);
      }
    } catch (err) {
      console.warn('[Inventory Management] Could not load magento products:', err);
    }
    
    // Handle paginated response
    if (itemsData && itemsData.items) {
      inventoryData = Array.isArray(itemsData.items) ? itemsData.items : [];
      totalItemsFromAPI = itemsData.total || inventoryData.length;
      console.log(`[Inventory Management] Loaded page ${itemsData.page} with ${inventoryData.length} items (total: ${totalItemsFromAPI}, total_pages: ${itemsData.total_pages})`);
      console.log(`[Inventory Management] API Response:`, itemsData);
    } else {
      // Fallback for old non-paginated API
      inventoryData = Array.isArray(itemsData) ? itemsData : [];
      totalItemsFromAPI = inventoryData.length;
      console.log(`[Inventory Management] Loaded ${inventoryData.length} items (non-paginated)`);
    }
    
    // Index metadata by SKU (primary key is now SKU)
    metadataIndex.clear();
    if (Array.isArray(metadata)) {
      metadata.forEach(meta => {
        const sku = meta.sku;
        if (sku) {
          metadataIndex.set(sku, meta);
        }
      });
    }
    
    console.log(`[Inventory Management] Indexed ${metadata.length} metadata records by SKU`);
    
  } catch (error) {
    console.error('[Inventory Management] Error loading data:', error);
    
    // Fallback: create some sample data for testing
    console.log('[Inventory Management] Using fallback sample data');
    inventoryData = [
      {
        item_id: "sample_001",
        product_name: "Sample Product 1",
        sku: "SKU001",
        stock_on_hand: 10,
        available_stock: 8
      },
      {
        item_id: "sample_002", 
        product_name: "Sample Product 2",
        sku: "SKU002",
        stock_on_hand: 25,
        available_stock: 20
      }
    ];
    
    totalItemsFromAPI = inventoryData.length;
    
    metadataIndex.clear();
    metadataIndex.set("sample_001", {
      item_id: "sample_001",
      location: "London",
      date: "2025-09-05",
      qty_ordered_jason: 0,
      uk_6m_data: "",
      shelf_lt1: "A1",
      shelf_lt1_qty: 5,
      shelf_gt1: "B1",
      shelf_gt1_qty: 3,
      top_floor_expiry: "2025-12-31",
      top_floor_total: 2,
      status: "",
      uk_fr_preorder: "",
      fr_6m_data: ""
    });
  }
}

function setupDropdowns() {
  // Column visibility dropdown
  bindDropdown('columnDropdown', 'columnToggle', [
    { value: 'col-1', text: 'Location', checked: true },
    { value: 'col-2', text: 'Date', checked: true },
    { value: 'col-3', text: 'Qty Ordered - Jason', checked: true },
    { value: 'col-4', text: 'Product Name', checked: true },
    { value: 'col-5', text: 'SKU', checked: true },
    { value: 'col-6', text: 'UK 6M Data', checked: true },
    { value: 'col-7', text: 'Shelf < 1', checked: true },
    { value: 'col-8', text: 'Shelf < 1 Year Qty', checked: true },
    { value: 'col-9', text: 'Shelf > 1', checked: true },
    { value: 'col-10', text: 'Shelf > 1 Year Qty', checked: true },
    { value: 'col-11', text: 'Shelf Total', checked: true },
    { value: 'col-12', text: 'Top Floor Expiry Date', checked: true },
    { value: 'col-13', text: 'Top Floor Total', checked: true },
    { value: 'col-14', text: 'Total Stock', checked: true },
    { value: 'col-15', text: 'Status', checked: true },
    { value: 'col-16', text: 'UK + FR Pre Order', checked: true },
    { value: 'col-17', text: 'FR 6M Data', checked: true }
  ], true); // true = this is a column dropdown

  // Stock status dropdown - for overstock/low stock indicators (based on metadata.status field)
  bindDropdown('statusDropdown', 'statusToggle', [
    { value: '', text: 'All Stock Status' },
    { value: 'overstock', text: 'Overstock' },
    { value: 'lowstock', text: 'Low Stock' }
  ]);
  
  // Set initial selected value for status dropdown (default: empty string for "All")
  const statusContainer = document.getElementById('statusDropdown');
  if (statusContainer) {
    statusContainer.dataset.selectedValue = '';
  }
}

function bindDropdown(containerId, toggleId, options, isColumnDropdown = false) {
  const container = document.getElementById(containerId);
  const toggle = document.getElementById(toggleId);
  
  if (!container || !toggle) return;
  
  // Prevent duplicate binding
  if (container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = container.getAttribute('aria-expanded') === 'true';
    closeAllDropdowns();
    if (!isOpen) {
      container.setAttribute('aria-expanded', 'true');
      container.classList.add('open');
      const list = container.querySelector('.c-select__list');
      if (list) list.setAttribute('aria-hidden', 'false');
      getBackdrop().classList.add('show');
    }
  });

  let dropdownContent = container.querySelector('.c-select__list');
  if (!dropdownContent) {
    dropdownContent = document.createElement('div');
    dropdownContent.className = 'c-select__list';
    dropdownContent.setAttribute('role', 'listbox');
    dropdownContent.setAttribute('aria-hidden', 'true');
    container.appendChild(dropdownContent);
  }

  // Populate options
  if (isColumnDropdown) {
    // Column visibility dropdown with checkboxes
    dropdownContent.innerHTML = options.map(opt => 
      `<label class="c-select__item checkbox-item" data-value="${opt.value}" role="option">
        <input type="checkbox" ${opt.checked ? 'checked' : ''} data-column="${opt.value}">
        <span>${opt.text}</span>
      </label>`
    ).join('');

    // Handle column visibility changes
    dropdownContent.addEventListener('change', e => {
      if (e.target.type === 'checkbox') {
        const column = e.target.dataset.column;
        const isVisible = e.target.checked;
        toggleColumn(column, isVisible);
      }
    });
  } else {
    // Regular dropdown (for stock status filter)
    dropdownContent.innerHTML = options.map(opt => 
      `<div class="c-select__item" data-value="${opt.value}" role="option">${opt.text}</div>`
    ).join('');

    // Handle regular dropdown selection
    dropdownContent.addEventListener('click', e => {
      if (e.target.classList.contains('c-select__item')) {
        const value = e.target.dataset.value;
        const text = e.target.textContent;
        
        // Store the selected value in the container's data attribute
        container.dataset.selectedValue = value;
        
        const labelSpan = toggle.querySelector('.c-select__label');
        if (labelSpan) {
          const icon = labelSpan.querySelector('i');
          const iconHTML = icon ? icon.outerHTML : '';
          labelSpan.innerHTML = `${iconHTML} ${text}`;
        }
        closeAllDropdowns();
        
        // Trigger stock status filter change
        onStockStatusFilterChange();
      }
    });
  }
}

function toggleColumn(columnClass, isVisible) {
  const tableWrapper = document.getElementById('inventoryManagementTableWrapper');
  if (!tableWrapper) return;
  
  const className = `hide-${columnClass}`;
  
  if (isVisible) {
    tableWrapper.classList.remove(className);
  } else {
    tableWrapper.classList.add(className);
  }
}

function setupTable() {
  const tableBody = document.getElementById('inventoryManagementBody');
  if (!tableBody) {
    console.error('[Inventory Management] Table body not found');
    return;
  }

  // Clear existing content
  tableBody.innerHTML = '';

  // Get selected discontinued status filters (checkboxes) and update global set
  const selectedDiscontinuedFilters = getSavedDiscontinuedStatusFilters();
  discontinuedFilterSet = new Set(selectedDiscontinuedFilters);
  
  // Get stock status filter (dropdown)
  const statusToggle = document.getElementById('statusToggle');
  const stockStatusFilter = getSelectedValue(statusToggle);
  
  // Get search query
  const searchInput = document.getElementById('inventorySearch');
  const searchQuery = searchInput?.value?.toLowerCase().trim() || '';
  
  console.log('[Inventory Management] Active discontinued status filters:', Array.from(discontinuedFilterSet));
  console.log('[Inventory Management] Active stock status filter:', stockStatusFilter);
  console.log('[Inventory Management] Search query:', searchQuery);
  console.log('[Inventory Management] Current page inventory items:', inventoryData.length);
  console.log('[Inventory Management] Magento products indexed:', magentoProductsIndex.size);
  
  let filteredItems = [];
  let skippedCount = 0;
  let noMagentoDataCount = 0;

  // Filter items based on discontinued status, stock status, and search
  inventoryData.forEach(item => {
    const sku = item.sku;
    const metadata = metadataIndex.get(sku) || {};
    
    // Merge sales data from item.custom_fields into metadata
    if (item.custom_fields) {
      if (item.custom_fields.uk_6m_data !== undefined) {
        metadata.uk_6m_data = item.custom_fields.uk_6m_data;
      }
      if (item.custom_fields.fr_6m_data !== undefined) {
        metadata.fr_6m_data = item.custom_fields.fr_6m_data;
      }
      // Ensure stock quantities are available for status calculation
      if (item.custom_fields.shelf_lt1_qty !== undefined) {
        metadata.shelf_lt1_qty = item.custom_fields.shelf_lt1_qty;
      }
      if (item.custom_fields.shelf_gt1_qty !== undefined) {
        metadata.shelf_gt1_qty = item.custom_fields.shelf_gt1_qty;
      }
      if (item.custom_fields.top_floor_total !== undefined) {
        metadata.top_floor_total = item.custom_fields.top_floor_total;
      }
    }
    
    // Note: Discontinued status filtering is now done on the backend
    // Items returned from API are already filtered by discontinued_status parameter
    
    // Apply stock status filter (from metadata.status field)
    if (stockStatusFilter && !matchesStockStatus(metadata, stockStatusFilter)) {
      skippedCount++;
      return;
    }
    
    // Apply search filter (note: search is also done backend, but we keep this for consistency)
    if (searchQuery && !matchesSearch(item, metadata, searchQuery)) {
      skippedCount++;
      return;
    }
    
    // Product passes all filters - add to filtered list
    filteredItems.push({ item, metadata });
  });

  // For now, use the filtered items count as total (server-side filtering would be better)
  // In a full implementation, we'd send filter params to API and get total_filtered from server
  totalFilteredItems = totalItemsFromAPI;

  console.log(`[Inventory Management] Filter results:`);
  console.log(`  - Total items in API: ${totalItemsFromAPI}`);
  console.log(`  - Displaying on this page: ${filteredItems.length} items`);
  console.log(`  - Current page: ${currentPage + 1}`);
  console.log(`  - Filtered out on this page: ${skippedCount} rows`);
  console.log(`  - No magento data: ${noMagentoDataCount} rows`);

  // Populate table with filtered items from current page
  filteredItems.forEach(({ item, metadata }) => {
    const row = createTableRow(item, metadata);
    tableBody.appendChild(row);
  });
  
  // Show message if no items match filters
  if (filteredItems.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="16">
          <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <h3>No Products Found</h3>
            <p>No products match the selected filters on this page.</p>
            <small style="display: block; margin-top: 0.5rem; color: #7f8c8d;">
              Discontinued status filters: ${Array.from(discontinuedFilterSet).join(', ')}<br>
              Stock status filter: ${stockStatusFilter || 'All'}<br>
              Try adjusting your filters or navigating to a different page.
            </small>
          </div>
        </td>
      </tr>
    `;
  }

  // Update pagination controls
  updatePaginationControls();
}

function calculateStockStatus(metadata) {
  // Calculate demand: UK 6M Data + FR 6M Data (FR already includes NL)
  const ukData = parseInt(metadata.uk_6m_data) || 0;
  const frData = parseInt(metadata.fr_6m_data) || 0;
  const demand = ukData + frData;
  
  // Calculate total stock
  const shelfTotal = (parseInt(metadata.shelf_lt1_qty) || 0) + (parseInt(metadata.shelf_gt1_qty) || 0);
  const totalStock = shelfTotal + (parseInt(metadata.top_floor_total) || 0);
  
  // Determine status based on demand vs stock
  if (demand === 0) {
    // No demand data - can't determine status
    return '';
  }
  
  if (totalStock >= demand * 3) {
    return 'overstock';
  } else if (totalStock < demand) {
    return 'lowstock';
  } else {
    return 'normal';
  }
}

function matchesStockStatus(metadata, stockStatusFilter) {
  // Stock status filter based on calculated demand vs stock
  const calculatedStatus = calculateStockStatus(metadata);
  
  if (!stockStatusFilter) {
    return true; // No filter applied
  }
  
  return calculatedStatus === stockStatusFilter;
}

function matchesSearch(item, metadata, searchQuery) {
  // Build searchable text from item and metadata
  const searchableText = [
    item.product_name,
    item.sku,
    metadata.location,
    metadata.status,
    metadata.shelf_lt1,
    metadata.shelf_gt1
  ].filter(Boolean).join(' ').toLowerCase();
  
  // Split search query into tokens and check if all are present
  const tokens = searchQuery.split(/\s+/).filter(Boolean);
  return tokens.every(token => searchableText.includes(token));
}

function updatePaginationControls() {
  // Update the new pagination section
  const paginationSection = document.getElementById('paginationSection');
  const paginationInfo = document.getElementById('paginationInfo');
  const pageIndicator = document.getElementById('pageIndicator');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (!paginationSection) return;
  
  const totalPages = Math.ceil(totalFilteredItems / ITEMS_PER_PAGE);
  const startItem = totalFilteredItems > 0 ? (currentPage * ITEMS_PER_PAGE) + 1 : 0;
  const endItem = Math.min((currentPage + 1) * ITEMS_PER_PAGE, totalFilteredItems);
  
  console.log(`[Pagination] totalFilteredItems: ${totalFilteredItems}, totalPages: ${totalPages}, currentPage: ${currentPage}`);
  
  // Show pagination section if there are items
  if (totalFilteredItems > 0) {
    paginationSection.style.display = 'flex';
  } else {
    paginationSection.style.display = 'none';
    return;
  }
  
  // Update pagination info
  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${startItem}-${endItem} of ${totalFilteredItems} items`;
  }
  
  // Update page indicator
  if (pageIndicator) {
    pageIndicator.textContent = `Page ${currentPage + 1} of ${totalPages || 1}`;
  }
  
  // Update button states
  if (prevBtn) {
    prevBtn.disabled = currentPage === 0;
  }
  
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages - 1 || totalFilteredItems === 0;
    console.log(`[Pagination] Next button disabled: ${nextBtn.disabled}, condition: currentPage (${currentPage}) >= totalPages - 1 (${totalPages - 1})`);
  }
}

function createTableRow(item, metadata) {
  function formatTextForDisplay(text) {
    return text ? String(text).replace(/\n/g, '<br>') : '';
  }

  const row = document.createElement('tr');
  row.dataset.itemId = item.item_id;
  row.dataset.product = item.product_name || '';
  row.dataset.sku = item.sku || '';
  row.dataset.location = metadata.location || '';
  row.dataset.status = metadata.status || '';

  const shelfTotal = (metadata.shelf_lt1_qty || 0) + (metadata.shelf_gt1_qty || 0);
  const totalStock = shelfTotal + (metadata.top_floor_total || 0);

  // Get discontinued status from magento products
  const magentoProduct = magentoProductsIndex.get(item.sku);
  const discontinuedStatus = magentoProduct?.discontinued_status || '';
  
  // Calculate stock status based on demand
  const stockStatus = calculateStockStatus(metadata);
  const stockStatusDisplay = stockStatus === 'overstock' ? 'Over Stock' : 
                            stockStatus === 'lowstock' ? 'Low Stock' : 
                            stockStatus === 'normal' ? 'Normal Stock' : '';
  const stockStatusClass = stockStatus ? `stock-status-${stockStatus}` : '';

  row.innerHTML = `
    <td contenteditable="true">${formatTextForDisplay(metadata.location)}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.date)}</td>
    <td contenteditable="true">${metadata.qty_ordered_jason || 0}</td>
    <td class="wrap">${item.product_name || ''}</td>
    <td class="wrap">${item.sku || ''}</td>
    <td class="readonly-field" title="Populated from table">${metadata.uk_6m_data || ''}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.shelf_lt1)}</td>
    <td contenteditable="true">${metadata.shelf_lt1_qty || 0}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.shelf_gt1)}</td>
    <td contenteditable="true">${metadata.shelf_gt1_qty || 0}</td>
    <td>${shelfTotal}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.top_floor_expiry)}</td>
    <td contenteditable="true">${metadata.top_floor_total || 0}</td>
    <td>${totalStock}</td>
    <td contenteditable="false" class="readonly-field ${stockStatusClass}" title="Calculated: Demand (UK+FR 6M) vs Total Stock">${stockStatusDisplay}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.uk_fr_preorder)}</td>
    <td class="readonly-field" title="Populated from table (FR + NL merged)">${metadata.fr_6m_data || ''}</td>
    <td class="readonly-field">${discontinuedStatus}</td>
  `;

  // Add save functionality to editable cells
  const editableCells = row.querySelectorAll('td[contenteditable="true"]');
  editableCells.forEach(cell => {
    cell.addEventListener('blur', async () => {
      updateRowCalculations(row);
      await saveRowData(row);
    });
    
    cell.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Allow Shift+Enter for line breaks - don't prevent default
          return;
        } else {
          // Regular Enter commits the change
          e.preventDefault();
          cell.blur(); // This will trigger the blur event which calls saveRowData
        }
      }
    });
  });

  // Build search tokens for fast filtering
  const tokens = buildTokens(row);
  const search = makeSearchFnFromTokens(tokens);
  rowEntryByEl.set(row, { search, status: row.dataset.status });

  return row;
}

function updateRowCalculations(row) {
  const cells = row.children;
  if (cells.length < 17) return;

  const shelf_lt1_qty = Number(cells[7].textContent.trim()) || 0;
  const shelf_gt1_qty = Number(cells[9].textContent.trim()) || 0;
  const top_floor_total = Number(cells[12].textContent.trim()) || 0;

  // Calculate totals
  const shelfTotal = shelf_lt1_qty + shelf_gt1_qty;
  const totalStock = shelfTotal + top_floor_total;

  cells[10].textContent = shelfTotal; // Shelf Total
  cells[13].textContent = totalStock; // Total Stock
  
  // Recalculate stock status
  const uk_6m_data = Number(cells[5].textContent.trim()) || 0;
  const fr_6m_data = Number(cells[16].textContent.trim()) || 0;
  const demand = uk_6m_data + fr_6m_data;
  
  let stockStatus = '';
  let stockStatusDisplay = '';
  
  if (demand > 0) {
    if (totalStock >= demand * 3) {
      stockStatus = 'overstock';
      stockStatusDisplay = 'Over Stock';
    } else if (totalStock < demand) {
      stockStatus = 'lowstock';
      stockStatusDisplay = 'Low Stock';
    } else {
      stockStatus = 'normal';
      stockStatusDisplay = 'Normal Stock';
    }
  }
  
  // Update stock status cell (column 14)
  cells[14].textContent = stockStatusDisplay;
  cells[14].className = stockStatus ? `readonly-field stock-status-${stockStatus}` : 'readonly-field';
}

async function saveRowData(row) {
  const cells = row.children;
  if (cells.length < 17) return;

  const sku = row.dataset.sku;
  if (!sku) {
    console.error('[Inventory Management] Cannot save - no SKU found');
    return;
  }

  function getTextWithLineBreaks(cell) {
    // Convert <br> tags to \n and get text content
    const clone = cell.cloneNode(true);
    const brTags = clone.querySelectorAll('br');
    brTags.forEach(br => {
      br.replaceWith('\n');
    });
    return clone.textContent.trim();
  }

  const updated = {
    sku: sku,
    location: getTextWithLineBreaks(cells[0]),
    date: getTextWithLineBreaks(cells[1]) || null,
    qty_ordered_jason: Number(cells[2].textContent.trim()) || 0,
    // uk_6m_data: excluded - populated from table
    shelf_lt1: getTextWithLineBreaks(cells[6]),
    shelf_lt1_qty: Number(cells[7].textContent.trim()) || 0,
    shelf_gt1: getTextWithLineBreaks(cells[8]),
    shelf_gt1_qty: Number(cells[9].textContent.trim()) || 0,
    top_floor_expiry: getTextWithLineBreaks(cells[11]) || null,
    top_floor_total: Number(cells[12].textContent.trim()) || 0,
    status: getTextWithLineBreaks(cells[14]),
    uk_fr_preorder: getTextWithLineBreaks(cells[15]),
    // fr_6m_data: excluded - populated from table
  };

  try {
    // Use PATCH for updating existing metadata (now using SKU)
    const patchPath = `/api/v1/inventory/management/metadata/${encodeURIComponent(sku)}`;
    
    console.log(`[Inventory Management] Updating SKU ${sku} with:`, updated);
    
    // Use PATCH for updating existing metadata
    await patch(patchPath, updated);
    
    console.log(`[Inventory Management] Successfully updated via PATCH: ${patchPath}`);
    
    metadataIndex.set(sku, updated);
    
    console.log('[Inventory Management] Successfully updated:', sku);
    
  } catch (err) {
    console.error('[Inventory Management] Update failed:', err);
    
    alert(`Failed to save changes: ${err.message}`);
  }
}

function determineStatus(item, metadata) {
  const stock = item.stock_on_hand || 0;
  if (stock === 0) return 'out_of_stock';
  if (stock < 10) return 'low_stock'; // Arbitrary threshold
  return 'active';
}

function setupSearchAndFilters() {
  const searchInput = document.getElementById('inventorySearch');
  if (searchInput) {
    // Clear any existing listeners
    searchInput.removeEventListener('input', searchHandler);
    
    // Add debounced search
    searchInput.addEventListener('input', searchHandler);
  }
  
  // Setup discontinued status filter checkboxes
  setupDiscontinuedStatusFilters();
}

function setupDiscontinuedStatusFilters() {
  // Load saved filters and set checkbox states
  const savedFilters = getSavedDiscontinuedStatusFilters();
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = savedFilters.includes(checkbox.value);
    // Add listener to update count on change
    checkbox.addEventListener('change', updateFilterCount);
  });
  
  // Initialize filter count
  updateFilterCount();
  
  // Apply filters button
  const applyBtn = document.getElementById('applyStatusFilters');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const selectedFilters = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      
      console.log('[Inventory] Applying discontinued status filters:', selectedFilters);
      
      // Immediate visual feedback - show loading state
      const originalText = applyBtn.textContent;
      applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
      applyBtn.disabled = true;
      applyBtn.style.opacity = '0.7';
      applyBtn.style.cursor = 'wait';
      
      try {
        // Save preferences
        saveDiscontinuedStatusFilters(selectedFilters);
        
        // Update the global filter set BEFORE loading data
        discontinuedFilterSet = new Set(selectedFilters);
        
        // Reset to first page when filters change
        currentPage = 0;
        
        // Reload data from API with new filters and re-render table
        await loadInventoryData();
        setupTable();
        
        // Count visible rows
        const visibleRows = document.querySelectorAll('#inventoryManagementBody tr:not([style*="display: none"])').length;
        console.log(`[Inventory] Now showing ${visibleRows} products after applying filters`);
        
        // Show success toast
        showToast(`Filters applied! Showing ${visibleRows} products`, 'success');
        
        // Reset button state
        applyBtn.textContent = originalText;
        applyBtn.style.background = '';
        applyBtn.disabled = false;
        applyBtn.style.opacity = '1';
        applyBtn.style.cursor = 'pointer';
      } catch (error) {
        console.error('[Inventory] Error applying filters:', error);
        
        // Show error toast
        showToast('Error applying filters: ' + error.message, 'error');
        
        // Reset button state
        applyBtn.textContent = originalText;
        applyBtn.style.background = '';
        applyBtn.disabled = false;
        applyBtn.style.opacity = '1';
        applyBtn.style.cursor = 'pointer';
      }
    });
  }
}

// Update filter count display
function updateFilterCount() {
  const checkboxes = document.querySelectorAll('.status-filter-checkbox');
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  const countElement = document.getElementById('activeFiltersCount');
  if (countElement) {
    countElement.textContent = checkedCount;
  }
}

const searchHandler = debounce(async () => {
  // Reset to first page when search changes
  currentPage = 0;
  await loadInventoryData();
  setupTable();
}, 300);

// Stock status dropdown change handler
async function onStockStatusFilterChange() {
  currentPage = 0;
  await loadInventoryData();
  setupTable();
}

function applyFilters() {
  // Deprecated - search is now handled by rebuilding the table
  // This function is kept for compatibility but does nothing
  console.log('[Inventory Management] applyFilters called (deprecated)');
}

function getSelectedValue(toggle) {
  if (!toggle) return '';
  
  // For c-select dropdowns, get the value from the container's data attribute
  const container = toggle.closest('.c-select');
  if (container && container.dataset.selectedValue !== undefined) {
    return container.dataset.selectedValue;
  }
  
  // Fallback for legacy dropdowns (if any)
  const text = toggle.textContent;
  const match = text.match(/^(.+?)\s*▼?$/);
  const value = match ? match[1].trim() : text.trim();
  
  const valueMap = {
    'All Stock Status': '',
    'Over Stock': 'overstock',
    'Low Stock': 'lowstock',
    'Normal Stock': 'normal'
  };
  
  return valueMap[value] || '';
}

// Zoom control functionality
const ZOOM_STORAGE_KEY = 'inventory_table_zoom';
const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

function setupZoomControls() {
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const zoomIndicator = document.getElementById('zoomIndicator');
  const tableScroller = document.getElementById('inventoryManagementTableScroller');
  
  if (!zoomInBtn || !zoomOutBtn || !zoomResetBtn || !zoomIndicator || !tableScroller) {
    console.warn('[Inventory] Zoom controls not found');
    return;
  }
  
  // Load saved zoom or use default
  let currentZoom = getSavedZoom();
  applyZoom(currentZoom);
  
  // Zoom in
  zoomInBtn.addEventListener('click', () => {
    if (currentZoom < MAX_ZOOM) {
      currentZoom = Math.min(currentZoom + ZOOM_STEP, MAX_ZOOM);
      applyZoom(currentZoom);
      saveZoom(currentZoom);
    }
  });
  
  // Zoom out
  zoomOutBtn.addEventListener('click', () => {
    if (currentZoom > MIN_ZOOM) {
      currentZoom = Math.max(currentZoom - ZOOM_STEP, MIN_ZOOM);
      applyZoom(currentZoom);
      saveZoom(currentZoom);
    }
  });
  
  // Reset zoom
  zoomResetBtn.addEventListener('click', () => {
    currentZoom = DEFAULT_ZOOM;
    applyZoom(currentZoom);
    saveZoom(currentZoom);
  });
  
  function applyZoom(zoom) {
    const table = document.getElementById('inventoryManagementTable');
    if (table) {
      // Use font-size scaling instead of transform scale
      // This actually makes content smaller/larger and lets you see more/less
      const baseFontSize = 0.9; // Base rem value from CSS
      const scaledFontSize = baseFontSize * (zoom / 100);
      table.style.fontSize = `${scaledFontSize}rem`;
      
      // Scale headers too, but keep them proportionally larger (80% of zoom vs 100%)
      // This ensures headers shrink enough to fit but remain more readable
      const headers = table.querySelectorAll('th');
      const baseHeaderFontSize = 0.8; // Base rem from CSS
      const headerZoomFactor = 0.7 + (zoom / 100) * 0.3; // 70% base + 30% of zoom (so at 50% zoom, headers are 85% size)
      const scaledHeaderFontSize = baseHeaderFontSize * (zoom / 100) * 1.15; // Keep headers 15% larger than body
      headers.forEach(header => {
        header.style.fontSize = `${scaledHeaderFontSize}rem`;
        header.style.padding = `${0.875 * (zoom / 100)}rem 1rem`;
      });
      
      // Scale body cell padding proportionally for better fit
      const cells = table.querySelectorAll('td');
      const basePadding = 1; // Base rem value
      const scaledPadding = basePadding * (zoom / 100);
      cells.forEach(cell => {
        cell.style.padding = `${scaledPadding}rem`;
      });
      
      // Reset any transform that might have been applied
      table.style.transform = '';
      table.style.transformOrigin = '';
      
      // Reset wrapper width
      const tableWrapper = table.closest('.table-wrapper');
      if (tableWrapper) {
        tableWrapper.style.width = '';
      }
    }
    
    // Update indicator
    if (zoomIndicator) {
      zoomIndicator.textContent = `${zoom}%`;
    }
    
    // Update button states
    zoomInBtn.disabled = zoom >= MAX_ZOOM;
    zoomOutBtn.disabled = zoom <= MIN_ZOOM;
  }
  
  function saveZoom(zoom) {
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, zoom.toString());
    } catch (e) {
      console.error('[Inventory] Failed to save zoom:', e);
    }
  }
  
  function getSavedZoom() {
    try {
      const saved = localStorage.getItem(ZOOM_STORAGE_KEY);
      if (saved) {
        const zoom = parseInt(saved, 10);
        if (!isNaN(zoom) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM) {
          return zoom;
        }
      }
    } catch (e) {
      console.error('[Inventory] Failed to load saved zoom:', e);
    }
    return DEFAULT_ZOOM;
  }
}

function bindGlobalHandlers() {
  // Global save function for update buttons
  window.saveRow = async function(button) {
    const row = button.closest('tr');
    if (!row) return;

    try {
      await handleUpdate(row);
      button.textContent = '✓ Saved';
      button.style.backgroundColor = 'green';
      setTimeout(() => {
        button.textContent = 'Update';
        button.style.backgroundColor = '';
      }, 2000);
    } catch (error) {
      console.error('[Inventory Management] Update error:', error);
      button.textContent = '✗ Error';
      button.style.backgroundColor = 'red';
      setTimeout(() => {
        button.textContent = 'Update';
        button.style.backgroundColor = '';
      }, 2000);
    }
  };

  // Bind pagination buttons
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', async () => {
      if (currentPage > 0) {
        currentPage--;
        await loadInventoryData();
        setupTable();
        // Scroll to top of table
        document.getElementById('inventoryManagementTableScroller')?.scrollTo(0, 0);
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      const totalPages = Math.ceil(totalFilteredItems / ITEMS_PER_PAGE);
      if (currentPage < totalPages - 1) {
        currentPage++;
        await loadInventoryData();
        setupTable();
        // Scroll to top of table
        document.getElementById('inventoryManagementTableScroller')?.scrollTo(0, 0);
      }
    });
  }

  // Bind document click for dropdown closing
  if (!dropdownDocListenersBound) {
    document.addEventListener('click', () => {
      closeAllDropdowns();
    });
    dropdownDocListenersBound = true;
  }
}

async function handleUpdate(row) {
  const cells = row.children;
  if (cells.length < 16) return;

  const sku = row.dataset.sku;
  if (!sku) {
    console.error('[Inventory Management] Cannot update - no SKU found');
    return;
  }

  const updated = {
    sku: sku,
    location: cells[0].textContent.trim(),
    date: cells[1].textContent.trim() || null,
    // uk_6m_data: excluded - populated from table
    shelf_lt1: cells[5].textContent.trim(),
    shelf_lt1_qty: Number(cells[6].textContent.trim()) || 0,
    shelf_gt1: cells[7].textContent.trim(),
    shelf_gt1_qty: Number(cells[8].textContent.trim()) || 0,
    top_floor_expiry: cells[10].textContent.trim() || null,
    top_floor_total: Number(cells[11].textContent.trim()) || 0,
    status: cells[13].textContent.trim(),
    uk_fr_preorder: cells[14].textContent.trim(),
    // fr_6m_data: excluded - populated from table
  };

  const newShelfTotal = updated.shelf_lt1_qty + updated.shelf_gt1_qty;
  const newTotalStock = newShelfTotal + updated.top_floor_total;
  cells[9].textContent = newShelfTotal;
  cells[12].textContent = newTotalStock;

  try {
    await post(`/api/v1/inventory/management/metadata`, updated);
    
    metadataIndex.set(sku, updated);
    
    console.log('[Inventory Management] Successfully updated:', sku);
    
  } catch (err) {
    console.error('[Inventory Management] Update failed:', err);
    throw err;
  }
}

function debounce(fn, delay = 250) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

function getBackdrop() {
  if (!dropdownBackdrop) {
    dropdownBackdrop = document.getElementById('globalDropdownBackdrop');
    if (!dropdownBackdrop) {
      dropdownBackdrop = document.createElement('div');
      dropdownBackdrop.id = 'globalDropdownBackdrop';
      dropdownBackdrop.className = 'dropdown-backdrop';
      document.body.appendChild(dropdownBackdrop);
    }
  }
  return dropdownBackdrop;
}

function closeAllDropdowns() {
  // Close c-select dropdowns
  document.querySelectorAll('.c-select[aria-expanded="true"]').forEach(el => {
    el.setAttribute('aria-expanded', 'false');
    el.classList.remove('open');
  });
  document.querySelectorAll('.c-select__list[aria-hidden="false"]').forEach(el => {
    el.setAttribute('aria-hidden', 'true');
  });
  
  // Legacy support - close old dropdown-container style (if any remain)
  document.querySelectorAll('.dropdown-container.open').forEach(el => {
    el.classList.remove('open');
  });
  document.querySelectorAll('.dropdown-toggle.open').forEach(el => {
    el.classList.remove('open');
  });
  document.querySelectorAll('.dropdown-content.show').forEach(el => {
    el.classList.remove('show');
  });
  
  getBackdrop().classList.remove('show');
}

// State management
let isSyncing = false;

/**
* Unified sales sync function
*/
async function syncSalesData(showNotification = true) {
  if (isSyncing) return;
  const btn = document.getElementById('syncSalesBtn');
  try {
    isSyncing = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    const res = await post('/api/v1/inventory/management/sync-sales-data', {
      dry_run: false
    });
    if (res && res.status === 'success') {
      const updated = res.stats?.updated_records ?? 0;
      console.log(`[Sync] Success: ${updated} records updated`);
      if (showNotification) {
        showToast(`Sales data synced! ${updated} records updated`, 'success');
      }

      // Refresh table if available
      if (typeof loadInventoryData === 'function') {
        await loadInventoryData();
        setupTable(); // Rebuild table with updated data
      }
      
      localStorage.setItem('lastSalesSync', new Date().toISOString());
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
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync-alt"></i> Sync Sales Data';
    }
  }
}

/**
* Auto-sync on page load (but avoid repeat syncs via cooldown)
*/
async function initAutoSync() {
  const lastSync = localStorage.getItem('lastSalesSync');
  if (lastSync) {
    const diffMins = (new Date() - new Date(lastSync)) / 60000;
    if (diffMins < 5) {
      console.log('[Sync] Skipping sync (recently synced)');
      return;
    }
  }

  console.log('[Sync] Running auto-sync...');
  await syncSalesData(false); // false = don’t show alert
  localStorage.setItem('lastSalesSync', new Date().toISOString());
}

// Attach to button
document.getElementById('syncSalesBtn')?.addEventListener('click', () => syncSalesData(true));

export function cleanup() {
  console.log('[Inventory Management] Cleaning up');
  
  // Clear data
  inventoryData = [];
  metadataIndex.clear();
  magentoProductsIndex.clear();
  rowEntryByEl.clear();
  
  // Reset pagination
  currentPage = 0;
  totalFilteredItems = 0;
  
  // Hide pagination section
  const paginationSection = document.getElementById('paginationSection');
  if (paginationSection) {
    paginationSection.style.display = 'none';
  }
  
  // Remove global functions
  if (window.saveRow) {
    delete window.saveRow;
  }
}
