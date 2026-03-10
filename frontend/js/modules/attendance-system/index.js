// js/modules/attendance-system/index.js
// Router for attendance system - no longer uses home page

let currentSubModule = null;

export async function init(path) {
  // Clean up previous sub-module
  if (currentSubModule?.destroy) {
    await currentSubModule.destroy();
  }
  
  // Cache-busting timestamp for sub-module imports
  const cacheBust = `?t=${Date.now()}`;
  
  // Route to the appropriate sub-module based on path
  if (path.includes('/analytics') || path.includes('/dashboard')) {
    const mod = await import(`./dashboard.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/clocking') || path.includes('/automatic')) {
    const mod = await import(`./automatic.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/timesheets') || path.includes('/logs')) {
    const mod = await import(`./logs.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else if (path.includes('/staff') || path.includes('/employees')) {
    const mod = await import(`./employees.js${cacheBust}`);
    await mod.init();
    currentSubModule = mod;
  } else {
    // Default to dashboard (first sub-page)
    const mod = await import(`./dashboard.js${cacheBust}`);
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
