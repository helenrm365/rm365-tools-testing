/**
 * Inventory Management API Service
 * Handles all inventory management related API calls
 * Supports multiple branch locations (uk-birmingham, uk-london, fr-paris)
 */
import { get, post, patch, http } from './http.js';

// Branch configuration
const BRANCH_CONFIG = {
  'uk-birmingham': {
    basePath: '/v1/inventory/management/uk-birmingham',
    tableName: 'uk_birmingham_inventory',
    displayName: 'UK Birmingham'
  },
  'uk-london': {
    basePath: '/v1/inventory/management/uk-london',
    tableName: 'uk_london_inventory',
    displayName: 'UK London'
  },
  'fr-paris': {
    basePath: '/v1/inventory/management/fr-paris',
    tableName: 'fr_paris_inventory',
    displayName: 'FR Paris'
  }
};

// Default branch for backwards compatibility
const DEFAULT_BRANCH = 'uk-birmingham';

/**
 * Get the current branch from URL or page data attribute
 * @returns {string} Branch identifier
 */
export function getCurrentBranch() {
  // Try to get from URL first
  const path = window.location.pathname;
  const match = path.match(/\/inventory\/management\/(uk-birmingham|uk-london|fr-paris)/);
  if (match) {
    return match[1];
  }
  
  // Try to get from page data attribute
  const pageElement = document.querySelector('.inventory-management[data-branch]');
  if (pageElement) {
    return pageElement.dataset.branch;
  }
  
  return DEFAULT_BRANCH;
}

/**
 * Get branch configuration
 * @param {string} branch - Branch identifier (optional, defaults to current)
 * @returns {Object} Branch configuration
 */
export function getBranchConfig(branch = null) {
  const branchId = branch || getCurrentBranch();
  return BRANCH_CONFIG[branchId] || BRANCH_CONFIG[DEFAULT_BRANCH];
}

/**
 * Get the base path for API calls
 * @param {string} branch - Branch identifier (optional)
 * @returns {string} Base path
 */
function getBasePath(branch = null) {
  return getBranchConfig(branch).basePath;
}

/**
 * Check the status of inventory management tables without initializing them
 * @param {string} branch - Branch identifier (optional)
 * @returns {Promise<{status: string, tables_status: object, all_tables_exist: boolean}>}
 */
export async function checkTablesStatus(branch = null) {
  try {
    const response = await get(`${getBasePath(branch)}/status`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error checking tables status:', error);
    throw error;
  }
}

/**
 * Initialize inventory management tables if they don't exist
 * @param {string} branch - Branch identifier (optional)
 * @returns {Promise<{status: string, message: string}>}
 */
export async function initializeTables(branch = null) {
  try {
    const response = await get(`${getBasePath(branch)}/init`);
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
 * @param {string} options.branch - Branch identifier (optional)
 * @returns {Promise<{items: Array, total: number, page: number, per_page: number, total_pages: number}>}
 */
export async function getInventoryItems(options = {}) {
  const { page = 1, perPage = 100, search = '', discontinuedStatus = '', showOrphaned = false, branch = null } = options;
  
  let url = `${getBasePath(branch)}/items?page=${page}&per_page=${perPage}`;
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
 * @param {string} branch - Branch identifier (optional)
 * @returns {Promise<Array>}
 */
export async function getMetadata(branch = null) {
  try {
    const response = await get(`${getBasePath(branch)}/metadata`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error fetching metadata:', error);
    throw error;
  }
}

/**
 * Get magento products for discontinued status filtering
 * @param {string} branch - Branch identifier (optional)
 * @returns {Promise<Array>}
 */
export async function getMagentoProducts(branch = null) {
  try {
    const response = await get(`${getBasePath(branch)}/magento-products`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error fetching magento products:', error);
    throw error;
  }
}

/**
 * Health check for inventory management module
 * @param {string} branch - Branch identifier (optional)
 * @returns {Promise<{status: string}>}
 */
export async function healthCheck(branch = null) {
  try {
    const response = await get(`${getBasePath(branch)}/health`);
    return response;
  } catch (error) {
    console.error('[InventoryApi] Error checking health:', error);
    throw error;
  }
}
