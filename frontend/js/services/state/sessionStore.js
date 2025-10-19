// frontend/js/services/state/sessionStore.js
const KEY = 'access_token';

export function getToken() {
  // prefer sessionStorage for web sessions, fall back to localStorage
  return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '';
}

export function setToken(token) {
  if (!token) {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } else {
    sessionStorage.setItem(KEY, token);
    localStorage.setItem(KEY, token);
  }
}

export function isAuthed() {
  return !!getToken();
}

export function clearToken() {
  setToken('');
}
