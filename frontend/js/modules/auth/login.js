// frontend/js/modules/auth/login.js
import { login, me } from '../../services/api/authApi.js';
import { setToken, clearToken, isAuthed } from '../../services/state/sessionStore.js';
import { setAllowedTabs, clearUser } from '../../services/state/userStore.js';
import { navigate } from '../../router.js';
import { setupTabsForUser, getDefaultAllowedPath } from '../../utils/tabs.js';

function $(sel) { return document.querySelector(sel); }

async function doLogin() {
  console.log('[LOGIN] doLogin called');
  const status = $('#loginStatus');
  const username = $('#loginUsername')?.value?.trim();
  const password = $('#loginPassword')?.value || '';
  
  console.log('[LOGIN] Username:', username, 'Password length:', password.length);
  
  if (!username || !password) {
    status.textContent = 'Please enter both username and password.';
    return;
  }
  $('#loginBtn')?.setAttribute('disabled', 'true');
  status.textContent = 'Signing in…';

  try {
    console.log('[LOGIN] Calling login API...');
    const { access_token, allowed_tabs } = await login({ username, password });
    console.log('[LOGIN] Login successful, token:', access_token?.substring(0, 20) + '...', 'tabs:', allowed_tabs);
    
    setToken(access_token);
    setAllowedTabs(allowed_tabs);
    status.textContent = 'Login successful! Redirecting...';
    
    try { 
      setupTabsForUser(); 
      console.log('[LOGIN] Tabs setup completed');
    } catch (e) {
      console.warn('[LOGIN] Tab setup failed:', e);
    }
    
    // Update sidebar logout button to reflect authenticated state
    try {
      if (window.updateSidebarLogoutButton) {
        window.updateSidebarLogoutButton();
        console.log('[LOGIN] Sidebar logout button updated');
      }
    } catch (e) {
      console.warn('[LOGIN] Failed to update sidebar logout button:', e);
    }
    
    console.log('[LOGIN] Navigating to home page');
    
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
  console.log('[LOGIN] Initializing login module');
  
  // If we already have a token, sanity-check it and bounce to the app
  if (isAuthed()) {
    console.log('[LOGIN] Found existing auth token, validating...');
    try {
      const { allowed_tabs } = await me();
      console.log('[LOGIN] Token valid, allowed tabs:', allowed_tabs);
      setAllowedTabs(allowed_tabs);
      try { setupTabsForUser(); } catch {}
      console.log('[LOGIN] Redirecting authenticated user to home page');
      await navigate('/home', true);
      return;
    } catch (error) {
      console.warn('[LOGIN] Token validation failed:', error);
      clearToken();
      clearUser();
    }
  }
  
  console.log('[LOGIN] Setting up login form event handlers');
  
  // Wire up button click
  $('#loginBtn')?.addEventListener('click', (e) => {
    console.log('[LOGIN] Login button clicked');
    e.preventDefault();
    doLogin();
  });
  
  // Handle form submit (Enter on any field)
  const form = document.querySelector('.login-wrapper form');
  form?.addEventListener('submit', (e) => {
    console.log('[LOGIN] Form submitted');
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
  
  console.log('[LOGIN] Login module initialization complete');
}
