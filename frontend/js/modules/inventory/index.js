import { navigate } from '../../router.js';

let currentInventoryModule = null;

export async function init(path) {
  console.log('[Inventory] Initializing inventory module for path:', path);
  
  // Clean up previous module if exists
  if (currentInventoryModule?.cleanup) {
    currentInventoryModule.cleanup();
    currentInventoryModule = null;
  }
  
  try {
    if (path === '/inventory' || path === '/inventory/') {
      // Main inventory page - no specific module to load
      console.log('[Inventory] Loading main inventory page');
      // Don't redirect, just let the home page show
    } else if (path === '/inventory/management') {
      const mod = await import('./management.js');
      currentInventoryModule = mod;
      await mod.init();
    } else if (path === '/inventory/adjustments') {
      const mod = await import('./adjustments.js');
      currentInventoryModule = mod;
      await mod.init();
    } else {
      console.warn('[Inventory] Unknown inventory path:', path);
      // Only redirect if it's truly an unknown path, not the main inventory page
    }
  } catch (error) {
    console.error('[Inventory] Failed to initialize module:', error);
    
    // Show error in view
    const view = document.querySelector('#view');
    if (view) {
      view.innerHTML = `
        <div style="padding: 2rem; text-align: center;">
          <h2>Error Loading Inventory Module</h2>
          <p>${error.message}</p>
          <button onclick="window.location.reload()" class="modern-button">Retry</button>
        </div>
      `;
    }
  }
}

export function cleanup() {
  if (currentInventoryModule?.cleanup) {
    currentInventoryModule.cleanup();
    currentInventoryModule = null;
  }
}
