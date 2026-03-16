// js/modules/orders/index.js
// Router for the shared orders hub pages

let currentSubModule = null;

function cleanupSubModule() {
  if (currentSubModule) {
    if (typeof currentSubModule.cleanup === 'function') {
      currentSubModule.cleanup();
    }
    currentSubModule = null;
  }
}

export async function init(path) {
  cleanupSubModule();

  const cacheBust = `?t=${Date.now()}`;

  if (path === '/operations/scanning-logs-hub') {
    const mod = await import(`./scanning-logs-dashboard.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  }
  // Other orders hub pages can be added here
}

export function cleanup() {
  cleanupSubModule();
}
