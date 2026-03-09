// js/modules/magentodata/index.js
// Router for magento data module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/all-magento')) {
    const mod = await import(`./all-magento.js${cacheBust}`);
    await mod.initAllMagentoData(path);
    currentSubModule = mod;
  } else if (path.includes('/fr-magento')) {
    const mod = await import(`./fr-magento.js${cacheBust}`);
    await mod.initFRMagentoData(path);
    currentSubModule = mod;
  } else if (path.includes('/nl-magento')) {
    const mod = await import(`./nl-magento.js${cacheBust}`);
    await mod.initNLMagentoData(path);
    currentSubModule = mod;
  } else if (path.includes('/history')) {
    const mod = await import(`./history.js${cacheBust}`);
    await mod.initMagentoDataHistory();
    currentSubModule = mod;
  } else if (path.includes('/uk-magento')) {
    const mod = await import(`./uk-magento.js${cacheBust}`);
    await mod.initUKMagentoData(path);
    currentSubModule = mod;
  } else {
    // Default to All Magento (first sub-page)
    const mod = await import(`./all-magento.js${cacheBust}`);
    await mod.initAllMagentoData(path);
    currentSubModule = mod;
  }
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
