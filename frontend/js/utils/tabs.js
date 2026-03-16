// frontend/js/utils/tabs.js
import { getAllowedTabs } from '../services/state/userStore.js';
import { isAuthed } from '../services/state/sessionStore.js';

// Returns true if a top-level section (e.g. "inventory"), a subtab
// (e.g. "inventory.management"), or a specific sub-page
// (e.g. "inventory.management.dashboard") is allowed by the user's permissions.
//
// Hierarchy:
//   - Section key ("inventory") → true if any descendant exists in allowedTabs
//   - 2-level key ("inventory.management") → true if exact match OR any 3-level child exists
//   - 3-level key ("inventory.management.dashboard") → true if exact match OR 2-level parent exists
export function isAllowed(key, allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();

  // No restrictions configured: allow everything (full access)
  if (!allowedTabs || allowedTabs.length === 0) return true;

  // If '*' is present, allow all (superadmin / full-access roles)
  if (allowedTabs.includes('*')) return true;

  // Exact match
  if (allowedTabs.includes(key)) return true;

  const parts = key.split('.');

  // Section-level key (no dot): allow if any descendant permission exists
  if (parts.length === 1) {
    return allowedTabs.some(t => t === key || t.startsWith(key + '.'));
  }

  // 2-level key (section.subtab): allow if any 3-level child exists
  if (parts.length === 2) {
    return allowedTabs.some(t => t.startsWith(key + '.'));
  }

  // 3-level key (section.subtab.subpage): allow if 2-level parent grants all children
  if (parts.length >= 3) {
    const parent = parts.slice(0, 2).join('.');
    return allowedTabs.includes(parent);
  }

  return false;
}

export function getDefaultAllowedPath(allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();
  if (!allowedTabs || allowedTabs.length === 0) {
    // No restrictions: full access, default to attendance
    return '/attendance';
  }

  // Prefer attendance if present
  if (isAllowed('attendance', allowedTabs)) {
    if (isAllowed('attendance.analytics', allowedTabs)) return '/attendance/analytics';
    if (isAllowed('attendance.staff', allowedTabs)) return '/attendance/staff';
    if (isAllowed('attendance.clocking', allowedTabs)) return '/attendance/clocking';
    if (isAllowed('attendance.timesheets', allowedTabs)) return '/attendance/timesheets';
    return '/attendance';
  }
  // Then inventory
  if (isAllowed('inventory', allowedTabs)) return '/inventory/management/dashboard';
  // Then sales data
  if (isAllowed('sales', allowedTabs)) return '/sales/all';
  // Then operations (warehouse)
  if (isAllowed('operations', allowedTabs)) return '/operations/birmingham/scanner';
  // Then birmingham-orders
  if (isAllowed('birmingham-orders', allowedTabs)) return '/birmingham-orders';
  // Then france-orders
  if (isAllowed('france-orders', allowedTabs)) return '/france-orders';
  // Then london-orders
  if (isAllowed('london-orders', allowedTabs)) return '/london-orders';
  // Then system
  if (isAllowed('system', allowedTabs)) return '/system/access-control';
  
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
  const subpage = parts[2] || '';

  // Only enforce for known app sections
  if (!section) return { allowed: true, redirect: null };

  // Always allow home - accessible to everyone
  if (section === 'home') return { allowed: true, redirect: null };

  // Build the most specific permission key from the path
  let key;
  if (subpage && sub) {
    key = `${section}.${sub}.${subpage}`;
  } else if (sub) {
    key = `${section}.${sub}`;
  } else {
    key = section;
  }

  if (isAllowed(key)) {
    // Section-root paths (no sub) map to a default sub-page.
    // If the user only has specific child permissions, redirect to their first allowed sub-page.
    if (!sub && isAllowed(section)) {
      const allowedTabs = getAllowedTabs();
      if (allowedTabs && allowedTabs.length > 0 && !allowedTabs.includes('*')) {
        const sectionChildren = allowedTabs.filter(t => t.startsWith(section + '.'));
        if (sectionChildren.length > 0) {
          // Build the deepest allowed path from the first matching permission
          const childParts = sectionChildren[0].split('.');
          const redirect = '/' + childParts.join('/');
          if (redirect !== pathname) {
            return { allowed: false, redirect };
          }
        }
      }
    }
    return { allowed: true, redirect: null };
  }

  const fallback = getDefaultAllowedPath();
  return { allowed: false, redirect: fallback };
}

// Inside the currently loaded view, hide inner tabs the user can't access.
export function applyInnerTabPermissions(root = document) {
  const allowedTabs = getAllowedTabs();
  // Buttons or links that route to /section/sub
  // We look for data-nav OR just buttons/links inside .nui-tabs OR module feature cards
  const candidates = root.querySelectorAll('.nui-tabs a, .nui-tabs button, .module-feature-card');
  candidates.forEach(el => {
    const href = el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('onclick') || '';
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
       const dn = el.getAttribute('data-nav');
       if (dn && dn.startsWith('/')) path = dn;
    }

    if (!path) return;
    const parts = path.replace(/^\/+/, '').split('/');
    if (parts.length < 2) return;

    // Build permission key directly from path segments (up to 3 levels)
    let key;
    if (parts.length >= 3) {
      key = `${parts[0]}.${parts[1]}.${parts[2]}`;
    } else {
      key = `${parts[0]}.${parts[1]}`;
    }

    const ok = isAllowed(key, allowedTabs);
    if (!ok) {
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
