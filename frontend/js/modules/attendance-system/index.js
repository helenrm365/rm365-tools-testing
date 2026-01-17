// js/modules/attendance-system/index.js
// Consolidated module for Attendance System (employees, overview, automatic, logs)

export async function init(path) {
  if (path === '/attendance-system' || path === '/attendance-system/') {
    // Home page - no JS needed, just static cards
    return;
  }
  
  if (path === '/attendance-system/employees') {
    // Employee management with CRUD and clock toggle
    const mod = await import('./employees.js');
    await mod.init();
    return;
  }
  
  if (path === '/attendance-system/overview') {
    // Attendance overview with charts and stats
    const mod = await import('./overview.js');
    await mod.init();
    return;
  }
  
  if (path === '/attendance-system/automatic') {
    // NFC card scanning for automatic clocking
    const mod = await import('./automatic.js');
    await mod.init();
    return;
  }
  
  if (path === '/attendance-system/logs') {
    // Attendance logs with export functionality
    const mod = await import('./logs.js');
    await mod.init();
    return;
  }
  
  // default: do nothing for unknown subpaths
}
