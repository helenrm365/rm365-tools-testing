// js/modules/france-orders/index.js
// Router for Birmingham Orders module - uses UK Birmingham branch inventory

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/order-progress')) {
    const mod = await import(`./order-progress.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/order-tracking')) {
    const mod = await import(`./order-tracking.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/order-approval')) {
    const mod = await import(`./order-approval.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else {
    // Default to order-fulfillment (first sub-page)
    const mod = await import(`./order-fulfillment.js${cacheBust}`);
    await mod.init(path);
    currentSubModule = mod;
  }
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
