import { navigate } from '../../router.js';

let currentInventoryModule = null;

export async function init(path) {
  // Clean up previous module if exists
  if (currentInventoryModule?.cleanup) {
    currentInventoryModule.cleanup();
    currentInventoryModule = null;
  }
  
  try {
    if (path === '/inventory' || path === '/inventory/') {
      // Main inventory home page - no module to load, just display landing page
      return;
    } else if (path === '/inventory/management') {
      const mod = await import('./management.js');
      currentInventoryModule = mod;
      await mod.init();
    } else if (path === '/inventory/order-fulfillment' || path.startsWith('/inventory/order-fulfillment/')) {
      const mod = await import('./order-fulfillment.js');
      currentInventoryModule = mod;
      if (mod.init) await mod.init(path);
    } else if (path === '/inventory/order-progress') {
      const mod = await import('./order-progress.js');
      currentInventoryModule = mod;
      if (mod.init) await mod.init();
    } else {
      console.warn('[Inventory] Unknown inventory path:', path);
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
