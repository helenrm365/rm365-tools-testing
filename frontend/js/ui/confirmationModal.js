// frontend/js/ui/confirmationModal.js
/**
 * Modern confirmation modal component
 * Provides a better UX than browser's native confirm() dialog
 */

let modalContainer = null;

function ensureModalContainer() {
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'confirmationModalContainer';
    document.body.appendChild(modalContainer);
  }
  return modalContainer;
}

function createConfirmationModal(options) {
  const {
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmVariant = 'danger', // 'danger', 'warning', 'primary'
    icon = '⚠️'
  } = options;

  const modalHtml = `
    <div class="modal-overlay active" id="confirmationModal">
      <div class="modal-content" style="max-width: 450px; animation: modalSlideIn 0.3s ease-out;">
        <div class="modal-header">
          <h3 class="modal-title">${icon} ${title}</h3>
          <button class="modal-close" id="confirmModalClose">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin: 0 0 1.5rem 0; font-size: 1rem; line-height: 1.5; color: #555;">
            ${message}
          </p>
        </div>
        <div class="modal-footer" style="display: flex; gap: 0.75rem; justify-content: flex-end;">
          <button class="modern-button" id="confirmModalCancel" style="background: #6c757d; color: white;">
            ${cancelText}
          </button>
          <button class="modern-button" id="confirmModalConfirm" style="background: ${getVariantColor(confirmVariant)}; color: white;">
            ${confirmText}
          </button>
        </div>
      </div>
    </div>
  `;

  return modalHtml;
}

function getVariantColor(variant) {
  switch (variant) {
    case 'danger':
      return 'linear-gradient(to bottom right, #e74c3c, #c0392b)';
    case 'warning':
      return 'linear-gradient(to bottom right, #f39c12, #e67e22)';
    case 'primary':
      return 'linear-gradient(to bottom right, #3498db, #2980b9)';
    default:
      return 'linear-gradient(to bottom right, #e74c3c, #c0392b)';
  }
}

/**
 * Show a confirmation modal
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
 */
export function confirmModal(options = {}) {
  return new Promise((resolve) => {
    const container = ensureModalContainer();
    const modalHtml = createConfirmationModal(options);
    
    container.innerHTML = modalHtml;
    
    const modal = container.querySelector('#confirmationModal');
    const confirmBtn = container.querySelector('#confirmModalConfirm');
    const cancelBtn = container.querySelector('#confirmModalCancel');
    const closeBtn = container.querySelector('#confirmModalClose');
    
    // Event handlers
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    const cleanup = () => {
      modal.classList.remove('active');
      setTimeout(() => {
        container.innerHTML = '';
      }, 300); // Wait for animation
      document.removeEventListener('keydown', handleEscape);
    };
    
    // Bind events
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    
    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
    
    // Focus the confirm button for better UX
    setTimeout(() => {
      confirmBtn.focus();
    }, 100);
  });
}

/**
 * Shorthand for bulk delete confirmation
 * @param {number} count - Number of items to delete
 * @param {string} itemType - Type of items (e.g., 'employees', 'records')
 * @returns {Promise<boolean>}
 */
export function confirmBulkDelete(count, itemType = 'items') {
  return confirmModal({
    title: 'Bulk Delete Confirmation',
    message: `You are about to permanently delete ${count} ${itemType}. This action cannot be undone.`,
    confirmText: `Delete ${count} ${itemType}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
}

/**
 * Shorthand for single item delete confirmation
 * @param {string} itemName - Name of the item to delete
 * @param {string} itemType - Type of item (e.g., 'employee', 'record')
 * @returns {Promise<boolean>}
 */
export function confirmDelete(itemName, itemType = 'item') {
  return confirmModal({
    title: 'Delete Confirmation',
    message: `Are you sure you want to delete ${itemType} "${itemName}"? This action cannot be undone.`,
    confirmText: `Delete ${itemType}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
}