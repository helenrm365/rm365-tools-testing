// frontend/js/shell-ui.js
import { clearToken } from './services/state/sessionStore.js';
import { clearUser } from './services/state/userStore.js';
import { navigate } from './router.js';
import { setupTabsForUser, filterSidebarByPermissions } from './utils/tabs.js';

export function setupShellUI() {
  // Add loaded class to body to show main content
  document.body.classList.add('loaded');
  
  // Convert all select elements to c-select system only
  setTimeout(() => {
    // Add modern-select class to all select elements
    document.querySelectorAll('select:not(.select-hidden):not([data-enhanced])').forEach(select => {
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
        // Add classes to new select elements
        document.querySelectorAll('select:not(.select-hidden):not([data-enhanced])').forEach(select => {
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
  
  // NOTE: Sidebar functionality is now handled by the universal-sidebar.html component
  // which includes its own JavaScript for dark mode, search, navigation, logout, etc.
  // The universal sidebar will initialize itself when loaded.
  
  // Expose filterSidebarByPermissions globally so sidebar can access it
  window.filterSidebarByPermissions = filterSidebarByPermissions;
  
  // ---- Permissions-based tab filtering (if available)
  try {
    setupTabsForUser();
  } catch {
    // Safe to ignore if not available yet
  }
}
