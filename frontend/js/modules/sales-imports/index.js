// js/modules/sales-imports/index.js
export async function init(path) {
  console.log('[Sales Imports] Initializing module for path:', path);
  
  if (path === '/sales-imports/uk-sales') {
    const mod = await import('./ukSalesData.js');
    await mod.init();
  } else if (path === '/sales-imports/upload') {
    const mod = await import('./upload.js');
    await mod.init();
  } else if (path === '/sales-imports/history') {
    const mod = await import('./history.js');
    await mod.init();
  }
  // Home page doesn't need initialization - just displays the nav buttons
}
