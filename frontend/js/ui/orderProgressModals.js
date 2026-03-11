// frontend/js/ui/orderProgressModals.js
/**
 * Specialized modals for Order Progress Dashboard
 * Uses css/components/modals.css and buttons-nextui.css
 */

let modalContainer = null;

function ensureModalContainer() {
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'orderProgressModalContainer';
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
      return 'btn-danger';
    case 'warning':
      return 'btn-warning';
    case 'primary':
      return 'btn-primary';
    case 'success':
      return 'btn-success';
    default:
      return 'btn-primary';
  }
}

function getIconClass(variant, emojiIcon) {
  // Map emoji icons to FontAwesome equivalents
  const emojiToFontAwesome = {
    '📊': 'fa-chart-bar',
    '⚠️': 'fa-exclamation-triangle',
    '⛔': 'fa-ban',
    '👤': 'fa-user',
    '🔄': 'fa-sync-alt',
    '📋': 'fa-clipboard-list',
    '✅': 'fa-check-circle',
    '❌': 'fa-times-circle',
    'ℹ️': 'fa-info-circle',
    '🎉': 'fa-check-double'
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
    confirmVariant = 'primary',
    icon = '📊',
    showReasonInput = false,
    showUserInput = false,
    reasonPlaceholder = 'Enter reason (optional)...',
    userPlaceholder = 'Enter username...'
  } = options;

  const headerClass = getHeaderClass(confirmVariant);
  const confirmBtnClass = getConfirmButtonClass(confirmVariant);
  const iconClass = getIconClass(confirmVariant, icon);

  const reasonInputHtml = showReasonInput ? `
    <div class="form-group" style="margin-top: 1rem;">
      <label class="form-label">Reason:</label>
      <textarea 
        id="orderProgressReasonInput" 
        class="form-input" 
        placeholder="${reasonPlaceholder}"
        style="min-height: 80px; resize: vertical;"
      ></textarea>
    </div>
  ` : '';

  const userInputHtml = showUserInput ? `
    <div class="form-group" style="margin-top: 1rem;">
      <label class="form-label">Target User:</label>
      <input 
        type="text" 
        id="orderProgressUserInput" 
        class="form-input" 
        placeholder="${userPlaceholder}"
      />
    </div>
  ` : '';

  // Note: Don't add 'active' class here - it's added via JS for animation
  const modalHtml = `
    <div class="modal-backdrop" id="orderProgressConfirmModal">
      <div class="modal modal-sm">
        <div class="modal-header ${headerClass}">
          <div class="modal-header-icon">
            <i class="fas ${iconClass}"></i>
          </div>
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close modal-close-contrast" id="orderProgressModalClose">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-message">${message.replace(/\n/g, '<br>')}</p>
          ${reasonInputHtml}
          ${userInputHtml}
        </div>
        <div class="modal-footer">
          ${cancelText ? `<button class="btn btn-solid btn-default rounded-lg" id="orderProgressModalCancel">${cancelText}</button>` : ''}
          <button class="btn btn-solid ${confirmBtnClass} rounded-lg" id="orderProgressModalConfirm">
            ${confirmText}
          </button>
        </div>
      </div>
    </div>
  `;

  return modalHtml;
}

/**
 * Show a confirmation modal with optional input fields
 * @param {Object} options - Configuration options
 * @returns {Promise<Object|boolean>} - Resolves to {confirmed: boolean, reason?: string, user?: string}
 */
export function confirmModal(options = {}) {
  return new Promise((resolve) => {
    const container = ensureModalContainer();
    const modalHtml = createModal(options);
    
    container.innerHTML = modalHtml;
    
    const modal = container.querySelector('#orderProgressConfirmModal');
    const confirmBtn = container.querySelector('#orderProgressModalConfirm');
    const cancelBtn = container.querySelector('#orderProgressModalCancel');
    const closeBtn = container.querySelector('#orderProgressModalClose');
    const reasonInput = container.querySelector('#orderProgressReasonInput');
    const userInput = container.querySelector('#orderProgressUserInput');
    
    // For alerts (no cancel button), we need different behavior
    const isAlertOnly = !options.cancelText;
    
    // Trigger animation by adding active class after a frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add('active');
      });
    });
    
    // Event handlers
    const handleConfirm = () => {
      const result = {
        confirmed: true
      };
      
      if (reasonInput) {
        result.reason = reasonInput.value.trim();
      }
      
      if (userInput) {
        result.user = userInput.value.trim();
      }
      
      cleanup();
      resolve(result);
    };
    
    const handleCancel = () => {
      cleanup();
      resolve({ confirmed: false });
    };
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        // For alerts, ESC should act as confirm (OK)
        if (isAlertOnly) {
          handleConfirm();
        } else {
          handleCancel();
        }
      } else if (e.key === 'Enter' && !reasonInput) {
        // Only auto-confirm on Enter if there's no textarea (to allow newlines)
        handleConfirm();
      }
    };
    
    const cleanup = () => {
      modal.classList.remove('active');
      document.removeEventListener('keydown', handleEscape);
      setTimeout(() => {
        container.innerHTML = '';
      }, 300); // Wait for animation
    };
    
    // Bind events
    confirmBtn.addEventListener('click', handleConfirm);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }
    // For alerts, close button should act as confirm
    closeBtn.addEventListener('click', isAlertOnly ? handleConfirm : handleCancel);
    document.addEventListener('keydown', handleEscape);
    
    // Prevent event bubbling in input fields
    if (reasonInput) {
      reasonInput.addEventListener('keydown', (e) => e.stopPropagation());
    }
    if (userInput) {
      userInput.addEventListener('keydown', (e) => e.stopPropagation());
    }
    
    // Close on overlay click - but NOT for alerts
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (!isAlertOnly) {
          handleCancel();
        }
      }
    });
    
    // Focus the appropriate input or button
    setTimeout(() => {
      if (userInput) {
        userInput.focus();
      } else if (reasonInput) {
        reasonInput.focus();
      } else if (isAlertOnly) {
        confirmBtn.focus();
      } else if (cancelBtn) {
        cancelBtn.focus();
      } else {
        confirmBtn.focus();
      }
    }, 100);
  });
}

/**
 * Force Cancel Session (admin action)
 */
export function confirmForceCancel(orderNumber, currentOwner) {
  return confirmModal({
    title: 'Force Cancel Session',
    message: `Are you sure you want to force cancel the session for Order #${orderNumber}?\n\n${currentOwner ? `Current owner: ${currentOwner}` : ''}\n\nThis action will immediately terminate the session and notify the user.`,
    confirmText: 'Force Cancel',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '⛔',
    showReasonInput: true,
    reasonPlaceholder: 'Enter cancellation reason (optional)...'
  });
}

/**
 * Force Assign Session (admin action)
 */
export function confirmForceAssign(orderNumber, currentOwner) {
  return confirmModal({
    title: 'Force Assign Session',
    message: `Assign the session for Order #${orderNumber} to another user.\n\n${currentOwner ? `Current owner: ${currentOwner}\n\n` : ''}The current user will lose access to this session.`,
    confirmText: 'Assign',
    cancelText: 'Cancel',
    confirmVariant: 'warning',
    icon: '👤',
    showUserInput: true,
    userPlaceholder: 'Enter target username...'
  });
}

/**
 * Takeover Session (user action)
 */
export function confirmTakeover(orderNumber, currentOwner) {
  return confirmModal({
    title: 'Take Over Session',
    message: `Are you sure you want to take over the session for Order #${orderNumber}?\n\n${currentOwner ? `Current owner: ${currentOwner} will be notified.` : ''}`,
    confirmText: 'Take Over',
    cancelText: 'Cancel',
    confirmVariant: 'warning',
    icon: '🔄'
  });
}

/**
 * View Session Details
 */
export function showSessionDetails(session) {
  const createdAt = new Date(session.created_at).toLocaleString();
  const lastModified = session.last_modified_at 
    ? new Date(session.last_modified_at).toLocaleString()
    : 'N/A';
  
  const auditLogHtml = renderAuditLog(session.audit_logs);
  
  const detailsMessage = `Order #${session.order_number}

Invoice: ${session.invoice_number}
Session Type: ${session.session_type}
Status: ${session.status.replace('_', ' ')}
Created: ${createdAt} by ${session.created_by}
Last Modified: ${lastModified}${session.last_modified_by ? ' by ' + session.last_modified_by : ''}
${session.current_owner ? `Current Owner: ${session.current_owner}` : ''}
Progress: ${session.items_scanned} / ${session.items_expected} items (${session.progress_percentage}%)

Recent Activity:
${auditLogHtml}`;
  
  return confirmModal({
    title: 'Session Details',
    message: detailsMessage,
    confirmText: 'Close',
    cancelText: '',
    confirmVariant: 'primary',
    icon: '📋'
  });
}

function renderAuditLog(logs) {
  if (!logs || logs.length === 0) {
    return '  No activity logged yet.';
  }
  
  const recentLogs = logs.slice(-5).reverse();
  return recentLogs.map(log => {
    const timestamp = new Date(log.timestamp).toLocaleString();
    const details = log.details ? `: ${log.details}` : '';
    return `  • ${timestamp} - ${log.action.replace('_', ' ')} by ${log.user}${details}`;
  }).join('\n');
}

/**
 * Generic success alert
 */
export function alertSuccess(message, title = 'Success') {
  return confirmModal({
    title,
    message,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'success',
    icon: '✅'
  });
}

/**
 * Generic error alert
 */
export function alertError(message, title = 'Error') {
  return confirmModal({
    title,
    message,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'danger',
    icon: '❌'
  });
}

/**
 * Generic warning alert
 */
export function alertWarning(message, title = 'Warning') {
  return confirmModal({
    title,
    message,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'warning',
    icon: '⚠️'
  });
}

/**
 * Generic info alert
 */
export function alertInfo(message, title = 'Information') {
  return confirmModal({
    title,
    message,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'primary',
    icon: 'ℹ️'
  });
}

/**
 * Session action completed successfully
 */
export function alertActionCompleted(action, orderNumber) {
  const messages = {
    'assigned': `Session for Order #${orderNumber} has been successfully assigned.`,
    'cancelled': `Session for Order #${orderNumber} has been cancelled.`,
    'takeover': `You have successfully taken over Order #${orderNumber}.`
  };
  
  return confirmModal({
    title: 'Action Completed',
    message: messages[action] || 'Action completed successfully.',
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'success',
    icon: '🎉'
  });
}

/**
 * Validation error for missing required field
 */
export function alertValidationError(fieldName) {
  return confirmModal({
    title: 'Validation Error',
    message: `Please enter a ${fieldName}.`,
    confirmText: 'OK',
    cancelText: '',
    confirmVariant: 'warning',
    icon: '⚠️'
  });
}
