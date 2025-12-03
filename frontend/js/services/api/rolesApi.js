// frontend/js/services/api/rolesApi.js
import { get, post, patch, del } from './http.js';
import { apiCache } from '../../utils/cache.js';

const API = '/v1/roles';  // http.js adds BASE which already includes /api

// Cache TTLs
const ROLES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (roles rarely change)

export const getRoles = async () => {
    // Use cache with 5-minute TTL
    return apiCache.getOrFetch('roles-list', async () => {
        try {
            const result = await get(API);
            return result;
        } catch (error) {
            console.error('[Roles API] Error fetching roles:', error);
            throw error;
        }
    }, ROLES_CACHE_TTL);
};

export const getRole = async (roleName) => {
    const cacheKey = `role-${roleName}`;
    return apiCache.getOrFetch(cacheKey, async () => {
        return get(`${API}/${encodeURIComponent(roleName)}`);
    }, ROLES_CACHE_TTL);
};

export const createRole = async ({ role_name, allowed_tabs = [] }) => {
    const result = await post(API, { role_name, allowed_tabs });
    // Invalidate cache after creating
    apiCache.clear('roles-list');
    return result;
};

export const updateRole = async ({ role_name, new_role_name, allowed_tabs }) => {
    const result = await patch(API, { role_name, new_role_name, allowed_tabs });
    // Invalidate cache after updating
    apiCache.clear('roles-list');
    apiCache.clear(`role-${role_name}`);
    if (new_role_name) {
        apiCache.clear(`role-${new_role_name}`);
    }
    return result;
};

export const deleteRole = (roleName) => {
    const result = del(`${API}?role_name=${encodeURIComponent(roleName)}`);
    // Invalidate cache after deleting
    apiCache.clear('roles-list');
    apiCache.clear(`role-${roleName}`);
    return result;
};
