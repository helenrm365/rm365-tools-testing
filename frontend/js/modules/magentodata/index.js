// frontend/js/modules/magentodata/index.js

/**
 * Main entry point for the magento data module
 * Loads the appropriate page based on the path
 */
export async function init(path) {
  try {
    if (path === '/magentodata' || path === '/magentodata/home') {
      // Load home page and initialize tables
      const { initMagentoDataHome } = await import('./home.js');
      await initMagentoDataHome();
    } else if (path === '/magentodata/uk-magento') {
      // Load UK magento page
      const { initUKMagentoData } = await import('./uk-magento.js');
      await initUKMagentoData();
    } else if (path === '/magentodata/fr-magento') {
      // Load FR magento page
      const { initFRMagentoData } = await import('./fr-magento.js');
      await initFRMagentoData();
    } else if (path === '/magentodata/nl-magento') {
      // Load NL magento page
      const { initNLMagentoData } = await import('./nl-magento.js');
      await initNLMagentoData();
    } else if (path === '/magentodata/history') {
      // Load history page
      const { initMagentoDataHistory } = await import('./history.js');
      await initMagentoDataHistory();
    }
  } catch (error) {
    console.error('[Magento Data] Error initializing module:', error);
    throw error;
  }
}
