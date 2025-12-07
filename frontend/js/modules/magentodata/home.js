// frontend/js/modules/magentodata/home.js
import { initializeTables, checkTablesStatus, refreshAllCondensedData, testSyncMagentoData } from '../../services/api/magentoDataApi.js';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the magento data home page
 */
export async function initMagentoDataHome() {
  try {
    console.warn('[Magento Data] Initializing home page (v2)...');
    
    // Wait a tick to ensure DOM is fully rendered
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Set up event listeners
    setupEventListeners();
    
    // Call the backend to initialize tables
    console.warn('[Magento Data] Calling initializeTables()...');
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
  console.warn('[Magento Data] Setting up event listeners...');
  
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
    testSyncBtn.addEventListener('click', handleTestSync);
    console.warn('[Magento Data] Test sync button event listener attached');
  } else {
    console.warn('[Magento Data] Test sync button not found');
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

// State for test sync
let testSyncRunning = false;
let testSyncController = null;

/**
 * Handle test sync button click
 */
async function handleTestSync(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  
  // If currently running, cancel instead
  if (testSyncRunning) {
    if (testSyncController) {
      testSyncController.abort();
      showToast('Cancelling test sync...', 'info');
    }
    return;
  }
  
  console.log('[Magento Data] Test sync button clicked!');
  
  try {
    testSyncRunning = true;
    testSyncController = new AbortController();
    
    // Change to cancel mode
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-times"></i> Cancel Test';
    btn.classList.remove('primary-btn');
    btn.classList.add('danger-btn'); // Use danger style for cancel
    
    showToast('Starting test sync (10 orders)...', 'info');
    
    console.log('[Magento Data] Calling testSyncMagentoData API...');
    const result = await testSyncMagentoData(testSyncController.signal);
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
    testSyncRunning = false;
    testSyncController = null;
    
    // Reset button state
    btn.innerHTML = '<i class="fas fa-vial"></i> Test Sync (10 Orders)';
    btn.classList.remove('danger-btn');
    btn.classList.add('primary-btn');
  }
}
