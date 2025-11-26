// js/modules/usermanagement/management.js
import { getUsers, createUser, updateUser, deleteUser } from '../../services/api/usersApi.js';
import { getRoles } from '../../services/api/rolesApi.js';
import { generateTabStructure } from '../../router.js';

// Get the tab structure dynamically from the router
const TAB_STRUCTURE = generateTabStructure();
console.log('[User Management] TAB_STRUCTURE loaded:', TAB_STRUCTURE);

let state = {
  users: [],
  roles: [],
  query: '',
  selectedForDelete: new Set(),
};

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }

function renderRoleDropdown(selectedRole, uniqueId) {
  const options = state.roles.map(role => 
    `<option value="${role.role_name}" ${selectedRole === role.role_name ? 'selected' : ''}>${role.role_name}</option>`
  ).join('');
  
  return `
    <div class="role-dropdown-wrapper" style="position: relative;">
      <select class="in role modern-select role-dropdown" id="${uniqueId}" data-original="${selectedRole}">
        ${options}
        <option value="__ADD_NEW__">➕ Add New Role...</option>
      </select>
      <input type="text" class="in role-custom-input modern-input" style="display: none;" placeholder="Enter new role name...">
    </div>
  `;
}

function renderTable() {
  const tbody = $('#userTableWrap');
  if (!state.users || state.users.length === 0) {
    tbody.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem; color: #999;">No users found.</p>';
    return;
  }

  const filtered = state.users.filter(user => {
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return user.username.toLowerCase().includes(q) || 
           (user.role || '').toLowerCase().includes(q) ||
           user.allowed_tabs.some(tab => tab.toLowerCase().includes(q));
  });

  const tableHTML = `
    <div class="table-container">
    <table class="modern-table">
      <thead>
        <tr>
          <th style="width: 40px;">
            <input type="checkbox" id="selectAll" ${state.selectedForDelete.size === filtered.length && filtered.length > 0 ? 'checked' : ''}>
          </th>
          <th style="width: 200px;">Username</th>
          <th style="width: 180px;">Role</th>
          <th>Allowed Tabs & Sub-tabs</th>
          <th style="width: 150px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(user => `
          <tr data-username="${user.username}">
            <td>
              <input type="checkbox" class="row-select" value="${user.username}" ${state.selectedForDelete.has(user.username) ? 'checked' : ''}>
            </td>
            <td>
              <input type="text" class="in username modern-input" value="${user.username}" data-original="${user.username}" style="width: 100%; max-width: 180px;">
            </td>
            <td>
              ${renderRoleDropdown(user.role, 'role-select-' + user.username)}
            </td>
            <td>
              <div class="tabs-checkboxes">
                <div style="display: flex; align-items: center; margin-bottom: 8px;">
                  <label class="checkbox-label" style="display: inline-flex; align-items: center; margin-right: 8px; font-weight: 500;">
                    <input type="checkbox" class="select-all-tabs-row" style="margin-right: 4px;"> Select All
                  </label>
                </div>
                ${renderTabCheckboxes(user.allowed_tabs)}
              </div>
            </td>
            <td>
              <div style="display: flex; gap: 0.75rem;">
                <button class="action-btn save" style="background: #27ae60; color: white;">Save</button>
                <button class="action-btn del" style="background: #e74c3c; color: white;">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;

  tbody.innerHTML = tableHTML;

  // Wire event handlers
  wireTableEvents();
}

function renderTabCheckboxes(allowedTabs) {
  let html = `
    <div class="tabs-master-control" style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
      <button type="button" class="expand-all-tabs-btn" style="padding: 6px 12px; background: linear-gradient(135deg, #76a12b, #5e8122); color: white; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; font-weight: 500;">
        ▼ Expand All
      </button>
      <span style="font-size: 0.85rem; color: var(--text-secondary, #666);">Click dropdown arrows to expand/collapse sections</span>
    </div>
  `;
  
  for (const [tabKey, tabInfo] of Object.entries(TAB_STRUCTURE)) {
    // Check if main tab is allowed (for backwards compatibility, check both 'tab' and any 'tab.*' pattern)
    const mainTabAllowed = allowedTabs.includes(tabKey) || 
                           allowedTabs.some(t => t.startsWith(tabKey + '.'));
    
    const hasSubtabs = tabInfo.subtabs.length > 0;
    
    html += `
      <div class="tab-group ${hasSubtabs ? 'collapsible' : ''}" data-tab-key="${tabKey}">
        <div class="tab-header" ${hasSubtabs ? 'data-has-subtabs="true"' : ''}>
          <label class="checkbox-label">
            <input type="checkbox" class="tab-checkbox parent-tab" value="${tabKey}" ${mainTabAllowed ? 'checked' : ''}> 
            ${tabInfo.label}
          </label>
          ${hasSubtabs ? `<span class="expand-icon" role="button" tabindex="0" aria-label="Expand ${tabInfo.label}">▼</span>` : ''}
        </div>
        ${hasSubtabs ? `
          <div class="subtabs-container">
            ${tabInfo.subtabs.map(sub => {
              const subtabValue = `${tabKey}.${sub.key}`;
              const isChecked = allowedTabs.includes(subtabValue);
              return `
                <label class="checkbox-label subtab-label">
                  <input type="checkbox" class="tab-checkbox subtab-checkbox" data-parent="${tabKey}" value="${subtabValue}" ${isChecked ? 'checked' : ''}>
                  ${sub.label}
                </label>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  return html;
}

function wireTableEvents() {
  // Handle "Select All Tabs" checkbox in each row
  $all('.select-all-tabs-row').forEach(selectAllCheckbox => {
    selectAllCheckbox.addEventListener('change', (e) => {
      const tr = e.target.closest('tr');
      const tabCheckboxes = tr.querySelectorAll('.tab-checkbox');
      tabCheckboxes.forEach(cb => {
        cb.checked = e.target.checked;
      });
    });
  });

  // Handle parent-child tab relationships in table rows
  $all('.parent-tab').forEach(parentCheckbox => {
    const tr = parentCheckbox.closest('tr');
    const tabKey = parentCheckbox.value;
    const subtabs = tr.querySelectorAll(`.subtab-checkbox[data-parent="${tabKey}"]`);
    
    // When parent is checked, check all children
    parentCheckbox.addEventListener('change', (e) => {
      if (subtabs.length > 0) {
        subtabs.forEach(st => st.checked = e.target.checked);
      }
      updateRowSelectAllState(tr);
    });
    
    // When any child changes, update parent state
    subtabs.forEach(subtab => {
      subtab.addEventListener('change', () => {
        const allSubtabsChecked = Array.from(subtabs).every(st => st.checked);
        const someSubtabsChecked = Array.from(subtabs).some(st => st.checked);
        
        parentCheckbox.checked = allSubtabsChecked;
        parentCheckbox.indeterminate = someSubtabsChecked && !allSubtabsChecked;
        updateRowSelectAllState(tr);
      });
    });
  });

  // Update "Select All Tabs" when individual tabs are checked/unchecked
  $all('.tab-checkbox').forEach(tabCheckbox => {
    tabCheckbox.addEventListener('change', (e) => {
      const tr = e.target.closest('tr');
      updateRowSelectAllState(tr);
    });
    
    // Initialize indeterminate state on load
    const tr = tabCheckbox.closest('tr');
    updateRowSelectAllState(tr);
  });
  
  function updateRowSelectAllState(tr) {
    const selectAllCheckbox = tr.querySelector('.select-all-tabs-row');
    const allTabCheckboxes = tr.querySelectorAll('.tab-checkbox');
    const checkedCount = Array.from(allTabCheckboxes).filter(cb => cb.checked).length;
    
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = checkedCount === allTabCheckboxes.length;
      selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allTabCheckboxes.length;
    }
  }
  
  // Add collapsible functionality for table rows
  $all('tbody tr').forEach(tr => {
    const tabsCell = tr.querySelector('.tabs-checkboxes');
    if (tabsCell) {
      wireTabCollapsibles(tabsCell);
    }
  });

  // Handle role dropdown "Add New Role" option
  $all('.role-dropdown').forEach(select => {
    select.addEventListener('change', (e) => {
      const wrapper = e.target.closest('.role-dropdown-wrapper');
      const customInput = wrapper.querySelector('.role-custom-input');
      
      if (e.target.value === '__ADD_NEW__') {
        // Show custom input, hide dropdown
        e.target.style.display = 'none';
        customInput.style.display = 'block';
        customInput.focus();
        customInput.value = '';
      } else {
        // Auto-populate tabs based on selected role for this user row
        const tr = e.target.closest('tr');
        autoPopulateTabsForRoleInRow(tr, e.target.value);
      }
    });
  });

  // Handle custom role input blur (when user finishes typing)
  $all('.role-custom-input').forEach(input => {
    input.addEventListener('blur', (e) => {
      const wrapper = e.target.closest('.role-dropdown-wrapper');
      const select = wrapper.querySelector('.role-dropdown');
      const customValue = e.target.value.trim();
      
      if (customValue) {
        // Add the custom role to the dropdown if it doesn't exist
        const existingOption = Array.from(select.options).find(opt => opt.value === customValue);
        if (!existingOption) {
          const newOption = document.createElement('option');
          newOption.value = customValue;
          newOption.textContent = customValue;
          // Insert before "Add New Role" option
          select.insertBefore(newOption, select.options[select.options.length - 1]);
        }
        select.value = customValue;
      } else {
        // If empty, restore original value
        select.value = select.dataset.original || 'user';
      }
      
      // Show dropdown, hide input
      e.target.style.display = 'none';
      select.style.display = 'block';
    });

    // Also handle Enter key
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.target.blur();
      }
    });

    // Handle Escape key to cancel
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const wrapper = e.target.closest('.role-dropdown-wrapper');
        const select = wrapper.querySelector('.role-dropdown');
        select.value = select.dataset.original || 'user';
        e.target.style.display = 'none';
        select.style.display = 'block';
      }
    });
  });

  // Select all checkbox
  const selectAll = $('#selectAll');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      const checkboxes = $all('.row-select');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        if (e.target.checked) {
          state.selectedForDelete.add(cb.value);
        } else {
          state.selectedForDelete.delete(cb.value);
        }
      });
      updateBulkDeleteButton();
    });
  }

  // Individual row selects
  $all('.row-select').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedForDelete.add(e.target.value);
      } else {
        state.selectedForDelete.delete(e.target.value);
      }
      updateBulkDeleteButton();
      
      const allCheckboxes = $all('.row-select');
      const checkedCount = Array.from(allCheckboxes).filter(cb => cb.checked).length;
      if (selectAll) {
        selectAll.checked = checkedCount === allCheckboxes.length && allCheckboxes.length > 0;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
      }
    });
  });

  // Save buttons
  $all('tbody .save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const originalUsername = tr.dataset.username;
      const username = tr.querySelector('.in.username').value.trim();
      const roleDropdown = tr.querySelector('.role-dropdown');
      const role = roleDropdown ? roleDropdown.value : tr.querySelector('.in.role').value;
      const allowedTabs = Array.from(tr.querySelectorAll('.tab-checkbox:checked')).map(cb => cb.value);

      btn.disabled = true;
      try {
        await updateUser({
          username: originalUsername,
          new_username: originalUsername !== username ? username : undefined,
          role,
          allowed_tabs: allowedTabs
        });
        notify('✅ User updated successfully');
        await refresh();
      } catch (e) {
        notify('❌ Update failed: ' + e.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  $all('tbody .del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const username = tr.dataset.username;
      
      if (await confirmDelete(username, 'user')) {
        try {
          await deleteUser(username);
          notify('✅ User deleted successfully');
          await refresh();
        } catch (e) {
          notify('❌ Delete failed: ' + e.message, true);
        }
      }
    });
  });
}

function wireToolbar() {
  const createBtn = $('#userCreateBtn');
  createBtn?.addEventListener('click', showCreateUserModal);

  // Bulk delete button
  const bulkDeleteBtn = $('#userBulkDeleteBtn');
  bulkDeleteBtn?.addEventListener('click', async () => {
    const count = state.selectedForDelete.size;
    if (count === 0) {
      notify('❌ No users selected for deletion', true);
      return;
    }
    
    if (await confirmBulkDelete(count, 'users')) {
      try {
        // Since the API doesn't support bulk delete, delete one by one
        for (const username of state.selectedForDelete) {
          await deleteUser(username);
        }
        notify(`✅ ${count} user(s) deleted successfully`);
        state.selectedForDelete.clear();
        await refresh();
      } catch (e) {
        notify('❌ Bulk delete failed: ' + e.message, true);
      }
    }
  });

  // Search functionality
  const searchContainer = $('.toolbar');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search users...';
  searchInput.className = 'modern-input';
  searchInput.style.marginLeft = 'auto';
  searchInput.style.width = '200px';
  searchContainer.appendChild(searchInput);

  searchInput.addEventListener('input', (e) => {
    state.query = e.target.value;
    renderTable();
  });
}

function updateBulkDeleteButton() {
  const bulkDeleteBtn = $('#userBulkDeleteBtn');
  const count = state.selectedForDelete.size;
  if (bulkDeleteBtn) {
    bulkDeleteBtn.innerHTML = count > 0 ? `<i class="fas fa-trash-alt"></i> Delete (${count})` : '<i class="fas fa-trash-alt"></i> Bulk Delete';
    bulkDeleteBtn.disabled = count === 0;
  }
}

function showCreateUserModal() {
  populateCreateRoleDropdown(); // Populate with latest roles
  populateCreateTabsCheckboxes(); // Populate with tab structure
  const modal = $('#createUserModal');
  modal.style.display = 'flex';
  $('#createUsername').focus();
}

function populateCreateTabsCheckboxes() {
  const container = $('#tabsCheckboxGroup');
  if (!container) return;

  let html = `
    <div class="tabs-master-control" style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <button type="button" class="expand-main-tabs-btn" style="padding: 6px 12px; background: linear-gradient(135deg, #76a12b, #5e8122); color: white; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; font-weight: 500;">
          ▼ Expand Main Tabs
        </button>
        <button type="button" class="expand-all-subtabs-btn" style="padding: 6px 12px; background: linear-gradient(135deg, #6b7280, #4b5563); color: white; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; font-weight: 500; opacity: 0.5;" disabled>
          ▼ Expand All Sub-tabs
        </button>
      </div>
      <span style="font-size: 0.85rem; color: var(--text-secondary, #666);">Click dropdown arrows to expand/collapse sections</span>
    </div>
    
    <div class="main-tabs-container collapsed">
  `;
  
  for (const [tabKey, tabInfo] of Object.entries(TAB_STRUCTURE)) {
    const hasSubtabs = tabInfo.subtabs.length > 0;
    
    html += `
      <div class="tab-group ${hasSubtabs ? 'collapsible' : ''}" data-tab-key="${tabKey}">
        <div class="tab-header" ${hasSubtabs ? 'data-has-subtabs="true"' : ''}>
          <label class="checkbox-label" onclick="event.stopPropagation();">
            <input type="checkbox" class="parent-tab-create" name="allowed_tabs" value="${tabKey}"> 
            ${tabInfo.label}
          </label>
          ${hasSubtabs ? `<span class="expand-icon">▼</span>` : ''}
        </div>
        ${hasSubtabs ? `
          <div class="subtabs-container collapsed">
            ${tabInfo.subtabs.map(sub => {
              const subtabValue = `${tabKey}.${sub.key}`;
              return `
                <label class="checkbox-label subtab-label">
                  <input type="checkbox" class="subtab-checkbox-create" data-parent="${tabKey}" name="allowed_tabs" value="${subtabValue}">
                  ${sub.label}
                </label>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  html += `</div>`; // Close main-tabs-container
  
  container.innerHTML = html;

  // Wire up the "Select All" checkbox for the modal
  const selectAllCheckbox = $('#selectAllTabs');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const allCheckboxes = container.querySelectorAll('input[name="allowed_tabs"]');
      allCheckboxes.forEach(cb => {
        cb.checked = e.target.checked;
      });
    });

    // Update "Select All" when individual checkboxes change
    const allCheckboxes = container.querySelectorAll('input[name="allowed_tabs"]');
    allCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const checkedCount = Array.from(allCheckboxes).filter(c => c.checked).length;
        selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
        selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
      });
    });
    
    // Handle parent-child relationships in create modal
    const parentTabs = container.querySelectorAll('.parent-tab-create');
    parentTabs.forEach(parentCheckbox => {
      const tabKey = parentCheckbox.value;
      const subtabs = container.querySelectorAll(`.subtab-checkbox-create[data-parent="${tabKey}"]`);
      
      // When parent is checked, check all children
      parentCheckbox.addEventListener('change', (e) => {
        subtabs.forEach(st => st.checked = e.target.checked);
        updateSelectAllState();
      });
      
      // When any child changes, update parent state
      subtabs.forEach(subtab => {
        subtab.addEventListener('change', () => {
          const allSubtabsChecked = Array.from(subtabs).every(st => st.checked);
          const someSubtabsChecked = Array.from(subtabs).some(st => st.checked);
          
          parentCheckbox.checked = allSubtabsChecked;
          parentCheckbox.indeterminate = someSubtabsChecked && !allSubtabsChecked;
          updateSelectAllState();
        });
      });
    });
    
    function updateSelectAllState() {
      const checkedCount = Array.from(allCheckboxes).filter(c => c.checked).length;
      selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
      selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
    }
  }
  
  // Add collapsible functionality
  wireTabCollapsibles(container);
}

function wireTabCollapsibles(container) {
  const mainTabsContainer = container.querySelector('.main-tabs-container');
  const expandMainBtn = container.querySelector('.expand-main-tabs-btn');
  const expandAllSubtabsBtn = container.querySelector('.expand-all-subtabs-btn');
  const tabGroups = container.querySelectorAll('.tab-group.collapsible');
  
  // Add click handlers for individual collapsible tab groups (sub-tabs)
  tabGroups.forEach(group => {
    const subtabsContainer = group.querySelector('.subtabs-container');
    const expandIcon = group.querySelector('.expand-icon');
    
    if (expandIcon && subtabsContainer) {
      // Toggle function for individual sub-tabs
      const toggleExpand = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const isExpanded = subtabsContainer.classList.contains('expanded');
        
        if (isExpanded) {
          subtabsContainer.classList.remove('expanded');
          subtabsContainer.classList.add('collapsed');
          expandIcon.style.transform = 'rotate(0deg)';
        } else {
          subtabsContainer.classList.remove('collapsed');
          subtabsContainer.classList.add('expanded');
          expandIcon.style.transform = 'rotate(180deg)';
        }
      };
      
      expandIcon.addEventListener('click', toggleExpand);
      expandIcon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggleExpand(e);
        }
      });
    }
  });
  
  // Main tabs expand/collapse button
  if (expandMainBtn && mainTabsContainer) {
    let mainExpanded = false;
    expandMainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mainExpanded = !mainExpanded;
      
      if (mainExpanded) {
        mainTabsContainer.classList.remove('collapsed');
        mainTabsContainer.classList.add('expanded');
        expandMainBtn.textContent = '▲ Collapse Main Tabs';
        expandAllSubtabsBtn.disabled = false;
        expandAllSubtabsBtn.style.opacity = '1';
      } else {
        mainTabsContainer.classList.remove('expanded');
        mainTabsContainer.classList.add('collapsed');
        expandMainBtn.textContent = '▼ Expand Main Tabs';
        expandAllSubtabsBtn.disabled = true;
        expandAllSubtabsBtn.style.opacity = '0.5';
        
        // Also collapse all subtabs when main tabs are collapsed
        tabGroups.forEach(group => {
          const subtabsContainer = group.querySelector('.subtabs-container');
          const expandIcon = group.querySelector('.expand-icon');
          if (subtabsContainer) {
            subtabsContainer.classList.remove('expanded');
            subtabsContainer.classList.add('collapsed');
            if (expandIcon) expandIcon.style.transform = 'rotate(0deg)';
          }
        });
        expandAllSubtabsBtn.textContent = '▼ Expand All Sub-tabs';
      }
    });
  }
  
  // All subtabs expand/collapse button
  if (expandAllSubtabsBtn) {
    let allSubtabsExpanded = false;
    expandAllSubtabsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      allSubtabsExpanded = !allSubtabsExpanded;
      
      tabGroups.forEach(group => {
        const subtabsContainer = group.querySelector('.subtabs-container');
        const expandIcon = group.querySelector('.expand-icon');
        
        if (subtabsContainer) {
          if (allSubtabsExpanded) {
            subtabsContainer.classList.remove('collapsed');
            subtabsContainer.classList.add('expanded');
            if (expandIcon) expandIcon.style.transform = 'rotate(180deg)';
          } else {
            subtabsContainer.classList.remove('expanded');
            subtabsContainer.classList.add('collapsed');
            if (expandIcon) expandIcon.style.transform = 'rotate(0deg)';
          }
        }
      });
      
      expandAllSubtabsBtn.textContent = allSubtabsExpanded ? '▲ Collapse All Sub-tabs' : '▼ Expand All Sub-tabs';
    });
  }
}

function autoPopulateTabsForRole(roleName) {
  // Find the role in state
  const role = state.roles.find(r => r.role_name === roleName);
  if (!role || !role.allowed_tabs) return;
  
  // Get all tab checkboxes in the create modal
  const container = $('#tabsCheckboxGroup');
  if (!container) return;
  
  const allCheckboxes = container.querySelectorAll('input[name="allowed_tabs"]');
  
  // Uncheck all first
  allCheckboxes.forEach(cb => cb.checked = false);
  
  // Check the tabs that match the role's allowed_tabs
  allCheckboxes.forEach(cb => {
    if (role.allowed_tabs.includes(cb.value)) {
      cb.checked = true;
    }
  });
  
  // Update parent checkbox states based on children
  const parentTabs = container.querySelectorAll('.parent-tab-create');
  parentTabs.forEach(parentCheckbox => {
    const tabKey = parentCheckbox.value;
    const subtabs = container.querySelectorAll(`.subtab-checkbox-create[data-parent="${tabKey}"]`);
    
    if (subtabs.length > 0) {
      const allSubtabsChecked = Array.from(subtabs).every(st => st.checked);
      const someSubtabsChecked = Array.from(subtabs).some(st => st.checked);
      
      parentCheckbox.checked = allSubtabsChecked;
      parentCheckbox.indeterminate = someSubtabsChecked && !allSubtabsChecked;
    }
  });
  
  // Update "Select All" state
  const selectAllCheckbox = $('#selectAllTabs');
  if (selectAllCheckbox) {
    const checkedCount = Array.from(allCheckboxes).filter(c => c.checked).length;
    selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
    selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
  }
}

function autoPopulateTabsForRoleInRow(tr, roleName) {
  // Find the role in state
  const role = state.roles.find(r => r.role_name === roleName);
  if (!role || !role.allowed_tabs) return;
  
  // Get all tab checkboxes in this row
  const allCheckboxes = tr.querySelectorAll('.tab-checkbox');
  
  // Uncheck all first
  allCheckboxes.forEach(cb => cb.checked = false);
  
  // Check the tabs that match the role's allowed_tabs
  allCheckboxes.forEach(cb => {
    if (role.allowed_tabs.includes(cb.value)) {
      cb.checked = true;
    }
  });
  
  // Update parent checkbox states based on children
  const parentTabs = tr.querySelectorAll('.parent-tab');
  parentTabs.forEach(parentCheckbox => {
    const tabKey = parentCheckbox.value;
    const subtabs = tr.querySelectorAll(`.subtab-checkbox[data-parent="${tabKey}"]`);
    
    if (subtabs.length > 0) {
      const allSubtabsChecked = Array.from(subtabs).every(st => st.checked);
      const someSubtabsChecked = Array.from(subtabs).some(st => st.checked);
      
      parentCheckbox.checked = allSubtabsChecked;
      parentCheckbox.indeterminate = someSubtabsChecked && !allSubtabsChecked;
    }
  });
  
  // Update "Select All Tabs" state for this row
  const selectAllCheckbox = tr.querySelector('.select-all-tabs-row');
  if (selectAllCheckbox) {
    const checkedCount = Array.from(allCheckboxes).filter(c => c.checked).length;
    selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
    selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
  }
}

function hideCreateUserModal() {
  const modal = $('#createUserModal');
  modal.style.display = 'none';
  $('#createUserForm').reset();
  
  // Reset custom role input if visible
  const roleSelect = $('#createRole');
  const customInput = $('#createRoleCustom');
  if (customInput) {
    customInput.style.display = 'none';
    customInput.value = '';
  }
  if (roleSelect) {
    roleSelect.style.display = 'block';
  }
}

function populateCreateRoleDropdown() {
  const roleSelect = $('#createRole');
  if (!roleSelect) return;

  // Clear existing options except the first one (if any)
  roleSelect.innerHTML = '';
  
  // Add role options from state
  state.roles.forEach(role => {
    const option = document.createElement('option');
    option.value = role.role_name;
    option.textContent = role.role_name;
    roleSelect.appendChild(option);
  });

  // Add "Add New Role" option
  const addNewOption = document.createElement('option');
  addNewOption.value = '__ADD_NEW__';
  addNewOption.textContent = '➕ Add New Role...';
  roleSelect.appendChild(addNewOption);
}

function wireCreateUserModal() {
  // Close buttons
  $('#closeModal')?.addEventListener('click', hideCreateUserModal);
  $('#cancelCreateUser')?.addEventListener('click', hideCreateUserModal);

  // Handle role dropdown "Add New Role" option
  const roleSelect = $('#createRole');
  if (roleSelect) {
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'modern-input';
    customInput.placeholder = 'Enter new role name...';
    customInput.style.display = 'none';
    customInput.id = 'createRoleCustom';
    roleSelect.parentNode.appendChild(customInput);

    roleSelect.addEventListener('change', (e) => {
      if (e.target.value === '__ADD_NEW__') {
        roleSelect.style.display = 'none';
        customInput.style.display = 'block';
        customInput.focus();
        customInput.value = '';
      } else {
        // Auto-populate tabs based on selected role
        autoPopulateTabsForRole(e.target.value);
      }
    });

    // Handle custom input blur
    customInput.addEventListener('blur', () => {
      const customValue = customInput.value.trim();
      if (customValue) {
        // Add to dropdown if doesn't exist
        const existingOption = Array.from(roleSelect.options).find(opt => opt.value === customValue);
        if (!existingOption) {
          const newOption = document.createElement('option');
          newOption.value = customValue;
          newOption.textContent = customValue;
          // Insert before "Add New Role" option
          roleSelect.insertBefore(newOption, roleSelect.options[roleSelect.options.length - 1]);
        }
        roleSelect.value = customValue;
      } else {
        roleSelect.value = roleSelect.options[0]?.value || 'user';
      }
      customInput.style.display = 'none';
      roleSelect.style.display = 'block';
    });

    // Handle Enter key
    customInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        customInput.blur();
      }
    });

    // Handle Escape key
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        customInput.value = '';
        customInput.style.display = 'none';
        roleSelect.value = roleSelect.options[0]?.value || 'user';
        roleSelect.style.display = 'block';
      }
    });
  }

  // Form submission
  $('#createUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const username = formData.get('username').trim();
    const password = formData.get('password').trim();
    const roleSelect = $('#createRole');
    const customInput = $('#createRoleCustom');
    
    let role;
    if (roleSelect.style.display === 'none' && customInput) {
      role = customInput.value.trim();
    } else {
      role = formData.get('role');
    }
    
    const allowedTabs = formData.getAll('allowed_tabs');

    if (!username || !password) {
      notify('❌ Username and password are required', true);
      return;
    }

    if (!role) {
      notify('❌ Role is required', true);
      return;
    }

    const submitBtn = $('#submitCreateUser');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      await createUser({ username, password, role, allowed_tabs: allowedTabs });
      notify('✅ User created successfully');
      hideCreateUserModal();
      await refresh();
    } catch (e) {
      notify('❌ Failed to create user: ' + e.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  // Close modal when clicking outside
  $('#createUserModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'createUserModal') {
      hideCreateUserModal();
    }
  });
}

// Confirmation modal functions
function showConfirmationModal(options = {}) {
  const modal = $('#confirmationModal');
  const title = $('#confirmTitle');
  const message = $('#confirmMessage');
  const confirmBtn = $('#confirmAction');

  title.textContent = options.title || 'Confirm Action';
  message.textContent = options.message || 'Are you sure?';
  
  const color = getConfirmButtonColor(options.variant || 'default');
  confirmBtn.style.background = color;
  confirmBtn.textContent = options.confirmText || 'Confirm';

  modal.style.display = 'flex';

  return new Promise((resolve) => {
    function cleanup() {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      $('#cancelConfirm').removeEventListener('click', onCancel);
      $('#closeConfirmModal').removeEventListener('click', onCancel);
    }

    function onConfirm() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    confirmBtn.addEventListener('click', onConfirm);
    $('#cancelConfirm').addEventListener('click', onCancel);
    $('#closeConfirmModal').addEventListener('click', onCancel);

    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) onCancel();
    });
  });
}

function getConfirmButtonColor(variant) {
  switch (variant) {
    case 'danger': return 'linear-gradient(to bottom right, #e74c3c, #c0392b)';
    case 'warning': return 'linear-gradient(to bottom right, #f39c12, #d68910)';
    case 'success': return 'linear-gradient(to bottom right, #27ae60, #229954)';
    default: return 'linear-gradient(to bottom right, #3498db, #2980b9)';
  }
}

function confirmBulkDelete(count, itemType = 'items') {
  return showConfirmationModal({
    title: 'Confirm Bulk Delete',
    message: `Are you sure you want to delete ${count} ${itemType}? This action cannot be undone.`,
    confirmText: `Delete ${count} ${itemType}`,
    variant: 'danger'
  });
}

function confirmDelete(itemName, itemType = 'item') {
  return showConfirmationModal({
    title: `Delete ${itemType}`,
    message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
    confirmText: `Delete ${itemType}`,
    variant: 'danger'
  });
}

function notify(msg, isErr = false) {
  const area = $('#notificationArea');
  if (!area) return;

  const notification = document.createElement('div');
  notification.className = `notification ${isErr ? 'error' : 'success'}`;
  notification.textContent = msg;
  notification.style.cssText = `
    padding: 12px 16px;
    margin-bottom: 8px;
    border-radius: 4px;
    color: white;
    font-weight: 500;
    background: ${isErr ? '#e74c3c' : '#27ae60'};
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;

  area.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 10);

  // Auto remove
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 4000);

  // Click to dismiss
  notification.addEventListener('click', () => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  });
}

async function loadRoles() {
  try {
    console.log('[User Management] Loading roles...');
    const rolesData = await getRoles();
    state.roles = Array.isArray(rolesData) ? rolesData : [];
    console.log('[User Management] Loaded roles:', state.roles);
  } catch (e) {
    console.error('[User Management] Failed to load roles:', e);
    // Fallback to default roles if API fails
    state.roles = [
      { role_name: 'user', allowed_tabs: ['enrollment', 'attendance'] },
      { role_name: 'admin', allowed_tabs: ['enrollment', 'inventory', 'attendance', 'labels', 'salesdata', 'usermanagement'] },
      { role_name: 'manager', allowed_tabs: ['enrollment', 'inventory', 'attendance', 'labels', 'salesdata'] }
    ];
  }
}

export async function refresh() {
  try {
    console.log('[User Management] Starting refresh...');
    await loadRoles(); // Load roles first
    const data = await getUsers();
    console.log('[User Management] Received data:', data);
    state.users = Array.isArray(data) ? data : [];
    console.log('[User Management] State users:', state.users);
    renderTable();
    updateBulkDeleteButton();
  } catch (e) {
    console.error('[User Management] Refresh failed:', e);
    notify('❌ Failed to load users: ' + e.message, true);
    // Still render table to show "No users found" message
    state.users = [];
    renderTable();
  }
}

export async function init() {
  wireToolbar();
  wireCreateUserModal();
  await refresh();
  
  // Load debug utilities in development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('🧪 [Debug] User management loaded');
  }
}