// frontend/js/router.js
import { isAuthed } from './services/state/sessionStore.js';
import { enforceRoutePermission, applyInnerTabPermissions, getDefaultAllowedPath } from './utils/tabs.js';

const routes = {
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
  
  '/usermanagement':            '/html/usermanagement/home.html',
  '/usermanagement/management': '/html/usermanagement/management.html',
};

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

    // Auth gate: everything except /login requires a token
    if (path !== '/login' && !isAuthed()) {
      console.log('[Router] Not authenticated, redirecting to login');
      path = '/login';
      replace = true;
    }

    // Permission gate: if not allowed, redirect to default allowed path
    if (path !== '/login') {
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
      // Fallback to a default route
      const fallbackPath = isAuthed() ? getDefaultAllowedPath() : '/login';
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
      const tabName = path.split('/')[1] || 'RM365';
      const subPath = path.split('/')[2];
      
      // Hide header on home pages (no subpath or subpath is 'home')
      const header = pageTitle.closest('.header');
      if (header) {
        if (!subPath || subPath === 'home') {
          header.style.display = 'none';
        } else {
          header.style.display = '';
        }
      }
      
      // Map for proper title casing
      const titleMap = {
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
    : (isAuthed() ? getDefaultAllowedPath() : '/login');
  
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
