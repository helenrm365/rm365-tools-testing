// js/modules/usermanagement/index.js
export async function init(path) {
  console.log('[UserManagement] Initializing for path:', path);
  
  switch (path) {
    case '/usermanagement':
      // Load and initialize the user management module
      console.log('[UserManagement] Loading management module...');
      try {
        const { init: managementInit } = await import('./management.js');
        await managementInit();
        console.log('[UserManagement] Management module initialized successfully');
      } catch (error) {
        console.error('[UserManagement] Failed to initialize management module:', error);
      }
      break;
    default:
      console.warn('[UserManagement] Unknown path:', path);
  }
}