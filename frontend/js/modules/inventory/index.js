// js/modules/inventory/index.js
// Router for inventory module - no longer uses home page

let currentSubModule = null;

/**
 * Cleanup the current sub-module (supports both cleanup and destroy for backwards compatibility)
 */
function cleanupSubModule() {
  if (currentSubModule) {
    if (typeof currentSubModule.cleanup === 'function') {
      currentSubModule.cleanup();
    } else if (typeof currentSubModule.destroy === 'function') {
      currentSubModule.destroy();
    }
    currentSubModule = null;
  }
}

export async function init(path) {
  // Clean up previous sub-module before loading new one
  cleanupSubModule();
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/sourcing')) {
    const mod = await import(`./sourcing.js${cacheBust}`);
    await mod.init(path);
    currentSubModule = mod;
  } else if (path === '/inventory/management/dashboard' || path === '/inventory/management' || path === '/inventory') {
    // Dashboard overview page
    const mod = await import(`./management-dashboard.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else {
    // Branch-specific management page
    const mod = await import(`./management.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  }
}

/**
 * Cleanup function called by router when leaving inventory section
 */
export function cleanup() {
  cleanupSubModule();
}
