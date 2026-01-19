// frontend/js/utils/tabs.js
import { getAllowedTabs } from '../services/state/userStore.js';
import { isAuthed } from '../services/state/sessionStore.js';

// Returns true if a top-level section (e.g. "enrollment") or specific inner tab
// (e.g. "enrollment.management") is allowed by the user's permissions.
export function isAllowed(key, allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();

  // If allowedTabs is empty or falsy, allow all (no restrictions)
  if (!allowedTabs || allowedTabs.length === 0) return true;

  // If '*' is present, allow all
  if (allowedTabs.includes('*')) return true;

  // Exact match or any child permission implies parent allowed
  if (allowedTabs.includes(key)) return true;

  const [section] = key.split('.');
  // If asked for a section (no dot), allow if any child exists
  if (!key.includes('.')) {
    return allowedTabs.some(t => t === section || t.startsWith(section + '.'));
  }
  // If asked for a sub-route (has dot), also check if parent section is allowed
  if (allowedTabs.includes(section)) return true;
  return false;
}

export function getDefaultAllowedPath(allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();
  if (!allowedTabs || allowedTabs.length === 0) {
    // No restrictions: allow all, default to attendance-system
    return '/attendance-system';
  }

  // Prefer attendance-system if present
  if (isAllowed('attendance-system', allowedTabs)) {
    if (allowedTabs.includes('attendance-system.overview')) return '/attendance-system/overview';
    if (allowedTabs.includes('attendance-system.employees')) return '/attendance-system/employees';
    if (allowedTabs.includes('attendance-system.automatic')) return '/attendance-system/automatic';
    if (allowedTabs.includes('attendance-system.logs')) return '/attendance-system/logs';
    return '/attendance-system';
  }
  // Then labels
  if (isAllowed('labels', allowedTabs)) return '/labels';
  // Then magentodata
  if (isAllowed('magentodata', allowedTabs)) return '/magentodata';
  // Then inventory
  if (isAllowed('inventory', allowedTabs)) return '/inventory';
  // Then orders
  if (isAllowed('orders', allowedTabs)) return '/orders';
  // Then user management
  if (isAllowed('usermanagement', allowedTabs)) return '/usermanagement';
  
  // Fallback to home (accessible to everyone when logged in)
  return '/home';
}

// Enforce that a given pathname is allowed; return { allowed, redirect }
export function enforceRoutePermission(pathname) {
  // Always allow login
  if (pathname === '/login' || !isAuthed()) return { allowed: true, redirect: null };

  const parts = pathname.replace(/^\/+/, '').split('/');
  const section = parts[0] || '';
  const sub = parts[1] || '';

  // Only enforce for known app sections
  if (!section) return { allowed: true, redirect: null };

  // Always allow home - accessible to everyone
  if (section === 'home') return { allowed: true, redirect: null };

  const key = sub ? `${section}.${sub}` : section;
  if (isAllowed(key)) return { allowed: true, redirect: null };

  const fallback = getDefaultAllowedPath();
  return { allowed: false, redirect: fallback };
}

// Inside the currently loaded view, hide inner tabs the user can't access.
export function applyInnerTabPermissions(root = document) {
  const allowedTabs = getAllowedTabs();
  // Buttons or links that route to /section/sub
  // We look for data-nav OR just buttons/links inside .inner-tabs OR module feature cards
  const candidates = root.querySelectorAll('.inner-tabs a, .inner-tabs button, .module-feature-card');
  candidates.forEach(el => {
    const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
    // If it's a button with inline location.href, try to parse
    let path = '';
    if (href.startsWith('/')) {
      path = href;
    } else if (/location\.href\s*=\s*'\//.test(href)) {
      const m = href.match(/'\/(.*?)'/);
      path = m ? '/' + m[1] : '';
    }
    
    // Also check data-nav if present (overrides href/onclick parsing)
    if (el.hasAttribute('data-nav')) {
       // data-nav might be "attendance.overview" or "/attendance/overview"
       // If it's a path, use it. If it's a key, we need to handle that.
       // But usually data-nav is used for routing.
       // Let's assume the existing logic relied on href/onclick mostly or data-nav was a path.
       // If data-nav is present, let's try to use it as path if it starts with /
       const dn = el.getAttribute('data-nav');
       if (dn && dn.startsWith('/')) path = dn;
    }

    if (!path) return;
    const parts = path.replace(/^\/+/, '').split('/');
    if (parts.length < 2) return;
    const key = `${parts[0]}.${parts[1]}`;
    const ok = isAllowed(key, allowedTabs);
    if (!ok) {
      // Prefer removing to avoid accidental navigation
      el.style.display = 'none';
    }
  });
}

export function filterHomeCardsByPermissions() {
  const allowedTabs = getAllowedTabs();
  const cards = document.querySelectorAll('.module-feature-card[data-module]');
  
  cards.forEach(card => {
    const module = card.getAttribute('data-module');
    if (!module) return;
    
    // Check if the module (e.g. "enrollment") is allowed
    if (isAllowed(module, allowedTabs)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}

export function setupTabsForUser() {
  try {
    applyInnerTabPermissions(document);
    filterHomeCardsByPermissions();
  } catch (e) {
    console.warn('[tabs] setup error:', e);
  }
}
