// frontend/js/modules/salesdata/index.js

/**
 * Main entry point for the sales data module
 * Loads the appropriate page based on the path
 */
export async function init(path) {
  console.log('[Sales Data] Initializing module for path:', path);
  
  try {
    if (path === '/salesdata' || path === '/salesdata/home') {
      // Home page - no initialization needed, just a landing page
      console.log('[Sales Data] Loading home page');
      return;
    } else if (path === '/salesdata/uk-sales') {
      // Load UK sales page
      const { initUKSalesData } = await import('./uk-sales.js');
      await initUKSalesData();
    } else if (path === '/salesdata/fr-sales') {
      // Load FR sales page
      const { initFRSalesData } = await import('./fr-sales.js');
      await initFRSalesData();
    } else if (path === '/salesdata/nl-sales') {
      // Load NL sales page
      const { initNLSalesData } = await import('./nl-sales.js');
      await initNLSalesData();
    } else if (path === '/salesdata/history') {
      // Load history page
      const { initSalesDataHistory } = await import('./history.js');
      await initSalesDataHistory();
    }
  } catch (error) {
    console.error('[Sales Data] Error initializing module:', error);
    throw error;
  }
}
