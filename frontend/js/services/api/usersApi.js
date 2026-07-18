// frontend/js/services/api/usersApi.js
import { get, post, patch, del } from './http.js';

const API = '/v1/users';  // http.js adds BASE which already includes /api

export const getUsers = async () => {
    try {
        const result = await get(`${API}/detailed`);
        return result;
    } catch (error) {
        console.error('[Users API] Error fetching users:', error);
        throw error;
    }
};

export const createUser = ({ username, password, email = null, role = null, tab_preset = null, allowed_tabs = [], location_id = null, group_id = null }) =>
    post(`${API}`, { username, password, email, role, tab_preset, allowed_tabs, location_id, group_id });

export const updateUser = ({ username, new_username, new_password, role, tab_preset, allowed_tabs, location_id, group_id }) =>
    patch(`${API}`, { username, new_username, new_password, role, tab_preset, allowed_tabs, location_id, group_id });

export const deleteUser = (username) => del(`${API}?username=${encodeURIComponent(username)}`);

// --- Email Verification ---
export const sendEmailVerificationCode = (username, email) =>
    post(`${API}/email-verification/send`, { username, email });

export const resendEmailVerificationCode = (username) =>
    post(`${API}/email-verification/resend`, { username });

export const confirmEmailVerification = (username, code) =>
    post(`${API}/email-verification/confirm`, { username, code });