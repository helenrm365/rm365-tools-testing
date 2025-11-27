// frontend/js/ui/orderFulfillmentModals.js
/**
 * Specialized confirmation modals for Order Fulfillment
 * Uses the same styling approach as confirmationModal.js but with inventory-specific contexts
 */

let modalContainer = null;

function ensureModalContainer() {
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'orderFulfillmentModalContainer';
    document.body.appendChild(modalContainer);
  }
  return modalContainer;
}

function createModal(options) {
  const {
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmVariant = 'primary', // 'danger', 'warning', 'primary', 'success'
    icon = '📦'
  } = options;

  const headerStyle = getHeaderStyle(confirmVariant);

  const modalHtml = `
    <div class="modal-overlay active" id="orderFulfillmentConfirmModal">
      <div class="modal-content" style="max-width: 450px; animation: modalSlideIn 0.3s ease-out;">
        <div class="modal-header" style="${headerStyle}">
          <h3 class="modal-title" style="color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 0.75rem;">
            <span style="background: rgba(255,255,255,0.2); border-radius: 8px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.2);">${icon}</span>
            <span>${title}</span>
          </h3>
          <button class="modal-close modal-close-contrast" id="orderFulfillmentModalClose">&times;</button>
        </div>
        <div class="modal-body" style="padding-top: 0;">
          <p class="modal-message" style="white-space: pre-line; line-height: 1.6;">
            ${message}
          </p>
        </div>
        <div class="modal-footer" style="display: flex; gap: 0.75rem; justify-content: flex-end; padding: 1rem 1.5rem;">
          ${cancelText ? `<button class="modern-button" id="orderFulfillmentModalCancel" style="background: #6c757d; color: white;">${cancelText}</button>` : ''}
          <button class="modern-button" id="orderFulfillmentModalConfirm" style="background: ${getVariantColor(confirmVariant)}; color: white;">
            ${confirmText}
          </button>
        </div>
      </div>
    </div>
  `;

  return modalHtml;
}

function getHeaderStyle(variant) {
  switch (variant) {
    case 'danger':
      return 'background: linear-gradient(to right, #e74c3c, #c0392b); border-bottom: none;';
    case 'warning':
      return 'background: linear-gradient(to right, #f39c12, #e67e22); border-bottom: none;';
    case 'primary':
      return 'background: linear-gradient(to right, #3498db, #2980b9); border-bottom: none;';
    case 'success':
      return 'background: linear-gradient(to right, #27ae60, #229954); border-bottom: none;';
    default:
      return 'background: linear-gradient(to right, #3498db, #2980b9); border-bottom: none;';
  }
}

function getVariantColor(variant) {
  switch (variant) {
    case 'danger':
      return 'linear-gradient(to bottom right, #e74c3c, #c0392b)';
    case 'warning':
      return 'linear-gradient(to bottom right, #f39c12, #e67e22)';
    case 'primary':
      return 'linear-gradient(to bottom right, #3498db, #2980b9)';
    case 'success':
      return 'linear-gradient(to bottom right, #27ae60, #229954)';
    default:
      return 'linear-gradient(to bottom right, #3498db, #2980b9)';
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
    const modalHtml = createModal(options);
    
    container.innerHTML = modalHtml;
    
    const modal = container.querySelector('#orderFulfillmentConfirmModal');
    const confirmBtn = container.querySelector('#orderFulfillmentModalConfirm');
    const cancelBtn = container.querySelector('#orderFulfillmentModalCancel');
    const closeBtn = container.querySelector('#orderFulfillmentModalClose');
    
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
    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }
    closeBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    
    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
    
    // Focus the cancel button by default for safety (prevents accidental confirms)
    setTimeout(() => {
      if (cancelBtn) {
        cancelBtn.focus();
      } else {
        confirmBtn.focus();
      }
    }, 100);
  });
}

/**
 * Order In Progress - Request takeover
 */
export function confirmTakeoverRequest(orderNumber, currentUser) {
  return confirmModal({
    title: 'Order In Progress',
    message: `This order is currently being worked on by ${currentUser}.\n\nWould you like to request to take it over?`,
    confirmText: 'Request Takeover',
    cancelText: 'Cancel',
    confirmVariant: 'warning',
    icon: '⚠️'
  });
}

/**
 * Own order in progress elsewhere
 */
export function confirmOwnOrderInProgress() {
  return confirmModal({
    title: 'Order In Progress',
    message: 'This order is being worked on by you in another session.\n\nPlease complete or cancel that session first.',
    confirmText: 'OK',
    cancelText: 'Close',
    confirmVariant: 'warning',
    icon: '⚠️'
  });
}

/**
 * Draft Session Available - Claim or continue
 */
export function confirmClaimDraft(orderNumber, userName, isOwnDraft = false) {
  const message = isOwnDraft
    ? `You have a draft session for this order.\n\nWould you like to continue where you left off?`
    : `There is a draft session for this order started by ${userName}.\n\nWould you like to claim it and continue?`;
  
  return confirmModal({
    title: 'Draft Session Available',
    message,
    confirmText: 'Continue',
    cancelText: 'Cancel',
    confirmVariant: 'primary',
    icon: '📝'
  });
}

/**
 * Order Already Completed
 */
export function alertOrderCompleted(orderNumber, completedBy) {
  return confirmModal({
    title: 'Order Completed',
    message: `This order has already been completed.\n\nCompleted by: ${completedBy}\n\nYou cannot start a new session for completed orders.`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'primary',
    icon: '✅'
  });
}

/**
 * Cancelled Session - Start Fresh
 */
export function confirmStartAfterCancelled(orderNumber) {
  return confirmModal({
    title: 'Cancelled Session',
    message: 'There is a cancelled session for this order.\n\nWould you like to start a fresh session?',
    confirmText: 'Start Fresh',
    cancelText: 'Cancel',
    confirmVariant: 'primary',
    icon: '🔄'
  });
}

/**
 * Complete Session Confirmation
 */
export function confirmCompleteSession(orderNumber) {
  return confirmModal({
    title: 'Complete Session',
    message: 'Are you sure you want to complete this session?\n\nThis will finalize all scanned items.',
    confirmText: 'Complete',
    cancelText: 'Cancel',
    confirmVariant: 'success',
    icon: '✅'
  });
}

/**
 * Cancel Session Confirmation (destructive)
 */
export function confirmCancelSession(orderNumber) {
  return confirmModal({
    title: 'Cancel Session',
    message: 'Are you sure you want to cancel this session?\n\nAll progress will be lost and cannot be recovered.',
    confirmText: 'Cancel Session',
    cancelText: 'Keep Working',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
}

/**
 * Resume Active Session
 */
export function confirmResumeSession(orderNumber) {
  return confirmModal({
    title: 'Resume Session',
    message: `You have an active session for order ${orderNumber}.\n\nWould you like to resume where you left off?`,
    confirmText: 'Resume',
    cancelText: 'Start New',
    confirmVariant: 'primary',
    icon: '▶️'
  });
}

/**
 * Session Transferred notification
 */
export function alertSessionTransferred(newOwner) {
  return confirmModal({
    title: 'Session Transferred',
    message: `This session has been transferred to ${newOwner}.`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'warning',
    icon: '🔄'
  });
}

/**
 * Session Force Cancelled
 */
export function alertSessionForceCancelled(reason = '') {
  const reasonText = reason ? `\n\nReason: ${reason}` : '';
  return confirmModal({
    title: 'Session Cancelled',
    message: `This session has been cancelled by an administrator.${reasonText}`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'danger',
    icon: '⛔'
  });
}

/**
 * Session Force Taken Over
 */
export function alertSessionForceTakeover(newOwner) {
  return confirmModal({
    title: 'Session Taken Over',
    message: `This session has been taken over by ${newOwner}.`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'warning',
    icon: '👤'
  });
}

/**
 * Takeover Request Received (from another user)
 */
export function confirmAllowTakeover(requesterUsername, orderNumber) {
  return confirmModal({
    title: 'Takeover Request',
    message: `${requesterUsername} is requesting to take over your session for order ${orderNumber}.\n\nDo you want to allow this takeover?`,
    confirmText: 'Allow',
    cancelText: 'Deny',
    confirmVariant: 'warning',
    icon: '👋'
  });
}

/**
 * Success notification for completed session
 */
export function alertSessionCompleted() {
  return confirmModal({
    title: 'Session Completed',
    message: 'Session completed successfully!\n\nYou can now start a new order.',
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'success',
    icon: '🎉'
  });
}

/**
 * Takeover Request Accepted
 */
export function alertTakeoverAccepted(orderNumber) {
  return confirmModal({
    title: 'Request Accepted',
    message: `Your takeover request for order ${orderNumber} was accepted!`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'success',
    icon: '✅'
  });
}

/**
 * Takeover Request Rejected
 */
export function alertTakeoverRejected(orderNumber) {
  return confirmModal({
    title: 'Request Rejected',
    message: `Your takeover request for order ${orderNumber} was rejected.`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'warning',
    icon: '❌'
  });
}

/**
 * Generic error alert
 */
export function alertError(errorMessage, title = 'Error') {
  return confirmModal({
    title,
    message: errorMessage,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'danger',
    icon: '❌'
  });
}

/**
 * Generic info alert
 */
export function alertInfo(infoMessage, title = 'Information') {
  return confirmModal({
    title,
    message: infoMessage,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'primary',
    icon: 'ℹ️'
  });
}
