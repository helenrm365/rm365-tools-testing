// frontend/js/modules/home/index.js
import { isAuthed } from '../../services/state/sessionStore.js';

export async function init() {
  console.log('[Home] Initializing home page');
  
  // Check authentication status
  const authenticated = isAuthed();
  
  const loginPrompt = document.getElementById('loginPrompt');
  const welcomeMessage = document.getElementById('welcomeMessage');
  const featuresGrid = document.querySelector('.features-grid');
  
  if (authenticated) {
    // Hide both login prompt and welcome message for authenticated users
    if (loginPrompt) loginPrompt.hidden = true;
    if (welcomeMessage) welcomeMessage.hidden = true;
    
    // Show feature cards for authenticated users
    if (featuresGrid) featuresGrid.style.display = 'grid';
    
    // Enable feature cards navigation for authenticated users
    setupFeatureCards(true);
  } else {
    // Show login prompt for unauthenticated users
    if (loginPrompt) loginPrompt.hidden = false;
    if (welcomeMessage) welcomeMessage.hidden = true;
    
    // Hide feature cards for unauthenticated users
    if (featuresGrid) featuresGrid.style.display = 'none';
    
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
  const featureCards = document.querySelectorAll('.feature-card');
  
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
