// frontend/js/modules/sales-imports/home.js
import { initializeTables, checkTablesStatus } from '../../services/api/salesImportsApi.js';
import { showToast } from '../../ui/toast.js';

/**
 * Initialize the sales imports home page
 */
export async function initSalesImportsHome() {
  console.log('[Sales Imports] Initializing home page...');
  
  try {
    // Show loading state
    showLoadingState();
    
    // Call the backend to initialize tables
    const result = await initializeTables();
    
    if (result.status === 'success') {
      console.log('[Sales Imports] Tables initialized:', result.tables);
      showToast('Sales import tables ready', 'success');
      showReadyState(result.tables);
    } else {
      console.error('[Sales Imports] Failed to initialize tables:', result.message);
      showToast('Failed to initialize tables: ' + result.message, 'error');
      showErrorState(result.message);
    }
  } catch (error) {
    console.error('[Sales Imports] Error initializing home page:', error);
    showToast('Error initializing sales imports: ' + error.message, 'error');
    showErrorState(error.message);
  }
}

/**
 * Show loading state while initializing
 */
function showLoadingState() {
  const container = document.querySelector('.sales-imports-home');
  if (!container) return;
  
  // Add a loading indicator if one doesn't exist
  let loadingDiv = container.querySelector('.initialization-status');
  if (!loadingDiv) {
    loadingDiv = document.createElement('div');
    loadingDiv.className = 'initialization-status';
    loadingDiv.style.cssText = 'margin: 1rem 0; padding: 1rem; background: #f0f8ff; border-radius: 8px; border-left: 4px solid #0066cc;';
    
    const introCard = container.querySelector('.intro-card');
    if (introCard) {
      container.insertBefore(loadingDiv, introCard);
    } else {
      container.appendChild(loadingDiv);
    }
  }
  
  loadingDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.5rem;">
      <div style="width: 20px; height: 20px; border: 3px solid #0066cc; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <span>Initializing database tables...</span>
    </div>
  `;
}

/**
 * Show ready state after successful initialization
 */
function showReadyState(tables) {
  const statusDiv = document.querySelector('.initialization-status');
  if (!statusDiv) return;
  
  statusDiv.style.cssText = 'margin: 1rem 0; padding: 1rem; background: #e6ffe6; border-radius: 8px; border-left: 4px solid #00cc00;';
  statusDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.5rem;">
      <span style="font-size: 1.5rem;">✅</span>
      <div>
        <strong>Database Ready</strong>
        <div style="font-size: 0.9rem; color: #666; margin-top: 0.25rem;">
          Tables initialized: ${tables.join(', ')}
        </div>
      </div>
    </div>
  `;
}

/**
 * Show error state if initialization fails
 */
function showErrorState(message) {
  const statusDiv = document.querySelector('.initialization-status');
  if (!statusDiv) return;
  
  statusDiv.style.cssText = 'margin: 1rem 0; padding: 1rem; background: #ffe6e6; border-radius: 8px; border-left: 4px solid #cc0000;';
  statusDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.5rem;">
      <span style="font-size: 1.5rem;">❌</span>
      <div>
        <strong>Initialization Failed</strong>
        <div style="font-size: 0.9rem; color: #666; margin-top: 0.25rem;">
          ${message}
        </div>
      </div>
    </div>
  `;
}

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// Initialize when the page loads
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the sales imports home page
    if (window.location.pathname.includes('/sales-imports') && 
        (window.location.pathname.endsWith('/home') || window.location.pathname === '/sales-imports')) {
      initSalesImportsHome();
    }
  });
}
