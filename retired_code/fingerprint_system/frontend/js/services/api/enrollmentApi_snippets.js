// ----- Fingerprint -----
export const scanFingerprintBackend = () => post(`${API}/scan/fingerprint`);

export const saveFingerprint = (employee_id, template_b64, name = "Default") =>
    post(`${API}/save/fingerprint`, { employee_id, template_b64, name });

export const deleteFingerprint = (fingerprint_id) =>
    post(`${API}/delete/fingerprint`, { fingerprint_id });
