// frontend/js/modules/magentodata/home.js
import { initializeTables, checkTablesStatus, refreshAllCondensedData, testSyncMagentoData } from '../../services/api/magentoDataApi.js';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the magento data home page
 */
export async function initMagentoDataHome() {
  try {
    console.log('[Magento Data] Initializing home page...');
    
    // Wait a tick to ensure DOM is fully rendered
    await new Promise(resolve => setTimeout(resolve, 10));
    
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
    console.log('[Magento Data] Refresh all button event listener attached');
  } else {
    console.warn('[Magento Data] Refresh all button not found');
  }
  
  // Test sync button
  const testSyncBtn = document.getElementById('testSyncBtn');
  if (testSyncBtn) {
    console.log('[Magento Data] Test sync button found, setting up...');
    setupTestSync(testSyncBtn);
  } else {
    console.warn('[Magento Data] Test sync button not found in DOM');
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

/**
 * Set up test sync functionality
 */
function setupTestSync(testSyncBtn) {
  let testAbortController = null;
  
  const handleCancel = () => {
    if (testAbortController) {
      testAbortController.abort();
      showToast('Cancelling test sync...', 'info');
    }
  };
  
  const handleTestSync = async () => {
    console.log('[Magento Data] Test sync button clicked!');
    try {
      testAbortController = new AbortController();
      
      // Change to cancel mode
      testSyncBtn.onclick = handleCancel;
      testSyncBtn.innerHTML = '<i class="fas fa-times" style="margin-right: 8px;"></i>Cancel Test';
      testSyncBtn.style.background = '#f44336';
      
      showToast('Starting test sync (10 orders)...', 'info');
      
      console.log('[Magento Data] Calling testSyncMagentoData API...');
      // Call test sync API with proper authentication via http service
      const result = await testSyncMagentoData(testAbortController.signal);
      console.log('[Magento Data] Test sync result:', result);
      
      if (result.status === 'success') {
        showToast(
          `✅ Test sync complete! Synced ${result.rows_synced} product rows from ${result.orders_processed} orders to test_magento_data table`,
          'success',
          5000
        );
      } else {
        showToast('❌ Test sync failed: ' + result.message, 'error');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Test Sync] Cancelled by user');
        showToast('⚠️ Test sync cancelled', 'warning');
      } else {
        console.error('[Test Sync] Error:', error);
        showToast('❌ Test sync error: ' + error.message, 'error');
      }
    } finally {
      testAbortController = null;
  testSyncBtn.addEventListener('click', handleTestSync);
  console.log('[Magento Data] Test sync button event listener attached');
}   // Check if we're on the magento data home page
    if (window.location.pathname.includes('/magentodata') && 
        (window.location.pathname.endsWith('/home') || window.location.pathname === '/magentodata')) {
      initMagentoDataHome();
    }
  });
}
