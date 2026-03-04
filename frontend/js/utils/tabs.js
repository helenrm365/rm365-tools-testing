// frontend/js/utils/tabs.js
import { getAllowedTabs } from '../services/state/userStore.js';
import { isAuthed } from '../services/state/sessionStore.js';

// Returns true if a top-level section (e.g. "enrollment") or specific inner tab
// (e.g. "enrollment.management") is allowed by the user's permissions.
export function isAllowed(key, allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();

  // No restrictions configured: allow everything (full access)
  if (!allowedTabs || allowedTabs.length === 0) return true;

  // If '*' is present, allow all (superadmin / full-access roles)
  if (allowedTabs.includes('*')) return true;

  // Exact match
  if (allowedTabs.includes(key)) return true;

  const [section] = key.split('.');
  // If asked for a section (no dot), allow if any child permission exists
  if (!key.includes('.')) {
    return allowedTabs.some(t => t === section || t.startsWith(section + '.'));
  }
  // Sub-route (has dot): only exact match counts (already checked above).
  // Parent key does NOT grant blanket access to all children.
  return false;
}

export function getDefaultAllowedPath(allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();
  if (!allowedTabs || allowedTabs.length === 0) {
    // No restrictions: full access, default to attendance-system
    return '/attendance-system';
  }

  // Prefer attendance-system if present
  if (isAllowed('attendance-system', allowedTabs)) {
    if (allowedTabs.includes('attendance-system.dashboard')) return '/attendance-system/dashboard';
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
  // Then birmingham-orders (UK Birmingham branch orders)
  if (isAllowed('birmingham-orders', allowedTabs)) return '/birmingham-orders';
  // Then france-orders (FR/NL region orders)
  if (isAllowed('france-orders', allowedTabs)) return '/france-orders';
  // Then london-orders (UK London region orders)
  if (isAllowed('london-orders', allowedTabs)) return '/london-orders';
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

  // If visiting a section root (no sub-page), redirect to the first allowed child
  if (!sub && isAllowed(section)) {
    const allowedTabs = getAllowedTabs();
    // Find the first allowed child for this section
    const firstChild = allowedTabs.find(t => t.startsWith(section + '.'));
    if (firstChild) {
      const childSub = firstChild.split('.')[1];
      return { allowed: false, redirect: `/${section}/${childSub}` };
    }
    // Section itself is allowed with no children (e.g., labels, inventory)
    return { allowed: true, redirect: null };
  }

  const key = sub ? `${section}.${sub}` : section;
  if (isAllowed(key)) {
    // Section-root paths (no sub) map to a default sub-page (e.g. /attendance-system → dashboard).
    // If the user only has specific child permissions, redirect to their first allowed sub-page
    // so they don't land on a default page they can't access.
    if (!sub) {
      const allowedTabs = getAllowedTabs();
      if (allowedTabs && allowedTabs.length > 0 && !allowedTabs.includes('*')) {
        const sectionChildren = allowedTabs.filter(t => t.startsWith(section + '.'));
        if (sectionChildren.length > 0) {
          const firstChildSub = sectionChildren[0].substring(section.length + 1);
          const redirect = `/${section}/${firstChildSub}`;
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
  // We look for data-nav OR just buttons/links inside .inner-tabs OR module feature cards
  const candidates = root.querySelectorAll('.inner-tabs a, .inner-tabs button, .module-feature-card');
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
