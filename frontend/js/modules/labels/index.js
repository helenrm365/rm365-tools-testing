// js/modules/labels/index.js
export async function init(path) {
  // Home page - no initialization needed, just a landing page
  if (path === '/labels') {
    return;
  }
  if (path === '/labels/generator') {
    const mod = await import('./generator.js');
    await mod.initLabelGenerator();
    return;
  }
  if (path === '/labels/history') {
    const mod = await import('./history.js');
    await mod.init();
    return;
  }
  // default: do nothing for unknown subpaths
}
