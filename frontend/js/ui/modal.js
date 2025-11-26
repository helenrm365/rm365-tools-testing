/**
 * Modal utility for showing styled alerts and confirmations
 */

/**
 * Show a notification modal (replaces alert)
 * @param {string} message - The message to display
 * @param {string} type - Type of notification: 'success', 'error', 'warning', 'info'
 * @param {string} title - Optional custom title
 * @returns {Promise<void>}
 */
export function showNotification(message, type = 'info', title = null) {
  return new Promise((resolve) => {
    const modal = document.getElementById('notificationModal');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');
    const iconEl = document.getElementById('notificationIcon');
    const okBtn = document.getElementById('notificationOkBtn');
    const closeBtn = document.getElementById('closeNotificationBtn');

    if (!modal) {
      // Fallback to alert if modal doesn't exist
      alert(message);
      resolve();
      return;
    }

    // Set title based on type
    const titles = {
      success: 'Success',
      error: 'Error',
      warning: 'Warning',
      info: 'Information'
    };
    titleEl.textContent = title || titles[type] || 'Notification';

    // Set icon based on type
    const icons = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };
    
    iconEl.className = 'notification-icon ' + type;
    iconEl.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i>`;

    // Set message
    messageEl.textContent = message;

    // Show modal
    modal.style.display = 'flex';

    // Handle close
    const closeHandler = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', closeHandler);
      closeBtn.removeEventListener('click', closeHandler);
      resolve();
    };

    okBtn.addEventListener('click', closeHandler);
    closeBtn.addEventListener('click', closeHandler);

    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeHandler();
      }
    });
  });
}

/**
 * Show a confirmation modal (replaces confirm)
 * @param {string} message - The message to display
 * @param {string} title - Optional custom title
 * @param {string} okText - Text for OK button (default: 'OK')
 * @param {string} cancelText - Text for Cancel button (default: 'Cancel')
 * @returns {Promise<boolean>} - True if confirmed, false if cancelled
 */
export function showConfirm(message, title = 'Confirm', okText = 'OK', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmationModal');
    const titleEl = document.getElementById('confirmationTitle');
    const messageEl = document.getElementById('confirmationMessage');
    const okBtn = document.getElementById('confirmationOkBtn');
    const cancelBtn = document.getElementById('confirmationCancelBtn');
    const closeBtn = document.getElementById('closeConfirmationBtn');

    if (!modal) {
      // Fallback to confirm if modal doesn't exist
      resolve(confirm(message));
      return;
    }

    // Set title and message
    titleEl.textContent = title;
    messageEl.textContent = message;

    // Set button text
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    // Show modal
    modal.style.display = 'flex';

    // Handle OK
    const okHandler = () => {
      modal.style.display = 'none';
      cleanup();
      resolve(true);
    };

    // Handle Cancel
    const cancelHandler = () => {
      modal.style.display = 'none';
      cleanup();
      resolve(false);
    };

    // Cleanup event listeners
    const cleanup = () => {
      okBtn.removeEventListener('click', okHandler);
      cancelBtn.removeEventListener('click', cancelHandler);
      closeBtn.removeEventListener('click', cancelHandler);
    };

    okBtn.addEventListener('click', okHandler);
    cancelBtn.addEventListener('click', cancelHandler);
    closeBtn.addEventListener('click', cancelHandler);

    // Close on background click = cancel
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelHandler();
      }
    });
  });
}

/**
 * Helper function for success notifications
 */
export function showSuccess(message, title = 'Success') {
  return showNotification(message, 'success', title);
}

/**
 * Helper function for error notifications
 */
export function showError(message, title = 'Error') {
  return showNotification(message, 'error', title);
}

/**
 * Helper function for warning notifications
 */
export function showWarning(message, title = 'Warning') {
  return showNotification(message, 'warning', title);
}

/**
 * Helper function for info notifications
 */
export function showInfo(message, title = 'Information') {
  return showNotification(message, 'info', title);
}
