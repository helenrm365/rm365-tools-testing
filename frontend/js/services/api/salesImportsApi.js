// js/services/api/salesImportsApi.js
import { get, post, http } from './http.js';
import { getToken } from '../state/sessionStore.js';
import { config } from '../../config.js';

const API = '/api/v1/sales-imports';

// UK Sales Data operations
export async function getUKSalesData(limit = 50, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/uk-sales?${params.toString()}`);
}

// Sales Orders operations
export async function getSalesOrders(limit = 100, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    search: search
  });
  return await get(`${API}/orders?${params.toString()}`);
}

export async function deleteSalesOrder(orderId) {
  return await http(`${API}/orders/${orderId}`, { method: 'DELETE' });
}

// Import operations - using raw fetch for FormData
export async function uploadCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const BASE = config.API.replace(/\/+$/, '');
  const url = `${BASE}${API}/upload`;
  
  const fetchOptions = {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: {
      'Accept': 'application/json',
      // Don't set Content-Type - let browser set it with boundary for FormData
    },
    body: formData
  };
  
  // Add auth header if token exists
  const token = getToken();
  if (token) {
    fetchOptions.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, fetchOptions);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Upload failed with status ${response.status}`);
  }
  
  return await response.json();
}

export async function validateCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const BASE = config.API.replace(/\/+$/, '');
  const url = `${BASE}${API}/validate`;
  
  const fetchOptions = {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: {
      'Accept': 'application/json',
      // Don't set Content-Type - let browser set it with boundary for FormData
    },
    body: formData
  };
  
  // Add auth header if token exists
  const token = getToken();
  if (token) {
    fetchOptions.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, fetchOptions);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Validation failed with status ${response.status}`);
  }
  
  return await response.json();
}

// Import History operations
export async function getImportHistory(limit = 20) {
  const params = new URLSearchParams({
    limit: limit.toString()
  });
  return await get(`${API}/history?${params.toString()}`);
}

// Template operations
export async function downloadTemplate() {
  return await get(`${API}/template`);
}

// Health check
export async function checkHealth() {
  return await get(`${API}/health`);
}
