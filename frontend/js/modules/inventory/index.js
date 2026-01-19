// js/modules/inventory/index.js
// Router for inventory module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/sourcing')) {
    const mod = await import('./sourcing.js');
    await mod.init(path);
    currentSubModule = mod;
  } else {
    // Default to management (first sub-page)
    const mod = await import('./management.js');
    await mod.init();
    currentSubModule = mod;
  }
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
