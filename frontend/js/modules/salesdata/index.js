// frontend/js/modules/salesdata/index.js

/**
 * Main entry point for the sales data module
 * Loads the appropriate page based on the path
 */
export async function init(path) {
  try {
    if (path === '/salesdata' || path === '/salesdata/home') {
      // Load home page and initialize tables
      const { initSalesDataHome } = await import('./home.js');
      await initSalesDataHome();
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
