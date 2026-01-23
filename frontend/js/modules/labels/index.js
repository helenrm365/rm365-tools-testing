// js/modules/labels/index.js
// Router for labels module - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/history')) {
    const mod = await import(`./history.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else {
    // Default to generator (first sub-page)
    const mod = await import(`./generator.js${cacheBust}`);
    await mod.initLabelGenerator();
    currentSubModule = mod;
  }
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
