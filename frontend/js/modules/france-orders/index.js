// js/modules/france-orders/index.js
// Router for France Orders module - uses France (FR/NL) inventory

// Use window-scoped state to survive cache-busting reimports
const MODULE_KEY = '__franceOrdersModule';

function getState() {
  if (!window[MODULE_KEY]) {
    window[MODULE_KEY] = { currentSubModule: null, currentSubModulePath: null };
  }
  return window[MODULE_KEY];
}

export async function init(path) {
  console.log('[France index.js] init() called with path:', path);
  const state = getState();
  
  // Determine which sub-module we're routing to
  let targetSubModule = 'order-fulfillment';
  if (path.includes('/order-progress')) targetSubModule = 'order-progress';
  else if (path.includes('/order-tracking')) targetSubModule = 'order-tracking';
  else if (path.includes('/order-approval')) targetSubModule = 'order-approval';
  else if (path.includes('/scanning-logs')) targetSubModule = 'scanning-logs';
  else if (path.includes('/scanner')) targetSubModule = 'scanner';
  
  console.log('[France index.js] Target sub-module:', targetSubModule, 'Current:', state.currentSubModulePath);
  
  // Clean up previous sub-module if switching to a different one
  if (state.currentSubModule && state.currentSubModulePath !== targetSubModule) {
    console.log('[France index.js] Cleaning up previous sub-module:', state.currentSubModulePath);
    if (state.currentSubModule.cleanup) {
      await state.currentSubModule.cleanup();
    } else if (state.currentSubModule.destroy) {
      await state.currentSubModule.destroy();
    }
    state.currentSubModule = null;
  }
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/order-progress')) {
    const mod = await import(`./order-progress.js${cacheBust}`);
    await mod.init();
    state.currentSubModule = mod;
    state.currentSubModulePath = 'order-progress';
  } else if (path.includes('/order-tracking')) {
    const mod = await import(`./order-tracking.js${cacheBust}`);
    await mod.init();
    state.currentSubModule = mod;
    state.currentSubModulePath = 'order-tracking';
  } else if (path.includes('/order-approval')) {
    const mod = await import(`./order-approval.js${cacheBust}`);
    await mod.init();
    state.currentSubModule = mod;
    state.currentSubModulePath = 'order-approval';
  } else if (path.includes('/scanning-logs')) {
    const mod = await import(`./scanning-logs.js${cacheBust}`);
    await mod.init();
    state.currentSubModule = mod;
    state.currentSubModulePath = 'scanning-logs';
  } else if (path.includes('/scanner')) {
    const mod = await import(`./scanner.js${cacheBust}`);
    await mod.init(path);
    state.currentSubModule = mod;
    state.currentSubModulePath = 'scanner';
  } else {
    // Default to order-fulfillment (first sub-page)
    const mod = await import(`./order-fulfillment.js${cacheBust}`);
    await mod.init(path);
    state.currentSubModule = mod;
    state.currentSubModulePath = 'order-fulfillment';
  }
  console.log('[France index.js] init() complete, current sub-module:', state.currentSubModulePath);
}

export async function destroy() {
  console.log('[France index.js] destroy() called');
  const state = getState();
  if (state.currentSubModule) {
    console.log('[France index.js] Destroying sub-module:', state.currentSubModulePath);
    if (state.currentSubModule.cleanup) {
      await state.currentSubModule.cleanup();
    } else if (state.currentSubModule.destroy) {
      await state.currentSubModule.destroy();
    }
  }
  state.currentSubModule = null;
  state.currentSubModulePath = null;
  console.log('[France index.js] destroy() complete');
}

// Alias for router compatibility
export { destroy as cleanup };
