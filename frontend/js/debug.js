// frontend/js/debug.js
// Debug utilities for troubleshooting authentication and navigation issues

export function debugAuthState() {
  console.group('🔍 Authentication Debug Info');
  
  // Token info
  const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
  if (token) {
    console.log('Token preview:', token.substring(0, 20) + '...');
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      console.log('Token expires:', new Date(payload.exp * 1000));
    } catch (e) {
      console.warn('Could not decode token:', e);
    }
  }
  
  // User permissions
  const allowedTabs = JSON.parse(localStorage.getItem('allowed_tabs') || '[]');
  // Configuration
  // Current page state
  console.groupEnd();
}

export function clearAuthState() {
  localStorage.removeItem('access_token');
  sessionStorage.removeItem('access_token');
  localStorage.removeItem('allowed_tabs');
}

export function testBackendConnection() {
  console.group('🌐 Testing Backend Connection');
  
  const backendUrl = window.API;
  // Test basic connectivity
  fetch(backendUrl + '/api/health', {
    method: 'GET',
    credentials: 'omit'
  })
  .then(response => {
    return response.json();
  })
  .then(data => {
    // Test CORS with a preflight request
    return fetch(backendUrl + '/api/v1/auth/login', {
      method: 'OPTIONS',
      headers: {
        'Origin': window.location.origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });
  })
  .then(corsResponse => {
    console.log('CORS headers:', Object.fromEntries(corsResponse.headers.entries()));
    
    if (corsResponse.ok) {
    } else {
      console.warn('⚠️  CORS preflight failed - check backend ALLOW_ORIGIN_REGEX');
    }
  })
  .catch(error => {
    console.error('❌ Backend connection or CORS test failed:', error);
  })
  .finally(() => {
    console.groupEnd();
  });
}

export function generateCorsRegex() {
  console.group('🔧 CORS Regex Generator');
  
  const origin = window.location.origin;
  const hostname = window.location.hostname;
  let suggestions = [];
  
  if (hostname.includes('.pages.dev')) {
    // Extract project name
    const projectMatch = hostname.match(/^([^.]+)/);
    const projectName = projectMatch ? projectMatch[1] : 'your-project';
    
    suggestions = [
      `https://.*\\.pages\\.dev$`,
      `https://${projectName}.*\\.pages\\.dev$`,
      `https://(${projectName}|[a-f0-9]{8}-${projectName}).*\\.pages\\.dev$`
    ];
  } else if (hostname === 'localhost' || hostname === '127.0.0.1') {
    suggestions = [
      `http://localhost:(3000|5173|8080|8000)$`,
      `http://127\\.0\\.0\\.1:(3000|5173|8080|8000)$`
    ];
  } else {
    // Custom domain
    const escapedHostname = hostname.replace(/\./g, '\\.');
    suggestions = [
      `https://${escapedHostname}$`,
      `https://(www\\.)?${escapedHostname}$`
    ];
  }
  suggestions.forEach((pattern, index) => {
  });
  console.groupEnd();
  
  return suggestions;
}

export function debugBackdrop() {
  console.group('🎭 Backdrop Debug Info');
  
  // Find all backdrop elements
  const backdrops = [
    document.getElementById('globalDropdownBackdrop'),
    document.getElementById('dropdownBackdrop'),
    ...document.querySelectorAll('.dropdown-backdrop')
  ].filter(Boolean);
  backdrops.forEach((backdrop, index) => {
    console.log(`Backdrop ${index + 1}:`, {
      id: backdrop.id,
      className: backdrop.className,
      visible: backdrop.classList.contains('show'),
      display: window.getComputedStyle(backdrop).display,
      zIndex: window.getComputedStyle(backdrop).zIndex
    });
  });
  
  // Find open dropdowns
  const openDropdowns = document.querySelectorAll('.dropdown-container.open');
  const openToggles = document.querySelectorAll('.dropdown-toggle.open');
  const raisedBoxes = document.querySelectorAll('.modern-box.z-raise');
  console.groupEnd();
}

export function fixBackdrop() {
  // Remove all open states from dropdown containers
  document.querySelectorAll('.dropdown-container.open').forEach(container => {
    container.classList.remove('open');
  });
  
  // Remove all open states from dropdown toggles
  document.querySelectorAll('.dropdown-toggle.open').forEach(toggle => {
    toggle.classList.remove('open');
  });
  
  // Remove z-raise from boxes
  document.querySelectorAll('.modern-box.z-raise').forEach(box => {
    box.classList.remove('z-raise');
  });
  
  // Hide all backdrop elements
  const backdrops = [
    document.getElementById('globalDropdownBackdrop'),
    document.getElementById('dropdownBackdrop'),
    ...document.querySelectorAll('.dropdown-backdrop')
  ].filter(Boolean);
  
  backdrops.forEach(backdrop => {
    backdrop.classList.remove('show');
    backdrop.style.display = 'none'; // Force hide
  });
  // Call global closeAllDropdowns if available
  if (typeof window.closeAllDropdowns === 'function') {
    window.closeAllDropdowns();
  }
}

// Make debug functions available globally in development
if (window.location.hostname === 'localhost' || window.location.search.includes('debug=true')) {
  window.debugAuth = debugAuthState;
  window.clearAuth = clearAuthState;
  window.testBackend = testBackendConnection;
  window.generateCorsRegex = generateCorsRegex;
  window.debugBackdrop = debugBackdrop;
  window.fixBackdrop = fixBackdrop;
  console.log('  - debugAuth() - Show authentication state');
  console.log('  - clearAuth() - Clear all auth data');
  console.log('  - testBackend() - Test backend connectivity');
  console.log('  - generateCorsRegex() - Generate CORS regex for current domain');
  console.log('  - debugBackdrop() - Show backdrop state info');
  console.log('  - fixBackdrop() - Force close all dropdowns and backdrops');
}
