// frontend/js/index.js
import { setupShellUI } from './shell-ui.js';
import { setupRouter } from './router.js';
import { config } from './config.js';
import { initScrollClamp } from './utils/scrollClamp.js';

// Import debug utilities in development
if (config.DEBUG) {
  import('./debug/apiTest.js').then(module => {
    console.log('🧪 Debug utilities loaded. Use testAllAPIs() to test API calls.');
  }).catch(err => {
    console.warn('Debug utilities not available:', err);
  });
}

setupShellUI();
setupRouter();
initScrollClamp();