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
  
  // ---- Logout
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', async () => {
    if (!confirm('Log out?')) return;
    clearToken();
    clearUser();
    await navigate('/login');
  });

  // ---- Dark mode (from your old ui.js, simplified)
  const toggle = document.getElementById('darkModeToggle');
  const THEME_KEY = 'darkMode';
  const stored = localStorage.getItem(THEME_KEY);
  const isDark = stored === 'true' || (stored == null && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark-mode', isDark);
  if (toggle) toggle.checked = isDark;
  toggle?.addEventListener('change', e => {
    const on = !!e.target.checked;
    document.documentElement.classList.toggle('dark-mode', on);
    localStorage.setItem(THEME_KEY, String(on));
  });

  // ---- Sidebar search (filter by label text)
  const search = document.getElementById('searchInput');
  if (search) {
    search.removeAttribute('disabled'); // enable it
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      document.querySelectorAll('.sidebar .sidebar-link').forEach(link => {
        const label = link.querySelector('.label')?.textContent?.toLowerCase() || '';
        const listItem = link.closest('li');
        if (listItem) {
          listItem.style.display = label.includes(q) ? 'flex' : 'none';
        }
      });
    });
  }

  // ---- Active marker (no tab switching; just highlight)
  function highlightActive(pathname = location.pathname) {
    document.querySelectorAll('.sidebar .sidebar-link').forEach(link => {
      const listItem = link.closest('li');
      if (listItem) {
        listItem.classList.toggle('active', link.getAttribute('href') === pathname);
      }
      // Also toggle active on the link itself for backward compatibility
      link.classList.toggle('active', link.getAttribute('href') === pathname);
    });
  }
  highlightActive();
  window.addEventListener('popstate', () => highlightActive());
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (a && a.getAttribute('href')?.startsWith('/')) {
      // give the router time to pushState, then highlight
      setTimeout(() => highlightActive(a.getAttribute('href')), 0);
    }
  });

  // ---- Permissions-based tab filtering
  try {
    setupTabsForUser();
  } catch {
    // Safe to ignore if not available yet
  }
}
