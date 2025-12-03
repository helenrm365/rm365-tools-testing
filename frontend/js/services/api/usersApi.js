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

export const getUsernames = () => get(`${API}`);

export const createUser = ({ username, password, role = 'user', allowed_tabs = [] }) =>
    post(`${API}`, { username, password, role, allowed_tabs });

export const updateUser = ({ username, new_username, new_password, role, allowed_tabs }) =>
    patch(`${API}`, { username, new_username, new_password, role, allowed_tabs });

export const deleteUser = (username) => del(`${API}?username=${encodeURIComponent(username)}`);