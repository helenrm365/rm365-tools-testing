// frontend/js/ui/sidebar.js
// Multi-level sidebar navigation with state management
import { navigate } from '../router.js';
import { isAuthed } from '../services/state/sessionStore.js';
import { isAllowed } from '../utils/tabs.js';

/**
 * Sidebar State Machine
 * States: 'idle' | 'expanded' | 'subpanel-open'
 * 
 * Transitions:
 * - idle -> expanded (on hover)
 * - expanded -> subpanel-open (on tab group click)
 * - subpanel-open -> idle (on sub-tab click or mouse leave)
 * - expanded -> idle (on mouse leave without subpanel)
 */

// State
let sidebarState = 'idle';
let activeGroupId = null; // Currently expanded subpanel group
let currentRouteSection = null; // Section derived from current URL
let currentRouteSubSection = null; // Subsection derived from current URL
let mouseInSidebar = false;
let collapseTimeout = null;

// DOM Elements (cached)
let container = null;
let subpanel = null;
let subpanelNav = null;
let subpanelTitle = null;
let overlay = null;

// Navigation structure definition
// Maps group IDs to their child tabs
const navigationConfig = {
  'home': {
    label: 'Dashboard',
    icon: 'fa-solid fa-gauge-high',
    directLink: true,
    path: '/home'
  },
  'attendance-system': {
    label: 'Attendance',
    icon: 'fa-solid fa-clock',
    children: [
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-chart-pie', path: '/attendance-system/dashboard' },
      { id: 'employees', label: 'Employees', icon: 'fa-solid fa-users', path: '/attendance-system/employees' },
      { id: 'automatic', label: 'Automatic', icon: 'fa-solid fa-fingerprint', path: '/attendance-system/automatic' },
      { id: 'logs', label: 'Logs', icon: 'fa-solid fa-list', path: '/attendance-system/logs' }
    ]
  },
  'labels': {
    label: 'Labels',
    icon: 'fa-solid fa-tags',
    children: [
      { id: 'generator', label: 'Generator', icon: 'fa-solid fa-print', path: '/labels/generator' },
      { id: 'history', label: 'History', icon: 'fa-solid fa-history', path: '/labels/history' }
    ]
  },
  'magentodata': {
    label: 'Magento Data',
    icon: 'fa-solid fa-chart-line',
    children: [
      { id: 'uk-magento', label: 'UK Magento', icon: 'fa-solid fa-globe', path: '/magentodata/uk-magento' },
      { id: 'fr-magento', label: 'FR Magento', icon: 'fa-solid fa-globe', path: '/magentodata/fr-magento' },
      { id: 'nl-magento', label: 'NL Magento', icon: 'fa-solid fa-globe', path: '/magentodata/nl-magento' },
      { id: 'history', label: 'History', icon: 'fa-solid fa-history', path: '/magentodata/history' }
    ]
  },
  'inventory': {
    label: 'Inventory',
    icon: 'fa-solid fa-boxes-stacked',
    children: [
      { id: 'uk-birmingham', label: 'UK Birmingham', icon: 'fa-solid fa-warehouse', path: '/inventory/management/uk-birmingham' },
      { id: 'uk-london', label: 'UK London', icon: 'fa-solid fa-warehouse', path: '/inventory/management/uk-london' },
      { id: 'fr-paris', label: 'FR Paris', icon: 'fa-solid fa-warehouse', path: '/inventory/management/fr-paris' },
      { id: 'sourcing', label: 'Product Sourcing', icon: 'fa-solid fa-truck', path: '/inventory/sourcing' }
    ]
  },
  'birmingham-orders': {
    label: 'Birmingham Orders',
    icon: 'fa-solid fa-cart-shopping',
    children: [
      { id: 'order-fulfillment', label: 'Order Fulfillment', icon: 'fa-solid fa-box', path: '/birmingham-orders/order-fulfillment' },
      { id: 'order-progress', label: 'Order Progress', icon: 'fa-solid fa-tasks', path: '/birmingham-orders/order-progress' },
      { id: 'order-tracking', label: 'Order Tracking', icon: 'fa-solid fa-location-dot', path: '/birmingham-orders/order-tracking' },
      { id: 'order-approval', label: 'Order Approval', icon: 'fa-solid fa-check-circle', path: '/birmingham-orders/order-approval' }
    ]
  },
  'france-orders': {
    label: 'France Orders',
    icon: 'fa-solid fa-cart-shopping',
    children: [
      { id: 'order-fulfillment', label: 'Order Fulfillment', icon: 'fa-solid fa-box', path: '/france-orders/order-fulfillment' },
      { id: 'order-progress', label: 'Order Progress', icon: 'fa-solid fa-tasks', path: '/france-orders/order-progress' },
      { id: 'order-tracking', label: 'Order Tracking', icon: 'fa-solid fa-location-dot', path: '/france-orders/order-tracking' },
      { id: 'order-approval', label: 'Order Approval', icon: 'fa-solid fa-check-circle', path: '/france-orders/order-approval' }
    ]
  },
  'london-orders': {
    label: 'London Orders',
    icon: 'fa-solid fa-cart-shopping',
    children: [
      { id: 'order-fulfillment', label: 'Order Fulfillment', icon: 'fa-solid fa-box', path: '/london-orders/order-fulfillment' },
      { id: 'order-progress', label: 'Order Progress', icon: 'fa-solid fa-tasks', path: '/london-orders/order-progress' },
      { id: 'order-tracking', label: 'Order Tracking', icon: 'fa-solid fa-location-dot', path: '/london-orders/order-tracking' },
      { id: 'order-approval', label: 'Order Approval', icon: 'fa-solid fa-check-circle', path: '/london-orders/order-approval' }
    ]
  },
  'usermanagement': {
    label: 'User Management',
    icon: 'fa-solid fa-user-gear',
    children: [
      { id: 'management', label: 'User Management', icon: 'fa-solid fa-users-cog', path: '/usermanagement/management' }
    ]
  }
};

// Settings configuration (separate from main nav - shown in footer)
const settingsConfig = {
  label: 'Settings',
  icon: 'fa-solid fa-gear',
  children: [
    { id: 'appearance', label: 'Appearance', icon: 'fa-solid fa-palette', path: '/settings/appearance' },
    { id: 'tasks', label: 'Scheduler Tasks', icon: 'fa-solid fa-clock-rotate-left', path: '/settings/tasks' },
    { id: 'system', label: 'System', icon: 'fa-solid fa-server', path: '/settings/system' }
  ]
};

/**
 * Initialize the sidebar system
 */
export function initSidebar() {
  // Don't initialize if not authenticated
  if (!isAuthed()) {
    hideSidebar();
    return;
  }

  // Build sidebar HTML if not exists
  if (!document.querySelector('.sidebar-container')) {
    buildSidebarHTML();
  }

  // Cache DOM elements
  container = document.querySelector('.sidebar-container');
  subpanel = document.querySelector('.sidebar-subpanel');
  subpanelNav = document.querySelector('.subpanel-nav');
  subpanelTitle = document.querySelector('.subpanel-title');
  overlay = document.querySelector('.sidebar-overlay');

  if (!container) return;

  // Add has-sidebar class to body
  document.body.classList.add('has-sidebar');

  // Setup event listeners
  setupEventListeners();

  // Highlight current route
  highlightCurrentRoute();

  // Animate in
  setTimeout(() => {
    container.classList.add('animate-in');
  }, 100);
}

/**
 * Build the sidebar HTML structure
 */
function buildSidebarHTML() {
  const sidebarHTML = `
    <div class="sidebar-container">
      <nav class="sidebar-primary">
        <!-- Header / Logo -->
        <div class="sidebar-header">
          <img src="/assets/RM365_Logo_New.png" alt="RM365" class="sidebar-logo">
          <span class="sidebar-brand">RM365 Toolbox</span>
        </div>
        
        <!-- Navigation Items -->
        <div class="sidebar-nav" id="sidebarNav">
          ${buildNavigationItems()}
        </div>
        
        <!-- Footer -->
        <div class="sidebar-footer">
          <button class="sidebar-footer-item" id="sidebarSettings" data-tooltip="Settings">
            <span class="sidebar-item-icon"><i class="fa-solid fa-gear"></i></span>
            <span class="sidebar-footer-label">Settings</span>
          </button>
          <button class="sidebar-footer-item" id="sidebarThemeToggle" data-tooltip="Toggle Theme">
            <span class="sidebar-item-icon"><i class="fa-solid fa-moon"></i></span>
            <span class="sidebar-footer-label">Dark Mode</span>
          </button>
          <button class="sidebar-footer-item logout" id="sidebarLogout" data-tooltip="Logout">
            <span class="sidebar-item-icon"><i class="fa-solid fa-right-from-bracket"></i></span>
            <span class="sidebar-footer-label">Logout</span>
          </button>
        </div>
      </nav>
      
      <!-- Secondary Subpanel -->
      <div class="sidebar-subpanel">
        <div class="subpanel-header">
          <span class="subpanel-title">Menu</span>
          <button class="subpanel-close" aria-label="Close submenu">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="subpanel-nav" id="subpanelNav">
          <!-- Dynamically populated -->
        </div>
      </div>
    </div>
    
    <!-- Overlay for mobile and click-away -->
    <div class="sidebar-overlay"></div>
    
    <!-- Mobile toggle button -->
    <button class="sidebar-mobile-toggle" aria-label="Open menu">
      <i class="fa-solid fa-bars"></i>
    </button>
  `;

  // Insert at start of body
  document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
}

/**
 * Build navigation items HTML based on permissions
 */
function buildNavigationItems() {
  let html = '';

  for (const [groupId, config] of Object.entries(navigationConfig)) {
    // Check permissions
    if (!isAllowed(groupId)) continue;

    const isDirectLink = config.directLink === true;
    const directClass = isDirectLink ? 'direct-link' : '';
    const dataAttrs = isDirectLink 
      ? `data-path="${config.path}"` 
      : `data-group="${groupId}"`;

    html += `
      <button class="sidebar-item ${directClass}" ${dataAttrs} data-tooltip="${config.label}">
        <span class="sidebar-item-icon"><i class="${config.icon}"></i></span>
        <span class="sidebar-item-label">${config.label}</span>
        ${!isDirectLink ? '<i class="sidebar-item-chevron fa-solid fa-chevron-right"></i>' : ''}
      </button>
    `;
  }

  return html;
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  if (!container) return;

  // Mouse enter/leave for sidebar area
  container.addEventListener('mouseenter', handleMouseEnter);
  container.addEventListener('mouseleave', handleMouseLeave);

  // Tab group clicks
  container.querySelectorAll('.sidebar-item[data-group]').forEach(item => {
    item.addEventListener('click', handleGroupClick);
  });

  // Direct link clicks
  container.querySelectorAll('.sidebar-item[data-path]').forEach(item => {
    item.addEventListener('click', handleDirectLinkClick);
  });

  // Subpanel close button
  const closeBtn = container.querySelector('.subpanel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSubpanel);
  }

  // Theme toggle
  const themeToggle = document.getElementById('sidebarThemeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
    updateThemeIcon();
  }

  // Logout
  const logoutBtn = document.getElementById('sidebarLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  // Settings button - opens subpanel with settings links
  const settingsBtn = document.getElementById('sidebarSettings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', handleSettingsClick);
  }

  // Overlay click
  if (overlay) {
    overlay.addEventListener('click', collapseSidebar);
  }

  // Mobile toggle
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', toggleMobileSidebar);
  }

  // Listen for route changes to update highlight
  window.addEventListener('popstate', highlightCurrentRoute);
}

/**
 * Handle mouse entering sidebar area
 */
function handleMouseEnter() {
  clearTimeout(collapseTimeout);
  mouseInSidebar = true;
  
  if (sidebarState === 'idle') {
    setState('expanded');
  }
}

/**
 * Handle mouse leaving sidebar area
 */
function handleMouseLeave() {
  mouseInSidebar = false;
  
  // Delay collapse to prevent flicker when moving between panels
  collapseTimeout = setTimeout(() => {
    if (!mouseInSidebar) {
      collapseSidebar();
    }
  }, 150);
}

/**
 * Handle click on a tab group (has children)
 */
function handleGroupClick(e) {
  const groupId = e.currentTarget.dataset.group;
  
  if (activeGroupId === groupId && sidebarState === 'subpanel-open') {
    // Clicking same group - close subpanel
    closeSubpanel();
  } else {
    // Open subpanel with this group's children
    openSubpanel(groupId);
  }
}

/**
 * Handle click on a direct link (no children)
 */
function handleDirectLinkClick(e) {
  const path = e.currentTarget.dataset.path;
  if (path) {
    collapseSidebar();
    navigate(path);
  }
}

/**
 * Open the subpanel with children of given group
 */
function openSubpanel(groupId) {
  const config = navigationConfig[groupId];
  if (!config || !config.children) return;

  activeGroupId = groupId;

  // Update subpanel title
  if (subpanelTitle) {
    subpanelTitle.textContent = config.label;
  }

  // Build subpanel links
  if (subpanelNav) {
    const currentPath = window.location.pathname;
    let html = '';
    for (const child of config.children) {
      // Check permissions for child
      const permKey = `${groupId}.${child.id}`;
      if (!isAllowed(permKey)) continue;
      
      // Check if this link is active
      const isActive = currentPath === child.path || currentPath.startsWith(child.path + '/');
      const activeClass = isActive ? 'active' : '';

      html += `
        <button class="subpanel-link ${activeClass}" data-path="${child.path}">
          <span class="subpanel-link-icon"><i class="${child.icon}"></i></span>
          <span>${child.label}</span>
        </button>
      `;
    }
    subpanelNav.innerHTML = html;

    // Attach click handlers
    subpanelNav.querySelectorAll('.subpanel-link').forEach(link => {
      link.addEventListener('click', handleSubpanelLinkClick);
    });
  }

  // Update subpanel-active class on primary nav items
  updateSubpanelActiveState(groupId);

  // Set state
  setState('subpanel-open');
}

/**
 * Close the subpanel
 */
function closeSubpanel() {
  activeGroupId = null;
  setState('expanded');
  
  // Remove subpanel-active class from all items
  container?.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('subpanel-active');
  });
  
  // Remove active from settings button
  const settingsBtn = document.getElementById('sidebarSettings');
  if (settingsBtn) {
    settingsBtn.classList.remove('active');
  }
  
  // Re-highlight based on current route (restores 'active' class)
  highlightCurrentRoute();
}

/**
 * Handle click on a subpanel link
 */
function handleSubpanelLinkClick(e) {
  const path = e.currentTarget.dataset.path;
  if (path) {
    // Collapse everything and navigate
    collapseSidebar();
    navigate(path);
  }
}

/**
 * Fully collapse sidebar to icon rail
 */
function collapseSidebar() {
  activeGroupId = null;
  setState('idle');
  
  // Close mobile sidebar
  container?.classList.remove('mobile-open');
  
  // Reset hamburger icon
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle i');
  if (mobileToggle) {
    mobileToggle.classList.remove('fa-xmark');
    mobileToggle.classList.add('fa-bars');
  }
  
  // Remove subpanel-active from all items
  container?.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('subpanel-active');
  });
  
  // Remove active from settings button
  const settingsBtn = document.getElementById('sidebarSettings');
  if (settingsBtn) {
    settingsBtn.classList.remove('active');
  }
  
  // Re-highlight based on current route
  setTimeout(highlightCurrentRoute, 50);
}

/**
 * Set sidebar state and update CSS classes
 */
function setState(newState) {
  sidebarState = newState;
  
  if (!container) return;

  // Remove all state classes
  container.classList.remove('expanded', 'subpanel-open');

  // Add appropriate class
  if (newState === 'expanded') {
    container.classList.add('expanded');
  } else if (newState === 'subpanel-open') {
    container.classList.add('expanded', 'subpanel-open');
  }
}

/**
 * Update which group has its subpanel open (adds subpanel-active class)
 * This is separate from the route-based 'active' class
 */
function updateSubpanelActiveState(groupId) {
  if (!container) return;

  container.querySelectorAll('.sidebar-item[data-group]').forEach(item => {
    const isSubpanelActive = item.dataset.group === groupId;
    item.classList.toggle('subpanel-active', isSubpanelActive);
  });
}

/**
 * Highlight navigation based on current route
 * - 'active' class: Shows which section/item corresponds to current URL
 * - 'subpanel-active' class: Shows which group's subpanel is currently open
 */
export function highlightCurrentRoute() {
  const currentPath = window.location.pathname;
  
  if (!container) return;

  // Get the section from path (e.g., /attendance-system/logs -> attendance-system)
  const parts = currentPath.split('/').filter(p => p);
  currentRouteSection = parts[0] || 'home';
  currentRouteSubSection = parts[1] || '';

  // Highlight primary nav item based on current route
  container.querySelectorAll('.sidebar-item').forEach(item => {
    const groupId = item.dataset.group;
    const path = item.dataset.path;
    
    let isActive = false;
    if (path) {
      // Direct link - exact match or home match
      isActive = currentPath === path || (path === '/home' && currentPath === '/');
    } else if (groupId) {
      // Group - check if current section matches
      isActive = currentRouteSection === groupId;
    }
    
    // Set active class (route-based)
    item.classList.toggle('active', isActive);
  });

  // Highlight subpanel links if subpanel is open
  if (subpanelNav && sidebarState === 'subpanel-open') {
    subpanelNav.querySelectorAll('.subpanel-link').forEach(link => {
      const linkPath = link.dataset.path;
      const isActive = currentPath === linkPath || currentPath.startsWith(linkPath + '/');
      link.classList.toggle('active', isActive);
    });
  }
}

/**
 * Toggle dark/light theme
 */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark);
  updateThemeIcon();
}

/**
 * Update theme toggle icon
 */
function updateThemeIcon() {
  const themeToggle = document.getElementById('sidebarThemeToggle');
  if (!themeToggle) return;

  const isDark = document.documentElement.classList.contains('dark-mode');
  const icon = themeToggle.querySelector('i');
  const label = themeToggle.querySelector('.sidebar-footer-label');
  
  if (icon) {
    icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
  if (label) {
    label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  }
  
  // Also update settings panel toggle if it exists
  const settingsToggle = document.getElementById('settingsThemeToggle');
  if (settingsToggle) {
    settingsToggle.checked = isDark;
  }
}

// ===== SETTINGS FUNCTIONS =====

/**
 * Handle settings button click - opens subpanel with settings links
 */
function handleSettingsClick() {
  if (activeGroupId === 'settings' && sidebarState === 'subpanel-open') {
    // Clicking settings again - close subpanel
    closeSubpanel();
  } else {
    // Open subpanel with settings links
    openSettingsSubpanel();
  }
}

/**
 * Open the settings subpanel (uses same subpanel as navigation)
 */
function openSettingsSubpanel() {
  activeGroupId = 'settings';

  // Update subpanel title
  if (subpanelTitle) {
    subpanelTitle.textContent = settingsConfig.label;
  }

  // Build subpanel links
  if (subpanelNav) {
    const currentPath = window.location.pathname;
    let html = '';
    for (const child of settingsConfig.children) {
      // Check if this link is active
      const isActive = currentPath === child.path || currentPath.startsWith(child.path + '/');
      const activeClass = isActive ? 'active' : '';

      html += `
        <button class="subpanel-link ${activeClass}" data-path="${child.path}">
          <span class="subpanel-link-icon"><i class="${child.icon}"></i></span>
          <span>${child.label}</span>
        </button>
      `;
    }
    subpanelNav.innerHTML = html;

    // Attach click handlers
    subpanelNav.querySelectorAll('.subpanel-link').forEach(link => {
      link.addEventListener('click', handleSubpanelLinkClick);
    });
  }

  // Highlight settings button
  const settingsBtn = document.getElementById('sidebarSettings');
  if (settingsBtn) {
    settingsBtn.classList.add('active');
  }

  // Set state
  setState('subpanel-open');
}

/**
 * Show logout confirmation modal
 */
function showLogoutConfirmModal() {
  // Remove existing modal if any
  const existingModal = document.getElementById('logoutConfirmModal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal HTML
  const modalHTML = `
    <div id="logoutConfirmModal" class="modal-backdrop">
      <div class="modal modal-sm">
        <div class="modal-header modal-header-warning">
          <div class="modal-header-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </div>
          <h3 class="modal-title">Confirm Logout</h3>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to log out? You will need to sign in again to access the dashboard.</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="action-btn secondary-btn" id="logoutCancelBtn">Cancel</button>
          <button type="button" class="action-btn danger-btn" id="logoutConfirmBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Logout
          </button>
        </div>
      </div>
    </div>
  `;

  // Insert modal into DOM
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modal = document.getElementById('logoutConfirmModal');
  const cancelBtn = document.getElementById('logoutCancelBtn');
  const confirmBtn = document.getElementById('logoutConfirmBtn');

  // Show modal with animation
  requestAnimationFrame(() => {
    modal.classList.add('active');
  });

  // Cancel button handler
  cancelBtn.addEventListener('click', () => {
    closeLogoutModal();
  });

  // Confirm button handler
  confirmBtn.addEventListener('click', async () => {
    closeLogoutModal();
    await performLogout();
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeLogoutModal();
    }
  });

  // ESC key to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeLogoutModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/**
 * Close logout modal
 */
function closeLogoutModal() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 300);
  }
}

/**
 * Perform the actual logout
 */
async function performLogout() {
  const { clearToken } = await import('../services/state/sessionStore.js');
  const { clearUser } = await import('../services/state/userStore.js');
  
  clearToken();
  clearUser();
  hideSidebar();
  navigate('/login');
}

/**
 * Handle logout button click - shows confirmation modal
 */
async function handleLogout() {
  showLogoutConfirmModal();
}

/**
 * Toggle mobile sidebar
 */
function toggleMobileSidebar() {
  console.log('[Sidebar Debug] Container:', container);
  console.log('[Sidebar Debug] Has mobile-open before toggle:', container?.classList.contains('mobile-open'));
  
  const isOpen = container?.classList.toggle('mobile-open');
  
  console.log('[Sidebar Debug] Has mobile-open after toggle:', isOpen);
  console.log('[Sidebar Debug] Container classList:', container?.classList.toString());
  
  // Update hamburger icon
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle i');
  if (mobileToggle) {
    if (isOpen) {
      mobileToggle.classList.remove('fa-bars');
      mobileToggle.classList.add('fa-xmark');
    } else {
      mobileToggle.classList.remove('fa-xmark');
      mobileToggle.classList.add('fa-bars');
    }
  }
}

/**
 * Show sidebar
 */
export function showSidebar() {
  if (!isAuthed()) return;
  
  if (!document.querySelector('.sidebar-container')) {
    initSidebar();
  }
  
  document.body.classList.add('has-sidebar');
  const container = document.querySelector('.sidebar-container');
  if (container) {
    container.style.display = '';
  }
  
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle');
  if (mobileToggle) {
    mobileToggle.style.display = '';
  }
  
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) {
    overlay.style.display = '';
  }
}

/**
 * Hide sidebar (for login page, etc.)
 */
export function hideSidebar() {
  document.body.classList.remove('has-sidebar');
  
  const container = document.querySelector('.sidebar-container');
  if (container) {
    container.style.display = 'none';
  }
  
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle');
  if (mobileToggle) {
    mobileToggle.style.display = 'none';
  }
  
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * Destroy sidebar (cleanup)
 */
export function destroySidebar() {
  const container = document.querySelector('.sidebar-container');
  const overlay = document.querySelector('.sidebar-overlay');
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle');
  
  container?.remove();
  overlay?.remove();
  mobileToggle?.remove();
  
  document.body.classList.remove('has-sidebar');
}

/**
 * Refresh sidebar (e.g., after permission changes)
 */
export function refreshSidebar() {
  destroySidebar();
  initSidebar();
}

// Export for external use
export { navigationConfig };
