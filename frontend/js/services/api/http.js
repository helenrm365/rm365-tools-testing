// frontend/js/services/api/http.js
import { getToken } from '../state/sessionStore.js';
import { config } from '../../config.js';

const BASE = config.API.replace(/\/+$/, '');
const ORIGIN = typeof location !== 'undefined' ? location.origin : '';
const SAME_ORIGIN = !BASE || BASE.startsWith(ORIGIN);

console.log('[HTTP] Configuration:', { BASE, ORIGIN, SAME_ORIGIN, IS_CROSS_ORIGIN: config.IS_CROSS_ORIGIN });

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function http(path, { method = 'GET', headers = {}, body, retry = 0 } = {}) {
  const url = `${BASE}${path}`;
  
  // Check if body is FormData (for file uploads)
  const isFormData = body instanceof FormData;
  
  console.log(`[HTTP] ${method} ${url}`, { 
    BASE,
    path,
    fullUrl: url,
    crossOrigin: !SAME_ORIGIN,
    hasAuth: !!getToken(),
    isFormData,
    headers: { ...authHeader(), ...headers },
    body: body && !isFormData ? (typeof body === 'string' ? JSON.parse(body) : body) : undefined
  });

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

    const res = await fetch(url, fetchOptions);

    console.log(`[HTTP] Response ${res.status}`, { 
      ok: res.ok, 
      url: res.url,
      headers: Object.fromEntries(res.headers.entries()) 
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      // simple retry on 5xx if requested
      if (retry > 0 && res.status >= 500) {
        console.log(`[HTTP] Retrying ${method} ${url} (${retry} retries left)`);
        return http(path, { method, headers, body, retry: retry - 1 });
      }
      const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
      console.error(`[HTTP] Error: ${msg}`, { status: res.status, data, url });
      throw new Error(msg);
    }
    
    if (method !== 'GET') {
      console.log(`[HTTP] Success:`, data);
    }
    return data;
    
  } catch (error) {
    console.error(`[HTTP] Fetch failed for ${method} ${url}:`, error);
    throw error;
  }
}

// sugar helpers
export const get  = (p)        => http(p);
export const del  = (p)        => http(p, { method: 'DELETE' });
export const post = (p, json)  => http(p, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
export const patch= (p, json)  => http(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
