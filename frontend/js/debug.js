// frontend/js/debug.js
// Debug utilities for troubleshooting authentication and navigation issues

export function debugAuthState() {
  console.group('🔍 Authentication Debug Info');
  
  // Token info
  const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
  console.log('Token exists:', !!token);
  if (token) {
    console.log('Token preview:', token.substring(0, 20) + '...');
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      console.log('Token payload:', payload);
      console.log('Token expires:', new Date(payload.exp * 1000));
    } catch (e) {
      console.warn('Could not decode token:', e);
    }
  }
  
  // User permissions
  const allowedTabs = JSON.parse(localStorage.getItem('allowed_tabs') || '[]');
  console.log('Allowed tabs:', allowedTabs);
  
  // Configuration
  console.log('Backend URL:', window.API);
  console.log('Frontend origin:', window.location.origin);
  console.log('Cross-origin setup:', window.API !== window.location.origin);
  
  // Current page state
  console.log('Current path:', window.location.pathname);
  console.log('Is authenticated:', !!token);
  
  console.groupEnd();
}

export function clearAuthState() {
  console.log('🧹 Clearing all authentication state...');
  localStorage.removeItem('access_token');
  sessionStorage.removeItem('access_token');
  localStorage.removeItem('allowed_tabs');
  console.log('✅ Authentication state cleared');
}

export function testBackendConnection() {
  console.group('🌐 Testing Backend Connection');
  
  const backendUrl = window.API;
  console.log('Testing connection to:', backendUrl);
  console.log('Current origin:', window.location.origin);
  
  // Test basic connectivity
  fetch(backendUrl + '/api/health', {
    method: 'GET',
    credentials: 'omit'
  })
  .then(response => {
    console.log('✅ Backend reachable, status:', response.status);
    return response.json();
  })
  .then(data => {
    console.log('Backend health response:', data);
    
    // Test CORS with a preflight request
    console.log('🔍 Testing CORS preflight...');
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
    console.log('CORS preflight status:', corsResponse.status);
    console.log('CORS headers:', Object.fromEntries(corsResponse.headers.entries()));
    
    if (corsResponse.ok) {
      console.log('✅ CORS configuration appears to be working');
    } else {
      console.warn('⚠️  CORS preflight failed - check backend ALLOW_ORIGIN_REGEX');
    }
  })
  .catch(error => {
    console.error('❌ Backend connection or CORS test failed:', error);
    console.log('💡 Check that ALLOW_ORIGIN_REGEX on Railway includes:', window.location.origin);
  })
  .finally(() => {
    console.groupEnd();
  });
}

export function generateCorsRegex() {
  console.group('🔧 CORS Regex Generator');
  
  const origin = window.location.origin;
  const hostname = window.location.hostname;
  
  console.log('Current origin:', origin);
  console.log('Current hostname:', hostname);
  
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
  
  console.log('Suggested ALLOW_ORIGIN_REGEX patterns:');
  suggestions.forEach((pattern, index) => {
    console.log(`${index + 1}. ${pattern}`);
  });
  
  console.log('\n💡 Set one of these patterns as ALLOW_ORIGIN_REGEX in your Railway backend environment variables');
  
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
  
  console.log('Found backdrops:', backdrops.length);
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
  console.log('Open dropdown containers:', openDropdowns.length);
  
  const openToggles = document.querySelectorAll('.dropdown-toggle.open');
  console.log('Open dropdown toggles:', openToggles.length);
  
  const raisedBoxes = document.querySelectorAll('.modern-box.z-raise');
  console.log('Raised boxes:', raisedBoxes.length);
  
  console.groupEnd();
}

export function fixBackdrop() {
  console.log('🔧 Fixing backdrop overlay...');
  
  // Remove all open states from dropdown containers
  document.querySelectorAll('.dropdown-container.open').forEach(container => {
    container.classList.remove('open');
    console.log('Closed dropdown container:', container);
  });
  
  // Remove all open states from dropdown toggles
  document.querySelectorAll('.dropdown-toggle.open').forEach(toggle => {
    toggle.classList.remove('open');
    console.log('Closed dropdown toggle:', toggle);
  });
  
  // Remove z-raise from boxes
  document.querySelectorAll('.modern-box.z-raise').forEach(box => {
    box.classList.remove('z-raise');
    console.log('Removed z-raise from box:', box);
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
    console.log('Hid backdrop:', backdrop);
  });
  
  console.log('✅ All dropdowns and backdrops should now be closed');
  
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
  
  console.log('🔧 Debug utilities available:');
  console.log('  - debugAuth() - Show authentication state');
  console.log('  - clearAuth() - Clear all auth data');
  console.log('  - testBackend() - Test backend connectivity');
  console.log('  - generateCorsRegex() - Generate CORS regex for current domain');
  console.log('  - debugBackdrop() - Show backdrop state info');
  console.log('  - fixBackdrop() - Force close all dropdowns and backdrops');
}
