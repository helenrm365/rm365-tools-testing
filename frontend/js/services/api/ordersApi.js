/**
 * Orders API Service
 * Handles order fulfillment related API calls including table status and initialization
 */
import { get } from './http.js';

const BASE_PATH = '/v1/magento';

// ============================================================================
// TABLE STATUS & INITIALIZATION
// ============================================================================

/**
 * Check status of order fulfillment tables
 * @returns {Promise<{status: string, tables_status: Object, all_tables_exist: boolean}>}
 */
export async function checkOrderTablesStatus() {
  try {
    return await get(`${BASE_PATH}/status`);
  } catch (error) {
    console.error('[OrdersApi] Error checking tables status:', error);
    throw error;
  }
}

/**
 * Initialize order fulfillment tables
 * @returns {Promise<{status: string, message: string}>}
 */
export async function initializeOrderTables() {
  try {
    return await get(`${BASE_PATH}/init`);
  } catch (error) {
    console.error('[OrdersApi] Error initializing tables:', error);
    throw error;
  }
}

/**
 * Ensure order fulfillment tables exist, creating them if necessary
 * @returns {Promise<boolean>} True if tables are ready
 */
export async function ensureOrderTablesExist() {
  try {
    const status = await checkOrderTablesStatus();
    console.log('[OrdersApi] Tables status:', status);
    
    if (!status.all_tables_exist) {
      console.log('[OrdersApi] Tables not found, initializing...');
      await initializeOrderTables();
      console.log('[OrdersApi] Tables initialized successfully');
    }
    
    return true;
  } catch (error) {
    console.error('[OrdersApi] Error ensuring tables exist:', error);
    throw error;
  }
}
