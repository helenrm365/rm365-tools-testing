// frontend/js/config.js
// Configuration for different environments

export const config = {
  // Backend API URL - Auto-detects environment
  API: window.API || 
       (typeof process !== 'undefined' && process.env?.API) ||
       // Production: Use Railway backend
       (window.location.hostname.includes('pages.dev') || window.location.hostname.includes('cloudflare') 
         ? 'https://rm365-tools-testing-production.up.railway.app'
         : 'http://127.0.0.1:8000'), // Local development
  
  // Debug mode
  DEBUG: window.location.hostname === 'localhost' || 
         window.location.hostname === '127.0.0.1' ||
         window.location.search.includes('debug=true'),
  
  // Cross-origin setup detection
  get IS_CROSS_ORIGIN() {
    return this.API !== window.location.origin;
  },
  
  // Environment detection
  get ENVIRONMENT() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'development-with-railway-backend';
    }
    if (window.location.hostname.includes('pages.dev') || window.location.hostname.includes('cloudflare')) {
      return 'production';
    }
    return 'unknown';
  }
};

// Log configuration on load
export function getApiUrl() {
  return config.API + '/api';
}

export function getApiBase() {
  return config.API;
}

console.log('[Config] Environment:', config.ENVIRONMENT);
console.log('[Config] Backend URL:', config.API);
console.log('[Config] API URL:', getApiUrl());
console.log('[Config] Frontend Origin:', window.location.origin);
console.log('[Config] Cross-origin:', config.IS_CROSS_ORIGIN);
console.log('[Config] Debug mode:', config.DEBUG);

export default config;
