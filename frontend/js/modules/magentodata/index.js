// frontend/js/modules/magentodata/index.js

/**
 * Main entry point for the magento data module
 * Loads the appropriate page based on the path
 */
export async function init(path) {
  console.log('[Magento Data Module] init() called with path:', path);
  try {
    if (path === '/magentodata' || path === '/magentodata/home') {
      // Load home page and initialize tables
      console.log('[Magento Data Module] Loading home.js...');
      // Add timestamp to force reload of the module
      const { initMagentoDataHome } = await import(`./home.js?t=${Date.now()}`);
      console.log('[Magento Data Module] home.js loaded, calling initMagentoDataHome()...');
      await initMagentoDataHome();
      console.log('[Magento Data Module] initMagentoDataHome() completed');
    } else if (path.startsWith('/magentodata/uk-magento')) {
      // Load UK magento page
      const { initUKMagentoData } = await import(`./uk-magento.js?t=${Date.now()}`);
      await initUKMagentoData(path);
    } else if (path.startsWith('/magentodata/fr-magento')) {
      // Load FR magento page
      console.log('[Magento Data Module] Loading fr-magento.js for path:', path);
      const { initFRMagentoData } = await import(`./fr-magento.js?t=${Date.now()}&v=4`);
      console.log('[Magento Data Module] fr-magento.js loaded, calling initFRMagentoData()');
      await initFRMagentoData(path);
      console.log('[Magento Data Module] initFRMagentoData() completed');
    } else if (path.startsWith('/magentodata/nl-magento')) {
      // Load NL magento page
      const { initNLMagentoData } = await import(`./nl-magento.js?t=${Date.now()}&v=2`);
      await initNLMagentoData(path);
    } else if (path === '/magentodata/test-magento') {
      // Load test magento page
      const { initTestMagentoData } = await import('./test-magento.js');
      await initTestMagentoData();
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
