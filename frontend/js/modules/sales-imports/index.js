// frontend/js/modules/sales-imports/index.js

/**
 * Main entry point for the sales imports module
 * Loads the appropriate page based on the path
 */
export async function init(path) {
  console.log('[Sales Imports] Initializing module for path:', path);
  
  try {
    if (path === '/sales-imports' || path === '/sales-imports/home') {
      // Load the home page module
      const { initSalesImportsHome } = await import('./home.js');
      await initSalesImportsHome();
    } else if (path === '/sales-imports/uk-sales') {
      // Load UK sales page
      const { initUKSales } = await import('./uk-sales.js');
      await initUKSales();
    } else if (path === '/sales-imports/fr-sales') {
      // Load FR sales page
      const { initFRSales } = await import('./fr-sales.js');
      await initFRSales();
    } else if (path === '/sales-imports/nl-sales') {
      // Load NL sales page
      const { initNLSales } = await import('./nl-sales.js');
      await initNLSales();
    } else if (path === '/sales-imports/history') {
      // Load history page
      const { initImportHistory } = await import('./history.js');
      await initImportHistory();
    }
  } catch (error) {
    console.error('[Sales Imports] Error initializing module:', error);
    throw error;
  }
}
