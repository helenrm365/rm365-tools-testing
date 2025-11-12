// frontend/js/modules/home/index.js
import { isAuthed } from '../../services/state/sessionStore.js';

export async function init() {
  console.log('[Home] Initializing home page');
  
  // Check authentication status
  const authenticated = isAuthed();
  console.log('[Home] User authenticated:', authenticated);
  
  const loginPrompt = document.getElementById('loginPrompt');
  const welcomeMessage = document.getElementById('welcomeMessage');
  const featuresGrid = document.querySelector('.features-grid');
  
  if (authenticated) {
    // Hide both login prompt and welcome message for authenticated users
    if (loginPrompt) {
      loginPrompt.hidden = true;
      loginPrompt.style.display = 'none';
      console.log('[Home] Login prompt hidden for authenticated user');
    }
    if (welcomeMessage) {
      welcomeMessage.hidden = true;
      welcomeMessage.style.display = 'none';
    }
    
    // Show feature cards for authenticated users
    if (featuresGrid) {
      featuresGrid.style.display = 'grid';
      console.log('[Home] Feature cards shown for authenticated user');
    }
    
    // Enable feature cards navigation for authenticated users
    setupFeatureCards(true);
  } else {
    // Show login prompt for unauthenticated users
    if (loginPrompt) {
      loginPrompt.hidden = false;
      loginPrompt.style.display = '';
      console.log('[Home] Login prompt shown for unauthenticated user');
    }
    if (welcomeMessage) {
      welcomeMessage.hidden = true;
      welcomeMessage.style.display = 'none';
    }
    
    // Hide feature cards for unauthenticated users
    if (featuresGrid) {
      featuresGrid.style.display = 'none';
      console.log('[Home] Feature cards hidden for unauthenticated user');
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
