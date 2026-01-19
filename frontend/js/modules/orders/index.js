// js/modules/orders/index.js
// Router for orders module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/order-progress')) {
    const mod = await import('./order-progress.js');
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/order-tracking')) {
    const mod = await import('./order-tracking.js');
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/order-approval')) {
    const mod = await import('./order-approval.js');
    await mod.init();
    currentSubModule = mod;
  } else {
    // Default to order-fulfillment (first sub-page)
    const mod = await import('./order-fulfillment.js');
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
