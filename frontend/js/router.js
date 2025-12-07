// frontend/js/router.js
import { getApiUrl } from './config.js';
import { getToken, isAuthed } from './services/state/sessionStore.js';
import { wsService } from './services/websocket.js';
import { enforceRoutePermission, applyInnerTabPermissions, getDefaultAllowedPath } from './utils/tabs.js';

// Track the current module for cleanup
let currentModule = null;
let currentModulePath = null;
let currentRoutePath = null; // Track the actual current route including session URLs

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
  const wasInOrderFulfillment = oldPath && oldPath.startsWith('/orders/order-fulfillment');
  const stillInOrderFulfillment = newPath && newPath.startsWith('/orders/order-fulfillment');
  
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
  '/attendance':            '/html/attendance/home.html',
  '/attendance/overview':   '/html/attendance/overview.html',
  '/attendance/logs':       '/html/attendance/logs.html',
  '/attendance/manual':     '/html/attendance/manual.html',
  '/attendance/automatic':  '/html/attendance/automatic.html',

  '/enrollment':            '/html/enrollment/home.html',
  '/enrollment/management': '/html/enrollment/management.html',
  '/enrollment/card':       '/html/enrollment/nfc.html',
  '/enrollment/nfc':        '/html/enrollment/nfc.html',
  '/enrollment/fingerprint':'/html/enrollment/fingerprint.html',

  '/labels':                '/html/labels/home.html',
  '/labels/generator':      '/html/labels/generator.html',
  '/labels/history':        '/html/labels/history.html',

  '/salesdata':         '/html/salesdata/home.html',
  '/salesdata/uk-sales':'/html/salesdata/uk-sales.html',
  '/salesdata/fr-sales':'/html/salesdata/fr-sales.html',
  '/salesdata/nl-sales':'/html/salesdata/nl-sales.html',
  '/salesdata/upload':  '/html/salesdata/upload.html',
  '/salesdata/history': '/html/salesdata/history.html',

  '/magentodata':         '/html/magentodata/home.html',
  '/magentodata/uk-magento':'/html/magentodata/uk-magento.html',
  '/magentodata/fr-magento':'/html/magentodata/fr-magento.html',
  '/magentodata/nl-magento':'/html/magentodata/nl-magento.html',
  '/magentodata/test-magento':'/html/magentodata/test-magento.html',
  '/magentodata/history': '/html/magentodata/history.html',

  '/inventory':             '/html/inventory/home.html',
  '/inventory/management':  '/html/inventory/management.html',
  
  '/orders':                    '/html/orders/home.html',
  '/orders/order-fulfillment':  '/html/orders/order-fulfillment.html',
  '/orders/order-progress':     '/html/orders/order-progress.html',
  '/orders/order-tracking':     '/html/orders/order-tracking.html',
  '/orders/order-approval':     '/html/orders/order-approval.html',
  
  '/usermanagement':            '/html/usermanagement/home.html',
  '/usermanagement/management': '/html/usermanagement/management.html',
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
  if (!currentPath || !currentPath.startsWith('/orders/order-fulfillment')) {
    return;
  }

  if (currentPath === '/orders/order-fulfillment') {
    return;
  }

  navigate('/orders/order-fulfillment', true);
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
    'labels': 'Labels',
    'salesdata': 'Sales Data',
    'magentodata': 'Magento Data',
    'inventory': 'Inventory',
    'orders': 'Orders',
    'usermanagement': 'User Management'
  };
  
  // Map of subtab keys to their display labels
  const subtabLabels = {
    // Attendance
    'automatic': 'Automatic',
    'manual': 'Manual',
    'logs': 'Logs',
    'overview': 'Overview',
    // Enrollment
    'management': 'Management',
    'card': 'NFC',
    'nfc': 'NFC',
    'fingerprint': 'Fingerprint',
    // Labels
    'generator': 'Generator',
    'history': 'History',
    // Sales Data
    'uk-sales': 'UK Sales',
    'fr-sales': 'FR Sales',
    'nl-sales': 'NL Sales',
    'upload': 'Upload',
    // Inventory
    'management': 'Management',
    // Orders
    'order-fulfillment': 'Order Fulfillment',
    'order-progress': 'Order Progress'
  };
  
  // Parse routes to build structure
  Object.keys(routes).forEach(route => {
    // Skip root, home, and login routes
    if (route === '/' || route === '/home' || route === '/login') return;
    
    const parts = route.split('/').filter(p => p);
    
    // We need at least one part (the section)
    if (parts.length === 0) return;
    
    const section = parts[0];
    const subtab = parts[1];
    
    // Initialize section if not exists
    if (!structure[section]) {
      structure[section] = {
        label: sectionLabels[section] || section.charAt(0).toUpperCase() + section.slice(1),
        subtabs: []
      };
    }
    
    // Add subtab if it exists and isn't 'home' and hasn't been added yet
    if (subtab && subtab !== 'home') {
      const subtabExists = structure[section].subtabs.some(st => st.key === subtab);
      if (!subtabExists) {
        structure[section].subtabs.push({
          key: subtab,
          label: subtabLabels[subtab] || subtab.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        });
      }
    }
  });
  
  return structure;
}

// Show loading overlay
export function showLoading(message = 'Loading...') {
  const overlay = document.getElementById('loadingOverlay');
  const msg = document.getElementById('loadingMessage');
  if (overlay) {
    overlay.removeAttribute('hidden');
    overlay.style.display = 'flex'; // Make sure it's visible
    if (msg) msg.textContent = message;
  }
}

// Hide loading overlay
export function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.setAttribute('hidden', 'true');
    overlay.style.display = 'none';
  }
}

export async function navigate(path, replace = false) {
  try {
    // Check if we're leaving an active session
    const oldPath = currentRoutePath || window.location.pathname;
    checkSessionCleanup(oldPath, path);
    
    // Show loading overlay
    showLoading('Loading...');

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

    // Check if this is a session-specific URL and map to base template
    let url = routes[path];
    if (!url && path.match(/^\/orders\/order-fulfillment\/session-/)) {
      // Session-specific URL, use the base order fulfillment template
      url = routes['/orders/order-fulfillment'];
    }
    
    if (!url) {
      console.warn('[Router] No route defined for:', path);
      // Fallback to home page
      const fallbackPath = '/home';
      if (path !== fallbackPath) {
        return navigate(fallbackPath, replace);
      }
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
      try { applyInnerTabPermissions(view); } catch {}
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
        'usermanagement': 'User Management',
        'salesdata': 'Sales Data',
        'magentodata': 'Magento Data',
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
    if (currentModule && currentModule.cleanup && currentModulePath !== newSection) {
      try {
        currentModule.cleanup();
      } catch (e) {
        console.warn('[Router] Cleanup error:', e);
      }
      currentModule = null;
      currentModulePath = null;
    }
    
    if (path === '/login') {
      const mod = await import('./modules/auth/login.js');
      await mod.init();
      currentModule = mod;
      currentModulePath = 'login';
    } else if (path === '/home' || path === '/') {
      const mod = await import('./modules/home/index.js');
      await mod.init();
      currentModule = mod;
      currentModulePath = 'home';
    } else if (path.startsWith('/attendance')) {
      const mod = await import('./modules/attendance/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'attendance';
    } else if (path.startsWith('/enrollment')) {
      const mod = await import('./modules/enrollment/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'enrollment';
    } else if (path.startsWith('/labels')) {
      const mod = await import('./modules/labels/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'labels';
    } else if (path.startsWith('/salesdata')) {
      const mod = await import('./modules/salesdata/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'salesdata';
    } else if (path.startsWith('/magentodata')) {
      const mod = await import('./modules/magentodata/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'magentodata';
    } else if (path.startsWith('/inventory')) {
      const mod = await import('./modules/inventory/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'inventory';
    } else if (path.startsWith('/orders')) {
      const mod = await import('./modules/orders/index.js');
      await mod.init(path); // Pass full path for session URL detection
      currentModule = mod;
      currentModulePath = 'orders';
    } else if (path.startsWith('/usermanagement')) {
      const mod = await import('./modules/usermanagement/index.js');
      await mod.init(path);
      currentModule = mod;
      currentModulePath = 'usermanagement';
    }

    // Highlight active nav item
    highlightActive(path);

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

export function setupRouter() {
  // Expose navigate globally for components like the sidebar
  window.navigate = navigate;
  
  // Setup session auto-drafting on page unload/close
  setupSessionAutoDraft();
  
  // Intercept clicks on <a data-nav href="/...">
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href?.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  });

  // Handle browser back/forward buttons
  window.addEventListener('popstate', (e) => {
    navigate(e.state?.path || location.pathname, true);
  });

  // Determine initial route
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
  document.querySelectorAll('.sidebar a[data-nav]').forEach(a => {
    const href = a.getAttribute('href');
    const isActive = href === `/${mainTab}` || (href === path);
    a.parentElement?.classList.toggle('active', isActive);
  });
}
