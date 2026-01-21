// frontend/js/services/api/locationsApi.js
import { get, post, patch, del } from './http.js';

const API = '/v1/locations';   // relative, http.js adds BASE (which already includes /api) & headers

/**
 * Initialize locations table (creates table and seeds defaults if not exists)
 */
export const initLocations = () => get(`${API}/init`);

/**
 * Get all locations
 * @returns {Promise<Array<{id: number, name: string, city_code: string, country_code: string, created_at: string}>>}
 */
export const getLocations = () => get(`${API}`);

/**
 * Get all unique country codes
 * @returns {Promise<Array<string>>}
 */
export const getCountryCodes = () => get(`${API}/country-codes`);

/**
 * Get all locations for a specific country code
 * @param {string} countryCode - Country code (e.g., 'UK')
 * @returns {Promise<Array<{id: number, name: string, city_code: string, country_code: string}>>}
 */
export const getLocationsByCountry = (countryCode) => get(`${API}/by-country/${encodeURIComponent(countryCode)}`);

/**
 * Get a location by name
 * @param {string} name - Location name
 * @returns {Promise<{id: number, name: string, city_code: string, country_code: string} | null>}
 */
export const getLocationByName = (name) => get(`${API}/by-name/${encodeURIComponent(name)}`);

/**
 * Get a location by city code
 * @param {string} cityCode - City code (e.g., 'BHX')
 * @returns {Promise<{id: number, name: string, city_code: string, country_code: string} | null>}
 */
export const getLocationByCityCode = (cityCode) => get(`${API}/by-city-code/${encodeURIComponent(cityCode)}`);

/**
 * Get a specific location by ID
 * @param {number} id - Location ID
 * @returns {Promise<{id: number, name: string, city_code: string, country_code: string, created_at: string}>}
 */
export const getLocation = (id) => get(`${API}/${id}`);

/**
 * Create a new location
 * @param {{name: string, city_code: string, country_code: string}} data - Location data
 * @returns {Promise<{id: number, name: string, city_code: string, country_code: string, created_at: string}>}
 */
export const createLocation = ({ name, city_code, country_code }) => 
    post(`${API}`, { name, city_code, country_code });

/**
 * Update an existing location
 * @param {number} id - Location ID
 * @param {{name?: string, city_code?: string, country_code?: string}} data - Fields to update
 * @returns {Promise<{id: number, name: string, city_code: string, country_code: string, created_at: string}>}
 */
export const updateLocation = (id, { name, city_code, country_code }) => 
    patch(`${API}/${id}`, { name, city_code, country_code });

/**
 * Delete a location
 * @param {number} id - Location ID
 * @returns {Promise<{status: string, message: string}>}
 */
export const deleteLocation = (id) => del(`${API}/${id}`);
