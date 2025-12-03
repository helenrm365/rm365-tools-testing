// js/services/api/enrollmentApi.js
import { get, post, patch, del } from './http.js';
const API = '/v1/enrollment';   // relative, http.js adds BASE (which already includes /api) & headers

// ----- Employees -----
export const getEmployees = () => get(`${API}/employees`);

export const createEmployee = ({ name, location, status = 'active', nfc_uid = null }) =>
    post(`${API}/employees`, { name, location, status, nfc_uid });

export const updateEmployee = (id, payload) =>
    patch(`${API}/employees/${id}`, payload);

export const deleteEmployee = (id) => del(`${API}/employees/${id}`);

export const bulkDeleteEmployees = (ids) =>
    post(`${API}/employees/bulk-delete`, { ids });

// ----- NFC -----
export const scanNFC = () => post(`${API}/scan/nfc`);

export const saveNFC = (employee_id, uid) =>
    post(`${API}/save/nfc`, { employee_id, uid });

export const deleteNFC = (employee_id) =>
    post(`${API}/delete/nfc`, { employee_id });

// ----- Fingerprint -----
export const scanFingerprintBackend = () => post(`${API}/scan/fingerprint`);

export const saveFingerprint = (employee_id, template_b64, name = "Default") =>
    post(`${API}/save/fingerprint`, { employee_id, template_b64, name });

export const deleteFingerprint = (fingerprint_id) =>
    post(`${API}/delete/fingerprint`, { fingerprint_id });