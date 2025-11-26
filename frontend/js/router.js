// frontend/js/router.js
import { isAuthed } from './services/state/sessionStore.js';
import { enforceRoutePermission, applyInnerTabPermissions, getDefaultAllowedPath } from './utils/tabs.js';

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
  '/enrollment/card':       '/html/enrollment/card.html',
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

  '/inventory':             '/html/inventory/home.html',
  '/inventory/management':  '/html/inventory/management.html',
  '/inventory/adjustments': '/html/inventory/adjustments.html',
  '/inventory/magento':     '/html/inventory/magento.html',
  '/inventory/order-progress': '/html/inventory/order-progress.html',
  
  '/usermanagement':            '/html/usermanagement/home.html',
  '/usermanagement/management': '/html/usermanagement/management.html',
};

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
    'inventory': 'Inventory',
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
    'card': 'Card',
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
    'adjustments': 'Adjustments',
    'magento': 'Pick & Pack',
    'order-progress': 'Order Progress'
  };
  
  console.log('[generateTabStructure] Starting with routes:', routes);
  
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
  
  console.log('[generateTabStructure] Generated structure:', structure);
  
  return structure;
}

// Show loading overlay
function showLoading(message = 'Loading...') {
  const overlay = document.getElementById('loadingOverlay');
  const msg = document.getElementById('loadingMessage');
  if (overlay) {
    overlay.removeAttribute('hidden');
    overlay.style.display = 'flex'; // Make sure it's visible
    if (msg) msg.textContent = message;
  }
}

// Hide loading overlay
function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.setAttribute('hidden', 'true');
    overlay.style.display = 'none';
  }
}

export async function navigate(path, replace = false) {
  console.log('[Router] Navigating to:', path, { replace });
  
  try {
    // Show loading overlay
    showLoading('Loading...');

    // Auth gate: everything except /login and /home requires a token
    if (path !== '/login' && path !== '/home' && path !== '/' && !isAuthed()) {
      console.log('[Router] Not authenticated, redirecting to home');
      path = '/home';
      replace = true;
    }

    // Permission gate: if not allowed, redirect to default allowed path
    if (path !== '/login' && path !== '/home' && path !== '/') {
      const perm = enforceRoutePermission(path);
      if (!perm.allowed && perm.redirect && perm.redirect !== path) {
        console.log('[Router] Not allowed, redirecting to:', perm.redirect);
        path = perm.redirect;
        replace = true;
      }
    }

    const url = routes[path];
    if (!url) {
      console.warn('[Router] No route defined for:', path);
      // Fallback to home page
      const fallbackPath = '/home';
      if (path !== fallbackPath) {
        console.log('[Router] Using fallback path:', fallbackPath);
        return navigate(fallbackPath, replace);
      }
    }

    // Fetch the HTML content
    console.log('[Router] Fetching:', url);
    const res = await fetch(url, { 
      credentials: 'same-origin',
      cache: 'no-cache' // Ensure we get fresh content 
    });
    
    if (!res.ok) {
      throw new Error(`Failed to load page: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    
    // Check if we got empty content
    if (!html || html.trim().length === 0) {
      console.warn('[Router] Empty HTML received for:', url);
      // For login page, we need actual content
      if (path === '/login') {
        console.error('[Router] Login page is empty! This will prevent login.');
      }
    }

    const view = document.querySelector('#view');
    if (view) {
      view.innerHTML = html;
      if (window.initModernUI) {
        window.initModernUI(view);
      }
      // Apply inner-tab permission filtering for the newly inserted content
      try { applyInnerTabPermissions(view); } catch {}
    }

    if (replace) {
      history.replaceState({ path }, '', path);
    } else {
      history.pushState({ path }, '', path);
    }

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
      const tabName = path.split('/')[1] || 'home';
      const subPath = path.split('/')[2];
      
      // Hide header on home pages (no subpath or subpath is 'home' or path is root)
      const header = pageTitle.closest('.header');
      if (header) {
        if (!subPath || subPath === 'home' || path === '/' || path === '/home') {
          header.style.display = 'none';
        } else {
          header.style.display = '';
        }
      }
      
      // Map for proper title casing
      const titleMap = {
        'home': 'Home',
        'usermanagement': 'User Management',
        'salesdata': 'Sales Data',
        'attendance': 'Attendance',
        'enrollment': 'Enrollment',
        'labels': 'Labels',
        'inventory': 'Inventory',
        'login': 'Login'
      };
      pageTitle.textContent = titleMap[tabName] || tabName.charAt(0).toUpperCase() + tabName.slice(1);
    }

    // Lazy-load tab-specific JavaScript
    if (path === '/login') {
      const mod = await import('./modules/auth/login.js');
      await mod.init();
    } else if (path === '/home' || path === '/') {
      const mod = await import('./modules/home/index.js');
      await mod.init();
    } else if (path.startsWith('/attendance')) {
      try {
        const mod = await import('./modules/attendance/index.js');
        await mod.init(path);
      } catch (e) {
        console.warn('[Router] Attendance module not implemented yet:', e);
      }
    } else if (path.startsWith('/enrollment')) {
      try {
        const mod = await import('./modules/enrollment/index.js');
        await mod.init(path);
      } catch (e) {
        console.warn('[Router] Enrollment module error:', e);
      }
    } else if (path.startsWith('/labels')) {
      try {
        const mod = await import('./modules/labels/index.js');
        await mod.init(path);
      } catch (e) {
        console.warn('[Router] Labels module error:', e);
      }
    } else if (path.startsWith('/salesdata')) {
      try {
        const mod = await import('./modules/salesdata/index.js');
        await mod.init(path);
      } catch (e) {
        console.warn('[Router] Sales data module error:', e);
      }
    } else if (path.startsWith('/inventory')) {
      try {
        const mod = await import('./modules/inventory/index.js');
        await mod.init(path);
      } catch (e) {
        console.warn('[Router] Inventory module error:', e);
      }
    } else if (path.startsWith('/usermanagement')) {
      try {
        const mod = await import('./modules/usermanagement/index.js');
        await mod.init(path);
      } catch (e) {
        console.warn('[Router] User management module error:', e);
      }
    }

    // Highlight active nav item
    highlightActive(path);

    // Success - hide loading overlay
    console.log('[Router] Navigation complete');
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
  console.log('[Router] Setting up router');
  
  // Expose navigate globally for components like the sidebar
  window.navigate = navigate;
  
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
  
  console.log('[Router] Initial route:', currentPath);
  
  // Navigate to initial route
  navigate(currentPath, true);
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
