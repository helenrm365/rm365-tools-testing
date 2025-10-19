// js/services/api/labelsApi.js
import { get, post, http } from './http.js';

const API = '/api/v1/labels';

// Label management operations
export async function getLabels() {
  return await get(`${API}/`);
}

export async function getLabel(labelId) {
  return await get(`${API}/${labelId}`);
}

export async function createLabel(labelData) {
  return await post(`${API}/`, labelData);
}

export async function updateLabel(labelId, labelData) {
  return await http(`${API}/${labelId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(labelData)
  });
}

export async function deleteLabel(labelId) {
  return await http(`${API}/${labelId}`, { method: 'DELETE' });
}

// Print operations
export async function printLabel(labelId, printData) {
  return await post(`${API}/${labelId}/print`, printData);
}

export async function printLabelWithData(labelId, data, quantity = 1) {
  return await post(`${API}/${labelId}/print`, {
    data: data,
    quantity: quantity
  });
}

// Print history operations
export async function getPrintHistory(filters = {}) {
  const params = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.append(key, value);
  });
  
  const url = params.toString() ? `${API}/history?${params}` : `${API}/history`;
  return await get(url);
}

export async function getPrintRecord(recordId) {
  return await get(`${API}/history/${recordId}`);
}

export async function deletePrintRecord(recordId) {
  return await http(`${API}/history/${recordId}`, { method: 'DELETE' });
}

export async function reprintLabel(recordId) {
  return await post(`${API}/history/${recordId}/reprint`, {});
}

// Template operations
export async function validateTemplate(template) {
  return await post(`${API}/validate-template`, { template });
}

export async function previewLabel(labelId, data = {}) {
  return await post(`${API}/${labelId}/preview`, { data });
}

// Printer operations
export async function getPrinters() {
  return await get(`${API}/printers`);
}

export async function testPrinter(printerName) {
  return await post(`${API}/printers/${printerName}/test`, {});
}
