// frontend/js/router.js
import { getApiUrl } from './config.js';
import { getToken, isAuthed } from './services/state/sessionStore.js';
import { setAllowedTabs } from './services/state/userStore.js';
import { wsService } from './services/websocket.js';
import { enforceRoutePermission, applyInnerTabPermissions, getDefaultAllowedPath } from './utils/tabs.js';

// Track the current module for cleanup
let currentModule = null;
let currentModulePath = null;
let currentRoutePath = null; // Track the actual current route including session URLs

// Sidebar update function (imported dynamically to avoid circular deps)
let updateSidebarStateFn = null;
async function getUpdateSidebarState() {
  if (!updateSidebarStateFn) {
    const shellUI = await import('./shell-ui.js');
    updateSidebarStateFn = shellUI.updateSidebarState;
  }
  return updateSidebarStateFn;
}

// Session auto-draft is now only driven by explicit unload/connection events.

/**
 * Update the browser URL and track the current route
 * This should be used instead of directly calling history.pushState/replaceState
 */
export function updateRoute(path, replace = false, state = {}) {
  if (replace) {
    history.replaceState({ ...state, path }, '', path);
  } else {
    history.pushState({ ...state, path }, '', path);
  }
  currentRoutePath = path;
}

// Check if we're navigating away from an active session
function checkSessionCleanup(oldPath, newPath) {
  // Check if we're leaving the order fulfillment module entirely
  const wasInOrderFulfillment = oldPath && oldPath.startsWith('/birmingham-orders/order-fulfillment');
  const stillInOrderFulfillment = newPath && newPath.startsWith('/birmingham-orders/order-fulfillment');
  
  // Only draft if we're leaving the order fulfillment module completely
  if (wasInOrderFulfillment && !stillInOrderFulfillment) {
    if (window.__currentMagentoSession) {
      saveSessionAsDraft(window.__currentMagentoSession);
      window.__currentMagentoSession = null;
    }
  }
}

const routes = {
  '/':                      '/html/home.html',
  '/home':                  '/html/home.html',
  '/login':                 '/html/login.html',
  
  // Attendance - redirect root to first sub-page (analytics)
  '/attendance':           '/html/attendance-system/dashboard.html',
  '/attendance/analytics': '/html/attendance-system/dashboard.html',
  '/attendance/staff':     '/html/attendance-system/employees.html',
  '/attendance/clocking':  '/html/attendance-system/automatic.html',
  '/attendance/timesheets':'/html/attendance-system/logs.html',

  // Labels - now under inventory
  '/inventory/labels':                '/html/labels/generator.html',
  '/inventory/labels/generator':      '/html/labels/generator.html',
  '/inventory/labels/history':        '/html/labels/history.html',

  // Sales Data - redirect root to first sub-page (All)
  '/sales':          '/html/magentodata/all-magento.html',
  '/sales/all':      '/html/magentodata/all-magento.html',
  '/sales/uk':       '/html/magentodata/uk-magento.html',
  '/sales/fr':       '/html/magentodata/fr-magento.html',
  '/sales/nl':       '/html/magentodata/nl-magento.html',
  '/sales/history':  '/html/magentodata/history.html',

  // Inventory - redirect root to first sub-page (management redirects to uk-birmingham)
  '/inventory':                                '/html/inventory/management/dashboard.html',
  '/inventory/management':                     '/html/inventory/management/dashboard.html',
  '/inventory/management/dashboard':           '/html/inventory/management/dashboard.html',
  '/inventory/management/uk-birmingham':       '/html/inventory/management/uk-birmingham.html',
  '/inventory/management/uk-london':           '/html/inventory/management/uk-london.html',
  '/inventory/management/fr-paris':            '/html/inventory/management/fr-paris.html',
  // /inventory/sourcing redirects to /inventory/sourcing/analysis-dashboard (handled in navigate())
  '/inventory/sourcing/analysis-dashboard': '/html/inventory/sourcing.html',
  '/inventory/sourcing/supplier-matrix':    '/html/inventory/sourcing.html',
  '/inventory/sourcing/suppliers':          '/html/inventory/sourcing.html',
  '/inventory/sourcing/fx-rates':           '/html/inventory/sourcing.html',
  
  // Birmingham Orders - UK Birmingham branch fulfillment
  '/birmingham-orders':                    '/html/birmingham-orders/order-fulfillment.html',
  '/birmingham-orders/order-fulfillment':  '/html/birmingham-orders/order-fulfillment.html',
  '/birmingham-orders/order-progress':     '/html/birmingham-orders/order-progress.html',
  '/birmingham-orders/order-tracking':     '/html/birmingham-orders/order-tracking.html',
  '/birmingham-orders/order-approval':     '/html/birmingham-orders/order-approval.html',
  
  // France Orders - FR/NL region fulfillment (shipped from Paris)
  '/france-orders':                    '/html/france-orders/order-fulfillment.html',
  '/france-orders/order-fulfillment':  '/html/france-orders/order-fulfillment.html',
  '/france-orders/order-progress':     '/html/france-orders/order-progress.html',
  '/france-orders/order-tracking':     '/html/france-orders/order-tracking.html',
  '/france-orders/order-approval':     '/html/france-orders/order-approval.html',
  
  // London Orders - UK London region fulfillment (London Office Collection)
  '/london-orders':                    '/html/london-orders/order-fulfillment.html',
  '/london-orders/order-fulfillment':  '/html/london-orders/order-fulfillment.html',
  '/london-orders/order-progress':     '/html/london-orders/order-progress.html',
  '/london-orders/order-tracking':     '/html/london-orders/order-tracking.html',
  '/london-orders/order-approval':     '/html/london-orders/order-approval.html',
  
  // Warehouse Operations - scanners and scanning logs
  '/operations/birmingham/scanner':       '/html/birmingham-orders/scanner.html',
  '/operations/birmingham/scanning-logs': '/html/birmingham-orders/scanning-logs.html',
  '/operations/france/scanner':           '/html/france-orders/scanner.html',
  '/operations/france/scanning-logs':     '/html/france-orders/scanning-logs.html',
  '/operations/london/scanner':           '/html/london-orders/scanner.html',
  '/operations/london/scanning-logs':     '/html/london-orders/scanning-logs.html',
  '/operations/scanning-logs-hub':        '/html/orders/scanning-logs-hub.html',
  
  // System - access control, appearance, tasks, health
  '/system':                    '/html/usermanagement/management.html',
  '/system/access-control':     '/html/usermanagement/management.html',
  '/system/appearance':         '/html/settings/appearance.html',
  '/system/tasks':              '/html/settings/tasks.html',
  '/system/health':             '/html/settings/system.html',
};

function shouldRedirectAfterAutoDraft(reason) {
  if (!reason) {
    return false;
  }

  const normalized = String(reason).toLowerCase();
  if (normalized === 'beforeunload' || normalized === 'pagehide') {
    return false;
  }

  if (normalized.startsWith('ws_')) {
    return true;
  }

  return normalized === 'offline' || normalized === 'freeze';
}

function redirectToOrderFulfillmentHome(reason) {
  const currentPath = currentRoutePath || window.location.pathname;
  if (!currentPath || !currentPath.startsWith('/birmingham-orders/order-fulfillment')) {
    return;
  }

  if (currentPath === '/birmingham-orders/order-fulfillment') {
    return;
  }

  navigate('/birmingham-orders/order-fulfillment', true);
}

/**
 * Generate tab structure dynamically from routes
 * Returns an object mapping section keys to their metadata and subtabs
 */
export function generateTabStructure() {
  const structure = {};
  
  // Map of section keys to their display labels
  const sectionLabels = {
    'attendance': 'Attendance',
    'enrollment': 'Enrollment',
    'sales': 'Sales Data',
    'inventory': 'Inventory',
    'operations': 'Warehouse Operations',
    'birmingham-orders': 'Birmingham Orders',
    'france-orders': 'France Orders',
    'london-orders': 'London Orders',
    'system': 'System'
  };
  
  // Map of subtab keys to their display labels
  const subtabLabels = {
    // Attendance
    'analytics': 'Analytics',
    'staff': 'Staff',
    'clocking': 'Clocking',
    'timesheets': 'Timesheets',
    // Enrollment
    'management': 'Management',
    'management-depth-test': 'Management Depth Test',
    'nfc': 'NFC',
    // Labels
    'generator': 'Generator',
    'history': 'History',
    // Inventory
    'sourcing': 'Product Sourcing',
    'labels': 'Labels',
    // Orders
    'order-fulfillment': 'Order Fulfillment',
    'order-progress': 'Order Progress',
    'order-tracking': 'Order Tracking',
    'order-approval': 'Order Approval',
    'fulfillment-design': 'Fulfillment Design',
    // Operations
    'birmingham': 'Birmingham',
    'france': 'France',
    'london': 'London',
    'scanning-logs-hub': 'Scanning Logs Hub',
    // Sales Data
    'all': 'All Regions',
    'uk': 'UK',
    'fr': 'France',
    'nl': 'Netherlands',
    // System
    'access-control': 'Access Control',
    'appearance': 'Appearance',
    'tasks': 'Task Automation',
    'health': 'System Health'
  };

  // Map of sub-page keys to their display labels (3rd level)
  const subpageLabels = {
    'dashboard': 'Dashboard',
    'uk-birmingham': 'Birmingham',
    'uk-london': 'London',
    'fr-paris': 'France',
    'analysis-dashboard': 'Analysis Dashboard',
    'supplier-matrix': 'Supplier Matrix',
    'suppliers': 'Suppliers',
    'fx-rates': 'FX Rates',
    'generator': 'Generator',
    'history': 'History',
    'scanner': 'Scanner',
    'scanning-logs': 'Scanning Logs'
  };
  
  // Parse routes to build structure
  Object.keys(routes).forEach(route => {
    // Skip login route
    if (route === '/login') return;
    
    const parts = route.split('/').filter(p => p);
    
    // We need at least one part (the section)
    if (parts.length === 0) return;
    
    const section = parts[0];
    const subtab = parts[1];
    const subpage = parts[2];
    
    // Initialize section if not exists
    if (!structure[section]) {
      structure[section] = {
        label: sectionLabels[section] || section.charAt(0).toUpperCase() + section.slice(1),
        subtabs: []
      };
    }
    
    // Add subtab if it exists and isn't 'home' and hasn't been added yet
    if (subtab && subtab !== 'home') {
      let subtabObj = structure[section].subtabs.find(st => st.key === subtab);
      if (!subtabObj) {
        subtabObj = {
          key: subtab,
          label: subtabLabels[subtab] || subtab.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          children: []
        };
        structure[section].subtabs.push(subtabObj);
      }

      // Add 3rd level sub-page if it exists
      if (subpage && subpage !== 'home') {
        const childExists = subtabObj.children.some(c => c.key === subpage);
        if (!childExists) {
          subtabObj.children.push({
            key: subpage,
            label: subpageLabels[subpage] || subpage.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          });
        }
      }
    }
  });
  
  return structure;
}

// Track loading start time for minimum display duration
let loadingStartTime = null;
const MIN_LOADING_DURATION = 400; // Minimum 400ms to ensure visibility

// Show loading overlay - returns a promise that resolves after the overlay is rendered
export function showLoading(message = 'Loading...') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('loadingOverlay');
    const msg = document.getElementById('loadingMessage');
    
    if (!overlay) {
      resolve();
      return;
    }
    
    loadingStartTime = Date.now();
    
    // Remove the hidden attribute and fading class
    overlay.removeAttribute('hidden');
    overlay.classList.remove('fading-out');
    
    // Explicitly set critical styles to guarantee visibility (except opacity - handled by CSS)
    overlay.style.display = '';
    overlay.style.visibility = 'visible';
    overlay.style.zIndex = '99998';
    overlay.style.pointerEvents = 'all';
    
    if (msg) msg.textContent = message;
    
    // Force browser to apply styles immediately
    void overlay.offsetHeight;
    
    // Use RAF to ensure paint before continuing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

// Hide loading overlay (with minimum display time and fade transition)
export function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  
  const elapsed = loadingStartTime ? Date.now() - loadingStartTime : MIN_LOADING_DURATION;
  const remaining = Math.max(0, MIN_LOADING_DURATION - elapsed);
  
  // Ensure overlay is visible for minimum duration, then fade out
  setTimeout(() => {
    // Add fading class to trigger CSS transition
    overlay.classList.add('fading-out');
    
    // Wait for transition to complete before fully hiding
    setTimeout(() => {
      overlay.setAttribute('hidden', 'true');
      overlay.style.display = 'none';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
      // Don't remove fading-out class here - leave for next showLoading to handle
      loadingStartTime = null;
    }, 500); // Match CSS transition duration
  }, remaining);
}

export async function navigate(path, replace = false) {
  try {
    // Check if we're leaving an active session
    const oldPath = currentRoutePath || window.location.pathname;
    checkSessionCleanup(oldPath, path);
    
    // Show loading overlay and wait for it to be visible
    await showLoading('Loading...');

    // Auth gate: everything except /login and /home requires a token
    if (path !== '/login' && path !== '/home' && path !== '/' && !isAuthed()) {
      path = '/home';
      replace = true;
    }

    // Permission gate: if not allowed, redirect to default allowed path
    if (path !== '/login' && path !== '/home' && path !== '/') {
      const perm = enforceRoutePermission(path);
      if (!perm.allowed && perm.redirect && perm.redirect !== path) {
        path = perm.redirect;
        replace = true;
      }
    }

    // Redirect bare sourcing path to default sub-tab
    if (path === '/inventory/sourcing') {
      return navigate('/inventory/sourcing/analysis-dashboard', true);
    }

    // Check if this is a session-specific URL and map to base template
    let url = routes[path];
    if (!url && path.match(/^\/birmingham-orders\/order-fulfillment\/session-/)) {
      // Session-specific URL, use the base Birmingham orders fulfillment template
      url = routes['/birmingham-orders/order-fulfillment'];
    }
    
    // Check if this is a France orders session-specific URL
    if (!url && path.match(/^\/france-orders\/order-fulfillment\/session-/)) {
      // Session-specific URL, use the base France orders fulfillment template
      url = routes['/france-orders/order-fulfillment'];
    }
    
    // Check if this is a London orders session-specific URL
    if (!url && path.match(/^\/london-orders\/order-fulfillment\/session-/)) {
      // Session-specific URL, use the base London orders fulfillment template
      url = routes['/london-orders/order-fulfillment'];
    }
    
    // Check if this is a sales data view-specific URL (full-data, 6-month, custom-range)
    // Use simple prefix matching instead of complex regex
    if (!url) {
      if (path.startsWith('/sales/all/')) {
        url = routes['/sales/all'];
        console.log(`[Router] Mapping ${path} to ${url} (region: all)`);
      } else if (path.startsWith('/sales/uk/')) {
        url = routes['/sales/uk'];
        console.log(`[Router] Mapping ${path} to ${url} (region: uk)`);
      } else if (path.startsWith('/sales/fr/')) {
        url = routes['/sales/fr'];
        console.log(`[Router] Mapping ${path} to ${url} (region: fr)`);
      } else if (path.startsWith('/sales/nl/')) {
        url = routes['/sales/nl'];
        console.log(`[Router] Mapping ${path} to ${url} (region: nl)`);
      }
    }
    
    if (!url) {
      console.warn('[Router] No route defined for:', path);
      console.warn('[Router] Available routes:', Object.keys(routes));
      // Fallback to default allowed path or login
      const fallbackPath = enforceRoutePermission(path).redirect || '/login';
      // Prevent infinite loop: only redirect if fallback exists and is different
      if (path !== fallbackPath && routes[fallbackPath]) {
        return navigate(fallbackPath, replace);
      }
      // If no valid fallback, go to login
      if (path !== '/login') {
        return navigate('/login', replace);
      }
      // Already at login but it doesn't exist - critical error
      throw new Error('Login route not configured');
    }

    // Fetch the HTML content
    const res = await fetch(url, { 
      credentials: 'same-origin',
      cache: 'no-cache' // Ensure we get fresh content 
    });
    
    if (!res.ok) {
      throw new Error(`Failed to load page: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    
    const view = document.querySelector('#view');
    if (view) {
      view.innerHTML = html;
      if (window.initModernUI) {
        window.initModernUI(view);
      }
      // Apply inner-tab permission filtering for the newly inserted content
      try { applyInnerTabPermissions(view); } catch (e) { console.error('[Router] applyInnerTabPermissions failed:', e); }

      // Execute any scripts inside the loaded view (required for inline page modules)
      const scripts = Array.from(view.querySelectorAll('script'));
      scripts.forEach((script) => {
        const newScript = document.createElement('script');
        if (script.type) newScript.type = script.type;
        if (script.src) {
          newScript.src = script.src;
        } else {
          newScript.textContent = script.textContent;
        }
        if (script.noModule) newScript.noModule = true;
        if (script.defer) newScript.defer = true;
        if (script.async) newScript.async = true;
        document.body.appendChild(newScript);
        script.remove();
      });
    }

    // Scroll to top when navigating to a new page
    window.scrollTo(0, 0);

    if (replace) {
      history.replaceState({ path }, '', path);
    } else {
      history.pushState({ path }, '', path);
    }
    
    // Track the current route path for session cleanup detection
    currentRoutePath = path;

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
      const tabName = path.split('/')[1] || 'home';
      const subPath = path.split('/')[2];
      
      // Always hide the header - user requested removal of main tab name display
      const header = pageTitle.closest('.header');
      if (header) {
        header.style.display = 'none';
      }
      
      // Map for proper title casing
      const titleMap = {
        'home': 'Home',
        'system': 'System',
        'sales': 'Sales Data',
        'attendance': 'Attendance',
        'enrollment': 'Enrollment',
        'labels': 'Labels',
        'inventory': 'Inventory',
        'login': 'Login'
      };
      pageTitle.textContent = titleMap[tabName] || tabName.charAt(0).toUpperCase() + tabName.slice(1);
    }

    // Lazy-load tab-specific JavaScript
    // First, cleanup the previous module if it exists and we're changing sections
    const newSection = path.split('/')[1];
    console.log('[Router] Section transition:', currentModulePath, '→', newSection);
    if (currentModule && currentModule.cleanup && currentModulePath !== newSection) {
      console.log('[Router] Calling cleanup() on previous module:', currentModulePath);
      try {
        await currentModule.cleanup();
        console.log('[Router] Cleanup completed for:', currentModulePath);
      } catch (e) {
        console.warn('[Router] Cleanup error:', e);
      }
      currentModule = null;
      currentModulePath = null;
    } else if (currentModulePath === newSection) {
      console.log('[Router] Same section, skipping cleanup');
    }
    
    // Cache-busting timestamp for module imports (ensures fresh versions after updates)
    const cacheBust = `?t=${Date.now()}`;
    
    if (path === '/login') {
      const mod = await import(`./modules/auth/login.js${cacheBust}`);
      await mod.init();
      currentModule = mod;
      currentModulePath = 'login';
    } else if (path === '/home' || path === '/') {
      const mod = await import(`./modules/home/index.js${cacheBust}`);
      await mod.init();
      currentModule = mod;
      currentModulePath = 'home';
    } else if (path.startsWith('/attendance')) {
      const mod = await import(`./modules/attendance-system/index.js${cacheBust}`);
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'attendance';
    } else if (path.startsWith('/sales')) {
      const mod = await import(`./modules/magentodata/index.js${cacheBust}`);
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'sales';
    } else if (path.startsWith('/inventory')) {
      // Labels sub-section under inventory
      if (path.startsWith('/inventory/labels')) {
        const mod = await import(`./modules/labels/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'inventory';
      } else {
        const mod = await import(`./modules/inventory/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'inventory';
      }
    } else if (path.startsWith('/operations')) {
      // Warehouse operations - route to the correct branch module
      if (path.startsWith('/operations/birmingham')) {
        const mod = await import(`./modules/birmingham-orders/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'operations';
      } else if (path.startsWith('/operations/france')) {
        const mod = await import(`./modules/france-orders/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'operations';
      } else if (path.startsWith('/operations/london')) {
        const mod = await import(`./modules/london-orders/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'operations';
      } else {
        // Scanning logs hub and other shared operations pages
        const mod = await import(`./modules/orders/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'operations';
      }
    } else if (path.startsWith('/birmingham-orders')) {
      const mod = await import(`./modules/birmingham-orders/index.js${cacheBust}`);
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'birmingham-orders';
    } else if (path.startsWith('/france-orders')) {
      const mod = await import(`./modules/france-orders/index.js${cacheBust}`);
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'france-orders';
    } else if (path.startsWith('/london-orders')) {
      const mod = await import(`./modules/london-orders/index.js${cacheBust}`);
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'london-orders';
    } else if (path.startsWith('/system')) {
      if (path === '/system/access-control' || path === '/system') {
        const mod = await import(`./modules/usermanagement/index.js${cacheBust}`);
        await mod.init(path);
        currentModule = mod;
        currentModulePath = 'system';
      }
      // appearance, tasks, health use inline <script> in their HTML — no module to load
    }

    // Highlight active nav item
    highlightActive(path);
    
    // Update sidebar state (show/hide based on route)
    try {
      const updateSidebar = await getUpdateSidebarState();
      if (updateSidebar) {
        updateSidebar(path);
      }
    } catch (err) {
      console.warn('[Router] Sidebar update error:', err);
    }

    // Success - hide loading overlay
    hideLoading();

  } catch (error) {
    console.error('[Router] Navigation error:', error);
    
    // Always hide the loading overlay on error
    hideLoading();
    
    // Show error message in the view
    const view = document.querySelector('#view');
    if (view) {
      view.innerHTML = `
        <div style="padding: 2rem; text-align: center;">
          <h2>Error Loading Page</h2>
          <p>${error.message}</p>
          <button class="modern-button" onclick="location.reload()">Reload</button>
        </div>
      `;
    }
    
    // If we're not on login and auth failed, redirect to login
    if (path !== '/login' && !isAuthed()) {
      setTimeout(() => navigate('/login', true), 1000);
    }
  }
}

export async function setupRouter() {
  // Expose navigate globally for navigation components
  window.navigate = navigate;
  
  // Setup session auto-drafting on page unload/close
  setupSessionAutoDraft();
  
  // Intercept clicks on <a data-nav href="/..."> and <button data-nav data-href="/...">
  document.addEventListener('click', (e) => {
    const navElement = e.target.closest('[data-nav]');
    if (!navElement) return;
    
    // Support both <a href="..."> and <button data-href="...">
    const href = navElement.getAttribute('href') || navElement.getAttribute('data-href');
    if (href?.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  });

  // Handle browser back/forward buttons
  window.addEventListener('popstate', (e) => {
    navigate(e.state?.path || location.pathname, true);
  });

  // Refresh allowed_tabs from server on every page load to prevent stale localStorage
  if (isAuthed()) {
    try {
      const { me } = await import('./services/api/authApi.js');
      const userData = await me();
      if (userData && Array.isArray(userData.allowed_tabs)) {
        setAllowedTabs(userData.allowed_tabs);
        console.log('[Router] Refreshed allowed_tabs from server:', userData.allowed_tabs);
      }
    } catch (e) {
      console.warn('[Router] Failed to refresh permissions from server:', e);
    }
  }

  // Determine initial route - use current path or home
  const currentPath = (location.pathname && location.pathname !== '/')
    ? location.pathname
    : '/home';
  
  // Navigate to initial route
  navigate(currentPath, true);
}

/**
 * Setup auto-drafting for sessions whenever the user abandons an active order.
 * Handles browser unload events, offline/connection loss, BFCache freezes, and
 * long-lived tab hides (with a grace window so quick tab switches stay safe).
 */
function setupSessionAutoDraft() {
  if (window.__sessionAutoDraftSetup) {
    return;
  }

  window.__sessionAutoDraftSetup = true;

  const ensureSessionDrafted = (reason) => {
    if (!window.__currentMagentoSession) {
      return;
    }

    const sessionId = window.__currentMagentoSession;
    window.__currentMagentoSession = null;

    saveSessionAsDraft(sessionId, reason);

    if (shouldRedirectAfterAutoDraft(reason)) {
      redirectToOrderFulfillmentHome(reason);
    }
  };

  window.addEventListener('beforeunload', () => ensureSessionDrafted('beforeunload'));

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) {
      // Browser is parking this page in BFCache; leave session intact so the user can resume
      return;
    }
    ensureSessionDrafted('pagehide');
  });

  document.addEventListener('freeze', () => ensureSessionDrafted('freeze'));
  window.addEventListener('offline', () => ensureSessionDrafted('offline'));

  wsService.on('disconnected', (payload) => {
    const reason = payload?.reason || 'socket_disconnect';
    ensureSessionDrafted(`ws_${reason}`);
  });
}

/**
 * Save session as draft via release endpoint
 */
function saveSessionAsDraft(sessionId, reason = 'unspecified') {
  if (!sessionId) return;
  
  const url = `${getApiUrl()}/v1/magento/sessions/${sessionId}/release`;
  const token = getToken();
  
  // Use fetch with keepalive flag to ensure request completes even during page unload
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({}),
    keepalive: true  // Critical: ensures request completes even during page unload
  }).then(response => {
    if (!response.ok) {
      console.error('[Router] Failed to save session draft:', response.status);
    }
  }).catch(error => {
    console.error('[Router] Error saving session draft:', error);
  });
}

function highlightActive(path) {
  // Highlight main tab
  const mainTab = path.split('/')[1];
  document.querySelectorAll('[data-nav]').forEach(a => {
    const href = a.getAttribute('href');
    const isActive = href === `/${mainTab}` || (href === path);
    a.parentElement?.classList.toggle('active', isActive);
  });
}
