// frontend/js/modules/auth/login.js
import { login, me } from '../../services/api/authApi.js';
import { setToken, clearToken, isAuthed } from '../../services/state/sessionStore.js';
import { setAllowedTabs, clearUser, setUserData } from '../../services/state/userStore.js';
import { navigate } from '../../router.js';
import { setupTabsForUser, getDefaultAllowedPath } from '../../utils/tabs.js';

function $(sel) { return document.querySelector(sel); }

async function doLogin() {
  const status = $('#loginStatus');
  const username = $('#loginUsername')?.value?.trim();
  const password = $('#loginPassword')?.value || '';
  if (!username || !password) {
    status.textContent = 'Please enter both username and password.';
    return;
  }
  $('#loginBtn')?.setAttribute('disabled', 'true');
  status.textContent = 'Signing in…';

  try {
    const { access_token, allowed_tabs } = await login({ username, password });
    
    setToken(access_token);
    setAllowedTabs(allowed_tabs);
    
    // Fetch and store user data
    try {
      const userData = await me();
      setUserData(userData);
    } catch (e) {
      console.warn('[LOGIN] Failed to fetch user data:', e);
    }
    
    status.textContent = 'Login successful! Redirecting...';
    
    try { 
      setupTabsForUser(); 
    } catch (e) {
      console.warn('[LOGIN] Tab setup failed:', e);
    }
    
    // Update sidebar logout button to reflect authenticated state
    try {
      if (window.updateSidebarLogoutButton) {
        window.updateSidebarLogoutButton();
      }
      if (window.updateSidebarUserProfile) {
        window.updateSidebarUserProfile();
      }
    } catch (e) {
      console.warn('[LOGIN] Failed to update sidebar:', e);
    }
    // Add a small delay to ensure state is properly set
    setTimeout(async () => {
      await navigate('/home', true);
    }, 500);
    
  } catch (e) {
    console.error('[LOGIN] Login failed:', e);
    status.textContent = `Login failed: ${e.message}`;
    // Clear any partial auth state on failure
    clearToken();
    clearUser();
  } finally {
    $('#loginBtn')?.removeAttribute('disabled');
  }
}

export async function init() {
  // If we already have a token, sanity-check it and bounce to the app
  if (isAuthed()) {
    try {
      const userData = await me();
      setAllowedTabs(userData.allowed_tabs);
      setUserData(userData);
      try { setupTabsForUser(); } catch {}
      await navigate('/home', true);
      return;
    } catch (error) {
      console.warn('[LOGIN] Token validation failed:', error);
      clearToken();
      clearUser();
    }
  }
  // Wire up button click
  $('#loginBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    doLogin();
  });
  
  // Handle form submit (Enter on any field)
  const form = document.querySelector('.login-wrapper form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin();
  });
  
  // Press Enter to submit from either field
  ['#loginUsername', '#loginPassword'].forEach(sel => {
    document.querySelector(sel)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doLogin();
      }
    });
  });
}
