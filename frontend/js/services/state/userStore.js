// frontend/js/services/state/userStore.js
const TABS_KEY = 'allowed_tabs';
const USER_KEY = 'user';

export function setAllowedTabs(tabs) {
  const arr = Array.isArray(tabs)
    ? tabs
    : typeof tabs === 'string'
      ? tabs.split(',').map(s => s.trim()).filter(Boolean)
      : [];
  localStorage.setItem(TABS_KEY, JSON.stringify(arr));
}

export function getAllowedTabs() {
  try { 
    const tabs = JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
    return tabs;
  }
  catch (e) { 
    console.warn('[UserStore] Failed to parse allowed tabs:', e);
    return []; 
  }
}

export function setUserData(userData) {
  localStorage.setItem(USER_KEY, JSON.stringify(userData));
}

export function getUserData() {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
    return user;
  } catch (e) {
    console.warn('[UserStore] Failed to parse user data:', e);
    return {};
  }
}

export function clearUser() {
  localStorage.removeItem(TABS_KEY);
  localStorage.removeItem(USER_KEY);
}
