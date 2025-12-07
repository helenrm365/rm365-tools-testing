// frontend/js/modules/magentodata/home.js
import { initializeTables, checkTablesStatus, refreshAllCondensedData } from '../../services/api/magentoDataApi.js';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the magento data home page
 */
export async function initMagentoDataHome() {
  try {
    // Set up event listeners
    setupEventListeners();
    
    // Call the backend to initialize tables
    const result = await initializeTables();
    
    if (result.status === 'success') {
      showToast(`✅ Database Ready - Tables initialized: ${result.tables.join(', ')}`, 'success');
    } else {
      console.error('[Magento Data] Failed to initialize tables:', result.message);
      showToast('❌ Failed to initialize tables: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Magento Data] Error initializing home page:', error);
    showToast('❌ Error initializing magento data: ' + error.message, 'error');
  }
}

/**
 * Set up event listeners for the home page
 */
function setupEventListeners() {
  // Refresh all condensed data button
  const refreshAllBtn = document.getElementById('refreshAllCondensedBtn');
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener('click', handleRefreshAllCondensedData);
  }
}

/**
 * Handle refresh all condensed data
 */
async function handleRefreshAllCondensedData() {
  try {
    showToast('Refreshing condensed data for all regions...', 'info');
    
    const result = await refreshAllCondensedData();
    
    if (result.status === 'success') {
      const successfulRegions = Object.keys(result.results).filter(r => result.results[r].success);
      showToast(`Successfully refreshed condensed data for ${successfulRegions.join(', ')}! Total: ${result.total_rows_aggregated} SKUs processed.`, 'success');
    } else {
      showToast('Refresh failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Magento Data] Refresh all error:', error);
    showToast('Refresh error: ' + error.message, 'error');
  }
}

// Initialize when the page loads
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the magento data home page
    if (window.location.pathname.includes('/magentodata') && 
        (window.location.pathname.endsWith('/home') || window.location.pathname === '/magentodata')) {
      initMagentoDataHome();
    }
  });
}
