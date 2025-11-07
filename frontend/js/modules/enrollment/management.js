// js/modules/enrollment/management.js
import { getEmployees,
    createEmployee, updateEmployee, deleteEmployee,
    bulkDeleteEmployees } from '../../services/api/enrollmentApi.js';


let state = {
  employees: [],
  query: '',
  status: '',
  location: '',
  selectedIds: new Set(),
};

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function renderTable() {
  const grid = $('#enrEmployeeGrid');
  if (!grid) return;

  const rows = state.employees
    .filter(e => !state.status || (e.status || 'active').toLowerCase() === state.status)
    .filter(e => !state.location || (e.location || '').toUpperCase() === state.location)
    .filter(e => {
      const q = state.query.trim().toLowerCase();
      if (!q) return true;
      const hay = `${e.name} ${e.employee_code} ${e.location || ''} ${e.card_uid || ''}`.toLowerCase();
      return hay.includes(q);
    });

  // Update employee count
  const countEl = $('#employeeCount');
  if (countEl) {
    const total = state.employees.length;
    const shown = rows.length;
    if (shown === total) {
      countEl.textContent = `${total} employee${total !== 1 ? 's' : ''} total`;
    } else {
      countEl.textContent = `Showing ${shown} of ${total} employee${total !== 1 ? 's' : ''}`;
    }
  }

  if (!rows.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No employees found</h3>
        <p>Try adjusting your filters or create a new employee</p>
      </div>`;
    return;
  }

  grid.innerHTML = rows.map(e => `
    <div class="employee-card" data-id="${e.id}">
      <div class="card-header-section">
        <div class="checkbox-wrapper">
          <input type="checkbox" class="employee-checkbox" data-id="${e.id}" ${state.selectedIds.has(e.id) ? 'checked' : ''}>
        </div>
        <div class="employee-info">
          <div class="employee-name-section">
            <input class="employee-name-input" value="${e.name || ''}" placeholder="Employee Name">
            <span class="employee-code">#${e.employee_code || 'N/A'}</span>
          </div>
          <div class="employee-meta">
            <span class="meta-badge location-badge">${e.location || 'N/A'}</span>
            <span class="meta-badge status-badge status-${(e.status || 'active').toLowerCase()}">
              ${(e.status || 'active').charAt(0).toUpperCase() + (e.status || 'active').slice(1)}
            </span>
          </div>
        </div>
      </div>
      
      <div class="card-details">
        <div class="detail-row">
          <label class="detail-label">Location</label>
          <select class="detail-select location-select">
            <option ${e.location === 'UK' ? 'selected' : ''} value="UK">🇬🇧 United Kingdom</option>
            <option ${e.location === 'FR' ? 'selected' : ''} value="FR">🇫🇷 France</option>
          </select>
        </div>
        
        <div class="detail-row">
          <label class="detail-label">Status</label>
          <select class="detail-select status-select">
            <option ${!e.status || e.status === 'active' ? 'selected' : ''} value="active">✅ Active</option>
            <option ${e.status === 'inactive' ? 'selected' : ''} value="inactive">⏸️ Inactive</option>
          </select>
        </div>
        
        <div class="detail-row">
          <label class="detail-label">Card UID</label>
          <input class="detail-input card-input" value="${e.card_uid || ''}" placeholder="No card assigned">
        </div>
        
        <div class="detail-row">
          <label class="detail-label">Fingerprint</label>
          <div class="fingerprint-status">
            <span class="status-indicator ${e.has_fingerprint ? 'active' : 'inactive'}"></span>
            <span>${e.has_fingerprint ? 'Enrolled' : 'Not enrolled'}</span>
          </div>
        </div>
      </div>
      
      <div class="card-actions">
        <button class="btn-save">
          <span class="btn-icon">💾</span>
          <span>Save Changes</span>
        </button>
        <button class="btn-delete">
          <span class="btn-icon">🗑️</span>
          <span>Delete</span>
        </button>
      </div>
    </div>
  `).join('');

  // Wire up event listeners
  wireCardEvents();
}

function wireCardEvents() {
  // Checkbox selection
  $all('.employee-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      updateBulkDeleteButton();
    });
  });

  // Save button
  $all('.btn-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.employee-card');
      const id = Number(card.dataset.id);
      const name = card.querySelector('.employee-name-input').value.trim();
      const location = card.querySelector('.location-select').value;
      const status = card.querySelector('.status-select').value;
      const card_uid = card.querySelector('.card-input').value.trim() || null;

      if (!name) {
        notify('❌ Employee name is required', true);
        return;
      }

      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span><span>Saving...</span>';
      
      try {
        await updateEmployee(id, { name, location, status, card_uid });
        notify('✅ Changes saved successfully');
        await refresh();
      } catch (e) {
        notify('❌ Save failed: ' + e.message, true);
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  });

  // Delete button
  $all('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.employee-card');
      const id = Number(card.dataset.id);
      const name = card.querySelector('.employee-name-input').value.trim();
      
      const confirmed = await confirmDelete(name, 'employee');
      if (!confirmed) return;
      
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span><span>Deleting...</span>';
      
      try {
        await deleteEmployee(id);
        notify('✅ Employee deleted successfully');
        state.selectedIds.delete(id);
        await refresh();
      } catch (e) {
        notify('❌ Delete failed: ' + e.message, true);
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  });
}

function updateBulkDeleteButton() {
  const bulkBtn = $('#enrBulkDeleteBtn');
  if (!bulkBtn) return;
  
  const count = state.selectedIds.size;
  if (count > 0) {
    bulkBtn.innerHTML = `<span class="btn-icon">🗑️</span><span>Delete Selected (${count})</span>`;
    bulkBtn.disabled = false;
  } else {
    bulkBtn.innerHTML = '<span class="btn-icon">🗑️</span><span>Delete Selected</span>';
    bulkBtn.disabled = true;
  }
}

function wireToolbar() {
  const createBtn = $('#enrCreateBtn');
  const bulkBtn = $('#enrBulkDeleteBtn');
  const searchBox = $('#employeeSearch');
  const statusFilter = $('#statusFilter');
  const locationFilter = $('#locationFilter');

  // Search functionality
  searchBox?.addEventListener('input', () => {
    state.query = searchBox.value;
    renderTable();
  });

  // Status filter
  statusFilter?.addEventListener('change', () => {
    state.status = statusFilter.value;
    renderTable();
  });

  // Location filter
  locationFilter?.addEventListener('change', () => {
    state.location = locationFilter.value;
    renderTable();
  });

  // Wire up the modern modal
  wireCreateEmployeeModal();

  createBtn?.addEventListener('click', () => {
    showCreateEmployeeModal();
  });

  bulkBtn?.addEventListener('click', async () => {
    const ids = Array.from(state.selectedIds);
    
    if (!ids.length) { 
      notify('❌ Select at least one employee', true); 
      return; 
    }
    
    const confirmed = await confirmBulkDelete(ids.length, 'employees');
    if (!confirmed) return;
    
    const originalText = bulkBtn.innerHTML;
    bulkBtn.disabled = true;
    bulkBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Deleting...</span>';
    
    try {
      const result = await bulkDeleteEmployees(ids);
      notify(`✅ Successfully deleted ${result.deleted} employee(s)`);
      state.selectedIds.clear();
      await refresh();
    } catch (e) {
      console.error('Bulk delete failed:', e);
      notify('❌ Bulk delete failed: ' + e.message, true);
    } finally {
      bulkBtn.innerHTML = originalText;
      updateBulkDeleteButton();
    }
  });
  
  updateBulkDeleteButton();
}

function showCreateEmployeeModal() {
  const modal = $('#createEmployeeModal');
  const nameInput = $('#employeeName');
  const locationSelect = $('#employeeLocation');
  const statusSelect = $('#employeeStatus');
  
  if (!modal || !nameInput || !locationSelect || !statusSelect) {
    // Try to wire the modal again in case it wasn't wired properly
    wireCreateEmployeeModal();
    return;
  }
  
  // Reset form
  nameInput.value = '';
  locationSelect.value = 'UK';
  statusSelect.value = 'active';
  
  // Show modal using the same method as user management (which works)
  modal.style.display = 'flex';
  
  // Focus the name input after a small delay to ensure the modal is visible
  setTimeout(() => {
    nameInput.focus();
  }, 100);
}

function hideCreateEmployeeModal() {
  const modal = $('#createEmployeeModal');
  if (modal) {
    // Use the same method as user management (which works)
    modal.style.display = 'none';
  }
}

// Confirmation modal functions (following the same pattern as create employee modal)
function showConfirmationModal(options = {}) {
  const {
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmVariant = 'danger', // 'danger', 'warning', 'primary'
    icon = '⚠️'
  } = options;

  // Remove any existing confirmation modal
  const existingModal = $('#confirmationModal');
  if (existingModal) {
    existingModal.remove();
  }

  const modalHtml = `
    <div class="modal-overlay" id="confirmationModal" style="display: flex;">
      <div class="modal-content" style="max-width: 450px;">
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
          <button class="modern-button" id="confirmModalConfirm" style="background: ${getConfirmButtonColor(confirmVariant)}; color: white;">
            ${confirmText}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  return new Promise((resolve) => {
    const modal = $('#confirmationModal');
    const confirmBtn = $('#confirmModalConfirm');
    const cancelBtn = $('#confirmModalCancel');
    const closeBtn = $('#confirmModalClose');
    
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
      modal.style.display = 'none';
      setTimeout(() => {
        modal?.remove();
      }, 300);
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
    
    // Focus the confirm button
    setTimeout(() => {
      confirmBtn.focus();
    }, 100);
  });
}

function getConfirmButtonColor(variant) {
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

function confirmBulkDelete(count, itemType = 'items') {
  return showConfirmationModal({
    title: 'Bulk Delete Confirmation',
    message: `You are about to permanently delete ${count} ${itemType} and all their related attendance logs. This action cannot be undone.`,
    confirmText: `Delete ${count} ${itemType}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
}

function confirmDelete(itemName, itemType = 'item') {
  return showConfirmationModal({
    title: 'Delete Confirmation',
    message: `Are you sure you want to delete ${itemType} "${itemName}" and all related attendance logs? This action cannot be undone.`,
    confirmText: `Delete ${itemType}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
}

function wireCreateEmployeeModal() {
  const modal = $('#createEmployeeModal');
  const closeBtn = $('#closeModal');
  const cancelBtn = $('#cancelCreate');
  const confirmBtn = $('#confirmCreate');
  const nameInput = $('#employeeName');
  
  // Silently return if modal elements aren't ready yet
  if (!modal || !closeBtn || !cancelBtn || !confirmBtn || !nameInput) {
    return;
  }
  
  // Close modal events
  closeBtn.addEventListener('click', hideCreateEmployeeModal);
  cancelBtn.addEventListener('click', hideCreateEmployeeModal);
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideCreateEmployeeModal();
  });
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      hideCreateEmployeeModal();
    }
  });
  
  // Handle form submission
  confirmBtn.addEventListener('click', async () => {
    const name = $('#employeeName').value.trim();
    const location = $('#employeeLocation').value;
    const status = $('#employeeStatus').value;
    
    if (!name) {
      notify('❌ Please enter an employee name', true);
      nameInput.focus();
      return;
    }
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Creating...';
    
    try {
      await createEmployee({ name, location, status });
      notify('✅ Employee created successfully');
      hideCreateEmployeeModal();
      await refresh();
    } catch (e) {
      console.error('Create employee failed:', e);
      notify('❌ Create failed: ' + e.message, true);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Create Employee';
    }
  });
  
  // Handle Enter key in name input
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      confirmBtn.click();
    }
  });
}

function notify(msg, isErr = false) {
  let n = document.getElementById('enrToast');
  if (!n) {
    n = document.createElement('div');
    n.id = 'enrToast';
    n.style.position = 'fixed';
    n.style.right = '20px';
    n.style.bottom = '20px';
    n.style.padding = '12px 18px';
    n.style.borderRadius = '10px';
    n.style.background = 'var(--toast-bg, #2d3436)';
    n.style.color = 'white';
    n.style.zIndex = '10000';
    n.style.fontWeight = '500';
    n.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    n.style.transition = 'all 0.3s ease';
    n.style.transform = 'translateY(100px)';
    n.style.opacity = '0';
    document.body.appendChild(n);
  }
  n.textContent = msg;
  n.style.background = isErr ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 'linear-gradient(135deg, #27ae60, #2d3436)';
  n.style.transform = 'translateY(0)';
  n.style.opacity = '1';
  
  // Auto-hide after 3 seconds
  setTimeout(() => { 
    n.style.transform = 'translateY(100px)';
    n.style.opacity = '0';
  }, 3000);
}

export async function refresh() {
  const data = await getEmployees();
  state.employees = Array.isArray(data) ? data : [];
  renderTable();
}

export async function init() {
  // Wait for DOM to be ready
  await new Promise(resolve => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  });
  
  // Add a small delay to ensure the DOM elements are fully rendered
  // This is needed because the HTML is dynamically loaded by the router
  await new Promise(resolve => setTimeout(resolve, 100));
  
  wireToolbar();
  await refresh();
}
