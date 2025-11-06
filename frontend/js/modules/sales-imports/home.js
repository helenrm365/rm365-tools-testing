// frontend/js/modules/sales-imports/home.js
import { initializeTables, checkTablesStatus } from '../../services/api/salesImportsApi.js';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the sales imports home page
 */
export async function initSalesImportsHome() {
  console.log('[Sales Imports] Initializing home page...');
  
  try {
    // Call the backend to initialize tables
    const result = await initializeTables();
    
    if (result.status === 'success') {
      console.log('[Sales Imports] Tables initialized:', result.tables);
      showToast(`✅ Database Ready - Tables initialized: ${result.tables.join(', ')}`, 'success');
    } else {
      console.error('[Sales Imports] Failed to initialize tables:', result.message);
      showToast('❌ Failed to initialize tables: ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Sales Imports] Error initializing home page:', error);
    showToast('❌ Error initializing sales imports: ' + error.message, 'error');
  }
}

// Initialize when the page loads
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the sales imports home page
    if (window.location.pathname.includes('/sales-imports') && 
        (window.location.pathname.endsWith('/home') || window.location.pathname === '/sales-imports')) {
      initSalesImportsHome();
    }
  });
}
