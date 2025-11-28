// Universal Sidebar Loader
// This utility makes it easy to include the sidebar on any page

class UniversalSidebar {
  constructor() {
    this.initialized = false;
    this.componentPath = '/components/universal-sidebar.html';
  }

  // Load the sidebar component into any page
  async loadIntoElement(targetElement) {
    if (typeof targetElement === 'string') {
      targetElement = document.querySelector(targetElement);
    }
    
    if (!targetElement) {
      console.error('[UniversalSidebar] Target element not found');
      return false;
    }

    try {
      const response = await fetch(this.componentPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      targetElement.innerHTML = html;
      return true;
    } catch (error) {
      console.error('[UniversalSidebar] Failed to load sidebar:', error);
      return false;
    }
  }

  // Load the sidebar at the beginning of the body (default behavior)
  async loadDefault() {
    return this.loadIntoElement(document.body);
  }

  // Insert the sidebar before the first child of body
  async loadBeforeContent() {
    const sidebar = document.createElement('div');
    document.body.insertBefore(sidebar, document.body.firstChild);
    return this.loadIntoElement(sidebar);
  }

  // Check if sidebar is already present
  isPresent() {
    return !!document.getElementById('sidebar');
  }

  // Auto-load sidebar if not present and page needs it
  async autoLoad() {
    // Don't load on login page
    if (window.location.pathname === '/login' || window.location.pathname.endsWith('/login.html')) {
      return false;
    }

    // Don't load if already present
    if (this.isPresent()) {
      return true;
    }

    const sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'sidebar-container';
    document.body.insertBefore(sidebarContainer, document.body.firstChild);
    
    return this.loadIntoElement(sidebarContainer);
  }

  // Ensure page layout is compatible with sidebar
  ensureLayout() {
    // Make sure we have the required CSS
    if (!document.querySelector('link[href*="app-shell.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/css/app-shell.css';
      document.head.appendChild(link);
    }

    // Add necessary classes to body if needed
    if (!document.body.classList.contains('has-sidebar')) {
      document.body.classList.add('has-sidebar');
    }
  }
}

window.UniversalSidebar = new UniversalSidebar();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await window.UniversalSidebar.autoLoad();
    window.UniversalSidebar.ensureLayout();
  });
} else {
  // DOM already ready
  setTimeout(async () => {
    await window.UniversalSidebar.autoLoad();
    window.UniversalSidebar.ensureLayout();
  }, 0);
}

// Export for module usage
export default UniversalSidebar;
