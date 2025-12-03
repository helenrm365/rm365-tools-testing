// js/services/api/labelsApi.js
import { get, post, http } from './http.js';
import { getToken } from '../state/sessionStore.js';
import { config } from '../../config.js';

const API = '/v1/labels';  // http.js adds BASE which already includes /api

/**
 * Get all products available for label printing
 * @param {Array<string>} discontinuedStatuses - Optional array of discontinued statuses to filter by
 * @param {string} region - Region preference: "uk", "fr", or "nl"
 */
export async function getProductsToPrint(discontinuedStatuses = null, region = "uk") {
  let url = `${API}/to-print`;
  
  const params = new URLSearchParams();
  
  // Add discontinued_statuses query parameter if provided
  if (discontinuedStatuses && discontinuedStatuses.length > 0) {
    const statusParam = discontinuedStatuses.join(',');
    params.append('discontinued_statuses', statusParam);
  }
  
  // Add region parameter
  params.append('region', region);
  
  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  
  return await get(url);
}

/**
 * Create a new label print job
 * @param {Object} payload - { line_date: 'YYYY-MM-DD', created_by: 'email' }
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
 * Download PDF labels for a job
 * @param {number} jobId - Job ID
 */
export async function downloadPDF(jobId) {
  const BASE = config.API.replace(/\/+$/, '');
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
  const BASE = config.API.replace(/\/+$/, '');
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
 * Initialize label dependencies (sync sales data)
 */
export async function initDependencies() {
  return await post(`${API}/init-dependencies`);
}
