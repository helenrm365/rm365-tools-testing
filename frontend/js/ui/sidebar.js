// frontend/js/ui/sidebar.js
// Multi-level sidebar navigation with state management
import { navigate } from '../router.js';
import { isAuthed } from '../services/state/sessionStore.js';
import { isAllowed } from '../utils/tabs.js';

/**
 * Sidebar State Machine
 * States: 'idle' | 'expanded'
 * 
 * Transitions:
 * - idle -> expanded (on hover)
 * - expanded -> idle (on mouse leave)
 * 
 * Dropdown state is tracked per-group via CSS class 'dropdown-open' on .sidebar-group
 */

// State
let sidebarState = 'idle';
let activeGroupId = null; // Currently expanded dropdown group
let mouseInSidebar = false;
let collapseTimeout = null;

// DOM Elements (cached)
let container = null;
let overlay = null;

// Navigation structure definition
// Maps group IDs to their child tabs
const navigationConfig = {
  'general': {
    label: 'General',
    icon: 'fa-solid fa-house',
    children: [
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge-high', path: '/home' }
    ]
  },
  'attendance': {
    label: 'Attendance (HR)',
    icon: 'fa-solid fa-clock',
    children: [
      { id: 'analytics', label: 'Analytics', icon: 'fa-solid fa-chart-pie', path: '/attendance/analytics' },
      { id: 'staff', label: 'Staff Directory', icon: 'fa-solid fa-users', path: '/attendance/staff' },
      { id: 'clocking', label: 'NFC Clocking Terminal', icon: 'fa-solid fa-fingerprint', path: '/attendance/clocking' },
      { id: 'timesheets', label: 'Timesheets & Logs', icon: 'fa-solid fa-list', path: '/attendance/timesheets' }
    ]
  },
  'inventory': {
    label: 'Inventory & Sourcing',
    icon: 'fa-solid fa-boxes-stacked',
    children: [
      { id: 'dashboard', label: 'Inventory', icon: 'fa-solid fa-warehouse', path: '/inventory/management/dashboard' },
      { id: 'sourcing', label: 'Sourcing & Suppliers', icon: 'fa-solid fa-truck', path: '/inventory/sourcing/analysis-dashboard' },
      { id: 'labels', label: 'Label Printing', icon: 'fa-solid fa-print', path: '/labels/generator' }
    ]
  },
  'warehouse': {
    label: 'Warehouse Operations',
    icon: 'fa-solid fa-cart-shopping',
    children: [
      { id: 'birmingham-scanner', label: 'Birmingham Scanner', icon: 'fa-solid fa-barcode', path: '/birmingham-orders/scanner' },
      { id: 'france-scanner', label: 'France Scanner', icon: 'fa-solid fa-barcode', path: '/france-orders/scanner' },
      { id: 'london-scanner', label: 'London Scanner', icon: 'fa-solid fa-barcode', path: '/london-orders/scanner' },
      { id: 'scanning-logs', label: 'Scanning Logs', icon: 'fa-solid fa-history', path: '/orders/scanning-logs-hub' }
    ]
  },
  'sales': {
    label: 'Sales Data',
    icon: 'fa-solid fa-chart-line',
    children: [
      { id: 'reports', label: 'Sales Reports', icon: 'fa-solid fa-globe-americas', path: '/magentodata/all-magento' },
      { id: 'history', label: 'Import History', icon: 'fa-solid fa-history', path: '/magentodata/history' }
    ]
  },
  'system': {
    label: 'System',
    icon: 'fa-solid fa-gear',
    children: [
      { id: 'access-control', label: 'Access Control', icon: 'fa-solid fa-users-cog', path: '/usermanagement/management' },
      { id: 'appearance', label: 'Appearance', icon: 'fa-solid fa-palette', path: '/settings/appearance' },
      { id: 'tasks', label: 'Task Automation', icon: 'fa-solid fa-clock-rotate-left', path: '/settings/tasks' },
      { id: 'health', label: 'System Health', icon: 'fa-solid fa-server', path: '/settings/system' }
    ]
  }
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

    // Build dropdown children
    let childHtml = '';
    for (const child of config.children) {
      const permKey = `${groupId}.${child.id}`;
      if (!isAllowed(permKey)) continue;
      childHtml += `
        <button class="sidebar-dropdown-link" data-path="${child.path}">
          <span class="sidebar-dropdown-link-icon"><i class="${child.icon}"></i></span>
          <span>${child.label}</span>
        </button>
      `;
    }

    html += `
      <div class="sidebar-group" data-group-id="${groupId}">
        <button class="sidebar-item" data-group="${groupId}" data-tooltip="${config.label}">
          <span class="sidebar-item-icon"><i class="${config.icon}"></i></span>
          <span class="sidebar-item-label">${config.label}</span>
          <i class="sidebar-item-chevron fa-solid fa-chevron-down"></i>
        </button>
        <div class="sidebar-dropdown">
          <div class="sidebar-dropdown-inner">
            ${childHtml}
          </div>
        </div>
      </div>
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

  // Dropdown link clicks
  container.querySelectorAll('.sidebar-dropdown-link').forEach(link => {
    link.addEventListener('click', handleDropdownLinkClick);
  });

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
 * Handle click on a tab group (has children) - toggles inline dropdown
 */
function handleGroupClick(e) {
  const groupId = e.currentTarget.dataset.group;
  toggleDropdown(groupId);
}

/**
 * Toggle dropdown for a navigation group
 */
function toggleDropdown(groupId) {
  const groupEl = container?.querySelector(`.sidebar-group[data-group-id="${groupId}"]`);
  if (!groupEl) return;

  const isOpen = groupEl.classList.contains('dropdown-open');

  // Close all other dropdowns (including settings)
  closeAllDropdowns();

  if (!isOpen) {
    // Open this dropdown
    groupEl.classList.add('dropdown-open');
    activeGroupId = groupId;

    // Add subpanel-active class to the sidebar-item for chevron styling
    const itemEl = groupEl.querySelector('.sidebar-item');
    if (itemEl) itemEl.classList.add('subpanel-active');
  } else {
    activeGroupId = null;
  }
}

/**
 * Close all open dropdowns
 */
function closeAllDropdowns() {
  if (!container) return;

  container.querySelectorAll('.sidebar-group.dropdown-open').forEach(group => {
    group.classList.remove('dropdown-open');
  });

  container.querySelectorAll('.sidebar-item.subpanel-active').forEach(item => {
    item.classList.remove('subpanel-active');
  });

  activeGroupId = null;
}

/**
 * Handle click on a dropdown link
 */
function handleDropdownLinkClick(e) {
  const path = e.currentTarget.dataset.path;
  if (path) {
    collapseSidebar();
    navigate(path);
  }
}

/**
 * Fully collapse sidebar to icon rail
 */
function collapseSidebar() {
  // Close all dropdowns
  closeAllDropdowns();
  
  setState('idle');
  
  // Close mobile sidebar
  container?.classList.remove('mobile-open');
  
  // Reset hamburger icon
  const mobileToggle = document.querySelector('.sidebar-mobile-toggle i');
  if (mobileToggle) {
    mobileToggle.classList.remove('fa-xmark');
    mobileToggle.classList.add('fa-bars');
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
  container.classList.remove('expanded');

  // Add appropriate class
  if (newState === 'expanded') {
    container.classList.add('expanded');
  }
}

/**
 * Highlight navigation based on current route
 * - 'active' class on sidebar-item: Shows which group contains the current page
 * - 'active' class on dropdown-link: Shows the exact current page
 */
export function highlightCurrentRoute() {
  const currentPath = window.location.pathname;
  
  if (!container) return;

  // Highlight primary nav groups by checking if any child path matches
  container.querySelectorAll('.sidebar-item[data-group]').forEach(item => {
    const groupId = item.dataset.group;
    const config = navigationConfig[groupId];
    let isActive = false;

    if (config?.children) {
      isActive = config.children.some(child =>
        currentPath === child.path || currentPath.startsWith(child.path + '/')
      );
    }

    item.classList.toggle('active', isActive);
  });

  // Highlight dropdown links
  container.querySelectorAll('.sidebar-dropdown-link').forEach(link => {
    const linkPath = link.dataset.path;
    const isActive = currentPath === linkPath || currentPath.startsWith(linkPath + '/');
    link.classList.toggle('active', isActive);
  });
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
