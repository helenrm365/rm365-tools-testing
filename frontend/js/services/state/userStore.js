// frontend/js/services/state/userStore.js
const TABS_KEY = 'allowed_tabs';
const USER_KEY = 'user';

export function setAllowedTabs(tabs) {
  const arr = Array.isArray(tabs)
    ? tabs
    : typeof tabs === 'string'
      ? tabs.split(',').map(s => s.trim()).filter(Boolean)
      : [];
  
  console.log('[UserStore] Setting allowed tabs:', arr);
  localStorage.setItem(TABS_KEY, JSON.stringify(arr));
}

export function getAllowedTabs() {
  try { 
    const tabs = JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
    console.log('[UserStore] Retrieved allowed tabs:', tabs);
    return tabs;
  }
  catch (e) { 
    console.warn('[UserStore] Failed to parse allowed tabs:', e);
    return []; 
  }
}

export function setUserData(userData) {
  console.log('[UserStore] Setting user data:', userData);
  localStorage.setItem(USER_KEY, JSON.stringify(userData));
}

export function getUserData() {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
    console.log('[UserStore] Retrieved user data:', user);
    return user;
  } catch (e) {
    console.warn('[UserStore] Failed to parse user data:', e);
    return {};
  }
}

export function clearUser() {
  console.log('[UserStore] Clearing user data');
  localStorage.removeItem(TABS_KEY);
  localStorage.removeItem(USER_KEY);
}
