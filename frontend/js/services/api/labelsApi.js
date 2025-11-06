// js/services/api/labelsApi.js
import { get, post, http } from './http.js';
import { getToken } from '../state/sessionStore.js';
import { config } from '../../config.js';

const API = '/api/v1/labels';

/**
 * Get all products available for label printing (active, not discontinued)
 */
export async function getProductsToPrint() {
  return await get(`${API}/to-print`);
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
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }
  
  const blob = await response.blob();
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
