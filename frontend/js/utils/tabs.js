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
  return false;
}

export function getDefaultAllowedPath(allowed = null) {
  const allowedTabs = Array.isArray(allowed) ? allowed : getAllowedTabs();
  if (!allowedTabs || allowedTabs.length === 0) {
    // No restrictions: allow all, default to enrollment
    return '/enrollment';
  }

  // Prefer enrollment if present
  if (isAllowed('enrollment', allowedTabs)) {
    // pick a sensible default sub-route
    if (allowedTabs.includes('enrollment.management')) return '/enrollment/management';
    if (allowedTabs.includes('enrollment.card')) return '/enrollment/card';
    if (allowedTabs.includes('enrollment.fingerprint')) return '/enrollment/fingerprint';
    return '/enrollment';
  }
  // Then attendance
  if (isAllowed('attendance', allowedTabs)) {
    if (allowedTabs.includes('attendance.overview')) return '/attendance/overview';
    if (allowedTabs.includes('attendance.manual')) return '/attendance/manual';
    if (allowedTabs.includes('attendance.automatic')) return '/attendance/automatic';
    if (allowedTabs.includes('attendance.logs')) return '/attendance/logs';
    return '/attendance';
  }
  // Then labels
  if (isAllowed('labels', allowedTabs)) return '/labels';
  // Then salesdata
  if (isAllowed('salesdata', allowedTabs)) return '/salesdata';
  // Then inventory
  if (isAllowed('inventory', allowedTabs)) return '/inventory';
  // Then user management
  if (isAllowed('usermanagement', allowedTabs)) return '/usermanagement';
  return '/login';
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

  const key = sub ? `${section}.${sub}` : section;
  if (isAllowed(key)) return { allowed: true, redirect: null };

  const fallback = getDefaultAllowedPath();
  return { allowed: false, redirect: fallback };
}

// Hide or show sidebar items according to allowed tabs
export function filterSidebarByPermissions() {
  const allowedTabs = getAllowedTabs();
  // Updated to work with new universal sidebar structure
  const items = document.querySelectorAll('.sidebar .sidebar-nav > li');
  items.forEach(li => {
    const a = li.querySelector('a.nav-item[href^="/"]');
    if (!a) return;
    const href = a.getAttribute('href') || '/';
    const section = href.replace(/^\/+/, '').split('/')[0];
    const ok = isAllowed(section, allowedTabs);
    
    if (ok) {
      li.style.display = '';
      li.removeAttribute('data-permission-hidden');
    } else {
      li.style.display = 'none';
      li.setAttribute('data-permission-hidden', 'true');
    }
  });
}

// Inside the currently loaded view, hide inner tabs the user can't access.
export function applyInnerTabPermissions(root = document) {
  const allowedTabs = getAllowedTabs();
  // Buttons or links with data-nav that route to /section/sub
  const candidates = root.querySelectorAll('.inner-tabs a[data-nav], .inner-tabs button[data-nav]');
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

export function setupTabsForUser() {
  try {
    filterSidebarByPermissions();
    applyInnerTabPermissions(document);
  } catch (e) {
    console.warn('[tabs] setup error:', e);
  }
}
