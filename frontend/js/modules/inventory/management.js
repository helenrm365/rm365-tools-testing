import { get, post, patch } from '../../services/api/http.js';
import { config } from '../../config.js';

const API = config.API;

console.log('[Inventory Management] Using API:', API);
console.log('[Inventory Management] Window location:', window.location.href);

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
let dropdownDocListenersBound = false;
let dropdownBackdrop;
let _filterSeq = 0;

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
  bindGlobalHandlers();
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
    
    inventoryData = Array.isArray(items) ? items : [];
    
    // Index metadata by item_id
    metadataIndex.clear();
    if (Array.isArray(metadata)) {
      metadata.forEach(meta => {
        metadataIndex.set(meta.item_id, meta);
      });
    }
    
    console.log(`[Inventory Management] Loaded ${inventoryData.length} items and ${metadata.length} metadata records`);
    
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

  // Status dropdown - only overstock and low stock
  bindDropdown('statusDropdown', 'statusToggle', [
    { value: '', text: 'All Status' },
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
    // Regular dropdown
    dropdownContent.innerHTML = options.map(opt => 
      `<button class="dropdown-item" data-value="${opt.value}">${opt.text}</button>`
    ).join('');

    // Handle regular dropdown selection
    dropdownContent.addEventListener('click', e => {
      if (e.target.classList.contains('dropdown-item')) {
        const value = e.target.dataset.value;
        const text = e.target.textContent;
        toggle.innerHTML = `${text} <span class="arrow">▼</span>`;
        closeAllDropdowns();
        applyFilters();
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

  // Populate table with combined data
  inventoryData.forEach(item => {
    const metadata = metadataIndex.get(item.item_id) || {};
    const row = createTableRow(item, metadata);
    tableBody.appendChild(row);
  });

  console.log(`[Inventory Management] Created ${tableBody.children.length} table rows`);
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
    
    // Show success feedback
    row.style.backgroundColor = '#d4edda';
    setTimeout(() => {
      row.style.backgroundColor = '';
    }, 2000);
    
    console.log('[Inventory Management] Successfully updated:', item_id);
    
  } catch (err) {
    console.error('[Inventory Management] Update failed:', err);
    
    // Show error feedback
    row.style.backgroundColor = '#f8d7da';
    setTimeout(() => {
      row.style.backgroundColor = '';
    }, 3000);
    
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
}

const searchHandler = debounce(() => {
  applyFilters();
}, 300);

function applyFilters() {
  const searchInput = document.getElementById('inventorySearch');
  const statusToggle = document.getElementById('statusToggle');
  
  const searchQuery = searchInput?.value || '';
  const statusFilter = getSelectedValue(statusToggle);

  console.log('[Inventory Management] Applying filters:', { searchQuery, statusFilter });

  const tableBody = document.getElementById('inventoryManagementBody');
  if (!tableBody) return;

  const rows = Array.from(tableBody.querySelectorAll('tr'));
  let visibleCount = 0;

  rows.forEach(row => {
    const entry = rowEntryByEl.get(row);
    if (!entry) return;

    let visible = true;

    // Search filter
    if (searchQuery && !entry.search(searchQuery)) {
      visible = false;
    }

    // Status filter - now matches the CSS classes used
    if (statusFilter) {
      const rowStatus = row.dataset.status || '';
      if (statusFilter === 'overstock' && !row.classList.contains('status-overstock')) {
        visible = false;
      } else if (statusFilter === 'lowstock' && !row.classList.contains('status-lowstock')) {
        visible = false;
      }
    }

    row.style.display = visible ? '' : 'none';
    if (visible) visibleCount++;
  });

  console.log(`[Inventory Management] ${visibleCount} of ${rows.length} rows visible`);
}

function getSelectedValue(toggle) {
  if (!toggle) return '';
  const text = toggle.textContent;
  // Extract value from dropdown selections like "London ▼" -> "London"
  const match = text.match(/^(.+?)\s*▼?$/);
  const value = match ? match[1].trim() : text.trim();
  
  // Map display text to actual values
  const valueMap = {
    'All Locations': '',
    'All Status': '',
    'Low Stock': 'low_stock',
    'Out of Stock': 'out_of_stock',
    'Active': 'active'
  };
  
  return valueMap[value] || value;
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
  getBackdrop().classList.remove('show');
}

// Sync sales data button handler
document.getElementById('syncSalesBtn')?.addEventListener('click',async() =>{
    const btn = document.getElementById('syncSalesBtn');
    btn.disabled = true;
    btn.innerText = 'Syncing..';
    try{
        const res = await post('/api/v1/inventory/management/sync-sales-data', {
            dry_run: false // or true if testing
        });
        if (res && res.status === 'success'){
            const updated = res.stats?.updated_records ?? 'unknown';
            alert(`Sync complete: ${updated} records updated`);
        } else {
            const errorDetail = res?.detail || 'No error details returned.'; //
            alert(`Sync failed: ${errorDetail}`);
        }
    } catch(err) {
        console.error('[Sync Sales Data] Failed:', err)
        alert('Sync failed:' + err.message);
    }   finally {
        btn.disabled = false;
        btn.innerText = 'Sync Sales Data';
    }
});

export function cleanup() {
  console.log('[Inventory Management] Cleaning up');
  
  // Clear data
  inventoryData = [];
  metadataIndex.clear();
  rowEntryByEl.clear();
  
  // Remove global functions
  if (window.saveRow) {
    delete window.saveRow;
  }
}
