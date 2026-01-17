// frontend/js/modules/magentodata/home.js
import { refreshAllAggregatedData } from '../../services/api/magentoDataApi.js?v=5';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the magento data home page
 */
export async function initMagentoDataHome() {
  try {
    console.warn('[Magento Data] Initializing home page...');
    
    // Wait a tick to ensure DOM is fully rendered
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Set up event listeners
    setupEventListeners();
    
    console.log('[Magento Data] Home page ready - table checks will occur when loading individual region pages');
  } catch (error) {
    console.error('[Magento Data] Error initializing home page:', error);
    showToast('❌ Error initializing magento data: ' + error.message, 'error');
  }
}

/**
 * Set up event listeners for the home page
 */
function setupEventListeners() {
  console.warn('[Magento Data] Setting up event listeners...');
  
  // Refresh all aggregated data button
  const refreshAllBtn = document.getElementById('refreshAllAggregatedBtn');
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener('click', handleRefreshAllAggregatedData);
    console.log('[Magento Data] Refresh all button event listener attached');
  } else {
    console.warn('[Magento Data] Refresh all button not found');
  }
}

/**
 * Handle refresh all aggregated data
 */
async function handleRefreshAllAggregatedData() {
  try {
    showToast('Refreshing aggregated data for all regions...', 'info');
    
    const result = await refreshAllAggregatedData();
    
    if (result.status === 'success') {
      const successfulRegions = Object.keys(result.results).filter(r => result.results[r].success);
      showToast(`Successfully refreshed aggregated data for ${successfulRegions.join(', ')}! Total: ${result.total_rows_aggregated} SKUs processed.`, 'success');
    } else {
      showToast('Refresh failed: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Magento Data] Refresh all error:', error);
    showToast('Refresh error: ' + error.message, 'error');
  }
}
