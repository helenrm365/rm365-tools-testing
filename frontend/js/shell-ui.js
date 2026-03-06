// frontend/js/shell-ui.js
import { clearToken, isAuthed } from './services/state/sessionStore.js';
import { clearUser } from './services/state/userStore.js';
import { get } from './services/api/http.js';
import { navigate } from './router.js';
import { setupTabsForUser } from './utils/tabs.js';
import { initSidebar, showSidebar, hideSidebar, highlightCurrentRoute, refreshSidebar } from './ui/sidebar.js';

export function setupShellUI() {
  // Add loaded class to body to show main content
  document.body.classList.add('loaded');

  // Apply saved appearance preferences
  applyUserPreferences();
  
  // Convert select elements to c-select system (exclude modals to prevent duplicates)
  setTimeout(() => {
    // Add modern-select class to select elements NOT inside modals
    document.querySelectorAll('select:not(.select-hidden):not([data-enhanced]):not([data-nui-enhanced]):not(.modal-overlay select):not(.modal-content select):not(.form-select)').forEach(select => {
      select.classList.add('modern-select');
      select.setAttribute('data-enhance', 'c-select');
    });
    
    if (window.initCSelects) {
      window.initCSelects();
    }
  }, 200);

  // Watch for dynamically added select elements
  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          if (node.tagName === 'SELECT' || (node.querySelector && node.querySelector('select'))) {
            hasNewContent = true;
          }
        }
      });
    });
    
    if (hasNewContent) {
      setTimeout(() => {
        // Add classes to new select elements (exclude modals)
        document.querySelectorAll('select:not(.select-hidden):not([data-enhanced]):not([data-nui-enhanced]):not(.modal-overlay select):not(.modal-content select):not(.form-select)').forEach(select => {
          select.classList.add('modern-select');
          select.setAttribute('data-enhance', 'c-select');
        });
        
        if (window.initCSelects) {
          window.initCSelects();
        }
      }, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // ---- Permissions-based tab filtering (if available)
  try {
    setupTabsForUser();
  } catch {
    // Safe to ignore if not available yet
  }
  
  // ---- Initialize sidebar navigation
  try {
    if (isAuthed()) {
      initSidebar();
    }
  } catch (err) {
    console.warn('[ShellUI] Sidebar initialization error:', err);
  }
}

async function applyUserPreferences() {
  try {
    if (!isAuthed()) return;
    const prefs = await get('/v1/users/preferences');
    if (!prefs) return;

    const root = document.documentElement;
    const accent = prefs.accent_color || '#8bc34a';
    const accentDark = prefs.accent_dark || '#7ab82d';
    const accentLight = prefs.accent_light || '#a5d461';

    if (prefs.accent_enabled) {
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--accent-dark', accentDark);
      root.style.setProperty('--accent-light', accentLight);
    } else {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-dark');
      root.style.removeProperty('--accent-light');
    }

    root.classList.toggle('dark-mode', !!prefs.dark_mode);
    localStorage.setItem('darkMode', String(!!prefs.dark_mode));

    // Apply glow preference (disabled by default)
    root.classList.toggle('glow-enabled', !!prefs.glow_enabled);
  } catch (e) {
    console.warn('[ShellUI] Failed to apply preferences:', e);
  }
}

/**
 * Update sidebar visibility based on authentication and route
 * Call this after navigation or auth state changes
 */
export function updateSidebarState(path) {
  const isLoginPage = path === '/login';
  
  if (isLoginPage || !isAuthed()) {
    hideSidebar();
    document.body.classList.add('login-page');
  } else {
    document.body.classList.remove('login-page');
    // If no sidebar exists yet (e.g. after fresh login), build it
    if (!document.querySelector('.sidebar-container')) {
      refreshSidebar();
    }
    showSidebar();
    highlightCurrentRoute();
  }
}
