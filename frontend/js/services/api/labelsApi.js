// js/services/api/labelsApi.js
import { get, post, http } from './http.js';
import { getToken } from '../state/sessionStore.js';
import { getApiUrl } from '../../config.js';

const API = '/v1/labels';  // http.js adds BASE which already includes /api

/**
 * Check status of labels-related tables in the database
 * @returns {Promise<{status: string, tables_status: object, all_tables_exist: boolean}>}
 */
export async function checkTablesStatus() {
  return await get(`${API}/status`);
}

/**
 * Initialize labels tables if they don't exist
 * @returns {Promise<{status: string, message: string}>}
 */
export async function initializeTables() {
  return await get(`${API}/init`);
}

/**
 * Purge old label print jobs and their items
 * @param {number} months - Delete jobs older than this many months (default 6)
 * @returns {Promise<{status: string, jobs_deleted: number, items_deleted: number}>}
 */
export async function purgeOldJobs(months = 6) {
  return await http(`${API}/purge-old?months=${months}`, { method: 'DELETE' });
}

/**
 * Get all products available for label printing
 * @param {Array<string>} discontinuedStatuses - Optional array of discontinued statuses to filter by
 * @param {string} region - Region preference: "uk", "fr", or "nl"
 * @param {boolean} showOrphaned - Whether to include orphaned SKUs (products without names)
 */
export async function getProductsToPrint(discontinuedStatuses = null, region = "uk", showOrphaned = false) {
  let url = `${API}/to-print`;
  
  const params = new URLSearchParams();
  
  // Add discontinued_statuses query parameter if provided
  if (discontinuedStatuses && discontinuedStatuses.length > 0) {
    const statusParam = discontinuedStatuses.join(',');
    params.append('discontinued_statuses', statusParam);
  }
  
  // Add region parameter
  params.append('region', region);
  
  // Add show_orphaned parameter
  if (showOrphaned) {
    params.append('show_orphaned', 'true');
  }
  
  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  
  return await get(url);
}

/**
 * Create a new label print job
 * @param {Object} payload - { line: 'optional text', created_by: 'email' }
 */
export async function createPrintJob(payload = {}) {
  return await post(`${API}/start-job`, payload);
}

/**
 * Get label print job details
 * @param {number} jobId - Job ID
 */
export async function getPrintJob(jobId) {
  return await get(`${API}/job/${jobId}`);
}

/**
 * List recent label print jobs
 * @param {number} limit - Number of jobs to return (default 10, max 100)
 */
export async function listPrintJobs(limit = 10) {
  return await get(`${API}/jobs?limit=${limit}`);
}

/**
 * Delete a print job
 * @param {number} jobId - Job ID
 */
export async function deletePrintJob(jobId) {
  return await http(`${API}/job/${jobId}`, { method: 'DELETE' });
}

/**
 * Delete multiple print jobs or all jobs
 * @param {Array<number>} jobIds - Array of job IDs to delete (optional if deleteAll is true)
 * @param {boolean} deleteAll - If true, delete all jobs
 */
export async function deletePrintJobs(jobIds = null, deleteAll = false) {
  return await http(`${API}/jobs`, { 
    method: 'DELETE',
    body: JSON.stringify({ job_ids: jobIds, delete_all: deleteAll })
  });
}

/**
 * Download PDF labels for a job
 * @param {number} jobId - Job ID
 */
export async function downloadPDF(jobId) {
  // Use API base with /api prefix so we hit the FastAPI routes, not the SPA index
  const BASE = getApiUrl().replace(/\/+$/, '');
  const url = `${BASE}${API}/job/${jobId}/pdf`;
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Labels API] PDF download failed:', response.status, errorText);
    throw new Error(`Failed to download PDF: ${response.statusText}. ${errorText}`);
  }
  
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error('Received empty PDF file');
  }
  
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `labels_job_${jobId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(downloadUrl);
  document.body.removeChild(a);
}

/**
 * Download CSV labels for a job
 * @param {number} jobId - Job ID
 */
export async function downloadCSV(jobId) {
  // Use API base with /api prefix so we hit the FastAPI routes, not the SPA index
  const BASE = getApiUrl().replace(/\/+$/, '');
  const url = `${BASE}${API}/job/${jobId}/csv`;
  
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`Failed to download CSV: ${response.statusText}`);
  }
  
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `labels_job_${jobId}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(downloadUrl);
  document.body.removeChild(a);
}

/**
 * Initialize label dependencies (sync magento data)
 */
export async function initDependencies() {
  return await post(`${API}/init-dependencies`);
}

// === Label Printing Presets API ===

/**
 * Get all label printing presets
 */
export async function getPresets() {
  return await get(`${API}/presets`);
}

/**
 * Get a specific preset by ID
 * @param {number} presetId - Preset ID
 */
export async function getPreset(presetId) {
  return await get(`${API}/presets/${presetId}`);
}

/**
 * Create a new label printing preset
 * @param {Object} preset - { name, description, status_filters, region, product_skus }
 */
export async function createPreset(preset) {
  return await post(`${API}/presets`, preset);
}

/**
 * Update an existing preset
 * @param {number} presetId - Preset ID
 * @param {Object} updates - { name?, description?, status_filters?, region?, product_skus? }
 */
export async function updatePreset(presetId, updates) {
  return await http(`${API}/presets/${presetId}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
}

/**
 * Delete a preset
 * @param {number} presetId - Preset ID
 */
export async function deletePreset(presetId) {
  return await http(`${API}/presets/${presetId}`, { method: 'DELETE' });
}