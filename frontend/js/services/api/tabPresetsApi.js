// frontend/js/services/api/tabPresetsApi.js
//
// API client for the Tab Presets module (formerly the "Roles" module — renamed
// because the bundle of allowed tabs is conceptually a *preset*, not the user's
// identity. The user's actual `role` is now a separate free-text label).

import { get, post, patch, del } from './http.js';
import { apiCache } from '../../utils/cache.js';

const API = '/v1/tab-presets';  // http.js adds BASE which already includes /api

const PRESETS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — presets rarely change

export const getTabPresets = async () => {
    return apiCache.getOrFetch('tab-presets-list', async () => {
        try {
            const result = await get(API);
            return result;
        } catch (error) {
            console.error('[TabPresets API] Error fetching presets:', error);
            throw error;
        }
    }, PRESETS_CACHE_TTL);
};

export const createTabPreset = async ({ preset_name, allowed_tabs = [] }) => {
    const result = await post(API, { preset_name, allowed_tabs });
    apiCache.clear('tab-presets-list');
    return result;
};

export const updateTabPreset = async ({ preset_name, new_preset_name, allowed_tabs }) => {
    const result = await patch(API, { preset_name, new_preset_name, allowed_tabs });
    apiCache.clear('tab-presets-list');
    return result;
};

export const deleteTabPreset = (presetName) => {
    const result = del(`${API}?preset_name=${encodeURIComponent(presetName)}`);
    apiCache.clear('tab-presets-list');
    return result;
};
