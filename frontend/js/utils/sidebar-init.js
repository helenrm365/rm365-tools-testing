// Universal sidebar initialization
// This runs after the sidebar HTML is loaded into the page

(function() {
  'use strict';
  
  if (window.sidebarInitialized) return;
  window.sidebarInitialized = true;
  
  const THEME_KEY = 'darkMode';
  const USER_KEY = 'user';
  
  // Custom confirmation modal
  function showLogoutConfirmation() {
    return new Promise((resolve) => {
      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.2s ease;
      `;
      
      // Create modal
      const modal = document.createElement('div');
      modal.style.cssText = `
        background: ${document.documentElement.classList.contains('dark-mode') ? '#2a2a2a' : 'white'};
        border-radius: 16px;
        padding: 2rem;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.3s ease;
        color: ${document.documentElement.classList.contains('dark-mode') ? '#ecf0f1' : '#2c3e50'};
      `;
      
      modal.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🚪</div>
          <h2 style="margin: 0 0 0.5rem 0; font-size: 1.5rem; font-weight: 600; color: inherit;">Logout Confirmation</h2>
          <p style="margin: 0 0 1.5rem 0; color: ${document.documentElement.classList.contains('dark-mode') ? '#95a5a6' : '#7f8c8d'}; font-size: 1rem;">Are you sure you want to log out?</p>
          <div style="display: flex; gap: 0.75rem; justify-content: center;">
            <button id="logoutCancel" style="
              padding: 0.75rem 1.5rem;
              border: 2px solid ${document.documentElement.classList.contains('dark-mode') ? '#444' : '#e0e0e0'};
              background: transparent;
              color: inherit;
              border-radius: 8px;
              font-size: 1rem;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s ease;
              font-family: 'Sora', sans-serif;
            ">Cancel</button>
            <button id="logoutConfirm" style="
              padding: 0.75rem 1.5rem;
              border: none;
              background: linear-gradient(135deg, #e74c3c, #c0392b);
              color: white;
              border-radius: 8px;
              font-size: 1rem;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s ease;
              box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
              font-family: 'Sora', sans-serif;
            ">Logout</button>
          </div>
        </div>
      `;
      
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      
      // Add animations
      const style = document.createElement('style');
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        #logoutCancel:hover {
          background: ${document.documentElement.classList.contains('dark-mode') ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} !important;
          border-color: ${document.documentElement.classList.contains('dark-mode') ? '#666' : '#ccc'} !important;
        }
        #logoutConfirm:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(231, 76, 60, 0.4) !important;
        }
      `;
      document.head.appendChild(style);
      
      const confirmBtn = backdrop.querySelector('#logoutConfirm');
      const cancelBtn = backdrop.querySelector('#logoutCancel');
      
      const cleanup = () => {
        backdrop.style.animation = 'fadeIn 0.2s ease reverse';
        setTimeout(() => {
          backdrop.remove();
          style.remove();
        }, 200);
      };
      
      confirmBtn.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });
      
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
      
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          cleanup();
          resolve(false);
        }
      });
      
      // Focus confirm button
      setTimeout(() => confirmBtn.focus(), 100);
    });
  }
  
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
        if (!listItem) return;
        
        // Check if item should be hidden by permissions
        // If it was already hidden (display: none), keep it hidden regardless of search
        const wasHiddenByPermissions = listItem.hasAttribute('data-permission-hidden');
        
        if (wasHiddenByPermissions) {
          // Don't show items that were hidden by permissions
          listItem.style.display = 'none';
        } else {
          // Only filter by search query for allowed items
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
    
    console.log('[Sidebar] Initializing logout/login button');
    updateLogoutButton();
  }
  
  function updateLogoutButton() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) {
      console.warn('[Sidebar] Logout button not found for update');
      return;
    }
    
    // Check if user is authenticated
    const isAuthenticated = sessionStorage.getItem('access_token') || localStorage.getItem('access_token');
    
    // Remove existing event listeners by cloning the button
    const newLogoutBtn = logoutBtn.cloneNode(true);
    logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
    
    if (isAuthenticated) {
      // Show logout button for authenticated users
      newLogoutBtn.querySelector('.nav-label').textContent = 'Logout';
      newLogoutBtn.querySelector('.nav-icon').textContent = '🚪';
      newLogoutBtn.setAttribute('aria-label', 'Logout');
      
      newLogoutBtn.addEventListener('click', (e) => {
        console.log('[Sidebar] Logout button clicked');
        
        showLogoutConfirmation().then((confirmed) => {
          if (!confirmed) return;
          
          // Clear all authentication and user data
          // Remove access_token from both sessionStorage and localStorage
          sessionStorage.removeItem('access_token');
          localStorage.removeItem('access_token');
          
          // Remove user data
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem('allowed_tabs');
          
          // Clear any legacy auth tokens
          localStorage.removeItem('authToken');
          
          // Clear everything in sessionStorage to be safe
          sessionStorage.clear();
          
          console.log('[Sidebar] All auth data cleared, redirecting to home');
          
          // Redirect to home page instead of login
          window.location.href = '/home';
        });
      });
    } else {
      // Show login button for unauthenticated users
      newLogoutBtn.querySelector('.nav-label').textContent = 'Login';
      newLogoutBtn.querySelector('.nav-icon').textContent = '🔑';
      newLogoutBtn.setAttribute('aria-label', 'Login');
      
      newLogoutBtn.addEventListener('click', (e) => {
        console.log('[Sidebar] Login button clicked');
        
        // Navigate to login page
        if (window.navigate) {
          window.navigate('/login');
        } else {
          window.location.href = '/login';
        }
      });
    }
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
  
  function initLogoClick() {
    const logo = document.querySelector('.sidebar-logo');
    const logoContainer = document.querySelector('.logo-container');
    
    if (logoContainer) {
      logoContainer.style.cursor = 'pointer';
      logoContainer.addEventListener('click', () => {
        console.log('[Sidebar] Logo clicked, navigating to home');
        if (window.navigate) {
          window.navigate('/home');
        } else {
          window.location.href = '/home';
        }
      });
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
    initLogoClick();
    initMobileToggle();
    
    // Apply permission-based filtering to sidebar items
    // This ensures tabs the user doesn't have access to are hidden
    // and marked so the search won't reveal them
    try {
      if (window.filterSidebarByPermissions) {
        window.filterSidebarByPermissions();
      }
    } catch (e) {
      console.warn('[Sidebar] Could not apply permission filtering:', e);
    }
    
    console.log('[Sidebar] Initialized successfully');
  }
  
  // Export init function globally so it can be called after sidebar HTML is loaded
  window.initSidebar = init;
  
  // Export updateLogoutButton globally so it can be called after login
  window.updateSidebarLogoutButton = updateLogoutButton;
  
  // Auto-init if sidebar already exists in DOM
  if (document.getElementById('sidebar')) {
    init();
  }
})();
