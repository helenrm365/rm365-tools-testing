// js/modules/usermanagement/index.js
// Router for user management module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Default to management (only sub-page)
  const mod = await import('./management.js');
  await mod.init();
  currentSubModule = mod;
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
