/**
 * Inventory Sourcing API Service
 * Handles all sourcing-related API calls (suppliers, pricing, FX rates, analysis)
 */
import { get, post, patch, http } from './http.js';
import { getToken } from '../state/sessionStore.js';
import { getApiUrl } from '../../config.js';

const BASE_PATH = '/v1/inventory/sourcing';

// ============================================================================
// TABLE STATUS & INITIALIZATION
// ============================================================================

/**
 * Check status of sourcing tables
 * @returns {Promise<{all_tables_exist: boolean, ...}>}
 */
export async function checkSourcingTablesStatus() {
  try {
    return await get(`${BASE_PATH}/status`);
  } catch (error) {
    console.error('[SourcingApi] Error checking tables status:', error);
    throw error;
  }
}

/**
 * Initialize sourcing tables
 * @returns {Promise<{status: string, message: string}>}
 */
export async function initializeSourcingTables() {
  try {
    return await post(`${BASE_PATH}/init`);
  } catch (error) {
    console.error('[SourcingApi] Error initializing tables:', error);
    throw error;
  }
}

// ============================================================================
// FX RATES (Currency Engine)
// ============================================================================

/**
 * Get current FX rates (live + overrides)
 * @returns {Promise<{base_currency: string, rates: Object, overrides: string[], source: string}>}
 */
export async function getFXRates() {
  try {
    return await get(`${BASE_PATH}/fx-rates`);
  } catch (error) {
    console.error('[SourcingApi] Error fetching FX rates:', error);
    throw error;
  }
}

/**
 * Set manual FX rate override
 * @param {string} currencyCode - Currency code (e.g., 'USD')
 * @param {number} rate - Exchange rate relative to GBP
 * @param {string} [notes] - Optional notes
 * @returns {Promise<{status: string, override: Object}>}
 */
export async function setFXOverride(currencyCode, rate, notes = null) {
  try {
    return await post(`${BASE_PATH}/fx-rates/override`, {
      currency_code: currencyCode,
      rate: rate,
      notes: notes
    });
  } catch (error) {
    console.error('[SourcingApi] Error setting FX override:', error);
    throw error;
  }
}

/**
 * Remove FX rate override (revert to live rate)
 * @param {string} currencyCode - Currency code
 * @returns {Promise<{status: string, message: string}>}
 */
export async function removeFXOverride(currencyCode) {
  try {
    return await http(`${BASE_PATH}/fx-rates/override/${currencyCode}`, { method: 'DELETE' });
  } catch (error) {
    console.error('[SourcingApi] Error removing FX override:', error);
    throw error;
  }
}

// ============================================================================
// SUPPLIERS
// ============================================================================

/**
 * Get all suppliers
 * @param {boolean} [activeOnly=true] - Only return active suppliers
 * @returns {Promise<Array<Object>>}
 */
export async function getSuppliers(activeOnly = true) {
  try {
    return await get(`${BASE_PATH}/suppliers?active_only=${activeOnly}`);
  } catch (error) {
    console.error('[SourcingApi] Error fetching suppliers:', error);
    throw error;
  }
}

/**
 * Get single supplier by ID
 * @param {number} supplierId
 * @returns {Promise<Object>}
 */
export async function getSupplier(supplierId) {
  try {
    return await get(`${BASE_PATH}/suppliers/${supplierId}`);
  } catch (error) {
    console.error('[SourcingApi] Error fetching supplier:', error);
    throw error;
  }
}

/**
 * Create new supplier
 * @param {Object} supplierData
 * @returns {Promise<Object>}
 */
export async function createSupplier(supplierData) {
  try {
    return await post(`${BASE_PATH}/suppliers`, supplierData);
  } catch (error) {
    console.error('[SourcingApi] Error creating supplier:', error);
    throw error;
  }
}

/**
 * Update supplier
 * @param {number} supplierId
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
export async function updateSupplier(supplierId, updates) {
  try {
    return await patch(`${BASE_PATH}/suppliers/${supplierId}`, updates);
  } catch (error) {
    console.error('[SourcingApi] Error updating supplier:', error);
    throw error;
  }
}

/**
 * Delete supplier
 * @param {number} supplierId
 * @returns {Promise<{status: string, message: string}>}
 */
export async function deleteSupplier(supplierId) {
  try {
    return await http(`${BASE_PATH}/suppliers/${supplierId}`, { method: 'DELETE' });
  } catch (error) {
    console.error('[SourcingApi] Error deleting supplier:', error);
    throw error;
  }
}

// ============================================================================
// SUPPLIER PRICING
// ============================================================================

/**
 * Get all pricing for a SKU
 * @param {string} sku
 * @returns {Promise<{sku: string, pricing: Array}>}
 */
export async function getPricingForSku(sku) {
  try {
    return await get(`${BASE_PATH}/pricing/${encodeURIComponent(sku)}`);
  } catch (error) {
    console.error('[SourcingApi] Error fetching pricing:', error);
    throw error;
  }
}

/**
 * Create or update pricing entry
 * @param {Object} pricingData - {sku, supplier_id, unit_price, currency, moq, shipping_cost, notes, is_preferred}
 * @returns {Promise<Object>}
 */
export async function upsertPricing(pricingData) {
  try {
    return await post(`${BASE_PATH}/pricing`, pricingData);
  } catch (error) {
    console.error('[SourcingApi] Error upserting pricing:', error);
    throw error;
  }
}

/**
 * Delete pricing entry
 * @param {string} sku
 * @param {number} supplierId
 * @returns {Promise<{status: string, message: string}>}
 */
export async function deletePricing(sku, supplierId) {
  try {
    return await http(`${BASE_PATH}/pricing/${encodeURIComponent(sku)}/${supplierId}`, { method: 'DELETE' });
  } catch (error) {
    console.error('[SourcingApi] Error deleting pricing:', error);
    throw error;
  }
}

/**
 * Bulk update pricing (for matrix/spreadsheet editing)
 * @param {Array<Object>} updates - Array of pricing updates
 * @returns {Promise<{status: string, updated: number}>}
 */
export async function bulkUpdatePricing(updates) {
  try {
    return await post(`${BASE_PATH}/pricing/bulk`, { updates });
  } catch (error) {
    console.error('[SourcingApi] Error bulk updating pricing:', error);
    throw error;
  }
}

// ============================================================================
// SUPPLIER MATRIX (Spreadsheet View)
// ============================================================================

/**
 * Get the supplier matrix view
 * @param {Object} options
 * @param {number} options.page - Page number
 * @param {number} options.perPage - Items per page
 * @param {string} options.search - Search query
 * @param {string} options.sortBy - Column to sort by
 * @param {string} options.sortOrder - Sort order (asc/desc)
 * @returns {Promise<{matrix: Array, suppliers: Array, total: number, ...}>}
 */
export async function getSupplierMatrix(options = {}) {
  const { page = 1, perPage = 100, search = '', sortBy = '', sortOrder = 'asc' } = options;
  let url = `${BASE_PATH}/matrix?page=${page}&per_page=${perPage}`;
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }
  if (sortBy) {
    url += `&sort_by=${encodeURIComponent(sortBy)}&sort_order=${encodeURIComponent(sortOrder)}`;
  }
  console.log('[SourcingApi] getSupplierMatrix URL:', url);
  try {
    return await get(url);
  } catch (error) {
    console.error('[SourcingApi] Error fetching matrix:', error);
    throw error;
  }
}

// ============================================================================
// ANALYSIS DASHBOARD (The Brain)
// ============================================================================

/**
 * Get analysis dashboard data
 * @param {Object} options
 * @param {number} options.page - Page number
 * @param {number} options.perPage - Items per page
 * @param {string} options.search - Search query
 * @param {string} options.category - Category filter
 * @param {string} options.marginStatus - Filter by margin status (healthy, warning, loss, no_data)
 * @param {string} options.sortBy - Column to sort by
 * @param {string} options.sortOrder - Sort order (asc/desc)
 * @returns {Promise<{products: Array, summary: Object, suppliers: Array, ...}>}
 */
export async function getAnalysisDashboard(options = {}) {
  const { page = 1, perPage = 100, search = '', category = '', marginStatus = '', sortBy = '', sortOrder = 'asc' } = options;
  console.log('[SourcingApi] getAnalysisDashboard options:', { sortBy, sortOrder, page, perPage });
  let url = `${BASE_PATH}/analysis?page=${page}&per_page=${perPage}`;
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }
  if (category) {
    url += `&category=${encodeURIComponent(category)}`;
  }
  if (marginStatus) {
    url += `&margin_status=${encodeURIComponent(marginStatus)}`;
  }
  if (sortBy) {
    url += `&sort_by=${encodeURIComponent(sortBy)}&sort_order=${encodeURIComponent(sortOrder)}`;
  }
  console.log('[SourcingApi] getAnalysisDashboard URL:', url);
  try {
    return await get(url);
  } catch (error) {
    console.error('[SourcingApi] Error fetching analysis:', error);
    throw error;
  }
}

// ============================================================================
// IMPORT/EXPORT
// ============================================================================

/**
 * Export supplier matrix as CSV
 * @returns {Promise<Blob>}
 */
export async function exportMatrixCSV() {
  try {
    const response = await http(`${BASE_PATH}/export/csv`, { method: 'GET' });
    return response;
  } catch (error) {
    console.error('[SourcingApi] Error exporting CSV:', error);
    throw error;
  }
}

/**
 * Import supplier matrix from CSV
 * @param {File} file - CSV file to import
 * @returns {Promise<{status: string, imported: number, errors: number}>}
 */
export async function importMatrixCSV(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    // Use http directly with FormData (don't set Content-Type, browser will set it with boundary)
    return await http(`${BASE_PATH}/import/csv`, { 
      method: 'POST',
      body: formData
    });
  } catch (error) {
    console.error('[SourcingApi] Error importing CSV:', error);
    throw error;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format currency amount with symbol
 * @param {number} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatCurrency(amount, currency = 'GBP') {
  if (amount == null) return '—';
  
  const symbols = {
    GBP: '£',
    USD: '$',
    EUR: '€',
    CNY: '¥',
    JPY: '¥',
    CAD: 'C$',
    AUD: 'A$',
    CHF: 'CHF ',
    SEK: 'kr ',
    NOK: 'kr ',
    DKK: 'kr ',
    PLN: 'zł ',
    CZK: 'Kč ',
    HUF: 'Ft '
  };
  
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Get margin status CSS class
 * @param {string} status - healthy, warning, loss, no_data
 * @returns {string}
 */
export function getMarginStatusClass(status) {
  switch (status) {
    case 'healthy': return 'margin-healthy';
    case 'warning': return 'margin-warning';
    case 'loss': return 'margin-loss';
    default: return 'margin-no-data';
  }
}

/**
 * Calculate margin percentage
 * @param {number} sellPrice
 * @param {number} costPrice
 * @returns {number|null}
 */
export function calculateMargin(sellPrice, costPrice) {
  if (!sellPrice || !costPrice) return null;
  return ((sellPrice - costPrice) / sellPrice) * 100;
}

/**
 * Sync matrix to Google Sheet
 * @param {string} sheetId
 */
export async function syncMatrixToGSheet(sheetId) {
    return await post(`${BASE_PATH}/sync/google-sheet/export`, { sheet_id: sheetId });
}

/**
 * Sync matrix from Google Sheet
 * @param {string} sheetId
 */
export async function syncMatrixFromGSheet(sheetId) {
    return await post(`${BASE_PATH}/sync/google-sheet/import`, { sheet_id: sheetId });
}

// ============================================================================
// PRODUCT MAPPINGS API
// ============================================================================

/**
 * Get all product mappings for a supplier or all suppliers
 * @param {number|null} [supplierId=null]
 * @returns {Promise<Array<Object>>}
 */
export async function getSupplierMappings(supplierId = null) {
  try {
    const url = supplierId ? `${BASE_PATH}/mappings?supplier_id=${supplierId}` : `${BASE_PATH}/mappings`;
    return await get(url);
  } catch (error) {
    console.error('[SourcingApi] Error fetching mappings:', error);
    throw error;
  }
}

/**
 * Create or update a product mapping
 * @param {Object} mappingData - {supplier_id, supplier_identifier, internal_sku}
 * @returns {Promise<Object>}
 */
export async function createSupplierMapping(mappingData) {
  try {
    return await post(`${BASE_PATH}/mappings`, mappingData);
  } catch (error) {
    console.error('[SourcingApi] Error creating mapping:', error);
    throw error;
  }
}

/**
 * Delete a product mapping
 * @param {number} mappingId
 * @returns {Promise<{status: string, message: string}>}
 */
export async function deleteSupplierMapping(mappingId) {
  try {
    return await http(`${BASE_PATH}/mappings/${mappingId}`, { method: 'DELETE' });
  } catch (error) {
    console.error('[SourcingApi] Error deleting mapping:', error);
    throw error;
  }
}

/**
 * Import product mappings from a CSV or Excel file
 * @param {File} file - CSV or .xlsx file with columns: supplier_code, supplier_identifier, internal_sku
 * @returns {Promise<{status: string, imported: number, skipped: number, errors: string[]}>}
 */
export async function importMappingsFile(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    return await http(`${BASE_PATH}/mappings/import`, { method: 'POST', body: formData });
  } catch (error) {
    console.error('[SourcingApi] Error importing mappings:', error);
    throw error;
  }
}

/**
 * Parse a supplier PDF price list and return a preview of pricing changes.
 * Does NOT commit changes — call bulkUpdatePricing with confirmed items to apply.
 * @param {File} file - PDF file
 * @param {number} supplierId - Supplier ID the PDF belongs to
 * @returns {Promise<{supplier_id, supplier_name, preview: Array, unmatched: Array, total_found, total_matched, total_unmatched}>}
 */
export async function importMatrixPDF(file, supplierId, { signal } = {}) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('supplier_id', supplierId);
    return await http(`${BASE_PATH}/import/pdf`, { method: 'POST', body: formData, signal });
  } catch (error) {
    console.error('[SourcingApi] Error importing PDF:', error);
    throw error;
  }
}

/**
 * Streaming PDF parse — emits live progress via Server-Sent Events and resolves
 * with the final preview payload. Falls back to importMatrixPDF on the caller's
 * side if streaming is unavailable.
 * @param {File} file
 * @param {number} supplierId
 * @param {{ onProgress?: (percent:number, message:string)=>void, signal?: AbortSignal }} [opts]
 * @returns {Promise<object>} the preview result
 */
export async function importMatrixPDFStream(file, supplierId, { onProgress, signal } = {}) {
  const base = getApiUrl().replace(/\/+$/, '');
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('supplier_id', supplierId);

  const response = await fetch(`${base}${BASE_PATH}/import/pdf/stream`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Server error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.type === 'progress') {
        onProgress?.(event.percent, event.message);
      } else if (event.type === 'complete') {
        result = event.result;
      } else if (event.type === 'error') {
        // Server emitted a real parse/validation error — mark it so the caller
        // does NOT retry via the non-streaming endpoint.
        const err = new Error(event.message || 'Failed to parse PDF');
        err.fromSse = true;
        throw err;
      }
    }
  }

  if (!result) throw new Error('No result returned from PDF parse');
  return result;
}

