// frontend/js/ui/orderProgressModals.js
/**
 * Specialized modals for Order Progress Dashboard
 * Uses the same styling approach as confirmationModal.js but with admin-specific contexts
 */

let modalContainer = null;

function ensureModalContainer() {
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'orderProgressModalContainer';
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
    confirmVariant = 'primary',
    icon = '📊',
    showReasonInput = false,
    showUserInput = false,
    reasonPlaceholder = 'Enter reason (optional)...',
    userPlaceholder = 'Enter username...'
  } = options;

  const headerStyle = getHeaderStyle(confirmVariant);

  const reasonInputHtml = showReasonInput ? `
    <div style="margin-top: 1rem;">
      <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-primary);">Reason:</label>
      <textarea 
        id="orderProgressReasonInput" 
        class="modal-input" 
        placeholder="${reasonPlaceholder}"
        style="width: 100%; min-height: 80px; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 6px; font-family: inherit; resize: vertical; background: var(--bg-primary); color: var(--text-primary);"
      ></textarea>
    </div>
  ` : '';

  const userInputHtml = showUserInput ? `
    <div style="margin-top: 1rem;">
      <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-primary);">Target User:</label>
      <input 
        type="text" 
        id="orderProgressUserInput" 
        class="modal-input" 
        placeholder="${userPlaceholder}"
        style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 6px; font-family: inherit; background: var(--bg-primary); color: var(--text-primary);"
      />
    </div>
  ` : '';

  const modalHtml = `
    <div class="modal-overlay active" id="orderProgressConfirmModal">
      <div class="modal-content" style="max-width: 450px; animation: modalSlideIn 0.3s ease-out;">
        <div class="modal-header" style="${headerStyle}">
          <h3 class="modal-title" style="color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 0.75rem;">
            <span style="background: rgba(255,255,255,0.2); border-radius: 8px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.2);">${icon}</span>
            <span>${title}</span>
          </h3>
          <button class="modal-close modal-close-contrast" id="orderProgressModalClose">&times;</button>
        </div>
        <div class="modal-body" style="padding-top: 0;">
          <p class="modal-message" style="white-space: pre-line; line-height: 1.6;">
            ${message}
          </p>
          ${reasonInputHtml}
          ${userInputHtml}
        </div>
        <div class="modal-footer" style="display: flex; gap: 0.75rem; justify-content: flex-end; padding: 1rem 1.5rem;">
          ${cancelText ? `<button class="modern-button" id="orderProgressModalCancel" style="background: #6c757d; color: white;">
            ${cancelText}
          </button>` : ''}
          <button class="modern-button" id="orderProgressModalConfirm" style="background: ${getVariantColor(confirmVariant)}; color: white;">
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
        handleCancel();
      } else if (e.key === 'Enter' && !reasonInput) {
        // Only auto-confirm on Enter if there's no textarea (to allow newlines)
        handleConfirm();
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
    
    // Prevent event bubbling in input fields
    if (reasonInput) {
      reasonInput.addEventListener('keydown', (e) => e.stopPropagation());
    }
    if (userInput) {
      userInput.addEventListener('keydown', (e) => e.stopPropagation());
    }
    
    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
    
    // Focus the appropriate input or button
    setTimeout(() => {
      if (userInput) {
        userInput.focus();
      } else if (reasonInput) {
        reasonInput.focus();
      } else {
        cancelBtn.focus();
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
