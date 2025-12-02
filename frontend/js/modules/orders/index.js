import { navigate } from '../../router.js';

let currentOrdersModule = null;

export async function init(path) {
  // Clean up previous module if exists
  if (currentOrdersModule?.cleanup) {
    currentOrdersModule.cleanup();
    currentOrdersModule = null;
  }
  
  try {
    if (path === '/orders' || path === '/orders/') {
      // Main orders home page - no module to load, just display landing page
      return;
    } else if (path === '/orders/order-fulfillment' || path.startsWith('/orders/order-fulfillment/')) {
      const mod = await import('./order-fulfillment.js');
      currentOrdersModule = mod;
      if (mod.init) await mod.init(path);
    } else if (path === '/orders/order-progress') {
      const mod = await import('./order-progress.js');
      currentOrdersModule = mod;
      if (mod.init) await mod.init();
    } else if (path === '/orders/order-tracking') {
      const mod = await import('./order-tracking.js');
      currentOrdersModule = mod;
      if (mod.init) await mod.init();
    } else if (path === '/orders/order-approval') {
      const mod = await import('./order-approval.js');
      currentOrdersModule = mod;
      if (mod.init) await mod.init();
    } else {
      console.warn('[Orders] Unknown orders path:', path);
    }
  } catch (error) {
    console.error('[Orders] Failed to initialize module:', error);
    
    // Show error in view
    const view = document.querySelector('#view');
    if (view) {
      view.innerHTML = `
        <div style="padding: 2rem; text-align: center;">
          <h2>Error Loading Orders Module</h2>
          <p>${error.message}</p>
          <button onclick="window.location.reload()" class="modern-button">Retry</button>
        </div>
      `;
    }
  }
}

export function cleanup() {
  if (currentOrdersModule?.cleanup) {
    currentOrdersModule.cleanup();
    currentOrdersModule = null;
  }
}

