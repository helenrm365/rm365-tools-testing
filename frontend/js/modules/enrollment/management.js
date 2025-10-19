// js/modules/enrollment/management.js
import { getEmployees,
    createEmployee, updateEmployee, deleteEmployee,
    bulkDeleteEmployees } from '../../services/api/enrollmentApi.js';


let state = {
  employees: [],
  query: '',
  status: '',
  location: '',
};

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function renderTable() {
  const wrap = $('#enrTableWrap');
  if (!wrap) return;

  const rows = state.employees
    .filter(e => !state.status || (e.status || 'active').toLowerCase() === state.status)
    .filter(e => !state.location || (e.location || '').toUpperCase() === state.location)
    .filter(e => {
      const q = state.query.trim().toLowerCase();
      if (!q) return true;
      const hay = `${e.name} ${e.employee_code} ${e.location || ''} ${e.card_uid || ''}`.toLowerCase();
      return hay.includes(q);
    });

  if (!rows.length) {
    wrap.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem; color: #999;">No employees found.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="grid modern-table" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="background: rgba(0,0,0,0.05); border-bottom: 2px solid #ddd;">
          <th style="padding: 12px 8px; text-align: left; width: 40px;"><input type="checkbox" id="bulkSelAll"></th>
          <th style="padding: 12px 8px; text-align: left; width: 150px;">Name</th>
          <th style="padding: 12px 8px; text-align: left; width: 80px;">Code</th>
          <th style="padding: 12px 8px; text-align: left; width: 90px;">Location</th>
          <th style="padding: 12px 8px; text-align: left; width: 100px;">Status</th>
          <th style="padding: 12px 8px; text-align: left; width: 120px;">Card UID</th>
          <th style="padding: 12px 8px; text-align: center; width: 80px;">Fingerprint</th>
          <th style="padding: 12px 8px; text-align: center; width: 130px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(e => `
          <tr data-id="${e.id}" style="border-bottom: 1px solid #eee;">
            <td style="padding: 8px; width: 40px;"><input type="checkbox" class="sel"></td>
            <td style="padding: 8px; width: 150px;"><input class="modern-input in name" value="${e.name || ''}" style="width: 100%; max-width: 140px; font-size: 0.9rem;"></td>
            <td style="padding: 8px; width: 80px;"><input class="modern-input in code employee-code-input" value="${e.employee_code || ''}" disabled style="width: 100%; max-width: 70px; font-size: 0.85rem;"></td>
            <td style="padding: 8px; width: 90px;">
              <select class="modern-input in location" style="width: 100%; max-width: 80px; font-size: 0.85rem;">
                <option ${e.location === 'UK' ? 'selected' : ''} value="UK">UK</option>
                <option ${e.location === 'FR' ? 'selected' : ''} value="FR">FR</option>
              </select>
            </td>
            <td style="padding: 8px; width: 100px;">
              <select class="modern-input in status" style="width: 100%; max-width: 90px; font-size: 0.85rem;">
                <option ${!e.status || e.status === 'active' ? 'selected' : ''} value="active">Active</option>
                <option ${e.status === 'inactive' ? 'selected' : ''} value="inactive">Inactive</option>
              </select>
            </td>
            <td style="padding: 8px; width: 120px;"><input class="modern-input in card" value="${e.card_uid || ''}" placeholder="UID" style="width: 100%; max-width: 110px; font-family: monospace; font-size: 0.8rem;"></td>
            <td style="padding: 8px; text-align: center; width: 80px;">${e.has_fingerprint ? '✅' : '❌'}</td>
            <td style="padding: 8px; text-align: center; width: 130px;">
              <div style="display: flex; gap: 0.25rem; justify-content: center;">
                <button class="modern-button save" style="padding: 4px 8px; font-size: 0.75rem; min-width: 50px;">💾</button>
                <button class="modern-button del" style="padding: 4px 8px; font-size: 0.75rem; min-width: 40px; background: linear-gradient(to bottom right, #e74c3c, #c0392b); color: white;">🗑️</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // bulk select
  const bulkAll = $('#bulkSelAll');
  if (bulkAll) {
    bulkAll.addEventListener('change', () => {
      $all('tbody .sel').forEach(cb => cb.checked = bulkAll.checked);
    });
  }

  // row actions
  $all('tbody .save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const id = Number(tr.dataset.id);
      const name = tr.querySelector('.in.name').value.trim();
      const location = tr.querySelector('.in.location').value;
      const status = tr.querySelector('.in.status').value;
      const card_uid = tr.querySelector('.in.card').value.trim() || null;

      btn.disabled = true;
      try {
        await updateEmployee(id, { name, location, status, card_uid });
        notify('✅ Saved successfully');
        await refresh();
      } catch (e) {
        notify('❌ Save failed: ' + e.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  $all('tbody .del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const id = Number(tr.dataset.id);
      const name = tr.querySelector('.in.name').value.trim();
      
      // Use modern confirmation modal
      const confirmed = await confirmDelete(name, 'employee');
      if (!confirmed) return;
      
      btn.disabled = true;
      btn.textContent = '🔄';
      
      try {
        await deleteEmployee(id);
        notify('✅ Employee and related attendance logs deleted successfully');
        await refresh();
      } catch (e) {
        notify('❌ Delete failed: ' + e.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🗑️';
      }
    });
  });
}

function wireToolbar() {
  const createBtn = $('#enrCreateBtn');
  const bulkBtn = $('#enrBulkDeleteBtn');

  const searchBox = document.createElement('input');
  searchBox.className = 'modern-input';
  searchBox.placeholder = 'Search employees...';
  searchBox.style.marginLeft = '0.5rem';
  searchBox.style.flex = '1';
  searchBox.style.maxWidth = '300px';
  const toolbar = createBtn?.closest('.toolbar');
  if (toolbar) toolbar.appendChild(searchBox);

  searchBox?.addEventListener('input', () => {
    state.query = searchBox.value;
    renderTable();
  });

  // Wire up the modern modal
  wireCreateEmployeeModal();

  createBtn?.addEventListener('click', () => {
    showCreateEmployeeModal();
  });

  bulkBtn?.addEventListener('click', async () => {
    const ids = $all('tbody tr').filter(tr => tr.querySelector('.sel')?.checked)
      .map(tr => Number(tr.dataset.id));
    
    if (!ids.length) { 
      notify('❌ Select at least one employee', true); 
      return; 
    }
    
    // Use modern confirmation modal
    const confirmed = await confirmBulkDelete(ids.length, 'employees');
    if (!confirmed) return;
    
    bulkBtn.disabled = true;
    bulkBtn.textContent = '🔄 Deleting...';
    
    try {
      const result = await bulkDeleteEmployees(ids);
      notify(`✅ Successfully deleted ${result.deleted} employee(s) and their attendance logs`);
      await refresh();
    } catch (e) {
      console.error('Bulk delete failed:', e);
      notify('❌ Bulk delete failed: ' + e.message, true);
    } finally {
      bulkBtn.disabled = false;
      bulkBtn.textContent = '🗑️ Bulk Delete';
    }
  });
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
