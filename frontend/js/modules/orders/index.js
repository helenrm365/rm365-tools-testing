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
  // Currently only the scanning-logs-hub exists — no sub-module logic needed yet
}

export function cleanup() {
  cleanupSubModule();
}
