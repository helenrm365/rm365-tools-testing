// js/modules/attendance-system/index.js
// Router for attendance system - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/overview')) {
    const mod = await import('./overview.js');
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/automatic')) {
    const mod = await import('./automatic.js');
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/logs')) {
    const mod = await import('./logs.js');
    await mod.init();
    currentSubModule = mod;
  } else {
    // Default to employees (first sub-page)
    const mod = await import('./employees.js');
    await mod.init();
    currentSubModule = mod;
  }
}

export async function destroy() {
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  currentSubModule = null;
}
