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
    await new Promise(resolve => setTimeout(resolve, 100));
    
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
    console.warn('[Magento Data] Test sync button not found in DOM. Retrying...');
    // Retry finding the button for a few seconds
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const btn = document.getElementById('testSyncBtn');
      if (btn) {
        console.log('[Magento Data] Test sync button found on retry, setting up...');
        setupTestSync(btn);
        clearInterval(interval);
      } else if (attempts >= 10) {
        console.error('[Magento Data] Test sync button could not be found after 5 seconds');
        clearInterval(interval);
      }
    }, 500);
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
  // Prevent duplicate listeners
  if (testSyncBtn.dataset.listenerAttached) {
    console.log('[Magento Data] Test sync button listener already attached');
    return;
  }

  let testAbortController = null;
  let isRunning = false;
  
  const handleCancel = () => {
    if (testAbortController) {
      testAbortController.abort();
      showToast('Cancelling test sync...', 'info');
    }
  };
  
  const handleClick = async (e) => {
    if (e) e.preventDefault();
    
    // If currently running, cancel instead
    if (isRunning) {
      handleCancel();
      return;
    }
    
    console.log('[Magento Data] Test sync button clicked!');
    try {
      isRunning = true;
      testAbortController = new AbortController();
      
      // Change to cancel mode
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
      isRunning = false;
      testAbortController = null;
      testSyncBtn.style.background = '#4CAF50';
      testSyncBtn.innerHTML = '<i class="fas fa-vial" style="margin-right: 8px;"></i>Test Sync (10 Orders)';
    }
  };
  
  testSyncBtn.addEventListener('click', handleClick);
  testSyncBtn.dataset.listenerAttached = 'true';
  console.log('[Magento Data] Test sync button event listener attached');
}
