// frontend/js/shell-ui.js
import { clearToken, isAuthed } from './services/state/sessionStore.js';
import { clearUser } from './services/state/userStore.js';
import { navigate } from './router.js';
import { setupTabsForUser } from './utils/tabs.js';
import { initSidebar, showSidebar, hideSidebar, highlightCurrentRoute } from './ui/sidebar.js';

export function setupShellUI() {
  // Add loaded class to body to show main content
  document.body.classList.add('loaded');
  
  // Convert select elements to c-select system (exclude modals to prevent duplicates)
  setTimeout(() => {
    // Add modern-select class to select elements NOT inside modals
    document.querySelectorAll('select:not(.select-hidden):not([data-enhanced]):not(.modal-overlay select):not(.modal-content select):not(.form-select)').forEach(select => {
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
        document.querySelectorAll('select:not(.select-hidden):not([data-enhanced]):not(.modal-overlay select):not(.modal-content select):not(.form-select)').forEach(select => {
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
    showSidebar();
    highlightCurrentRoute();
  }
}
