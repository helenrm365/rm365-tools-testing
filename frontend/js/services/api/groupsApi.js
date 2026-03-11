// frontend/js/services/api/groupsApi.js
import { get, post, patch, del } from './http.js';
import { apiCache } from '../../utils/cache.js';

const API = '/v1/groups';

const GROUPS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getGroups = async () => {
    return apiCache.getOrFetch('groups-list', async () => {
        try {
            const result = await get(API);
            return result;
        } catch (error) {
            console.error('[Groups API] Error fetching groups:', error);
            throw error;
        }
    }, GROUPS_CACHE_TTL);
};

export const createGroup = async ({ group_name }) => {
    const result = await post(API, { group_name });
    apiCache.clear('groups-list');
    return result;
};

export const updateGroup = async ({ id, new_name }) => {
    const result = await patch(API, { id, new_name });
    apiCache.clear('groups-list');
    return result;
};

export const deleteGroup = (id) => {
    const result = del(`${API}?id=${id}`);
    apiCache.clear('groups-list');
    return result;
};
