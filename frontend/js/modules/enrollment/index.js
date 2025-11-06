// js/modules/enrollment/index.js
export async function init(path) {
  // Home page - no initialization needed, just a landing page
  if (path === '/enrollment') {
    return;
  }
  if (path === '/enrollment/management') {
    const mod = await import('./management.js');
    await mod.init();
    return;
  }
  if (path === '/enrollment/card') {
    const mod = await import('./card.js');
    await mod.init();
    return;
  }
  if (path === '/enrollment/fingerprint') {
    const mod = await import('./fingerprint.js');
    await mod.init();
    return;
  }
  // default: do nothing for unknown subpaths
}
