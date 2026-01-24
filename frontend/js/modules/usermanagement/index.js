// js/modules/usermanagement/index.js
// Router for user management module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Default to management (only sub-page)
  const mod = await import(`./management.js${cacheBust}`);
  await mod.init();
  currentSubModule = mod;
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
