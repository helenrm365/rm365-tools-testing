// frontend/js/modules/salesdata/home.js
import { initializeTables, checkTablesStatus } from '../../services/api/salesDataApi.js';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the sales data home page
 */
export async function initSalesDataHome() {
  console.log('[Sales Data] Initializing home page...');
  
  try {
    // Call the backend to initialize tables
    const result = await initializeTables();
    
    if (result.status === 'success') {
      console.log('[Sales Data] Tables initialized:', result.tables);
      showToast(`✅ Database Ready - Tables initialized: ${result.tables.join(', ')}`, 'success');
    } else {
      console.error('[Sales Data] Failed to initialize tables:', result.message);
      showToast('❌ Failed to initialize tables: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Sales Data] Error initializing home page:', error);
    showToast('❌ Error initializing sales data: ' + error.message, 'error');
  }
}

// Initialize when the page loads
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the sales data home page
    if (window.location.pathname.includes('/salesdata') && 
        (window.location.pathname.endsWith('/home') || window.location.pathname === '/salesdata')) {
      initSalesDataHome();
    }
  });
}
