/**
 * Inventory Management API Service
 * Handles all inventory management related API calls
 */
import { get, post, patch, http } from './http.js';

const BASE_PATH = '/v1/inventory/management';

/**
 * Check the status of inventory management tables without initializing them
 * @returns {Promise<{status: string, tables_status: object, all_tables_exist: boolean}>}
 */
export async function checkTablesStatus() {
  try {
    const response = await get(`${BASE_PATH}/status`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error checking tables status:', error);
    throw error;
  }
}

/**
 * Initialize inventory management tables if they don't exist
 * @returns {Promise<{status: string, message: string}>}
 */
export async function initializeTables() {
  try {
    const response = await get(`${BASE_PATH}/init`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error initializing tables:', error);
    throw error;
  }
}

/**
 * Get inventory items with pagination and filtering
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-based)
 * @param {number} options.perPage - Items per page
 * @param {string} options.search - Search query
 * @param {string} options.discontinuedStatus - Discontinued status filter (comma-separated)
 * @param {boolean} options.showOrphaned - Show orphaned products
 * @returns {Promise<{items: Array, total: number, page: number, per_page: number, total_pages: number}>}
 */
export async function getInventoryItems(options = {}) {
  const { page = 1, perPage = 100, search = '', discontinuedStatus = '', showOrphaned = false } = options;
  
  let url = `${BASE_PATH}/items?page=${page}&per_page=${perPage}`;
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }
  if (discontinuedStatus) {
    url += `&discontinued_status=${encodeURIComponent(discontinuedStatus)}`;
  }
  if (showOrphaned) {
    url += `&show_orphaned=true`;
  }
  
  try {
    const response = await http(url, { timeout: 120000 }); // 2 minutes for slow inventory fetch
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error fetching inventory items:', error);
    throw error;
  }
}

/**
 * Get inventory metadata
 * @returns {Promise<Array>}
 */
export async function getMetadata() {
  try {
    const response = await get(`${BASE_PATH}/metadata`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error fetching metadata:', error);
    throw error;
  }
}

/**
 * Get magento products for discontinued status filtering
 * @returns {Promise<Array>}
 */
export async function getMagentoProducts() {
  try {
    const response = await get(`${BASE_PATH}/magento-products`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error fetching magento products:', error);
    throw error;
  }
}

/**
 * Health check for inventory management module
 * @returns {Promise<{status: string}>}
 */
export async function healthCheck() {
  try {
    const response = await get(`${BASE_PATH}/health`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error checking health:', error);
    throw error;
  }
}
