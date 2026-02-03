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
    case 'success':
      return 'modal-header-primary'; // Success uses primary styling with green icon
    default:
      return 'modal-header-primary';
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
    case 'success':
      return 'success-btn';
    default:
      return 'primary-btn';
  }
}

function getIconClass(variant, emojiIcon) {
  // Map emoji icons to FontAwesome equivalents
  const emojiToFontAwesome = {
    '📦': 'fa-box',
    '⚠️': 'fa-exclamation-triangle',
    '📝': 'fa-edit',
    '✅': 'fa-check-circle',
    '🔄': 'fa-sync-alt',
    '🗑️': 'fa-trash-alt',
    '▶️': 'fa-play',
    '⛔': 'fa-ban',
    '👤': 'fa-user',
    '👋': 'fa-hand-paper',
    '🎉': 'fa-check-double',
    '❌': 'fa-times-circle',
    'ℹ️': 'fa-info-circle',
    '❓': 'fa-question-circle',
    '↩️': 'fa-undo-alt',
    '📋': 'fa-clipboard-list'
  };
  
  if (emojiIcon && emojiToFontAwesome[emojiIcon]) {
    return emojiToFontAwesome[emojiIcon];
  }
  
  // Fallback based on variant
  switch (variant) {
    case 'danger':
      return 'fa-exclamation-triangle';
    case 'warning':
      return 'fa-exclamation-circle';
    case 'primary':
      return 'fa-info-circle';
    case 'success':
      return 'fa-check-circle';
    default:
      return 'fa-info-circle';
  }
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

  const headerClass = getHeaderClass(confirmVariant);
  const confirmBtnClass = getConfirmButtonClass(confirmVariant);
  const iconClass = getIconClass(confirmVariant, icon);

  // Note: Don't add 'active' class here - it's added via JS for animation
  const modalHtml = `
    <div class="modal-backdrop" id="orderFulfillmentConfirmModal">
      <div class="modal modal-sm">
        <div class="modal-header ${headerClass}">
          <div class="modal-header-icon">
            <i class="fas ${iconClass}"></i>
          </div>
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close modal-close-contrast" id="orderFulfillmentModalClose">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-message">${message.replace(/\n/g, '<br>')}</p>
        </div>
        <div class="modal-footer">
          ${cancelText ? `<button class="action-btn secondary-btn" id="orderFulfillmentModalCancel">${cancelText}</button>` : ''}
          <button class="action-btn ${confirmBtnClass}" id="orderFulfillmentModalConfirm">
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
    const modalHtml = createModal(options);
    
    container.innerHTML = modalHtml;
    
    const modal = container.querySelector('#orderFulfillmentConfirmModal');
    const confirmBtn = container.querySelector('#orderFulfillmentModalConfirm');
    const cancelBtn = container.querySelector('#orderFulfillmentModalCancel');
    const closeBtn = container.querySelector('#orderFulfillmentModalClose');
    
    console.log('[Modal] Showing modal:', options.title);
    
    // For alerts (no cancel button), we need different behavior
    const isAlertOnly = !options.cancelText;
    
    // Prevent double-handling
    let isResolved = false;
    
    // Trigger animation by adding active class after a frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add('active');
      });
    });
    
    // Event handlers
    const handleConfirm = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      if (isResolved) {
        console.log('[Modal] Already resolved, ignoring confirm');
        return;
      }
      isResolved = true;
      console.log('[Modal] Confirm clicked');
      cleanup();
      resolve(true);
    };
    
    const handleCancel = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      if (isResolved) {
        console.log('[Modal] Already resolved, ignoring cancel');
        return;
      }
      isResolved = true;
      console.log('[Modal] Cancel triggered');
      cleanup();
      resolve(false);
    };
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        // For alerts, ESC should act as confirm (OK)
        if (isAlertOnly) {
          handleConfirm();
        } else {
          handleCancel();
        }
      }
    };
    
    const cleanup = () => {
      console.log('[Modal] Cleaning up modal');
      modal.classList.remove('active');
      document.removeEventListener('keydown', handleEscape);
      setTimeout(() => {
        container.innerHTML = '';
      }, 300); // Wait for animation
    };
    
    // Delay binding events slightly to prevent click-through from previous modal
    setTimeout(() => {
      if (isResolved) return; // Already handled somehow
      
      // Bind events
      confirmBtn.addEventListener('click', handleConfirm);
      if (cancelBtn) {
        cancelBtn.addEventListener('click', handleCancel);
      }
      // For alerts, close button should act as confirm
      closeBtn.addEventListener('click', isAlertOnly ? handleConfirm : handleCancel);
      document.addEventListener('keydown', handleEscape);
      
      // Close on overlay click - but NOT for alerts
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          // Only allow overlay dismiss for confirm dialogs, not alerts
          if (!isAlertOnly) {
            handleCancel(e);
          }
          // For alerts, ignore overlay clicks - user must click OK
        }
      });
      
      // Focus the confirm button for alerts, cancel button for confirmations
      if (isAlertOnly) {
        confirmBtn.focus();
      } else if (cancelBtn) {
        cancelBtn.focus();
      } else {
        confirmBtn.focus();
      }
      
      console.log('[Modal] Events bound, modal ready for interaction');
    }, 50); // Small delay to prevent click-through
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
 * Draft Session Available - Claim or continue (for own draft)
 */
export function confirmClaimDraft(orderNumber, userName, isOwnDraft = false) {
  // For own draft, use standard 2-button modal
  if (isOwnDraft) {
    return confirmModal({
      title: 'Draft Session Available',
      message: `You have a draft session for this order.\n\nWould you like to continue where you left off?`,
      confirmText: 'Continue',
      cancelText: 'Cancel',
      confirmVariant: 'primary',
      icon: '📝'
    });
  }
  
  // For someone else's draft, use 3-button modal
  return confirmDraftFromOtherUser(orderNumber, userName);
}

/**
 * Draft from another user - Three-button modal
 * Returns: 'continue' | 'cancel' | 'cancel_order'
 */
export function confirmDraftFromOtherUser(orderNumber, userName) {
  return new Promise((resolve) => {
    const container = ensureModalContainer();
    
    const modalHtml = `
      <div class="modal-backdrop" id="orderFulfillmentConfirmModal">
        <div class="modal modal-sm">
          <div class="modal-header modal-header-warning">
            <div class="modal-header-icon">
              <i class="fas fa-user-edit"></i>
            </div>
            <h3 class="modal-title">Draft Started by Another User</h3>
            <button class="modal-close modal-close-contrast" id="orderFulfillmentModalClose">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-message">This order was originally drafted/started by <strong>${userName}</strong>.<br><br>What would you like to do?</p>
          </div>
          <div class="modal-footer" style="flex-direction: column; gap: 8px;">
            <div style="display: flex; gap: 8px; width: 100%;">
              <button class="action-btn secondary-btn" id="orderFulfillmentModalCancel" style="flex: 1;">Go Back</button>
              <button class="action-btn primary-btn" id="orderFulfillmentModalContinue" style="flex: 1;">Continue Draft</button>
            </div>
            <button class="action-btn danger-btn" id="orderFulfillmentModalCancelOrder" style="width: 100%;">
              <i class="fas fa-times-circle"></i> Cancel Order
            </button>
          </div>
        </div>
      </div>
    `;
    
    container.innerHTML = modalHtml;
    
    const modal = container.querySelector('#orderFulfillmentConfirmModal');
    const continueBtn = container.querySelector('#orderFulfillmentModalContinue');
    const cancelBtn = container.querySelector('#orderFulfillmentModalCancel');
    const cancelOrderBtn = container.querySelector('#orderFulfillmentModalCancelOrder');
    const closeBtn = container.querySelector('#orderFulfillmentModalClose');
    
    let isResolved = false;
    
    // Trigger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add('active');
      });
    });
    
    const cleanup = () => {
      modal.classList.remove('active');
      document.removeEventListener('keydown', handleEscape);
      setTimeout(() => {
        container.innerHTML = '';
      }, 300);
    };
    
    const handleContinue = (e) => {
      if (e) e.stopPropagation();
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve('continue');
    };
    
    const handleCancel = (e) => {
      if (e) e.stopPropagation();
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve('cancel');
    };
    
    const handleCancelOrder = (e) => {
      if (e) e.stopPropagation();
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve('cancel_order');
    };
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel(e);
      }
    };
    
    // Bind events
    setTimeout(() => {
      if (isResolved) return;
      continueBtn.addEventListener('click', handleContinue);
      cancelBtn.addEventListener('click', handleCancel);
      cancelOrderBtn.addEventListener('click', handleCancelOrder);
      closeBtn.addEventListener('click', handleCancel);
      document.addEventListener('keydown', handleEscape);
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          handleCancel(e);
        }
      });
      
      continueBtn.focus();
    }, 50);
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
 * Shows different messages for picking vs checking phases
 * @param {string} orderNumber - The order number
 * @param {object} sessionInfo - Optional session info { status, items_scanned_count }
 */
export function confirmCancelSession(orderNumber, sessionInfo = {}) {
  const { status, items_scanned_count = 0 } = sessionInfo;
  
  // During ACTIVE picking (in_progress) with scanned items - warn about inventory return
  if (status === 'in_progress' && items_scanned_count > 0) {
    return confirmModal({
      title: 'Cancel Session - Items Will Be Returned',
      message: `⚠️ You have ${items_scanned_count} item(s) already scanned.\n\n` +
        `Cancelling will automatically return all scanned items to their original inventory locations.\n\n` +
        `Please ensure any physically picked items are returned to their shelves before confirming.`,
      confirmText: 'Cancel & Return Items',
      cancelText: 'Keep Working',
      confirmVariant: 'danger',
      icon: '↩️'
    });
  }
  
  // Draft session with items - should resume first, but if cancelled items won't auto-return
  if (status === 'draft' && items_scanned_count > 0) {
    return confirmModal({
      title: 'Cancel Draft Session',
      message: `⚠️ This draft has ${items_scanned_count} item(s) that were previously scanned.\n\n` +
        `To return items to inventory, resume the session first, then cancel.\n\n` +
        `Cancelling now will NOT return items automatically.`,
      confirmText: 'Cancel Draft',
      cancelText: 'Keep Draft',
      confirmVariant: 'danger',
      icon: '📋'
    });
  }
  
  // During ready_to_check (checking phase) - items stay out, not returned
  if (status === 'ready_to_check' && items_scanned_count > 0) {
    return confirmModal({
      title: 'Cancel Checking',
      message: `⚠️ This order has ${items_scanned_count} item(s) that were already picked.\n\n` +
        `Cancelling will NOT return items to inventory - they remain physically picked.\n\n` +
        `To return items to inventory, first "Send Back to Picking" then cancel from there.`,
      confirmText: 'Cancel Checking',
      cancelText: 'Keep Checking',
      confirmVariant: 'danger',
      icon: '❌'
    });
  }
  
  // Default - no items scanned or unknown status
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

/**
 * Generic confirm dialog
 */
export function confirm(title, message) {
  return confirmModal({
    title,
    message,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    confirmVariant: 'primary',
    icon: '❓'
  });
}

/**
 * Generic alert dialog
 */
export function alert(title, message) {
  return confirmModal({
    title,
    message,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'primary',
    icon: 'ℹ️'
  });
}
