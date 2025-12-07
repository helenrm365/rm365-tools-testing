// frontend/js/modules/home/index.js
import { isAuthed } from '../../services/state/sessionStore.js';
import { filterHomeCardsByPermissions } from '../../utils/tabs.js';
import { showToast } from '../../ui/toast.js';

export async function init() {
  // Check authentication status
  const authenticated = isAuthed();
  const loginPrompt = document.getElementById('loginPrompt');
  const welcomeMessage = document.getElementById('welcomeMessage');
  const featuresGrid = document.querySelector('.module-cards-grid');
  
  if (authenticated) {
    // Hide both login prompt and welcome message for authenticated users
    if (loginPrompt) {
      loginPrompt.hidden = true;
      loginPrompt.style.display = 'none';
    }
    if (welcomeMessage) {
      welcomeMessage.hidden = true;
      welcomeMessage.style.display = 'none';
    }
    
    // Show test sync button for authenticated users
    const testSyncContainer = document.getElementById('testSyncContainer');
    if (testSyncContainer) {
      testSyncContainer.hidden = false;
      setupTestSync();
    }
    
    // Show feature cards for authenticated users
    if (featuresGrid) {
      featuresGrid.style.display = 'grid';
      filterHomeCardsByPermissions();
    }
    
    // Enable feature cards navigation for authenticated users
    setupFeatureCards(true);
  } else {
    // Show login prompt for unauthenticated users
    if (loginPrompt) {
      loginPrompt.hidden = false;
      loginPrompt.style.display = '';
    }
    if (welcomeMessage) {
      welcomeMessage.hidden = true;
      welcomeMessage.style.display = 'none';
    }
    
    // Hide feature cards for unauthenticated users
    if (featuresGrid) {
      featuresGrid.style.display = 'none';
    }
    
    // Setup login button
    const goToLoginBtn = document.getElementById('goToLoginBtn');
    if (goToLoginBtn) {
      goToLoginBtn.addEventListener('click', () => {
        if (window.navigate) {
          window.navigate('/login');
        } else {
          window.location.href = '/login';
        }
      });
    }
  }
}

function setupFeatureCards(authenticated) {
  const featureCards = document.querySelectorAll('.module-feature-card');
  
  featureCards.forEach(card => {
    const module = card.getAttribute('data-module');
    
    if (authenticated) {
      // Make cards clickable for authenticated users
      card.style.cursor = 'pointer';
      card.removeAttribute('data-disabled');
      
      card.addEventListener('click', () => {
        const path = `/${module}`;
        if (window.navigate) {
          window.navigate(path);
        } else {
          window.location.href = path;
        }
      });
    } else {
      // Disable cards for unauthenticated users
      card.setAttribute('data-disabled', 'true');
      card.style.cursor = 'not-allowed';
      
      card.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
  });
}

function setupTestSync() {
  const testSyncBtn = document.getElementById('testSyncBtn');
  
  if (!testSyncBtn) return;
  
  let testAbortController = null;
  
  const handleCancel = () => {
    if (testAbortController) {
      testAbortController.abort();
      showToast('Cancelling test sync...', 'info');
    }
  };
  
  const handleTestSync = async () => {
    try {
      testAbortController = new AbortController();
      
      // Change to cancel mode
      testSyncBtn.onclick = handleCancel;
      testSyncBtn.innerHTML = '<i class="fas fa-times" style="margin-right: 8px;"></i>Cancel Test';
      testSyncBtn.style.background = '#f44336';
      
      showToast('Starting test sync (10 orders)...', 'info');
      
      // Call test sync API with signal
      const response = await fetch('/api/v1/magentodata/test-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        signal: testAbortController.signal
      });
      
      const result = await response.json();
      
      if (result.status === 'success') {
        showToast(
          `✅ Test sync complete! Synced ${result.rows_synced} product rows from ${result.orders_processed} orders to test_magento_data table`,
          'success',
          5000
        );
      } else {
        showToast('❌ Test sync failed: ' + result.message, 'error');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Test Sync] Cancelled by user');
        showToast('⚠️ Test sync cancelled', 'warning');
      } else {
        console.error('[Test Sync] Error:', error);
        showToast('❌ Test sync error: ' + error.message, 'error');
      }
    } finally {
      testAbortController = null;
      testSyncBtn.onclick = handleTestSync;
      testSyncBtn.style.background = '#4CAF50';
      testSyncBtn.innerHTML = '<i class="fas fa-vial" style="margin-right: 8px;"></i>Test Sync (10 Orders)';
    }
  };
  
  testSyncBtn.addEventListener('click', handleTestSync);
}
