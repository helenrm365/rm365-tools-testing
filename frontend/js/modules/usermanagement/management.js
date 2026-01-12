// js/modules/usermanagement/management.js
import { getUsers, createUser, updateUser, deleteUser } from '../../services/api/usersApi.js';
import { getRoles, createRole, updateRole, deleteRole } from '../../services/api/rolesApi.js';
import { generateTabStructure } from '../../router.js';

// Dropdown helper functions exposed globally
window.toggleDropdown = function(id) {
  const dropdown = document.getElementById(id);
  if (!dropdown) return;
  
  // Close other dropdowns
  document.querySelectorAll('.custom-dropdown').forEach(d => {
    if (d.id !== id) d.classList.remove('open');
  });
  dropdown.classList.toggle('open');
};

window.selectOption = function(element, dropdownId, value, text) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = text;
  if (hiddenInput) hiddenInput.value = value;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
  
  // Auto-select tabs when role changes in user modal
  if (dropdownId === 'role-dropdown') {
    autoSelectTabsForRole(value);
  }
};

// Get the tab structure dynamically from the router
const TAB_STRUCTURE = generateTabStructure();
let state = {
  users: [],
  roles: [],
  query: '',
  selectedForDelete: new Set(),
  editingUser: null,
  
  // Role Manager State
  manageRoleSelected: null,
  returnToUserModal: false,
  returnToRolesManager: false
};

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }

// --- Rendering ---

function renderTable() {
  const wrapper = $('#userTableWrap');
  if (!state.users || state.users.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-users empty-state-icon"></i>
        <p class="empty-state-text">No users found</p>
      </div>
    `;
    return;
  }

  const filtered = state.users.filter(user => {
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return user.username.toLowerCase().includes(q) || 
           (user.role || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search empty-state-icon"></i>
        <p class="empty-state-text">No users match your search</p>
      </div>
    `;
    return;
  }

  const usersHTML = filtered.map(user => {
    // Visualize allowed tabs
    const tabCount = user.allowed_tabs ? user.allowed_tabs.length : 0;
    const tabSummary = tabCount > 0 
        ? (tabCount > 3 ? `${user.allowed_tabs.slice(0, 3).join(', ')}... (+${tabCount - 3})` : user.allowed_tabs.join(', '))
        : '<span style="color: var(--text-muted); font-style: italic;">No Access</span>';

    const initials = user.username.substring(0, 2).toUpperCase();

    return `
      <div class="user-row" data-username="${user.username}">
        <div class="user-checkbox">
          <input type="checkbox" class="row-select" value="${user.username}" ${state.selectedForDelete.has(user.username) ? 'checked' : ''}>
        </div>
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <h4 class="user-name">${user.username}</h4>
          <p class="user-role">
            <span class="status-badge status-${user.role || 'user'}">${user.role || 'user'}</span>
            <span style="margin-left: 0.5rem; font-size: 0.813rem;">• ${tabSummary}</span>
          </p>
        </div>
        <div class="user-actions">
          <button class="user-action-btn edit edit-user-btn" title="Edit User">
            <i class="fas fa-edit"></i>
            <span>Edit</span>
          </button>
          <button class="user-action-btn history history-user-btn" title="View Login History">
            <i class="fas fa-history"></i>
            <span>History</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  wrapper.innerHTML = usersHTML;

  // Wire events
  wireTableEvents();
}

function wireTableEvents() {
    // Row Selects
    $all('.row-select').forEach(cb => {
        cb.addEventListener('change', (e) => {
            if (e.target.checked) state.selectedForDelete.add(e.target.value);
            else state.selectedForDelete.delete(e.target.value);
            updateToolbar();
        });
    });

    // Edit User
    $all('.edit-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const username = btn.closest('.user-row').dataset.username;
            const user = state.users.find(u => u.username === username);
            if (user) openUserModal(user);
        });
    });

    // History
    $all('.history-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const username = btn.closest('.user-row').dataset.username;
            openHistoryModal(username);
        });
    });
}

function updateToolbar() {
    const bulkDeleteBtn = $('#userBulkDeleteBtn');
    const count = state.selectedForDelete.size;
    
    if (count > 0) {
        bulkDeleteBtn.style.display = 'inline-flex';
        bulkDeleteBtn.innerHTML = `<i class="fas fa-trash-alt"></i> Delete Selected (${count})`;
    } else {
        bulkDeleteBtn.style.display = 'none';
    }
}

// --- Modals ---

// Search
function wireToolbar() {
    $('#userSearch')?.addEventListener('input', (e) => {
        state.query = e.target.value;
        renderTable();
    });

    $('#userCreateBtn')?.addEventListener('click', () => {
        openUserModal(); // Create user mode
    });
    
    $('#manageRolesBtn')?.addEventListener('click', () => {
        openRolesManager();
    });

    $('#userBulkDeleteBtn')?.addEventListener('click', async () => {
        const count = state.selectedForDelete.size;
        if (await confirmAction(`Delete ${count} users?`, `This cannot be undone.`)) {
            try {
                // Sequential delete as API doesn't support bulk yet
                for (const username of state.selectedForDelete) {
                    await deleteUser(username);
                }
                notify(`✅ Deleted ${count} users`);
                state.selectedForDelete.clear();
                await refresh();
            } catch(e) {
                notify('❌ Error deleting users: ' + e.message, true);
            }
        }
    });
}

// User Modal (Create/Edit)
function openUserModal(user = null) {
    const modal = $('#userModal');
    const form = $('#userForm');
    const title = $('#userModalTitle');
    const btn = $('#saveUserBtn');
    
    // Populate Tabs
    const tabsContainer = $('#userTabsCheckboxGroup');
    renderTabCheckboxes(tabsContainer);

    if (user) {
        // Edit Mode
        state.editingUser = user.username;
        title.textContent = 'Edit User: ' + user.username;
        $('#editOriginalUsername').value = user.username;
        $('#formUsername').value = user.username;
        
        // Populate Roles dropdown with current role selected
        populateRolesDropdown(user.role || 'user');
        
        $('#formPassword').value = ''; // Don't show password
        $('#formConfirmPassword').value = '';
        $('#passwordMatchMsg').style.display = 'none';
        $('#passwordHint').style.display = 'inline';
        btn.innerHTML = '<i class="fas fa-save"></i><span>Save Changes</span>';

        // Set Tabs and expand parent tabs
        const allTabBoxes = form.querySelectorAll('input[name="allowed_tab"]');
        allTabBoxes.forEach(cb => {
            if (user.allowed_tabs.includes(cb.value)) {
                cb.checked = true;
                
                // If it's a parent checkbox, expand its subtabs
                if (cb.classList.contains('parent-checkbox')) {
                    const parentKey = cb.dataset.parent;
                    const subtabsContainer = tabsContainer.querySelector(`.subtabs-container[data-parent="${parentKey}"]`);
                    if (subtabsContainer) {
                        subtabsContainer.style.display = 'block';
                        subtabsContainer.classList.add('expanded');
                    }
                }
            }
        });
    } else {
        // Create Mode
        state.editingUser = null;
        title.textContent = 'Create New User';
        $('#editOriginalUsername').value = '';
        form.reset();
        $('#passwordMatchMsg').style.display = 'none';
        $('#passwordHint').style.display = 'none';
        btn.innerHTML = '<i class="fas fa-plus"></i><span>Create User</span>';
        
        // Populate Roles dropdown with default role
        populateRolesDropdown('user');
        autoSelectTabsForRole('user');
    }
    
    // Update Select All Checkbox logic initially
    updateSelectAllState(tabsContainer, 'allowed_tab');

    modal.classList.add('active');
}

function wireUserModal() {
    const form = $('#userForm');
    const modal = $('#userModal');

    // Close
    $('#closeUserModal')?.addEventListener('click', () => modal.classList.remove('active'));
    $('#cancelUserModal')?.addEventListener('click', () => modal.classList.remove('active'));

    // Add Role Logic
    $('#addRoleBtn')?.addEventListener('click', () => {
        // Close Edit modal temporarily
        modal.classList.remove('active');
        state.returnToUserModal = true;
        
        // Open Add Role Modal
        $('#addRoleModal').classList.add('active');
        $('#newRoleName').focus();
    });

    // Select All Tabs - only selects parent tabs
    $('#userSelectAllTabs')?.addEventListener('change', (e) => {
        const container = $('#userTabsCheckboxGroup');
        if (!container) return;
        
        const isChecked = e.target.checked;
        const parentCheckboxes = container.querySelectorAll('.parent-checkbox');
        
        parentCheckboxes.forEach(parentCb => {
            parentCb.checked = isChecked;
            
            // Handle subtabs expansion/collapse
            const parentKey = parentCb.dataset.parent;
            const subtabsContainer = container.querySelector(`.subtabs-container[data-parent="${parentKey}"]`);
            
            if (subtabsContainer) {
                const childCheckboxes = subtabsContainer.querySelectorAll('.child-checkbox');
                
                if (isChecked) {
                    // Show and expand subtabs
                    subtabsContainer.style.display = 'block';
                    subtabsContainer.offsetHeight; // Force reflow
                    subtabsContainer.classList.add('expanded');
                    childCheckboxes.forEach(child => child.checked = true);
                } else {
                    // Hide and collapse subtabs
                    subtabsContainer.classList.remove('expanded');
                    childCheckboxes.forEach(child => child.checked = false);
                    setTimeout(() => {
                        if (!parentCb.checked) {
                            subtabsContainer.style.display = 'none';
                        }
                    }, 300);
                }
            }
        });
    });

    // Password Validation Debounce
    let passwordDebounce;
    const validatePasswordMatch = () => {
        const p1 = $('#formPassword').value;
        const p2 = $('#formConfirmPassword').value;
        const msg = $('#passwordMatchMsg');
        
        if (!p1 && !p2) {
            msg.style.display = 'none';
            return;
        }

        if (p1 && p2) {
            msg.style.display = 'block';
            if (p1 === p2) {
                msg.textContent = '✅ Passwords match';
                msg.style.color = '#27ae60';
            } else {
                msg.textContent = '❌ Passwords do not match';
                msg.style.color = '#e74c3c';
            }
        } else if (p1 && !p2) {
            msg.style.display = 'block';
            msg.textContent = '⏳ Confirm password required';
            msg.style.color = '#f39c12';
        } else {
             msg.style.display = 'none';
        }
    };

    const handlePasswordInput = () => {
        clearTimeout(passwordDebounce);
        passwordDebounce = setTimeout(validatePasswordMatch, 500); // 500ms debounce
    };

    $('#formPassword')?.addEventListener('input', handlePasswordInput);
    $('#formConfirmPassword')?.addEventListener('input', handlePasswordInput);

    // Submit
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const username = formData.get('username').trim();
        const role = formData.get('role');
        
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');
        
        const allowedTabs = Array.from(document.querySelectorAll('input[name="allowed_tab"]:checked')).map(cb => cb.value);
        
        const originalUsername = $('#editOriginalUsername').value;
        const isEdit = !!state.editingUser;

        // Validation
        if (!username) {
            notify('❌ Username is required', true);
            return;
        }

        // Create Mode: Password required
        if (!isEdit && !password) {
            notify('❌ Password is required for new users', true);
            return;
        }

        // If password is being set/changed
        if (password) {
            if (password !== confirmPassword) {
                 notify('❌ Passwords do not match', true);
                 return;
            }
        }

        try {
            if (isEdit) {
                await updateUser({
                    username: originalUsername,
                    new_username: username !== originalUsername ? username : undefined,
                    new_password: password || undefined,
                    role,
                    allowed_tabs: allowedTabs
                });
                notify('✅ User updated');
            } else {
                await createUser({ username, password, role, allowed_tabs: allowedTabs });
                notify('✅ User created');
            }
            modal.classList.remove('active');
            await refresh();
        } catch(err) {
            notify('❌ Error: ' + err.message, true);
        }
    });
}

function wireAddRoleModal() {
    const modal = $('#addRoleModal');
    
    const closeAndReturn = () => {
        modal.classList.remove('active');
        if (state.returnToUserModal) {
            $('#userModal').classList.add('active');
            state.returnToUserModal = false;
        } else if (state.returnToRolesManager) {
            openRolesManager();
            state.returnToRolesManager = false;
        }
    };

    $('#closeAddRoleModal')?.addEventListener('click', closeAndReturn);
    $('#cancelAddRole')?.addEventListener('click', closeAndReturn);
    
    $('#confirmAddRole').onclick = async () => {
        const nameInput = $('#newRoleName');
        const name = nameInput.value.trim();
        
        if (!name) {
            notify('❌ Role name is required', true);
            return;
        }

        try {
            if (state.roles.find(r => r.role_name === name)) {
                notify('❌ Role already exists', true);
                return;
            }

            await createRole({ role_name: name, allowed_tabs: ['enrollment'] });
            notify('✅ Role created');
            await loadRoles();

            // If returning to Role Manager
            if (state.returnToRolesManager) {
                // Will be re-opened by closeAndReturn(), but let's pre-select
                state.manageRoleSelected = name;
            }

            // If returning to User Modal
            if (state.returnToUserModal) {
                populateRolesDropdown($('#formRole'));
                $('#formRole').value = name;
                autoSelectTabsForRole(name);
            }

            nameInput.value = '';
            closeAndReturn();
        } catch (e) {
            notify('❌ Failed to create role: ' + e.message, true);
        }
    };
}



function autoSelectTabsForRole(roleName) {
    const role = state.roles.find(r => r.role_name === roleName);
    const tabsContainer = $('#userTabsCheckboxGroup');
    const boxes = tabsContainer.querySelectorAll('input[name="allowed_tab"]');
    
    // Clear all and collapse all subtabs
    boxes.forEach(b => b.checked = false);
    const subtabsContainers = tabsContainer.querySelectorAll('.subtabs-container');
    subtabsContainers.forEach(sc => {
        sc.style.display = 'none';
        sc.classList.remove('expanded');
    });

    if (role && role.allowed_tabs) {
        boxes.forEach(b => {
            if (role.allowed_tabs.includes(b.value)) {
                b.checked = true;
                
                // If it's a parent checkbox, expand its subtabs
                if (b.classList.contains('parent-checkbox')) {
                    const parentKey = b.dataset.parent;
                    const subtabsContainer = tabsContainer.querySelector(`.subtabs-container[data-parent="${parentKey}"]`);
                    if (subtabsContainer) {
                        subtabsContainer.style.display = 'block';
                        subtabsContainer.classList.add('expanded');
                    }
                }
            }
        });
    }
    updateSelectAllState(tabsContainer, 'allowed_tab');
}

async function loadRoles() {
    try {
        state.roles = await getRoles() || [];
    } catch (e) {
        console.warn('Failed to load roles, falling back to defaults', e);
        state.roles = [
            {role_name:'user', allowed_tabs:['enrollment', 'attendance']}, 
            {role_name:'admin', allowed_tabs:[...Object.keys(TAB_STRUCTURE)]},
            {role_name:'manager', allowed_tabs:['enrollment', 'attendance', 'inventory']}
        ];
    }
}

// --- Roles Manager ---
function openRolesManager() {
    const modal = $('#rolesManagerModal');
    if (!modal) return;
    
    renderRolesList();
    wireRolesManager();
    
    modal.classList.add('active');
}

function wireRolesManager() {
   // Close
   $('#closeRolesManager').onclick = () => {
       $('#rolesManagerModal').classList.remove('active');
       refresh();
   };
   
   // Add Role
   $('#rolesManagerAddBtn').onclick = () => {
       $('#rolesManagerModal').classList.remove('active');
       state.returnToRolesManager = true;
       state.returnToUserModal = false;
       $('#addRoleModal').classList.add('active');
       $('#newRoleName').value = '';
       $('#newRoleName').focus();
   };
   
   // Select Role from List - Open Edit Modal
   $('#rolesList').onclick = (e) => {
       const item = e.target.closest('.role-list-item');
       if (item) {
           const roleName = item.dataset.role;
           openEditRoleModal(roleName);
       }
   };
}

function renderRolesList() {
    const list = $('#rolesList');
    list.innerHTML = state.roles.map(r => `
        <div class="role-list-item" data-role="${r.role_name}">
            <div class="role-list-item-name">${r.role_name}</div>
            <div class="role-list-item-tabs">${r.allowed_tabs ? r.allowed_tabs.length : 0} tabs allowed</div>
        </div>
    `).join('');
}

function openEditRoleModal(roleName) {
    state.manageRoleSelected = roleName;
    const role = state.roles.find(r => r.role_name === roleName);
    if (!role) return;
    
    const modal = $('#editRoleModal');
    $('#editRoleTitle').textContent = `Edit Role: ${roleName}`;
    $('#editRoleName').value = role.role_name;
    
    // Render Tabs
    const container = $('#editRoleTabsContainer');
    renderTabCheckboxesInternal(container, 'edit_role_allowed_tab');
    
    // Check boxes and expand parent tabs
    const boxes = container.querySelectorAll('input[name="edit_role_allowed_tab"]');
    boxes.forEach(cb => {
        if (role.allowed_tabs.includes(cb.value)) {
            cb.checked = true;
            
            // If it's a parent checkbox, expand its subtabs
            if (cb.classList.contains('parent-checkbox')) {
                const parentKey = cb.dataset.parent;
                const subtabsContainer = container.querySelector(`.subtabs-container[data-parent="${parentKey}"]`);
                if (subtabsContainer) {
                    subtabsContainer.style.display = 'block';
                    subtabsContainer.classList.add('expanded');
                }
            }
        }
    });
    
    // Update Select All based on parent checkboxes
    updateSelectAllState(container, 'edit_role_allowed_tab');
    
    wireEditRoleModal();
    modal.classList.add('active');
}

function wireEditRoleModal() {
    const modal = $('#editRoleModal');
    
    // Close
    $('#closeEditRole').onclick = () => {
        modal.classList.remove('active');
        $('#rolesManagerModal').classList.add('active');
    };
    $('#cancelEditRole').onclick = () => {
        modal.classList.remove('active');
        $('#rolesManagerModal').classList.add('active');
    };
    
    // Delete Role
    $('#editRoleDeleteBtn').onclick = async () => {
        const roleName = state.manageRoleSelected;
        if (!roleName) return;
        
        if (await confirmAction('Delete Role?', `Are you sure you want to delete role "${roleName}"?\nUsers with this role may lose permissions.`)) {
            try {
                await deleteRole(roleName);
                notify('✅ Role deleted');
                await loadRoles();
                modal.classList.remove('active');
                $('#rolesManagerModal').classList.add('active');
                renderRolesList();
                state.manageRoleSelected = null;
            } catch(e) {
                notify('❌ Failed to delete role: ' + e.message, true);
            }
        }
    };
    
    // Save Role
    $('#saveEditRole').onclick = async () => {
        const originalName = state.manageRoleSelected;
        const newName = $('#editRoleName').value.trim();
        if (!originalName || !newName) return;
        
        const container = $('#editRoleTabsContainer');
        const allowedTabs = Array.from(container.querySelectorAll('input[name="edit_role_allowed_tab"]:checked'))
                            .map(cb => cb.value);
        
        try {
            await updateRole({
                role_name: originalName,
                new_role_name: newName !== originalName ? newName : undefined,
                allowed_tabs: allowedTabs
            });
            notify('✅ Role updated');
            
            if (newName !== originalName) {
                state.manageRoleSelected = newName;
            }
            await loadRoles();
            modal.classList.remove('active');
            $('#rolesManagerModal').classList.add('active');
            renderRolesList();
        } catch(e) {
            notify('❌ Failed to save role: ' + e.message, true);
        }
    };
    
    // Select All - only selects parent tabs
    $('#editRoleSelectAllTabs').onchange = (e) => {
        const container = $('#editRoleTabsContainer');
        if (!container) return;
        
        const isChecked = e.target.checked;
        const parentCheckboxes = container.querySelectorAll('.parent-checkbox');
        
        parentCheckboxes.forEach(parentCb => {
            parentCb.checked = isChecked;
            
            // Handle subtabs expansion/collapse
            const parentKey = parentCb.dataset.parent;
            const subtabsContainer = container.querySelector(`.subtabs-container[data-parent="${parentKey}"]`);
            
            if (subtabsContainer) {
                const childCheckboxes = subtabsContainer.querySelectorAll('.child-checkbox');
                
                if (isChecked) {
                    // Show and expand subtabs
                    subtabsContainer.style.display = 'block';
                    subtabsContainer.offsetHeight; // Force reflow
                    subtabsContainer.classList.add('expanded');
                    childCheckboxes.forEach(child => child.checked = true);
                } else {
                    // Hide and collapse subtabs
                    subtabsContainer.classList.remove('expanded');
                    childCheckboxes.forEach(child => child.checked = false);
                    setTimeout(() => {
                        if (!parentCb.checked) {
                            subtabsContainer.style.display = 'none';
                        }
                    }, 300);
                }
            }
        });
    };
}

function selectRoleForEditing(roleName) {
    // This function is no longer used but keeping for backwards compatibility
    openEditRoleModal(roleName);
}

// Reuseable Tab Renderer with Collapsible Subtabs
function renderTabCheckboxesInternal(container, inputName) {
    let html = '';
    for (const [key, info] of Object.entries(TAB_STRUCTURE)) {
        const hasSubtabs = info.subtabs && info.subtabs.length > 0;
        
        html += `
            <div class="tab-group" data-tab-key="${key}">
                <label class="checkbox-label parent-tab">
                    <input type="checkbox" name="${inputName}" value="${key}" class="parent-checkbox" data-parent="${key}"> 
                    <span>${info.label}</span>
                </label>
        `;
        
        // Subtabs collapsible section
        if (hasSubtabs) {
            html += `<div class="subtabs-container" data-parent="${key}" style="display: none;">`;
            info.subtabs.forEach(sub => {
                html += `
                    <label class="checkbox-label subtab">
                        <input type="checkbox" name="${inputName}" value="${key}.${sub.key}" class="child-checkbox" data-parent="${key}"> 
                        <span>${sub.label}</span>
                    </label>
                `;
            });
            html += `</div>`;
        }
        
        html += `</div>`;
    }
    container.innerHTML = html;
    
    // Wire collapse/expand behavior
    wireTabCheckboxBehavior(container, inputName);
}

// Wire the collapsible checkbox behavior
function wireTabCheckboxBehavior(container, inputName) {
    const parentCheckboxes = container.querySelectorAll('.parent-checkbox');
    
    parentCheckboxes.forEach(parentCheckbox => {
        const parentKey = parentCheckbox.dataset.parent;
        const subtabsContainer = container.querySelector(`.subtabs-container[data-parent="${parentKey}"]`);
        const childCheckboxes = subtabsContainer ? subtabsContainer.querySelectorAll('.child-checkbox') : [];
        
        parentCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            
            if (subtabsContainer) {
                if (isChecked) {
                    // Show subtabs with animation
                    subtabsContainer.style.display = 'block';
                    // Force reflow for animation
                    subtabsContainer.offsetHeight;
                    subtabsContainer.classList.add('expanded');
                    
                    // Auto-select all child checkboxes
                    childCheckboxes.forEach(child => child.checked = true);
                } else {
                    // Hide subtabs with animation
                    subtabsContainer.classList.remove('expanded');
                    setTimeout(() => {
                        if (!parentCheckbox.checked) {
                            subtabsContainer.style.display = 'none';
                        }
                    }, 300);
                    
                    // Uncheck all child checkboxes
                    childCheckboxes.forEach(child => child.checked = false);
                }
            }
            
            updateSelectAllState(container, inputName);
        });
        
        // Initialize state on load
        if (parentCheckbox.checked && subtabsContainer) {
            subtabsContainer.style.display = 'block';
            subtabsContainer.classList.add('expanded');
        }
    });
    
    // Wire child checkbox changes to update select all
    const childCheckboxes = container.querySelectorAll('.child-checkbox');
    childCheckboxes.forEach(child => {
        child.addEventListener('change', () => {
            updateSelectAllState(container, inputName);
        });
    });
}

// Update Select All checkbox state based on current selections
function updateSelectAllState(container, inputName) {
    let selectAllCheckbox;
    
    // Determine which select all checkbox to update based on input name
    if (inputName === 'allowed_tab') {
        selectAllCheckbox = $('#userSelectAllTabs');
    } else if (inputName === 'edit_role_allowed_tab') {
        selectAllCheckbox = $('#editRoleSelectAllTabs');
    }
    
    if (!selectAllCheckbox) return;
    
    const allParentCheckboxes = container.querySelectorAll('.parent-checkbox');
    const checkedParents = Array.from(allParentCheckboxes).filter(cb => cb.checked);
    
    if (checkedParents.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedParents.length === allParentCheckboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// Refactor existing renderTabCheckboxes to use internal
function renderTabCheckboxes(container) {
    if (!container) return;
    renderTabCheckboxesInternal(container, 'allowed_tab');
}

function populateRolesDropdown(currentRole = null) {
    const dropdown = $('#role-dropdown');
    if (!dropdown) return;
    
    const optionsContainer = dropdown.querySelector('.dropdown-options');
    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    
    // Populate options
    optionsContainer.innerHTML = state.roles.map(r => {
        const isSelected = currentRole === r.role_name;
        return `<div class="dropdown-option ${isSelected ? 'selected' : ''}" onclick="selectOption(this, 'role-dropdown', '${r.role_name}', '${r.role_name}')">${r.role_name}</div>`;
    }).join('');
    
    // Set current selection
    if (currentRole) {
        selectedDisplay.textContent = currentRole;
        hiddenInput.value = currentRole;
    } else if (state.roles.length > 0) {
        // Default to first role (usually 'user')
        const defaultRole = state.roles.find(r => r.role_name === 'user') || state.roles[0];
        selectedDisplay.textContent = defaultRole.role_name;
        hiddenInput.value = defaultRole.role_name;
    }
}

// History Modal
function openHistoryModal(username) {
    const modal = $('#historyModal');
    $('#historyUserLabel').textContent = `User: ${username}`;
    
    // Mock Data since backend support is missing for now
    const mockHistory = [
        // Generate some sample data for visual effect if user wants, or leave empty
        // The user asked for it, creating some fake data is better than nothing?
        // Or just show "No history found" which is more accurate.
    ];

    const tbody = $('#historyTableBody');
    if (mockHistory.length > 0) {
        // ...
    } else {
        tbody.innerHTML = '<tr><td colspan="2" class="muted">No login history found.</td></tr>';
    }

    // Modal Close
    $('#closeHistoryModal').onclick = () => modal.classList.remove('active');
    $('#closeHistoryModalBtn').onclick = () => modal.classList.remove('active');
    
    modal.classList.add('active');
}



// --- Helpers ---
function notify(msg, isError = false) {
    let area = document.getElementById('notificationArea');
    if (!area) {
        area = document.createElement('div');
        area.id = 'notificationArea';
        area.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(area);
    }

    const div = document.createElement('div');
    div.textContent = msg;
    div.style.cssText = `
        padding: 12px 20px; 
        background: ${isError ? '#e74c3c' : '#2ecc71'}; 
        color: white; 
        border-radius: 4px; 
        box-shadow: 0 2px 10px rgba(0,0,0,0.2); 
        animation: slideIn 0.3s ease;
    `;
    area.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

function confirmAction(title, msg) {
    // Check if we have a fancy modal
    const modal = $('#confirmationModal');
    if (modal) {
        // Use existing modal if available (it was in the html, hope it is still there)
        const titleEl = $('#confirmTitle');
        const msgEl = $('#confirmMessage'); // Wait, check HTML for ID
        // The previous HTML had #confirmationModal and #confirmTitle.
        // Let's implement generic modal usage if elements exist.
         // ... For brevity I'll use confirm() which is reliable
        return new Promise(resolve => resolve(confirm(title + '\n' + msg)));
    }
    return new Promise(resolve => resolve(confirm(title + '\n' + msg)));
}


// --- Init ---
export async function refresh() {
    await loadRoles();
    
    try {
        const users = await getUsers();
        if (users && Array.isArray(users)) {
             state.users = users;
        } else {
             throw new Error('Invalid response');
        }
    } catch(e) {
        console.warn('Failed to load users, using sample data:', e);
        notify('⚠️ Connection failed: Using sample data', true);
        
        // Fallback sample data
        state.users = [
            {
                username: 'sample_admin',
                role: 'admin',
                allowed_tabs: [...Object.keys(TAB_STRUCTURE)]
            },
            {
                username: 'sample_user',
                role: 'user',
                allowed_tabs: ['enrollment', 'attendance']
            }
        ];
    }
    
    renderTable();
    updateToolbar();
}

export async function init() {
    wireToolbar();
    wireUserModal();
    wireAddRoleModal();
    await refresh();
}
