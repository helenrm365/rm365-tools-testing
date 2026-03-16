// frontend/js/ui/theme.js
import { get, put } from '/js/services/api/http.js';
import { showToast } from '/js/ui/toast.js';

/**
 * Toggles the theme between light and dark mode.
 * Updates the UI and saves the preference to localStorage and the backend.
 */
export function toggleTheme() {
  const isDark = !document.documentElement.classList.contains('dark-mode');
  setTheme(isDark);
}

/**
 * Sets the theme to a specific state (dark or light).
 * @param {boolean} isDark - True for dark mode, false for light mode.
 */
export function setTheme(isDark) {
  document.documentElement.classList.toggle('dark-mode', isDark);
  localStorage.setItem('darkMode', String(isDark));
  updateThemeToggles(isDark);
  saveThemePreference(isDark);
}

/**
 * Saves the user's theme preference to the backend.
 * @param {boolean} isDark - The current theme state.
 */
async function saveThemePreference(isDark) {
  try {
    const existingPrefs = await get('/v1/users/preferences') || {};
    const newPrefs = { ...existingPrefs, dark_mode: isDark };
    await put('/v1/users/preferences', newPrefs);
  } catch (error) {
    console.error('Failed to save theme preference:', error);
    showToast('Could not save theme preference.', 'error');
  }
}

/**
 * Updates the state of all theme toggles on the page.
 * @param {boolean} isDark - The current theme state.
 */
export function updateThemeToggles(isDark) {
  // Sidebar toggle
  const sidebarToggle = document.getElementById('sidebarThemeToggle');
  if (sidebarToggle) {
    const icon = sidebarToggle.querySelector('.sidebar-item-icon i');
    if (icon) {
      icon.classList.toggle('fa-moon', !isDark);
      icon.classList.toggle('fa-sun', isDark);
    }
    const label = sidebarToggle.querySelector('.sidebar-footer-label');
    if (label) {
      label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
    }
  }

  // User settings toggle
  const settingsToggle = document.getElementById('darkModeToggle');
  if (settingsToggle) {
    settingsToggle.checked = isDark;
  }
}

/**
 * Initializes the theme based on user preference or system settings.
 */
export function initTheme() {
  const stored = localStorage.getItem('darkMode');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = stored === 'true' || (stored === null && prefersDark);
  // Set theme without saving, to avoid a pointless API call on page load.
  document.documentElement.classList.toggle('dark-mode', isDark);
  localStorage.setItem('darkMode', String(isDark));
  updateThemeToggles(isDark);
}
