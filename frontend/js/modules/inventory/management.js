import { get, post, patch } from '../../services/api/http.js';
import { config } from '../../config.js';

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

// Pagination settings
const ITEMS_PER_PAGE = 100;
let currentPage = 0;
let totalFilteredItems = 0;

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
  
  // Load data
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
  console.log('[Inventory Management] Loading data from Zoho and PostgreSQL');
  
  try {
    // Try multiple possible API paths
    const possiblePaths = [
      { items: `/api/v1/inventory/management/items`, metadata: `/api/v1/inventory/management/metadata` },
      { items: `/api/inventory/management/items`, metadata: `/api/inventory/management/metadata` },
      { items: `/inventory/items`, metadata: `/inventory/metadata` },
      { items: `/api/inventory/items`, metadata: `/api/inventory/metadata` }
    ];
    
    let items = [];
    let metadata = [];
    let workingPath = null;
    
    for (const pathSet of possiblePaths) {
      try {
        console.log(`[Inventory Management] Trying paths: ${pathSet.items}, ${pathSet.metadata}`);
        
        const itemsResponse = await get(pathSet.items);
        const metadataResponse = await get(pathSet.metadata);
        
        if (itemsResponse && metadataResponse) {
          items = itemsResponse;
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
    
    inventoryData = Array.isArray(items) ? items : [];
    
    // Index metadata by item_id
    metadataIndex.clear();
    if (Array.isArray(metadata)) {
      metadata.forEach(meta => {
        metadataIndex.set(meta.item_id, meta);
      });
    }
    
    console.log(`[Inventory Management] Loaded ${inventoryData.length} items and ${metadata.length} metadata records`);
    
    // Setup table with filtered data
    setupTable();
    
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
    
    metadataIndex.clear();
    metadataIndex.set("sample_001", {
      item_id: "sample_001",
      location: "London",
      date: "2025-09-05",
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
    { value: 'col-3', text: 'Product Name', checked: true },
    { value: 'col-4', text: 'SKU', checked: true },
    { value: 'col-5', text: 'UK 6M Data', checked: true },
    { value: 'col-6', text: 'Shelf < 1', checked: true },
    { value: 'col-7', text: 'Shelf < 1 Year Qty', checked: true },
    { value: 'col-8', text: 'Shelf > 1', checked: true },
    { value: 'col-9', text: 'Shelf > 1 Year Qty', checked: true },
    { value: 'col-10', text: 'Shelf Total', checked: true },
    { value: 'col-11', text: 'Top Floor Expiry Date', checked: true },
    { value: 'col-12', text: 'Top Floor Total', checked: true },
    { value: 'col-13', text: 'Total Stock', checked: true },
    { value: 'col-14', text: 'Status', checked: true },
    { value: 'col-15', text: 'UK + FR Pre Order', checked: true },
    { value: 'col-16', text: 'FR 6M Data', checked: true }
  ], true); // true = this is a column dropdown

  // Stock status dropdown - for overstock/low stock indicators (based on metadata.status field)
  bindDropdown('statusDropdown', 'statusToggle', [
    { value: '', text: 'All Stock Status' },
    { value: 'overstock', text: 'Overstock' },
    { value: 'lowstock', text: 'Low Stock' }
  ]);
}

function bindDropdown(containerId, toggleId, options, isColumnDropdown = false) {
  const container = document.getElementById(containerId);
  const toggle = document.getElementById(toggleId);
  
  if (!container || !toggle) return;

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !container.classList.contains('open');
    closeAllDropdowns();
    if (willOpen) {
      container.classList.add('open');
      toggle.classList.add('open');
      const content = container.querySelector('.dropdown-content');
      if (content) content.classList.add('show');
      getBackdrop().classList.add('show');
    }
  });

  let dropdownContent = container.querySelector('.dropdown-content');
  if (!dropdownContent) {
    dropdownContent = document.createElement('div');
    dropdownContent.className = 'dropdown-content';
    container.appendChild(dropdownContent);
  }

  // Populate options
  if (isColumnDropdown) {
    // Column visibility dropdown with checkboxes
    dropdownContent.innerHTML = options.map(opt => 
      `<label class="dropdown-item checkbox-item" data-value="${opt.value}">
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
      `<button class="dropdown-item" data-value="${opt.value}">${opt.text}</button>`
    ).join('');

    // Handle regular dropdown selection
    dropdownContent.addEventListener('click', e => {
      if (e.target.classList.contains('dropdown-item')) {
        const value = e.target.dataset.value;
        const text = e.target.textContent;
        const icon = toggle.querySelector('i');
        const iconHTML = icon ? icon.outerHTML : '';
        toggle.innerHTML = `${iconHTML} ${text} <span class="arrow">▼</span>`;
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

  // Get selected discontinued status filters (checkboxes)
  const selectedDiscontinuedFilters = getSavedDiscontinuedStatusFilters();
  const discontinuedFilterSet = new Set(selectedDiscontinuedFilters);
  
  // Get stock status filter (dropdown)
  const statusToggle = document.getElementById('statusToggle');
  const stockStatusFilter = getSelectedValue(statusToggle);
  
  // Get search query
  const searchInput = document.getElementById('inventorySearch');
  const searchQuery = searchInput?.value?.toLowerCase().trim() || '';
  
  console.log('[Inventory Management] Active discontinued status filters:', Array.from(discontinuedFilterSet));
  console.log('[Inventory Management] Active stock status filter:', stockStatusFilter);
  console.log('[Inventory Management] Search query:', searchQuery);
  console.log('[Inventory Management] Total inventory items:', inventoryData.length);
  console.log('[Inventory Management] Magento products indexed:', magentoProductsIndex.size);
  
  let filteredItems = [];
  let skippedCount = 0;
  let noMagentoDataCount = 0;

  // Filter items based on discontinued status, stock status, and search
  inventoryData.forEach(item => {
    const metadata = metadataIndex.get(item.item_id) || {};
    const sku = item.sku;
    
    // Check if this product exists in magento_product_list
    if (!sku || !magentoProductsIndex.has(sku)) {
      // Product not in magento_product_list - default behavior: show it
      noMagentoDataCount++;
      
      // Apply stock status filter (from metadata.status field)
      if (stockStatusFilter && !matchesStockStatus(metadata, stockStatusFilter)) {
        skippedCount++;
        return;
      }
      
      // Apply search filter
      if (searchQuery && !matchesSearch(item, metadata, searchQuery)) {
        skippedCount++;
        return;
      }
      
      filteredItems.push({ item, metadata });
      return;
    }
    
    // Product exists in magento_product_list - check discontinued status
    const magentoProduct = magentoProductsIndex.get(sku);
    const discontinuedStatus = magentoProduct.discontinued_status;
    
    console.log(`[Filter Check] SKU: ${sku}, Discontinued Status: ${discontinuedStatus}, Stock Status: ${metadata.status}, Include: ${discontinuedFilterSet.has(discontinuedStatus)}`);
    
    // Filter: only show if discontinued_status is in selected filters
    if (!discontinuedStatus || !discontinuedFilterSet.has(discontinuedStatus)) {
      skippedCount++;
      return; // Skip this item
    }
    
    // Apply stock status filter (from metadata.status field)
    if (stockStatusFilter && !matchesStockStatus(metadata, stockStatusFilter)) {
      skippedCount++;
      return;
    }
    
    // Apply search filter
    if (searchQuery && !matchesSearch(item, metadata, searchQuery)) {
      skippedCount++;
      return;
    }
    
    // Product passes all filters - add to filtered list
    filteredItems.push({ item, metadata });
  });

  // Update total filtered items count
  totalFilteredItems = filteredItems.length;

  // Calculate pagination
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalFilteredItems);
  const paginatedItems = filteredItems.slice(startIndex, endIndex);

  console.log(`[Inventory Management] Filter results:`);
  console.log(`  - Total filtered: ${totalFilteredItems} items`);
  console.log(`  - Displaying: ${paginatedItems.length} items (page ${currentPage + 1})`);
  console.log(`  - Filtered out: ${skippedCount} rows`);
  console.log(`  - No magento data: ${noMagentoDataCount} rows`);

  // Populate table with paginated items
  paginatedItems.forEach(({ item, metadata }) => {
    const row = createTableRow(item, metadata);
    tableBody.appendChild(row);
  });
  
  // Show message if no items match filters
  if (totalFilteredItems === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="16">
          <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <h3>No Products Found</h3>
            <p>No products match the selected filters.</p>
            <small style="display: block; margin-top: 0.5rem; color: #7f8c8d;">
              Discontinued status filters: ${Array.from(discontinuedFilterSet).join(', ')}<br>
              Stock status filter: ${stockStatusFilter || 'All'}<br>
              Try adjusting your filters.
            </small>
          </div>
        </td>
      </tr>
    `;
  }

  // Update pagination controls
  updatePaginationControls();
}

function matchesStockStatus(metadata, stockStatusFilter) {
  // Stock status filter based on metadata.status field
  // This is for overstock/low stock indicators, not discontinued status
  const metadataStatus = (metadata.status || '').toLowerCase();
  
  if (stockStatusFilter === 'overstock') {
    // Add logic for overstock detection here when available
    return metadataStatus.includes('overstock');
  } else if (stockStatusFilter === 'lowstock') {
    // Add logic for low stock detection here when available
    return metadataStatus.includes('low') || metadataStatus.includes('lowstock');
  }
  
  return true; // No filter or unknown filter value
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

  row.innerHTML = `
    <td contenteditable="true">${formatTextForDisplay(metadata.location)}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.date)}</td>
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
    <td contenteditable="true">${formatTextForDisplay(metadata.status)}</td>
    <td contenteditable="true">${formatTextForDisplay(metadata.uk_fr_preorder)}</td>
    <td class="readonly-field" title="Populated from table">${metadata.fr_6m_data || ''}</td>
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
  if (cells.length < 16) return;

  const shelf_lt1_qty = Number(cells[6].textContent.trim()) || 0;
  const shelf_gt1_qty = Number(cells[8].textContent.trim()) || 0;
  const top_floor_total = Number(cells[11].textContent.trim()) || 0;

  // Calculate totals
  const shelfTotal = shelf_lt1_qty + shelf_gt1_qty;
  const totalStock = shelfTotal + top_floor_total;

  cells[9].textContent = shelfTotal; // Shelf Total
  cells[12].textContent = totalStock; // Total Stock
}

async function saveRowData(row) {
  const cells = row.children;
  if (cells.length < 16) return;

  const item_id = row.dataset.itemId;

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
    location: getTextWithLineBreaks(cells[0]),
    date: getTextWithLineBreaks(cells[1]),
    // uk_6m_data: excluded - populated from table
    shelf_lt1: getTextWithLineBreaks(cells[5]),
    shelf_lt1_qty: Number(cells[6].textContent.trim()) || 0,
    shelf_gt1: getTextWithLineBreaks(cells[7]),
    shelf_gt1_qty: Number(cells[8].textContent.trim()) || 0,
    top_floor_expiry: getTextWithLineBreaks(cells[10]),
    top_floor_total: Number(cells[11].textContent.trim()) || 0,
    status: getTextWithLineBreaks(cells[13]),
    uk_fr_preorder: getTextWithLineBreaks(cells[14]),
    // fr_6m_data: excluded - populated from table
  };

  try {
    // Use PATCH for updating existing metadata
    const patchPath = `/api/v1/inventory/management/metadata/${item_id}`;
    
    console.log(`[Inventory Management] Updating item ${item_id} with:`, updated);
    
    // Use PATCH for updating existing metadata
    await patch(patchPath, updated);
    
    console.log(`[Inventory Management] Successfully updated via PATCH: ${patchPath}`);
    
    const updatedWithId = { ...updated, item_id };
    metadataIndex.set(item_id, updatedWithId);
    
    console.log('[Inventory Management] Successfully updated:', item_id);
    
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
  });
  
  // Apply filters button
  const applyBtn = document.getElementById('applyStatusFilters');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const selectedFilters = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      
      console.log('[Inventory] Applying discontinued status filters:', selectedFilters);
      
      // Save preferences
      saveDiscontinuedStatusFilters(selectedFilters);
      
      // Reset to first page when filters change
      currentPage = 0;
      
      // Re-render table with new filters (no need to reload data from API)
      setupTable();
      
      // Count visible rows
      const visibleRows = document.querySelectorAll('#inventoryManagementBody tr:not([style*="display: none"])').length;
      console.log(`[Inventory] Now showing ${visibleRows} products after applying filters`);
      
      // Visual feedback on button
      const originalText = applyBtn.textContent;
      applyBtn.textContent = '✓ Filters Applied';
      applyBtn.style.background = '#10b981';
      setTimeout(() => {
        applyBtn.textContent = originalText;
        applyBtn.style.background = '';
      }, 2000);
    });
  }
}

const searchHandler = debounce(() => {
  // Reset to first page when search changes
  currentPage = 0;
  setupTable();
}, 300);

// Stock status dropdown change handler
function onStockStatusFilterChange() {
  currentPage = 0;
  setupTable();
}

function applyFilters() {
  // Deprecated - search is now handled by rebuilding the table
  // This function is kept for compatibility but does nothing
  console.log('[Inventory Management] applyFilters called (deprecated)');
}

function getSelectedValue(toggle) {
  if (!toggle) return '';
  const text = toggle.textContent;
  // Extract value from dropdown selections like "Overstock ▼" -> "Overstock"
  const match = text.match(/^(.+?)\s*▼?$/);
  const value = match ? match[1].trim() : text.trim();
  
  // Map display text to actual filter values
  const valueMap = {
    'All Stock Status': '',
    'Overstock': 'overstock',
    'Low Stock': 'lowstock'
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
      table.style.transform = `scale(${zoom / 100})`;
      table.style.transformOrigin = 'top left';
      
      // Adjust the scroller width to accommodate the scaled table
      const scaledWidth = table.offsetWidth * (zoom / 100);
      tableScroller.style.width = '100%';
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
    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        setupTable();
        // Scroll to top of table
        document.getElementById('inventoryManagementTableScroller')?.scrollTo(0, 0);
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(totalFilteredItems / ITEMS_PER_PAGE);
      if (currentPage < totalPages - 1) {
        currentPage++;
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

  const item_id = row.dataset.itemId;

  const updated = {
    item_id,
    location: cells[0].textContent.trim(),
    date: cells[1].textContent.trim(),
    // uk_6m_data: excluded - populated from table
    shelf_lt1: cells[5].textContent.trim(),
    shelf_lt1_qty: Number(cells[6].textContent.trim()) || 0,
    shelf_gt1: cells[7].textContent.trim(),
    shelf_gt1_qty: Number(cells[8].textContent.trim()) || 0,
    top_floor_expiry: cells[10].textContent.trim(),
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
    
    metadataIndex.set(item_id, updated);
    
    console.log('[Inventory Management] Successfully updated:', item_id);
    
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
      btn.innerText = 'Syncing...';
    }
    const res = await post('/api/v1/inventory/management/sync-sales-data', {
      dry_run: false
    });
    if (res && res.status === 'success') {
      const updated = res.stats?.updated_records ?? 0;
      console.log(`[Sync] Success: ${updated} records updated`);
      if (showNotification) {
        alert(`✅ Sync complete: ${updated} records updated`);
      }

      // Refresh table if available
      if (typeof loadInventoryData === 'function') {
        await loadInventoryData();
        setupTable(); // Rebuild table with updated data
      }
    } else {
      throw new Error(res?.detail || 'Sync failed');
    }
  } catch (err) {
    console.error('[Sync] Failed:', err);
    alert('❌ Sync failed: ' + err.message);
  } finally {
    isSyncing = false;
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Sync Sales Data';
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
