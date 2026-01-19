// js/modules/magentodata/index.js
// Router for magento data module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/fr-magento')) {
    const mod = await import('./fr-magento.js');
    await mod.initFRMagentoData(path);
    currentSubModule = mod;
  } else if (path.includes('/nl-magento')) {
    const mod = await import('./nl-magento.js');
    await mod.initNLMagentoData(path);
    currentSubModule = mod;
  } else if (path.includes('/history')) {
    const mod = await import('./history.js');
    await mod.initMagentoDataHistory();
    currentSubModule = mod;
  } else {
    // Default to UK Magento (first sub-page)
    const mod = await import('./uk-magento.js');
    await mod.initUKMagentoData(path);
    currentSubModule = mod;
  }
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
