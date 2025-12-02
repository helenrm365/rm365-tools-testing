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

export async function http(path, { method = 'GET', headers = {}, body, retry = 0, timeout = 60000 } = {}) {
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

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    fetchOptions.signal = controller.signal;

    try {
      const res = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (!res.ok) {
        // simple retry on 5xx if requested
        if (retry > 0 && res.status >= 500) {
          return http(path, { method, headers, body, retry: retry - 1 });
        }
        const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
        console.error(`[HTTP] ${method} ${url} failed:`, msg);
        throw new Error(msg);
      }
      
      return data;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw fetchError;
    }
    
  } catch (error) {
    throw error;
  }
}

// sugar helpers
export const get  = (p)        => http(p);
export const del  = (p)        => http(p, { method: 'DELETE' });
export const post = (p, json)  => http(p, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
export const patch= (p, json)  => http(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
