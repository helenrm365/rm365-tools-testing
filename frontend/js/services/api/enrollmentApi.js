// js/services/api/enrollmentApi.js
import { get, post, patch, del } from './http.js';
const API = '/api/v1/enrollment';   // relative, http.js adds BASE & headers

// ----- Employees -----
export const getEmployees = () => get(`${API}/employees`);

export const createEmployee = ({ name, location, status = 'active', card_uid = null }) =>
    post(`${API}/employees`, { name, location, status, card_uid });

export const updateEmployee = (id, payload) =>
    patch(`${API}/employees/${id}`, payload);

export const deleteEmployee = (id) => del(`${API}/employees/${id}`);

export const bulkDeleteEmployees = (ids) =>
    post(`${API}/employees/bulk-delete`, { ids });

// ----- Card -----
export const scanCard = () => post(`${API}/scan/card`);

export const saveCard = (employee_id, uid) =>
    post(`${API}/save/card`, { employee_id, uid });

// ----- Fingerprint -----
export const scanFingerprintBackend = () => post(`${API}/scan/fingerprint`);

export const saveFingerprint = (employee_id, template_b64) =>
    post(`${API}/save/fingerprint`, { employee_id, template_b64 });