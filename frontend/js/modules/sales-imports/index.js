// js/modules/sales-imports/index.js
let currentModule = null;

export async function init(path) {
  console.log('[Sales Imports] Initializing module for path:', path);
  
  // Route to appropriate module based on path
  if (path === '/sales-imports/uk-sales') {
    currentModule = await import('./ukSales.js');
    await currentModule.init();
  } else if (path === '/sales-imports/fr-sales') {
    currentModule = await import('./frSales.js');
    await currentModule.init();
  } else if (path === '/sales-imports/nl-sales') {
    currentModule = await import('./nlSales.js');
    await currentModule.init();
  } else if (path === '/sales-imports/history') {
    currentModule = await import('./history.js');
    await currentModule.init();
  } else if (path === '/sales-imports' || path === '/sales-imports/home') {
    // Keep the home page with tabs for backwards compatibility
    currentModule = await import('./regionalSales.js');
    await currentModule.init();
  }
}

export async function cleanup() {
  console.log('[Sales Imports] Cleaning up module');
  if (currentModule && currentModule.cleanup) {
    currentModule.cleanup();
  }
  currentModule = null;
}
