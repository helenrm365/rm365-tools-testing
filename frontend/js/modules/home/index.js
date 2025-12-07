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
    // Test sync moved to Magento Data page
    
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
