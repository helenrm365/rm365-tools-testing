// frontend/js/ui/confirmationModal.js
/**
 * Modern confirmation modal component
 * Uses css-new/components/modals.css and buttons.css
 */

let modalContainer = null;

function ensureModalContainer() {
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'confirmationModalContainer';
    modalContainer.style.position = 'relative';
    modalContainer.style.zIndex = '9999';
    document.body.appendChild(modalContainer);
  }
  return modalContainer;
}

function getHeaderClass(variant) {
  switch (variant) {
    case 'danger':
      return 'modal-header-danger';
    case 'warning':
      return 'modal-header-warning';
    case 'primary':
      return 'modal-header-primary';
    default:
      return 'modal-header-danger';
  }
}

function getConfirmButtonClass(variant) {
  switch (variant) {
    case 'danger':
      return 'danger-btn';
    case 'warning':
      return 'warning-btn';
    case 'primary':
      return 'primary-btn';
    default:
      return 'danger-btn';
  }
}

function getIconClass(variant) {
  switch (variant) {
    case 'danger':
      return 'fa-trash-alt';
    case 'warning':
      return 'fa-exclamation-triangle';
    case 'primary':
      return 'fa-question-circle';
    default:
      return 'fa-exclamation-triangle';
  }
}

function createConfirmationModal(options) {
  const {
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmVariant = 'danger',
    icon = null
  } = options;

  const headerClass = getHeaderClass(confirmVariant);
  const confirmBtnClass = getConfirmButtonClass(confirmVariant);
  const iconClass = icon || getIconClass(confirmVariant);

  // Note: Don't add 'active' class here - it's added via JS for animation
  const modalHtml = `
    <div class="modal-backdrop" id="confirmationModal">
      <div class="modal modal-sm">
        <div class="modal-header ${headerClass}">
          <div class="modal-header-icon">
            <i class="fas ${iconClass}"></i>
          </div>
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close modal-close-contrast" id="confirmModalClose">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-message">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="action-btn secondary-btn" id="confirmModalCancel">
            ${cancelText}
          </button>
          <button class="action-btn ${confirmBtnClass}" id="confirmModalConfirm">
            ${confirmText}
          </button>
        </div>
      </div>
    </div>
  `;

  return modalHtml;
}

/**
 * Show a confirmation modal
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
 */
export function confirmModal(options = {}) {
  return new Promise((resolve) => {
    const container = ensureModalContainer();
    
    // Find and hide any currently open modal (to show confirmation on top)
    const openModals = document.querySelectorAll('.modal-overlay.active, .modal-backdrop.active');
    const previousModal = Array.from(openModals).find(m => m.id !== 'confirmationModal' && !m.closest('#confirmationModalContainer'));
    
    if (previousModal) {
      previousModal.classList.remove('active');
    }
    
    const modalHtml = createConfirmationModal(options);
    container.innerHTML = modalHtml;
    
    const modal = container.querySelector('#confirmationModal');
    const confirmBtn = container.querySelector('#confirmModalConfirm');
    const cancelBtn = container.querySelector('#confirmModalCancel');
    const closeBtn = container.querySelector('#confirmModalClose');
    
    // Trigger animation by adding active class after a frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add('active');
      });
    });
    
    // Event handlers
    const handleConfirm = () => {
      cleanup(false); // Don't restore previous modal on confirm
      resolve(true);
    };
    
    const handleCancel = () => {
      cleanup(true); // Restore previous modal on cancel
      resolve(false);
    };
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    const cleanup = (restorePrevious) => {
      modal.classList.remove('active');
      document.removeEventListener('keydown', handleEscape);
      
      setTimeout(() => {
        container.innerHTML = '';
        
        // Restore previous modal if cancelled/closed
        if (restorePrevious && previousModal) {
          previousModal.classList.add('active');
        }
      }, 300); // Wait for animation
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
    icon: 'fas fa-trash-alt'
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
    icon: 'fas fa-trash-alt'
  });
}