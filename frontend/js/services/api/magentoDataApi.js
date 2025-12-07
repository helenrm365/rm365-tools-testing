// js/services/api/magentoDataApi.js
import { get, post, http } from './http.js';
import { getToken } from '../state/sessionStore.js';
import { config } from '../../config.js';

const API = '/v1/magentodata';  // http.js adds BASE which already includes /api

// Test sync - syncs 10 orders to test_magento_data table
export async function testSyncMagentoData(signal = null) {
  return await post(`${API}/test-sync`, {}, { signal });
}

// Initialize tables
export async function initializeTables() {
  return await http(`${API}/init`, { timeout: 120000 }); // 2 minutes for slow init
}

// Check tables status
export async function checkTablesStatus() {
  return await get(`${API}/status`);
}

// UK Magento Data operations
export async function getUKMagentoData(limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/uk?${params.toString()}`);
}

export async function syncUKMagentoData(signal = null, startDate = null, endDate = null, maxOrders = null) {
  const body = {};
  if (startDate) body.start_date = startDate;
  if (endDate) body.end_date = endDate;
  if (maxOrders) body.max_orders = maxOrders;
  
  return await post(`${API}/uk/sync`, body, { signal });
}

export async function uploadUKMagentoCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const BASE = config.API.replace(/\/+$/, '');
  const url = `${BASE}${API}/uk/upload`;
  
  const fetchOptions = {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    },
    body: formData
  };
  
  const token = getToken();
  if (token) {
    fetchOptions.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, fetchOptions);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Upload failed with status ${response.status}`);
  }
  
  return await response.json();
}

// FR Magento Data operations
export async function getFRMagentoData(limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/fr?${params.toString()}`);
}

export async function syncFRMagentoData(signal = null, startDate = null, endDate = null, maxOrders = null) {
  const body = {};
  if (startDate) body.start_date = startDate;
  if (endDate) body.end_date = endDate;
  if (maxOrders) body.max_orders = maxOrders;
  
  return await post(`${API}/fr/sync`, body, { signal });
}

export async function uploadFRMagentoCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const BASE = config.API.replace(/\/+$/, '');
  const url = `${BASE}${API}/fr/upload`;
  
  const fetchOptions = {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    },
    body: formData
  };
  
  const token = getToken();
  if (token) {
    fetchOptions.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, fetchOptions);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Upload failed with status ${response.status}`);
  }
  
  return await response.json();
}

// NL Magento Data operations
export async function getNLMagentoData(limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/nl?${params.toString()}`);
}

export async function syncNLMagentoData(signal = null, startDate = null, endDate = null, maxOrders = null) {
  const body = {};
  if (startDate) body.start_date = startDate;
  if (endDate) body.end_date = endDate;
  if (maxOrders) body.max_orders = maxOrders;
  
  return await post(`${API}/nl/sync`, body, { signal });
}

export async function uploadNLMagentoCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const BASE = config.API.replace(/\/+$/, '');
  const url = `${BASE}${API}/nl/upload`;
  
  const fetchOptions = {
    method: 'POST',
    mode: 'cors',
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    },
    body: formData
  };
  
  const token = getToken();
  if (token) {
    fetchOptions.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, fetchOptions);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Upload failed with status ${response.status}`);
  }
  
  return await response.json();
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
    credentials: 'include',
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
    credentials: 'include',
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

// Template operations
export async function downloadTemplate() {
  return await get(`${API}/template`);
}

// Health check
export async function checkHealth() {
  return await get(`${API}/health`);
}

// Condensed data operations (6-month aggregated by SKU)
export async function getUKCondensedData(limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/uk/condensed?${params.toString()}`);
}

export async function getFRCondensedData(limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/fr/condensed?${params.toString()}`);
}

export async function getNLCondensedData(limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/nl/condensed?${params.toString()}`);
}

export async function getCustomRangeCondensedData(region, rangeType, rangeValue, useExclusions, limit = 100, offset = 0, search = '') {
  const params = new URLSearchParams({
    range_type: rangeType,
    range_value: rangeValue,
    use_exclusions: useExclusions.toString(),
    limit: limit.toString(),
    offset: offset.toString(),
    search: search
  });
  return await get(`${API}/${region}/condensed/custom-range?${params.toString()}`);
}

// Import History operations
export async function getImportHistory(limit = 100, offset = 0, region = null) {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString()
  });
  if (region) {
    params.append('region', region);
  }
  return await get(`${API}/history?${params.toString()}`);
}

// Condensed data refresh operations
export async function refreshAllCondensedData() {
  return await post(`${API}/refresh-condensed`, {});
}

export async function refreshCondensedDataForRegion(region) {
  return await post(`${API}/refresh-condensed/${region}`, {});
}
