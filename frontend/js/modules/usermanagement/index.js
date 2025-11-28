// js/modules/usermanagement/index.js
export async function init(path) {
  switch (path) {
    case '/usermanagement':
      // Home page - no module needed
      break;
    case '/usermanagement/management':
      // Load and initialize the user management module
      try {
        const { init: managementInit } = await import('./management.js');
        await managementInit();
      } catch (error) {
        console.error('[UserManagement] Failed to initialize management module:', error);
      }
      break;
    default:
      console.warn('[UserManagement] Unknown path:', path);
  }
}