// Universal sidebar initialization
// This runs after the sidebar HTML is loaded into the page

(function() {
  'use strict';
  
  if (window.sidebarInitialized) return;
  window.sidebarInitialized = true;
  
  const THEME_KEY = 'darkMode';
  const USER_KEY = 'user';
  
  function initDarkMode() {
    const toggle = document.getElementById('darkModeToggle');
    if (!toggle) {
      console.warn('[Sidebar] Dark mode toggle not found');
      return;
    }
    
    console.log('[Sidebar] Initializing dark mode');
    
    // Check the actual current state of the HTML element (already set by index.html)
    const currentlyDark = document.documentElement.classList.contains('dark-mode');
    
    console.log('[Sidebar] Dark mode current state:', currentlyDark);
    
    // Sync the toggle with the actual current state
    toggle.checked = currentlyDark;
    toggle.setAttribute('aria-checked', String(currentlyDark));
    
    // Ensure localStorage is in sync
    localStorage.setItem(THEME_KEY, String(currentlyDark));
    
    // Add change event listener
    toggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      console.log('[Sidebar] Dark mode toggled:', enabled);
      document.documentElement.classList.toggle('dark-mode', enabled);
      localStorage.setItem(THEME_KEY, String(enabled));
      toggle.setAttribute('aria-checked', String(enabled));
    });
  }
  
  function initSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      const navItems = document.querySelectorAll('.sidebar .nav-item');
      
      navItems.forEach(item => {
        const label = item.querySelector('.nav-label')?.textContent?.toLowerCase() || '';
        const listItem = item.closest('li');
        if (listItem) {
          listItem.style.display = label.includes(query) ? '' : 'none';
        }
      });
    });
  }
  
  function highlightActiveNav(pathname = location.pathname) {
    document.querySelectorAll('.sidebar .nav-item').forEach(link => {
      const listItem = link.closest('li');
      const isActive = link.getAttribute('href') === pathname;
      
      if (listItem) {
        listItem.classList.toggle('active', isActive);
        link.setAttribute('aria-current', isActive ? 'page' : 'false');
      }
    });
  }
  
  function initNavigation() {
    highlightActiveNav();
    
    window.addEventListener('popstate', () => highlightActiveNav());
    
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-nav]');
      if (link?.getAttribute('href')?.startsWith('/')) {
        setTimeout(() => highlightActiveNav(link.getAttribute('href')), 0);
      }
    });
  }
  
  function initLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) {
      console.warn('[Sidebar] Logout button not found');
      return;
    }
    
    console.log('[Sidebar] Initializing logout button');
    
    logoutBtn.addEventListener('click', async () => {
      console.log('[Sidebar] Logout button clicked');
      
      if (!confirm('Are you sure you want to log out?')) return;
      
      localStorage.removeItem('authToken');
      localStorage.removeItem(USER_KEY);
      
      if (window.navigate) {
        console.log('[Sidebar] Using window.navigate to go to /login');
        await window.navigate('/login');
      } else {
        console.log('[Sidebar] Fallback: using window.location.href');
        window.location.href = '/login';
      }
    });
  }
  
  function loadUserProfile() {
    try {
      const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
      const profileName = document.getElementById('profileName');
      const profileSubtitle = document.getElementById('profileSubtitle');
      
      if (profileName && user.name) {
        profileName.textContent = user.name;
      }
      if (profileSubtitle && user.role) {
        profileSubtitle.textContent = user.role;
      }
    } catch (e) {
      console.warn('[Sidebar] Could not load user profile:', e);
    }
  }
  
  function initMobileToggle() {
    const createToggle = () => {
      if (document.querySelector('.mobile-sidebar-toggle')) return;
      
      const toggle = document.createElement('button');
      toggle.className = 'mobile-sidebar-toggle';
      toggle.innerHTML = '☰';
      toggle.setAttribute('aria-label', 'Toggle Sidebar');
      toggle.setAttribute('aria-expanded', 'false');
      
      toggle.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
          const isOpen = sidebar.classList.toggle('mobile-open');
          toggle.setAttribute('aria-expanded', String(isOpen));
        }
      });
      
      document.body.appendChild(toggle);
    };
    
    const removeToggle = () => {
      const toggle = document.querySelector('.mobile-sidebar-toggle');
      toggle?.remove();
      
      const sidebar = document.getElementById('sidebar');
      sidebar?.classList.remove('mobile-open');
    };
    
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        createToggle();
      } else {
        removeToggle();
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
  }
  
  function init() {
    console.log('[Sidebar] Starting initialization...');
    initDarkMode();
    initSearch();
    initNavigation();
    initLogout();
    loadUserProfile();
    initMobileToggle();
    
    console.log('[Sidebar] Initialized successfully');
  }
  
  // Export init function globally so it can be called after sidebar HTML is loaded
  window.initSidebar = init;
  
  // Auto-init if sidebar already exists in DOM
  if (document.getElementById('sidebar')) {
    init();
  }
})();
