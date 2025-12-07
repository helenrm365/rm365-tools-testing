// frontend/js/services/api/http.js
import { getToken } from '../state/sessionStore.js';
import { getApiUrl } from '../../config.js';

const BASE = getApiUrl().replace(/\/+$/, '');
const ORIGIN = typeof location !== 'undefined' ? location.origin : '';
const SAME_ORIGIN = !BASE || BASE.startsWith(ORIGIN);

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function http(path, { method = 'GET', headers = {}, body, retry = 0, timeout = 60000, signal = null } = {}) {
  const url = `${BASE}${path}`;
  console.log(`[HTTP] ${method} ${url}`);
  console.log(`[HTTP] BASE: ${BASE}, path: ${path}`);
  
  // Check if body is FormData (for file uploads)
  const isFormData = body instanceof FormData;
  
  try {
    const fetchOptions = {
      method,
      mode: 'cors', // Explicitly set CORS mode
      credentials: 'omit', // Don't send cookies for cross-origin
      headers: { 
        'Accept': 'application/json',
        // Don't set Content-Type for FormData - browser will set it with boundary
        'Content-Type': method === 'GET' || isFormData ? undefined : 'application/json',
        ...authHeader(), 
        ...headers 
      },
      body,
    };

    // Remove undefined headers
    Object.keys(fetchOptions.headers).forEach(key => {
      if (fetchOptions.headers[key] === undefined) {
        delete fetchOptions.headers[key];
      }
    });

    // Add timeout to prevent hanging (unless custom signal provided)
    const controller = signal ? null : new AbortController();
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;
    fetchOptions.signal = signal || (controller ? controller.signal : undefined);

    try {
      const res = await fetch(url, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (!res.ok) {
        // Handle token expiration (401 Unauthorized)
        if (res.status === 401) {
          const msg = (data && (data.detail || data.error)) || 'Unauthorized';
          
          // Check if it's a token expiration
          if (msg.toLowerCase().includes('token') || msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('unauthorized')) {
            console.warn(`[HTTP] Token expired or invalid, redirecting to login...`);
            
            // Clear the expired token
            sessionStorage.removeItem('access_token');
            localStorage.removeItem('access_token');
            
            // Dispatch logout event for any listeners
            window.dispatchEvent(new CustomEvent('user-logout'));
            
            // Redirect to login page
            if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
              window.location.href = '/login';
            }
          }
          
          console.error(`[HTTP] ${method} ${url} failed:`, msg);
          throw new Error(msg);
        }
        
        // simple retry on 5xx if requested
        if (retry > 0 && res.status >= 500) {
          return http(path, { method, headers, body, retry: retry - 1, signal });
        }
        const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
        console.error(`[HTTP] ${method} ${url} failed:`, msg);
        throw new Error(msg);
      }
      
      return data;
    } catch (fetchError) {
      if (timeoutId) clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        if (signal) {
          // User cancelled
          throw fetchError;
        }
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw fetchError;
    }
    
  } catch (error) {
    throw error;
  }
}

// sugar helpers
export const get  = (p, opts={})        => http(p, opts);
export const del  = (p, opts={})        => http(p, { method: 'DELETE', ...opts });
export const post = (p, json, opts={})  => http(p, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), ...opts });
export const patch= (p, json, opts={})  => http(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), ...opts });
