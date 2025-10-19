// frontend/js/services/api/authApi.js
import { post, get } from './http.js';

const API = '/api/v1/auth';

export function login({ username, password }) {
  return post(`${API}/login`, { username, password });
}

export function me() {
  return get(`${API}/me`);
}
