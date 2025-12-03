// frontend/js/config.js
// Configuration for different environments

// Helper to manage API URL persistence
function resolveApiUrl() {
  // 0. CRITICAL: If we are on a Cloudflare Tunnel (trycloudflare.com), ALWAYS use the current origin.
  // This prevents 'debug_api_url' or other settings from breaking the tunnel.
  if (window.location.hostname.endsWith('trycloudflare.com')) {
    return window.location.origin;
  }

  const params = new URLSearchParams(window.location.search);
  const queryApi = params.get('api');
  
  // 1. If 'api' param is provided, save it and use it (unless it's 'reset')
  if (queryApi) {
    if (queryApi === 'reset') {
      localStorage.removeItem('debug_api_url');
    } else {
      localStorage.setItem('debug_api_url', queryApi);
      return queryApi;
    }
  }

  // 2. Check LocalStorage for previously saved override
  const storedApi = localStorage.getItem('debug_api_url');
  if (storedApi) {
    return storedApi;
  }

  // 3. Check global/env variables
  if (window.API) return window.API;
  if (typeof process !== 'undefined' && process.env?.API) return process.env.API;

  // 4. Default Environment Logic
  // Self-hosted with Cloudflare Tunnel or local development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `http://${window.location.hostname}:8000`;
  }

  // Self-hosted (Cloudflare Tunnel or custom domain): Use same origin
  return window.location.origin;
}

export const config = {
  // Backend API URL - Auto-detects environment
  API: resolveApiUrl(),
  
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
      return 'development-local';
    }
    if (window.location.hostname.endsWith('trycloudflare.com')) {
      return 'cloudflare-tunnel';
    }
    return 'production-self-hosted';
  }
};

// Log configuration on load
export function getApiUrl() {
  return config.API + '/api';
}

export function getApiBase() {
  return config.API;
}
console.log('[Config] API URL:', getApiUrl());
export default config;
