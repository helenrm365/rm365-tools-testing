// js/modules/labels/index.js
export async function init(path) {
  if (path === '/labels' || path === '/labels/generator') {
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
