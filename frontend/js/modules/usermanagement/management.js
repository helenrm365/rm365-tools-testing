// js/modules/usermanagement/management.js
import { getUsers, createUser, updateUser, deleteUser, sendEmailVerificationCode, resendEmailVerificationCode, confirmEmailVerification } from '../../services/api/usersApi.js?v=2';
import { getTabPresets, createTabPreset, updateTabPreset, deleteTabPreset } from '../../services/api/tabPresetsApi.js';
import { getGroups, createGroup, updateGroup, deleteGroup } from '../../services/api/groupsApi.js';
import { getLocations as getLocationObjects } from '../../services/api/locationsApi.js';
import { generateTabStructure } from '../../router.js';
import { showToast } from '../../ui/toast.js';
import { initDropdown } from '../../ui/dropdown.js';

// Get the tab structure dynamically from the router
const TAB_STRUCTURE = generateTabStructure();
let state = {
  users: [],
  tabPresets: [],   // Tab Presets (formerly "roles") — bundles of allowed_tabs
  groups: [],
  locations: [],
  query: '',
  groupFilter: '',
  editingUser: null,

  // Tab Preset Manager State
  managePresetSelected: null,
  returnToUserModal: false,
  returnToPresetsManager: false,

  // Group Manager State
  editingGroupId: null,
  returnToGroupsManager: false,
};

// Persists across modal open/close — tracks per-user email verification state
// so closing/reopening a user cannot reset the rate-limit window.
// keyed by username → { codeSent, email, rateLimited, rateLimitMsg }
const emailVerifStateMap = new Map();

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }

// --- Helpers ---

function getGroupName(groupId) {
  if (!groupId) return '<span class="text-muted">—</span>';
  const group = state.groups.find(g => g.id === groupId);
  return group ? group.group_name : '<span class="text-muted">—</span>';
}

function isAdminPreset(presetName) {
  return presetName && presetName.toLowerCase() === 'admin';
}

function isCustomPreset(presetName) {
  return presetName && presetName.toLowerCase() === 'custom';
}

function isSystemPreset(presetName) {
  return isAdminPreset(presetName) || isCustomPreset(presetName);
}

function getPresetTabsForUser(user) {
  if (isAdminPreset(user.tab_preset)) return null; // Full access
  if (isCustomPreset(user.tab_preset)) return user.allowed_tabs || []; // Per-user tabs
  const preset = state.tabPresets.find(p => p.preset_name === user.tab_preset);
  return preset ? preset.allowed_tabs : user.allowed_tabs;
}

function notify(msg, isError = false) {
  showToast(msg, isError ? 'error' : 'success');
}

function confirmAction(title, msg) {
  return new Promise(resolve => {
    const modal = $('#confirmationModal');
    if (!modal) {
      resolve(confirm(title + '\n' + msg));
      return;
    }
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = msg;
    modal.classList.add('active');
    
    const cleanup = (result) => {
      modal.classList.remove('active');
      resolve(result);
    };
    
    $('#confirmAction').onclick = () => cleanup(true);
    $('#cancelConfirm').onclick = () => cleanup(false);
    $('#closeConfirmModal').onclick = () => cleanup(false);
  });
}

// ===============================================================================
// TABLE RENDERING
// ===============================================================================

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
    // Group filter
    if (state.groupFilter) {
      if (state.groupFilter === 'none') {
        if (user.group_id) return false;
      } else {
        const gid = parseInt(state.groupFilter, 10);
        if (user.group_id !== gid) return false;
      }
    }
    // Search filter
    if (state.query) {
      const q = state.query.toLowerCase();
      const groupName = (state.groups.find(g => g.id === user.group_id) || {}).group_name || '';
      return user.username.toLowerCase().includes(q) || 
             (user.role || '').toLowerCase().includes(q) ||
             (user.tab_preset || '').toLowerCase().includes(q) ||
             groupName.toLowerCase().includes(q);
    }
    return true;
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

  const rows = filtered.map(user => {
    const isAdmin = isAdminPreset(user.tab_preset);
    const hasPreset = !!user.tab_preset;
    let tabAccessDisplay;
    if (isAdmin) {
      tabAccessDisplay = '<span class="full-access-badge">Full Access</span>';
    } else if (hasPreset) {
      tabAccessDisplay = `<button class="btn btn-flat btn-primary btn-xs view-tabs-btn" data-username="${user.username}"><i class="fas fa-eye"></i> View</button>`;
    } else {
      tabAccessDisplay = '<span class="text-muted">—</span>';
    }
    const presetDisplay = hasPreset
      ? `<span class="status-badge status-${user.tab_preset}">${user.tab_preset}</span>`
      : '<span class="text-muted">—</span>';
    const roleDisplay = user.role
      ? `<span class="role-badge">${user.role}</span>`
      : '<span class="text-muted">—</span>';

    return `
      <tr data-username="${user.username}">
        <td class="col-group" data-label="Group">${getGroupName(user.group_id)}</td>
        <td class="col-username" data-label="Username">
          <div class="user-cell">
            <div class="user-avatar-sm">${user.username.substring(0, 2).toUpperCase()}</div>
            <span>${user.username}</span>
          </div>
        </td>
        <td class="col-role" data-label="Role">${roleDisplay}</td>
        <td class="col-preset" data-label="Tab Preset">${presetDisplay}</td>
        <td class="col-tabs" data-label="Tab Access">${tabAccessDisplay}</td>
        <td class="col-actions" data-label="Actions">
          <button class="btn btn-solid btn-default btn-xs rounded-lg edit-user-btn" title="Edit User">
            <i class="fas fa-edit"></i>
            <span>Edit</span>
          </button>
          <button class="btn btn-flat btn-danger btn-xs delete-user-btn" title="Delete User">
            <i class="fas fa-trash"></i>
            <span>Delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  wrapper.innerHTML = `
    <div class="table-container">
      <table class="data-table users-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Username</th>
            <th>Role</th>
            <th>Tab Preset</th>
            <th>Tab Access</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;

  wireTableEvents();
}

function wireTableEvents() {
  // Edit User
  $all('.edit-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const username = btn.closest('tr').dataset.username;
      const user = state.users.find(u => u.username === username);
      if (user) openUserModal(user);
    });
  });

  // Delete User
  $all('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.closest('tr').dataset.username;
      if (await confirmAction('Delete User', `Are you sure you want to delete "${username}"? This cannot be undone.`)) {
        try {
          await deleteUser(username);
          notify('User deleted');
          await refresh();
        } catch(e) {
          notify('Error deleting user: ' + e.message, true);
        }
      }
    });
  });

  // View Tabs
  $all('.view-tabs-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const username = btn.dataset.username;
      const user = state.users.find(u => u.username === username);
      if (user) openViewTabsModal(user);
    });
  });
}

// ===============================================================================
// TOOLBAR & FILTERS
// ===============================================================================

function wireToolbar() {
  $('#userSearch')?.addEventListener('input', (e) => {
    state.query = e.target.value;
    renderTable();
  });

  $('#userCreateBtn')?.addEventListener('click', () => {
    openUserModal();
  });
  
  $('#manageTabPresetsBtn')?.addEventListener('click', () => {
    openTabPresetsManager();
  });

  $('#manageGroupsBtn')?.addEventListener('click', () => {
    openGroupsManager();
  });

  $('#groupFilter')?.addEventListener('change', (e) => {
    state.groupFilter = e.target.value;
    renderTable();
  });
}

function populateGroupFilter() {
  const select = $('#groupFilter');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Groups</option>';
  state.groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.group_name;
    select.appendChild(opt);
  });
  // Add "No Group" option
  const noGroupOpt = document.createElement('option');
  noGroupOpt.value = 'none';
  noGroupOpt.textContent = 'No Group';
  select.appendChild(noGroupOpt);
  select.value = currentVal || '';
}

// ===============================================================================
// USER MODAL (Create/Edit) — Tabs driven by role, not user
// ===============================================================================

function populateLocationDropdown(selectedLocationId = null) {
  const select = $('#formLocation');
  if (!select) return;
  select.innerHTML = '<option value="">None (no timezone conversion)</option>';
  state.locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = `${loc.name} (${loc.timezone})`;
    if (selectedLocationId && loc.id === selectedLocationId) opt.selected = true;
    select.appendChild(opt);
  });
}

function populateGroupDropdown(selectedGroupId = null) {
  const select = $('#formGroup');
  if (!select) return;
  select.innerHTML = '<option value="">No Group</option>';
  state.groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.group_name;
    if (selectedGroupId && g.id === selectedGroupId) opt.selected = true;
    select.appendChild(opt);
  });
}

function populateTabPresetsDropdown(currentPreset = null) {
  const selectEl = $('#formTabPreset');
  if (!selectEl) return;

  selectEl.innerHTML = '<option value="">No Preset</option>' + state.tabPresets.map(p => {
    const isSelected = currentPreset === p.preset_name;
    return `<option value="${p.preset_name}" ${isSelected ? 'selected' : ''}>${p.preset_name}</option>`;
  }).join('');

  if (currentPreset) {
    selectEl.value = currentPreset;
  } else {
    selectEl.value = '';
  }

  // Attach change listener for preset selection
  if (!selectEl.dataset.listenerAttached) {
    selectEl.addEventListener('change', (e) => {
      // When switching to custom, pass the editing user's existing tabs if available
      const editingTabs = state.editingUser
        ? (state.users.find(u => u.username === state.editingUser)?.allowed_tabs || [])
        : [];
      updatePresetTabInfo(e.target.value, isCustomPreset(e.target.value) ? editingTabs : null);
    });
    selectEl.dataset.listenerAttached = 'true';
  }
}

function updatePresetTabInfo(presetName, userTabs = null) {
  const presetInfo = $('#presetTabInfo');
  const adminInfo = $('#adminTabInfo');
  const customSection = $('#customTabsSection');

  if (isAdminPreset(presetName)) {
    if (presetInfo) presetInfo.style.display = 'none';
    if (adminInfo) adminInfo.style.display = 'flex';
    if (customSection) customSection.style.display = 'none';
  } else if (isCustomPreset(presetName)) {
    if (presetInfo) presetInfo.style.display = 'none';
    if (adminInfo) adminInfo.style.display = 'none';
    if (customSection) {
      customSection.style.display = 'block';
      const container = $('#customTabsContainer');
      renderTabCheckboxesInternal(container, 'custom_user_allowed_tab');
      
      // Pre-check user's existing tabs when editing
      if (userTabs && userTabs.length > 0) {
        preCheckTabs(container, 'custom_user_allowed_tab', userTabs);
      }
    }
  } else {
    if (presetInfo) presetInfo.style.display = presetName ? 'flex' : 'none';
    if (adminInfo) adminInfo.style.display = 'none';
    if (customSection) customSection.style.display = 'none';
  }
}

function openUserModal(user = null) {
  const modal = $('#userModal');
  const form = $('#userForm');
  const title = $('#userModalTitle');
  const btn = $('#saveUserBtn');

  if (user) {
    // Edit Mode
    state.editingUser = user.username;
    title.textContent = 'Edit User: ' + user.username;
    $('#editOriginalUsername').value = user.username;
    $('#formUsername').value = user.username;
    $('#formRoleLabel').value = user.role || '';

    populateTabPresetsDropdown(user.tab_preset || null);
    populateGroupDropdown(user.group_id || null);
    populateLocationDropdown(user.location_id || null);

    $('#formPassword').value = '';
    $('#formConfirmPassword').value = '';
    $('#passwordMatchMsg').style.display = 'none';
    $('#passwordHint').style.display = 'inline';
    btn.innerHTML = '<i class="fas fa-save"></i><span>Save Changes</span>';

    updatePresetTabInfo(user.tab_preset || '', user.allowed_tabs || []);

    // Email: edit mode — restore state from map (persists across modal close/open)
    $('#emailCreateRow').style.display = 'none';
    resetEmailVerificationUI();

    const verif = emailVerifStateMap.get(user.username);
    if (user.email && !verif?.codeSent) {
      // Verified email on file, no pending change in progress
      $('#emailVerifiedValue').textContent = user.email;
      $('#emailVerifiedRow').style.display = '';
      $('#emailInputRow').style.display = 'none';
    } else {
      // No email yet, OR mid-change verification in progress
      $('#emailVerifiedRow').style.display = 'none';
      $('#emailInputRow').style.display = '';
      restoreEmailVerifState(user.username);
    }
  } else {
    // Create Mode
    state.editingUser = null;
    title.textContent = 'Create New User';
    $('#editOriginalUsername').value = '';
    form.reset();
    $('#passwordMatchMsg').style.display = 'none';
    $('#passwordHint').style.display = 'none';
    btn.innerHTML = '<i class="fas fa-plus"></i><span>Create User</span>';
    $('#formRoleLabel').value = 'Staff';

    populateTabPresetsDropdown(null);
    populateGroupDropdown(null);
    populateLocationDropdown(null);

    updatePresetTabInfo('');

    // Email: create mode — plain input, no verification required
    $('#emailCreateRow').style.display = '';
    $('#emailVerifiedRow').style.display = 'none';
    $('#emailInputRow').style.display = 'none';
    $('#emailCodeRow').style.display = 'none';
  }

  modal.classList.add('active');
}

function resetEmailVerificationUI() {
  $('#emailCodeRow').style.display = 'none';
  $('#formEmailCode').value = '';
  $('#formEmail').readOnly = false;
  const msg = $('#emailCodeMsg');
  msg.style.display = 'none';
  msg.textContent = '';
  const sendBtn = $('#emailSendCodeBtn');
  sendBtn.disabled = false;
  sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>Send Code</span>';
  const resendBtn = $('#emailResendBtn');
  resendBtn.disabled = false;
  resendBtn.innerHTML = '<i class="fas fa-redo"></i><span>Resend</span>';
}

// Restores the code-entry UI for a user who already had a code sent this session.
// Called when reopening the modal for a user who is mid-verification.
function restoreEmailVerifState(username) {
  const verif = emailVerifStateMap.get(username);
  if (!verif?.codeSent) return;

  $('#formEmail').value = verif.email;
  $('#formEmail').readOnly = true;
  $('#emailSendCodeBtn').innerHTML = '<i class="fas fa-paper-plane"></i><span>Sent</span>';
  $('#emailCodeRow').style.display = '';

  const msg = $('#emailCodeMsg');
  msg.style.display = 'block';

  if (verif.rateLimited) {
    msg.style.color = '#b91c1c';
    msg.textContent = verif.rateLimitMsg || 'Send limit reached.';
    $('#emailSendCodeBtn').disabled = true;
    $('#emailResendBtn').disabled = true;
  } else {
    msg.style.color = '#065f46';
    msg.textContent = `Code sent to ${verif.email}. Enter it below.`;
  }
}

function wireUserModal() {
  const form = $('#userForm');
  const modal = $('#userModal');

  // Close
  $('#closeUserModal')?.addEventListener('click', () => modal.classList.remove('active'));
  $('#cancelUserModal')?.addEventListener('click', () => modal.classList.remove('active'));

  // Password Validation Debounce
  let passwordDebounce;
  const validatePasswordMatch = () => {
    const p1 = $('#formPassword').value;
    const p2 = $('#formConfirmPassword').value;
    const msg = $('#passwordMatchMsg');
    
    if (!p1 && !p2) { msg.style.display = 'none'; return; }
    if (p1 && p2) {
      msg.style.display = 'block';
      if (p1 === p2) {
        msg.textContent = 'Passwords match';
        msg.style.color = '#27ae60';
      } else {
        msg.textContent = 'Passwords do not match';
        msg.style.color = '#e74c3c';
      }
    } else if (p1 && !p2) {
      msg.style.display = 'block';
      msg.textContent = 'Confirm password required';
      msg.style.color = '#f39c12';
    } else {
      msg.style.display = 'none';
    }
  };

  const handlePasswordInput = () => {
    clearTimeout(passwordDebounce);
    passwordDebounce = setTimeout(validatePasswordMatch, 500);
  };

  $('#formPassword')?.addEventListener('input', handlePasswordInput);
  $('#formConfirmPassword')?.addEventListener('input', handlePasswordInput);

  // Custom Role - Select All Tabs
  const customSelectAll = $('#customSelectAllTabs');
  if (customSelectAll && !customSelectAll.dataset.listenerAttached) {
    customSelectAll.addEventListener('change', (e) => {
      const container = $('#customTabsContainer');
      if (!container) return;
      const isChecked = e.target.checked;
      container.querySelectorAll('.parent-checkbox').forEach(p => { p.checked = isChecked; p.indeterminate = false; });
      container.querySelectorAll('.child-checkbox').forEach(c => { c.checked = isChecked; c.indeterminate = false; });
      container.querySelectorAll('.grandchild-checkbox').forEach(gc => gc.checked = isChecked);
    });
    customSelectAll.dataset.listenerAttached = 'true';
  }

  // --- Email Verification Handlers ---

  // "Change Email" — go back to input row, clear map entry so fresh verification starts
  $('#emailChangeBtn')?.addEventListener('click', () => {
    const username = state.editingUser;
    if (username) emailVerifStateMap.delete(username);
    $('#emailVerifiedRow').style.display = 'none';
    $('#emailInputRow').style.display = '';
    $('#formEmail').value = '';
    resetEmailVerificationUI();
  });

  // "Send Code"
  $('#emailSendCodeBtn')?.addEventListener('click', async () => {
    const email = $('#formEmail').value.trim();
    const username = state.editingUser;
    if (!email) { notify('Enter an email address first', true); return; }
    if (!username) return;

    const btn = $('#emailSendCodeBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Sending...</span>';

    try {
      await sendEmailVerificationCode(username, email);
      // Update persistent map
      emailVerifStateMap.set(username, { codeSent: true, email, rateLimited: false, rateLimitMsg: '' });

      $('#emailCodeRow').style.display = '';
      $('#formEmail').readOnly = true;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i><span>Sent</span>';
      const msg = $('#emailCodeMsg');
      msg.style.display = 'block';
      msg.style.color = '#065f46';
      msg.textContent = `Code sent to ${email}. Enter it below.`;
    } catch(err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i><span>Send Code</span>';

      if (/limit reached|try again in/i.test(err.message)) {
        // Rate limit hit — persist so reopening modal shows the same blocked state
        const existing = emailVerifStateMap.get(username) || {};
        emailVerifStateMap.set(username, { ...existing, rateLimited: true, rateLimitMsg: err.message });

        // If there was a previous code in-flight, restore the code row
        if (existing.codeSent) {
          restoreEmailVerifState(username);
        } else {
          const msg = $('#emailCodeMsg');
          msg.style.display = 'block';
          msg.style.color = '#b91c1c';
          msg.textContent = err.message;
          btn.disabled = true;
        }
      } else {
        notify('Failed to send code: ' + err.message, true);
      }
    }
  });

  // "Verify"
  $('#emailVerifyBtn')?.addEventListener('click', async () => {
    const code = ($('#formEmailCode').value || '').trim();
    const username = state.editingUser;
    if (!code || code.length !== 6) { notify('Enter the 6-digit code', true); return; }
    if (!username) return;

    const btn = $('#emailVerifyBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Verifying...</span>';

    try {
      const result = await confirmEmailVerification(username, code);
      // Clear map — verification complete, no pending state
      emailVerifStateMap.delete(username);
      // Update local user record so reopening shows the new verified email immediately
      const userIdx = state.users.findIndex(u => u.username === username);
      if (userIdx >= 0) state.users[userIdx] = { ...state.users[userIdx], email: result.email };

      $('#emailInputRow').style.display = 'none';
      $('#emailCodeRow').style.display = 'none';
      $('#formEmail').readOnly = false;
      $('#emailVerifiedValue').textContent = result.email;
      $('#emailVerifiedRow').style.display = '';
      notify(`Email ${result.email} verified and saved`);
    } catch(err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i><span>Verify</span>';
      const msg = $('#emailCodeMsg');
      msg.style.display = 'block';
      msg.style.color = '#b91c1c';
      msg.textContent = err.message || 'Invalid code';
    }
  });

  // "Resend"
  $('#emailResendBtn')?.addEventListener('click', async () => {
    const username = state.editingUser;
    if (!username) return;

    const btn = $('#emailResendBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Resending...</span>';

    try {
      await resendEmailVerificationCode(username);
      // Update map — still pending, not rate-limited
      const existing = emailVerifStateMap.get(username) || {};
      emailVerifStateMap.set(username, { ...existing, rateLimited: false, rateLimitMsg: '' });

      const msg = $('#emailCodeMsg');
      msg.style.display = 'block';
      msg.style.color = '#065f46';
      msg.textContent = 'New code sent! Check your email.';
      $('#formEmailCode').value = '';
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-redo"></i><span>Resend</span>';
    } catch(err) {
      // Rate limit hit — persist so reopening still shows blocked state
      const existing = emailVerifStateMap.get(username) || {};
      emailVerifStateMap.set(username, { ...existing, rateLimited: true, rateLimitMsg: err.message });

      const msg = $('#emailCodeMsg');
      msg.style.display = 'block';
      msg.style.color = '#b91c1c';
      msg.textContent = err.message || 'Could not resend. Try again later.';
      // Keep resend + send buttons disabled
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-redo"></i><span>Resend</span>';
      $('#emailSendCodeBtn').disabled = true;
    }
  });

  // Submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const username = formData.get('username').trim();
    const tab_preset = $('#formTabPreset').value || null;
    const role = ($('#formRoleLabel').value || '').trim() || null;
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');
    const locationIdRaw = $('#formLocation').value;
    const location_id = locationIdRaw ? parseInt(locationIdRaw, 10) : null;
    const groupIdRaw = $('#formGroup').value;
    const group_id = groupIdRaw ? parseInt(groupIdRaw, 10) : null;
    const originalUsername = $('#editOriginalUsername').value;
    const isEdit = !!state.editingUser;

    // Get allowed_tabs based on tab preset type
    let allowedTabs = [];
    if (isAdminPreset(tab_preset)) {
      allowedTabs = []; // Admin = full access, stored as empty
    } else if (isCustomPreset(tab_preset)) {
      allowedTabs = collectAllowedTabs('custom_user_allowed_tab'); // Per-user selection
    } else if (tab_preset) {
      const presetObj = state.tabPresets.find(p => p.preset_name === tab_preset);
      allowedTabs = presetObj ? presetObj.allowed_tabs : [];
    }

    // Validation
    if (!username) { notify('Username is required', true); return; }
    if (!isEdit && !password) { notify('Password is required for new users', true); return; }
    if (password && password !== confirmPassword) { notify('Passwords do not match', true); return; }

    try {
      if (isEdit) {
        await updateUser({
          username: originalUsername,
          new_username: username !== originalUsername ? username : undefined,
          new_password: password || undefined,
          role,
          tab_preset,
          allowed_tabs: allowedTabs,
          location_id,
          group_id
        });
        notify('User updated');
      } else {
        const email = ($('#formEmailCreate').value || '').trim() || null;
        await createUser({ username, password, email, role, tab_preset, allowed_tabs: allowedTabs, location_id, group_id });
        notify('User created');
      }
      modal.classList.remove('active');
      await refresh();
    } catch(err) {
      notify('Error: ' + err.message, true);
    }
  });
}

// ===============================================================================
// VIEW TABS MODAL
// ===============================================================================

function openViewTabsModal(user) {
  const modal = $('#viewTabsModal');
  $('#viewTabsTitle').textContent = `Tab Access: ${user.username}`;

  const list = $('#viewTabsList');

  if (isAdminPreset(user.tab_preset)) {
    list.innerHTML = '<div class="full-access-notice"><i class="fas fa-shield-alt"></i> Full access to all tabs (Admin preset)</div>';
  } else {
    const tabs = getPresetTabsForUser(user) || [];
    if (tabs.length === 0) {
      list.innerHTML = '<p class="text-muted">No tabs assigned</p>';
    } else {
      // Group tabs hierarchically
      const grouped = {};
      tabs.forEach(tab => {
        const parts = tab.split('.');
        const parent = parts[0];
        if (!grouped[parent]) grouped[parent] = {};
        if (parts.length === 1) return; // section-only key
        const subtab = parts[1];
        if (!grouped[parent][subtab]) grouped[parent][subtab] = [];
        if (parts.length >= 3) {
          grouped[parent][subtab].push(parts[2]);
        }
      });

      let html = '';
      for (const [parent, subtabs] of Object.entries(grouped)) {
        const tabInfo = TAB_STRUCTURE[parent];
        const label = tabInfo ? tabInfo.label : parent;
        html += `<div class="view-tab-group">`;
        html += `<div class="view-tab-parent"><i class="fas fa-folder"></i> ${label}</div>`;
        
        for (const [subtabKey, subpages] of Object.entries(subtabs)) {
          const subtabObj = tabInfo?.subtabs?.find(s => s.key === subtabKey);
          const subtabLabel = subtabObj ? subtabObj.label : subtabKey;
          
          if (subpages.length > 0) {
            // Has specific sub-pages
            html += `<div class="view-tab-subtab"><i class="fas fa-folder-open"></i> ${subtabLabel}</div>`;
            html += `<div class="view-tab-children view-tab-grandchildren">`;
            subpages.forEach(sp => {
              const spObj = subtabObj?.children?.find(c => c.key === sp);
              const spLabel = spObj ? spObj.label : sp;
              html += `<span class="view-tab-child"><i class="fas fa-check"></i> ${spLabel}</span>`;
            });
            html += `</div>`;
          } else {
            // Full subtab access (no specific sub-pages = all)
            const hasChildren = subtabObj?.children?.length > 0;
            html += `<div class="view-tab-children">`;
            html += `<span class="view-tab-child"><i class="fas fa-check"></i> ${subtabLabel}${hasChildren ? ' (All)' : ''}</span>`;
            html += `</div>`;
          }
        }
        
        html += `</div>`;
      }
      list.innerHTML = html;
    }
  }

  $('#closeViewTabs').onclick = () => modal.classList.remove('active');
  $('#closeViewTabsBtn').onclick = () => modal.classList.remove('active');
  modal.classList.add('active');
}

// ===============================================================================
// TAB PRESETS MANAGER
// ===============================================================================

async function loadTabPresets() {
  try {
    state.tabPresets = await getTabPresets() || [];
  } catch (e) {
    console.warn('Failed to load tab presets, falling back to defaults', e);
    state.tabPresets = [
      {preset_name:'admin', allowed_tabs:[...Object.keys(TAB_STRUCTURE)]},
      {preset_name:'custom', allowed_tabs:[]}
    ];
  }
}

function openTabPresetsManager() {
  const modal = $('#tabPresetsManagerModal');
  if (!modal) return;
  renderTabPresetsList();
  wireTabPresetsManager();
  modal.classList.add('active');
}

function wireTabPresetsManager() {
  $('#closeTabPresetsManager').onclick = () => {
    $('#tabPresetsManagerModal').classList.remove('active');
    refresh();
  };

  $('#tabPresetsManagerAddBtn').onclick = () => {
    $('#tabPresetsManagerModal').classList.remove('active');
    state.returnToPresetsManager = true;
    state.returnToUserModal = false;
    $('#addTabPresetModal').classList.add('active');
    $('#newTabPresetName').value = '';
    $('#newTabPresetName').focus();
  };

  $('#tabPresetsList').onclick = (e) => {
    const item = e.target.closest('.role-list-item');
    if (item && !item.classList.contains('is-locked')) {
      openEditTabPresetModal(item.dataset.preset);
    }
  };
}

function renderTabPresetsList() {
  const list = $('#tabPresetsList');
  list.innerHTML = state.tabPresets.map(p => {
    const locked = isSystemPreset(p.preset_name);
    const isAdmin = isAdminPreset(p.preset_name);
    const isCustom = isCustomPreset(p.preset_name);
    let tabInfo;
    if (isAdmin) tabInfo = 'Full Access';
    else if (isCustom) tabInfo = 'Per-user tab selection';
    else tabInfo = `${p.allowed_tabs ? p.allowed_tabs.length : 0} tabs allowed`;
    const lockIcon = locked ? '<i class="fas fa-lock role-lock-icon"></i>' : '';
    return `
      <div class="role-list-item${locked ? ' is-locked' : ''}" data-preset="${p.preset_name}">
        <div class="role-list-item-name">${lockIcon}${p.preset_name}</div>
        <div class="role-list-item-tabs">${tabInfo}</div>
      </div>
    `;
  }).join('');
}

function openEditTabPresetModal(presetName) {
  state.managePresetSelected = presetName;
  const preset = state.tabPresets.find(p => p.preset_name === presetName);
  if (!preset) return;

  const modal = $('#editTabPresetModal');
  const isAdmin = isAdminPreset(presetName);

  $('#editTabPresetTitle').textContent = `Edit Tab Preset: ${presetName}`;
  $('#editTabPresetName').value = preset.preset_name;

  // Show/hide admin notice and tabs section
  const adminNotice = $('#editTabPresetAdminNotice');
  const tabsSection = $('#editTabPresetTabsSection');

  if (isAdmin) {
    if (adminNotice) adminNotice.style.display = 'flex';
    if (tabsSection) tabsSection.style.display = 'none';
  } else {
    if (adminNotice) adminNotice.style.display = 'none';
    if (tabsSection) tabsSection.style.display = 'block';

    // Render Tabs
    const container = $('#editTabPresetTabsContainer');
    renderTabCheckboxesInternal(container, 'edit_preset_allowed_tab');
    preCheckTabs(container, 'edit_preset_allowed_tab', preset.allowed_tabs);
  }

  wireEditTabPresetModal();
  modal.classList.add('active');
}

function wireEditTabPresetModal() {
  const modal = $('#editTabPresetModal');

  $('#closeEditTabPreset').onclick = () => {
    modal.classList.remove('active');
    $('#tabPresetsManagerModal').classList.add('active');
  };
  $('#cancelEditTabPreset').onclick = () => {
    modal.classList.remove('active');
    $('#tabPresetsManagerModal').classList.add('active');
  };

  // Delete Preset
  $('#editTabPresetDeleteBtn').onclick = async () => {
    const presetName = state.managePresetSelected;
    if (!presetName) return;
    if (isSystemPreset(presetName)) {
      notify('Cannot delete system presets', true);
      return;
    }

    if (await confirmAction('Delete Tab Preset?', `Are you sure you want to delete tab preset "${presetName}"? Users assigned to it may lose permissions.`)) {
      try {
        await deleteTabPreset(presetName);
        notify('Tab preset deleted');
        await loadTabPresets();
        modal.classList.remove('active');
        $('#tabPresetsManagerModal').classList.add('active');
        renderTabPresetsList();
        state.managePresetSelected = null;
      } catch(e) {
        notify('Failed to delete tab preset: ' + e.message, true);
      }
    }
  };

  // Save Preset
  $('#saveEditTabPreset').onclick = async () => {
    const originalName = state.managePresetSelected;
    const newName = $('#editTabPresetName').value.trim();
    if (!originalName || !newName) return;

    let allowedTabs;
    if (isAdminPreset(newName)) {
      // Admin gets all tabs
      allowedTabs = Object.keys(TAB_STRUCTURE);
    } else {
      allowedTabs = collectAllowedTabs('edit_preset_allowed_tab');
    }

    try {
      await updateTabPreset({
        preset_name: originalName,
        new_preset_name: newName !== originalName ? newName : undefined,
        allowed_tabs: allowedTabs
      });
      notify('Tab preset updated');

      if (newName !== originalName) state.managePresetSelected = newName;
      await loadTabPresets();
      modal.classList.remove('active');
      $('#tabPresetsManagerModal').classList.add('active');
      renderTabPresetsList();
    } catch(e) {
      notify('Failed to save tab preset: ' + e.message, true);
    }
  };

  // Select All
  $('#editTabPresetSelectAllTabs').onchange = (e) => {
    const container = $('#editTabPresetTabsContainer');
    if (!container) return;
    const isChecked = e.target.checked;
    container.querySelectorAll('.parent-checkbox').forEach(p => { p.checked = isChecked; p.indeterminate = false; });
    container.querySelectorAll('.child-checkbox').forEach(c => { c.checked = isChecked; c.indeterminate = false; });
    container.querySelectorAll('.grandchild-checkbox').forEach(gc => gc.checked = isChecked);
  };
}

function wireAddTabPresetModal() {
  const modal = $('#addTabPresetModal');

  const closeAndReturn = () => {
    modal.classList.remove('active');
    if (state.returnToUserModal) {
      $('#userModal').classList.add('active');
      state.returnToUserModal = false;
    } else if (state.returnToPresetsManager) {
      openTabPresetsManager();
      state.returnToPresetsManager = false;
    }
  };

  $('#closeAddTabPresetModal')?.addEventListener('click', closeAndReturn);
  $('#cancelAddTabPreset')?.addEventListener('click', closeAndReturn);

  $('#confirmAddTabPreset').onclick = async () => {
    const nameInput = $('#newTabPresetName');
    const name = nameInput.value.trim();

    if (!name) { notify('Tab preset name is required', true); return; }

    try {
      if (state.tabPresets.find(p => p.preset_name === name)) {
        notify('Tab preset already exists', true);
        return;
      }
      await createTabPreset({ preset_name: name, allowed_tabs: [] });
      notify('Tab preset created');
      await loadTabPresets();

      if (state.returnToPresetsManager) {
        state.managePresetSelected = name;
      }
      if (state.returnToUserModal) {
        populateTabPresetsDropdown(name);
      }
      nameInput.value = '';
      closeAndReturn();
    } catch (e) {
      notify('Failed to create tab preset: ' + e.message, true);
    }
  };
}

// ===============================================================================
// GROUPS MANAGER
// ===============================================================================

async function loadGroups() {
  try {
    state.groups = await getGroups() || [];
  } catch (e) {
    console.warn('Failed to load groups:', e);
    state.groups = [];
  }
}

function openGroupsManager() {
  const modal = $('#groupsManagerModal');
  if (!modal) return;
  renderGroupsList();
  wireGroupsManager();
  modal.classList.add('active');
}

function wireGroupsManager() {
  $('#closeGroupsManager').onclick = () => {
    $('#groupsManagerModal').classList.remove('active');
    refresh();
  };
  
  $('#groupsManagerAddBtn').onclick = () => {
    $('#groupsManagerModal').classList.remove('active');
    state.returnToGroupsManager = true;
    $('#addGroupModal').classList.add('active');
    $('#newGroupName').value = '';
    $('#newGroupName').focus();
  };
  
  $('#groupsList').onclick = (e) => {
    const item = e.target.closest('.role-list-item');
    if (item) {
      const groupId = parseInt(item.dataset.groupId, 10);
      openEditGroupModal(groupId);
    }
  };
}

function renderGroupsList() {
  const list = $('#groupsList');
  if (state.groups.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="min-height: 150px;">
        <i class="fas fa-layer-group empty-state-icon"></i>
        <p class="empty-state-text">No groups created yet</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = state.groups.map(g => {
    const memberCount = state.users.filter(u => u.group_id === g.id).length;
    return `
      <div class="role-list-item" data-group-id="${g.id}">
        <div class="role-list-item-name">${g.group_name}</div>
        <div class="role-list-item-tabs">${memberCount} member${memberCount !== 1 ? 's' : ''}</div>
      </div>
    `;
  }).join('');
}

function wireAddGroupModal() {
  const modal = $('#addGroupModal');
  
  const closeAndReturn = () => {
    modal.classList.remove('active');
    if (state.returnToGroupsManager) {
      openGroupsManager();
      state.returnToGroupsManager = false;
    }
  };

  $('#closeAddGroupModal')?.addEventListener('click', closeAndReturn);
  $('#cancelAddGroup')?.addEventListener('click', closeAndReturn);
  
  $('#confirmAddGroup').onclick = async () => {
    const nameInput = $('#newGroupName');
    const name = nameInput.value.trim();
    
    if (!name) { notify('Group name is required', true); return; }

    try {
      await createGroup({ group_name: name });
      notify('Group created');
      await loadGroups();
      nameInput.value = '';
      closeAndReturn();
    } catch (e) {
      notify('Failed to create group: ' + e.message, true);
    }
  };
}

function openEditGroupModal(groupId) {
  state.editingGroupId = groupId;
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  
  const modal = $('#editGroupModal');
  $('#editGroupTitle').textContent = `Edit Group: ${group.group_name}`;
  $('#editGroupName').value = group.group_name;
  
  renderGroupMembers(groupId);
  wireEditGroupModal();
  modal.classList.add('active');
}

function renderGroupMembers(groupId) {
  const members = state.users.filter(u => u.group_id === groupId);
  const available = state.users.filter(u => u.group_id !== groupId);
  
  const membersEl = $('#editGroupMembers');
  const availableEl = $('#editGroupAvailable');
  const countEl = $('#editGroupMemberCount');
  
  countEl.textContent = `(${members.length} member${members.length !== 1 ? 's' : ''})`;
  
  if (members.length === 0) {
    membersEl.innerHTML = '<p class="text-muted" style="padding: 0.5rem 0; font-size: 0.8125rem;">No members in this group</p>';
  } else {
    membersEl.innerHTML = members.map(u => {
      const roleBadge = u.role
        ? `<span class="status-badge status-${u.role}" style="margin-left: 0.5rem; font-size: 0.7rem;">${u.role}</span>`
        : '';
      return `
      <div class="group-member-row">
        <div class="user-cell">
          <div class="user-avatar-sm">${u.username.substring(0, 2).toUpperCase()}</div>
          <span>${u.username}</span>
          ${roleBadge}
        </div>
        <button type="button" class="btn btn-flat btn-danger btn-xs remove-from-group-btn" data-username="${u.username}" title="Remove from group">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    }).join('');
  }
  
  if (available.length === 0) {
    availableEl.innerHTML = '<p class="text-muted" style="padding: 0.5rem 0; font-size: 0.8125rem;">All users are assigned to this group</p>';
  } else {
    availableEl.innerHTML = available.map(u => {
      const currentGroup = u.group_id ? state.groups.find(g => g.id === u.group_id) : null;
      const hint = currentGroup ? `Currently in: ${currentGroup.group_name}` : 'No group';
      return `
        <div class="group-member-row">
          <div class="user-cell">
            <div class="user-avatar-sm">${u.username.substring(0, 2).toUpperCase()}</div>
            <span>${u.username}</span>
            <span class="text-muted" style="margin-left: 0.5rem; font-size: 0.7rem;">${hint}</span>
          </div>
          <button type="button" class="btn btn-flat btn-success btn-xs add-to-group-btn" data-username="${u.username}" title="Add to group">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      `;
    }).join('');
  }
  
  // Wire add/remove buttons
  membersEl.querySelectorAll('.remove-from-group-btn').forEach(btn => {
    btn.onclick = async () => {
      const username = btn.dataset.username;
      try {
        await updateUser({ username, group_id: null });
        const user = state.users.find(u => u.username === username);
        if (user) user.group_id = null;
        renderGroupMembers(groupId);
      } catch (e) {
        notify('Failed to remove user from group: ' + e.message, true);
      }
    };
  });
  
  availableEl.querySelectorAll('.add-to-group-btn').forEach(btn => {
    btn.onclick = async () => {
      const username = btn.dataset.username;
      const user = state.users.find(u => u.username === username);
      const currentGroup = user?.group_id ? state.groups.find(g => g.id === user.group_id) : null;
      const targetGroup = state.groups.find(g => g.id === groupId);
      
      // If user is already in another group, confirm the move
      if (currentGroup) {
        const confirmed = await confirmAction(
          'Move User?',
          `"${username}" is currently in "${currentGroup.group_name}". Moving them will remove them from that group and add them to "${targetGroup?.group_name || 'this group'}".`
        );
        if (!confirmed) return;
      }
      
      try {
        await updateUser({ username, group_id: groupId });
        if (user) user.group_id = groupId;
        renderGroupMembers(groupId);
      } catch (e) {
        notify('Failed to add user to group: ' + e.message, true);
      }
    };
  });
}

function wireEditGroupModal() {
  const modal = $('#editGroupModal');
  
  const closeAndReturn = () => {
    modal.classList.remove('active');
    openGroupsManager();
  };
  
  $('#closeEditGroup').onclick = closeAndReturn;
  $('#cancelEditGroup').onclick = closeAndReturn;
  
  // Delete Group
  $('#editGroupDeleteBtn').onclick = async () => {
    const groupId = state.editingGroupId;
    if (!groupId) return;
    const group = state.groups.find(g => g.id === groupId);
    
    if (await confirmAction('Delete Group?', `Are you sure you want to delete group "${group?.group_name}"? Users in this group will be unassigned.`)) {
      try {
        await deleteGroup(groupId);
        notify('Group deleted');
        await loadGroups();
        modal.classList.remove('active');
        openGroupsManager();
      } catch(e) {
        notify('Failed to delete group: ' + e.message, true);
      }
    }
  };
  
  // Save Group (name only — user assignments are saved immediately)
  $('#saveEditGroup').onclick = async () => {
    const groupId = state.editingGroupId;
    const newName = $('#editGroupName').value.trim();
    if (!groupId || !newName) return;
    
    try {
      await updateGroup({ id: groupId, new_name: newName });
      notify('Group updated');
      await loadGroups();
      modal.classList.remove('active');
      openGroupsManager();
    } catch(e) {
      notify('Failed to save group: ' + e.message, true);
    }
  };
}

// ===============================================================================
// TAB CHECKBOX UTILITIES (used by Role Editor)
// ===============================================================================

/**
 * Pre-check tab checkboxes based on a list of allowed tab keys.
 * Handles 2-level keys (e.g. "inventory.management" grants all grandchildren)
 * and 3-level keys (e.g. "inventory.management.dashboard" grants individual sub-page).
 */
function preCheckTabs(container, inputName, tabs) {
  if (!tabs || tabs.length === 0) return;

  const allCbs = container.querySelectorAll(`input[name="${inputName}"]`);
  allCbs.forEach(cb => {
    if (tabs.includes(cb.value)) {
      cb.checked = true;
    }
  });

  // For 2-level keys like "inventory.management", also check all grandchildren
  tabs.forEach(tab => {
    const parts = tab.split('.');
    if (parts.length === 2) {
      // This is a subtab-level key — check all grandchildren under it
      container.querySelectorAll(`.grandchild-checkbox[data-parent="${parts[0]}"][data-child="${parts[1]}"]`)
        .forEach(gc => gc.checked = true);
    }
  });

  // Auto-check child (subtab) checkboxes when any grandchild is checked
  container.querySelectorAll('.child-checkbox[data-child]').forEach(childCb => {
    const parentKey = childCb.dataset.parent;
    const childKey = childCb.dataset.child;
    const gcCbs = container.querySelectorAll(`.grandchild-checkbox[data-parent="${parentKey}"][data-child="${childKey}"]`);
    if (gcCbs.length > 0) {
      const checkedCount = Array.from(gcCbs).filter(gc => gc.checked).length;
      childCb.checked = checkedCount > 0;
      childCb.indeterminate = checkedCount > 0 && checkedCount < gcCbs.length;
    }
  });

  // Auto-check parent (section) checkboxes when any child is checked
  for (const [key] of Object.entries(TAB_STRUCTURE)) {
    const childCbs = container.querySelectorAll(`.child-checkbox[data-parent="${key}"]`);
    const anyChildChecked = Array.from(childCbs).some(cb => cb.checked);
    if (anyChildChecked) {
      const parentCb = container.querySelector(`.parent-checkbox[data-parent="${key}"]`);
      if (parentCb) {
        parentCb.checked = true;
        const allChecked = Array.from(childCbs).every(cb => cb.checked);
        parentCb.indeterminate = !allChecked;
      }
    }
  }

  updateSelectAllState(container, inputName);
}

function renderTabCheckboxesInternal(container, inputName) {
  let html = '';
  for (const [key, info] of Object.entries(TAB_STRUCTURE)) {
    const hasSubtabs = info.subtabs && info.subtabs.length > 0;
    
    html += `<div class="tab-picker-group" data-tab-key="${key}">
      <div class="tab-picker-header">
        <i class="fas fa-folder"></i>
        <span class="tab-picker-parent-label">${info.label}</span>
        <label class="btn btn-flat btn-success btn-xs btn-checkable tab-picker-parent-btn">
          <input type="checkbox" name="${inputName}" value="${key}" class="parent-checkbox" data-parent="${key}">
          ${hasSubtabs ? 'All' : 'Enable'}
        </label>
      </div>`;
    
    if (hasSubtabs) {
      let inlineGroup = null;
      info.subtabs.forEach(sub => {
        const hasChildren = sub.children && sub.children.length > 0;
        const subtabValue = `${key}.${sub.key}`;

        if (hasChildren) {
          // Flush any pending inline group before a sub-section
          if (inlineGroup) {
            inlineGroup += `</div>`;
            html += inlineGroup;
            inlineGroup = null;
          }
          // Subtab with 3rd-level children: render as a sub-section
          html += `<div class="tab-picker-subtab-group" data-subtab-key="${subtabValue}">
            <div class="tab-picker-subtab-header" data-parent="${key}">
              <span class="tab-picker-subtab-label">${sub.label}</span>
              <label class="btn btn-flat btn-success btn-sm btn-checkable tab-picker-subtab-btn">
                <input type="checkbox" name="${inputName}" value="${subtabValue}" class="child-checkbox" data-parent="${key}" data-child="${sub.key}">
                All
              </label>
            </div>
            <div class="tab-picker-grandchildren" data-parent="${key}" data-child="${sub.key}">`;
          sub.children.forEach(gc => {
            html += `<label class="btn btn-flat btn-success btn-sm btn-checkable tab-picker-grandchild-btn">
              <input type="checkbox" name="${inputName}" value="${subtabValue}.${gc.key}" class="grandchild-checkbox" data-parent="${key}" data-child="${sub.key}">
              ${gc.label}
            </label>`;
          });
          html += `</div></div>`;
        } else {
          // Subtab without children: collect into inline group
          if (!inlineGroup) {
            inlineGroup = `<div class="tab-picker-children-inline" data-parent="${key}">`;
          }
          inlineGroup += `<label class="btn btn-flat btn-success btn-sm btn-checkable tab-picker-child-btn">
              <input type="checkbox" name="${inputName}" value="${subtabValue}" class="child-checkbox" data-parent="${key}">
              ${sub.label}
            </label>`;
        }
      });
      // Close any open inline group
      if (inlineGroup) {
        inlineGroup += `</div>`;
        html += inlineGroup;
      }
    }
    html += `</div>`;
  }
  container.innerHTML = html;
  wireTabCheckboxBehavior(container, inputName);
}

function wireTabCheckboxBehavior(container, inputName) {
  // Parent (section) checkbox → toggles all child + grandchild checkboxes
  container.querySelectorAll('.parent-checkbox').forEach(parentCb => {
    const parentKey = parentCb.dataset.parent;
    parentCb.addEventListener('change', () => {
      const isChecked = parentCb.checked;
      parentCb.indeterminate = false;
      container.querySelectorAll(`.child-checkbox[data-parent="${parentKey}"]`).forEach(c => { c.checked = isChecked; c.indeterminate = false; });
      container.querySelectorAll(`.grandchild-checkbox[data-parent="${parentKey}"]`).forEach(gc => gc.checked = isChecked);
      updateSelectAllState(container, inputName);
    });
  });

  // Child (subtab) checkbox → toggles grandchild checkboxes under it, updates parent
  container.querySelectorAll('.child-checkbox').forEach(childCb => {
    childCb.addEventListener('change', () => {
      const parentKey = childCb.dataset.parent;
      const childKey = childCb.dataset.child;
      const isChecked = childCb.checked;
      childCb.indeterminate = false;

      // Toggle grandchildren if this subtab has them
      if (childKey) {
        container.querySelectorAll(`.grandchild-checkbox[data-parent="${parentKey}"][data-child="${childKey}"]`)
          .forEach(gc => gc.checked = isChecked);
      }

      // Update parent state
      updateParentState(container, parentKey);
      updateSelectAllState(container, inputName);
    });
  });

  // Grandchild (sub-page) checkbox → updates child + parent states
  container.querySelectorAll('.grandchild-checkbox').forEach(gcCb => {
    gcCb.addEventListener('change', () => {
      const parentKey = gcCb.dataset.parent;
      const childKey = gcCb.dataset.child;

      // Update child (subtab) checkbox state
      const childCb = container.querySelector(`.child-checkbox[data-parent="${parentKey}"][data-child="${childKey}"]`);
      const siblings = container.querySelectorAll(`.grandchild-checkbox[data-parent="${parentKey}"][data-child="${childKey}"]`);
      if (childCb && siblings.length > 0) {
        const checkedCount = Array.from(siblings).filter(s => s.checked).length;
        childCb.checked = checkedCount > 0;
        childCb.indeterminate = checkedCount > 0 && checkedCount < siblings.length;
      }

      // Update parent state
      updateParentState(container, parentKey);
      updateSelectAllState(container, inputName);
    });
  });
}

function updateParentState(container, parentKey) {
  const parentCb = container.querySelector(`.parent-checkbox[data-parent="${parentKey}"]`);
  if (!parentCb) return;
  const allChildren = container.querySelectorAll(`.child-checkbox[data-parent="${parentKey}"]`);
  const checkedChildren = Array.from(allChildren).filter(c => c.checked);
  const anyIndeterminate = Array.from(allChildren).some(c => c.indeterminate);
  parentCb.checked = checkedChildren.length > 0;
  parentCb.indeterminate = (checkedChildren.length > 0 && checkedChildren.length < allChildren.length) || anyIndeterminate;
}

function updateSelectAllState(container, inputName) {
  let selectAllCheckbox;
  if (inputName === 'edit_role_allowed_tab') {
    selectAllCheckbox = $('#editRoleSelectAllTabs');
  } else if (inputName === 'custom_user_allowed_tab') {
    selectAllCheckbox = $('#customSelectAllTabs');
  }
  if (!selectAllCheckbox) return;
  
  const allParentCheckboxes = container.querySelectorAll('.parent-checkbox');
  const checkedParents = Array.from(allParentCheckboxes).filter(cb => cb.checked);
  const anyParentIndeterminate = Array.from(allParentCheckboxes).some(cb => cb.indeterminate);
  
  if (checkedParents.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (checkedParents.length === allParentCheckboxes.length && !anyParentIndeterminate) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

function collectAllowedTabs(inputName) {
  const tabs = [];
  for (const [key, info] of Object.entries(TAB_STRUCTURE)) {
    const hasSubtabs = info.subtabs && info.subtabs.length > 0;
    const parentCb = document.querySelector(`input[name="${inputName}"].parent-checkbox[data-parent="${key}"]`);
    if (!parentCb || !parentCb.checked) continue;

    if (!hasSubtabs) {
      tabs.push(key);
      continue;
    }

    // Collect from subtabs
    info.subtabs.forEach(sub => {
      const subtabValue = `${key}.${sub.key}`;
      const childCb = document.querySelector(`input[name="${inputName}"].child-checkbox[data-parent="${key}"][data-child="${sub.key}"]`);
      
      if (!childCb) {
        // Simple child (no data-child attribute) — check by value
        const simpleCb = document.querySelector(`input[name="${inputName}"].child-checkbox[value="${subtabValue}"]`);
        if (simpleCb && simpleCb.checked) tabs.push(subtabValue);
        return;
      }

      if (!childCb.checked) return;

      const hasChildren = sub.children && sub.children.length > 0;
      if (!hasChildren) {
        tabs.push(subtabValue);
        return;
      }

      // Check if ALL grandchildren are checked → push subtab key (grants all)
      const gcCbs = document.querySelectorAll(`input[name="${inputName}"].grandchild-checkbox[data-parent="${key}"][data-child="${sub.key}"]`);
      const checkedGc = Array.from(gcCbs).filter(gc => gc.checked);
      
      if (checkedGc.length === gcCbs.length) {
        // All checked → store parent key to grant blanket access
        tabs.push(subtabValue);
      } else {
        // Only some checked → store individual grandchild keys
        checkedGc.forEach(gc => tabs.push(gc.value));
      }
    });
  }
  return tabs;
}

// ===============================================================================
// INIT & REFRESH
// ===============================================================================

export async function refresh() {
  await Promise.all([loadTabPresets(), loadGroups()]);
  
  // Load locations
  try {
    const locs = await getLocationObjects();
    state.locations = Array.isArray(locs) ? locs : [];
  } catch(e) {
    console.warn('Failed to load locations:', e);
    state.locations = [];
  }
  
  try {
    const users = await getUsers();
    if (users && Array.isArray(users)) {
      state.users = users;
    } else {
      throw new Error('Invalid response');
    }
  } catch(e) {
    console.warn('Failed to load users, using sample data:', e);
    notify('Connection failed: Using sample data', true);
    state.users = [
      { username: 'sample_admin', role: 'Admin', tab_preset: 'admin', allowed_tabs: [...Object.keys(TAB_STRUCTURE)], group_id: null },
      { username: 'sample_user', role: 'Staff', tab_preset: 'custom', allowed_tabs: ['enrollment', 'attendance'], group_id: null }
    ];
  }
  
  populateGroupFilter();
  renderTable();
}

export async function init() {
  showToast('Setting up user management...', 'info');
  wireToolbar();
  wireUserModal();
  wireAddTabPresetModal();
  wireAddGroupModal();
  initDropdown('#formTabPreset');
  initDropdown('#formLocation');
  initDropdown('#formGroup');
  initDropdown('#groupFilter');

  showToast('Loading users & tab presets...', 'info');
  await refresh();
}
