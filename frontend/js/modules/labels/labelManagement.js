// js/modules/labels/labelManagement.js
import { createLabel, updateLabel, deleteLabel, getLabels } from '../../services/api/labelsApi.js';

let state = {
  labels: [],
  selectedLabel: null,
  editMode: false
};

function $(sel) { return document.querySelector(sel); }

async function loadLabels() {
  try {
    state.labels = await getLabels();
    renderLabelsTable();
    updateLabelSelect();
  } catch (e) {
    console.error('Error loading labels:', e);
    notify('❌ Failed to load labels', true);
  }
}

function renderLabelsTable() {
  const tableDiv = $('#labelsTable');
  
  if (state.labels.length === 0) {
    tableDiv.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: #666;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">🏷️</div>
        <h3>No labels found</h3>
        <p>Create your first label to get started.</p>
      </div>
    `;
    return;
  }

  tableDiv.innerHTML = `
    <div class="table-container">
    <table class="modern-table">
      <thead>
        <tr>
          <th style="text-align: left;">Label Details</th>
          <th style="text-align: center;">Template</th>
          <th style="text-align: center;">Status</th>
          <th style="text-align: center;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${state.labels.map(label => `
          <tr>
            <td>
              <div style="font-weight: 500; margin-bottom: 4px;">${label.name}</div>
              <div style="font-size: 0.85em; color: #666;">${label.description || 'No description'}</div>
              <div style="font-size: 0.8em; color: #888; margin-top: 4px;">
                Size: ${label.width}" × ${label.height}" | Created: ${new Date(label.created_at).toLocaleDateString()}
              </div>
            </td>
            <td style="text-align: center;">
              <div style="font-family: monospace; font-size: 0.9em; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; margin: 2px 0;">
                ${label.template ? label.template.substring(0, 50) + '...' : 'No template'}
              </div>
            </td>
            <td style="text-align: center;">
              <span class="status-badge ${label.is_active ? 'success' : 'warning'}">
                ${label.is_active ? '✅ Active' : '⏸️ Inactive'}
              </span>
            </td>
            <td style="text-align: center;">
              <div class="btn-group">
                <button class="btn-icon primary" onclick="editLabel(${label.id})" title="Edit label">
                  ✏️
                </button>
                <button class="btn-icon info" onclick="duplicateLabel(${label.id})" title="Duplicate label">
                  📄
                </button>
                <button class="btn-icon danger" onclick="deleteSelectedLabel(${label.id})" title="Delete label">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function updateLabelSelect() {
  const select = $('#labelSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select a label to edit...</option>';
  
  state.labels.forEach(label => {
    const option = document.createElement('option');
    option.value = label.id;
    option.textContent = `${label.name} (${label.width}" × ${label.height}")`;
    select.appendChild(option);
  });
}

function resetForm() {
  $('#labelName').value = '';
  $('#labelDescription').value = '';
  $('#labelWidth').value = '4';
  $('#labelHeight').value = '6';
  $('#labelTemplate').value = '';
  $('#isActive').checked = true;
  
  state.selectedLabel = null;
  state.editMode = false;
  
  $('#formTitle').textContent = 'Create New Label';
  $('#submitBtn').textContent = '💾 Create Label';
  $('#cancelBtn').style.display = 'none';
}

function loadLabelForEdit(label) {
  $('#labelName').value = label.name;
  $('#labelDescription').value = label.description || '';
  $('#labelWidth').value = label.width;
  $('#labelHeight').value = label.height;
  $('#labelTemplate').value = label.template || '';
  $('#isActive').checked = label.is_active;
  
  state.selectedLabel = label;
  state.editMode = true;
  
  $('#formTitle').textContent = 'Edit Label';
  $('#submitBtn').textContent = '💾 Update Label';
  $('#cancelBtn').style.display = 'inline-block';
}

async function saveLabel() {
  const formData = {
    name: $('#labelName').value.trim(),
    description: $('#labelDescription').value.trim(),
    width: parseFloat($('#labelWidth').value),
    height: parseFloat($('#labelHeight').value),
    template: $('#labelTemplate').value.trim(),
    is_active: $('#isActive').checked
  };

  // Validation
  if (!formData.name) {
    notify('❌ Label name is required', true);
    return;
  }
  
  if (formData.width <= 0 || formData.height <= 0) {
    notify('❌ Width and height must be positive numbers', true);
    return;
  }

  const btn = $('#submitBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = state.editMode ? 'Updating...' : 'Creating...';

  try {
    if (state.editMode) {
      await updateLabel(state.selectedLabel.id, formData);
      notify('✅ Label updated successfully');
    } else {
      await createLabel(formData);
      notify('✅ Label created successfully');
    }
    
    resetForm();
    await loadLabels();
    
  } catch (e) {
    notify(`❌ Failed to ${state.editMode ? 'update' : 'create'} label: ` + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function generateTemplate() {
  const name = $('#labelName').value.trim();
  const width = $('#labelWidth').value;
  const height = $('#labelHeight').value;
  
  if (!name) {
    notify('❌ Enter a label name first', true);
    return;
  }
  
  const template = `{
  "name": "${name}",
  "size": "${width}\\" x ${height}\\"",
  "fields": [
    {
      "type": "text",
      "content": "{{name}}",
      "position": {"x": 0.1, "y": 0.1},
      "font": {"size": 12, "weight": "bold"}
    },
    {
      "type": "barcode",
      "content": "{{id}}",
      "position": {"x": 0.1, "y": 0.5},
      "format": "CODE128"
    }
  ]
}`;
  
  $('#labelTemplate').value = template;
  notify('✅ Template generated');
}

function wireControls() {
  $('#submitBtn')?.addEventListener('click', saveLabel);
  $('#cancelBtn')?.addEventListener('click', resetForm);
  $('#generateTemplateBtn')?.addEventListener('click', generateTemplate);
  $('#refreshBtn')?.addEventListener('click', loadLabels);
  
  $('#labelSelect')?.addEventListener('change', (e) => {
    const labelId = parseInt(e.target.value);
    if (labelId) {
      const label = state.labels.find(l => l.id === labelId);
      if (label) loadLabelForEdit(label);
    } else {
      resetForm();
    }
  });
}

// Global functions
window.editLabel = function(labelId) {
  const label = state.labels.find(l => l.id === labelId);
  if (label) {
    loadLabelForEdit(label);
    $('#labelSelect').value = labelId;
  }
};

window.duplicateLabel = async function(labelId) {
  const label = state.labels.find(l => l.id === labelId);
  if (!label) return;
  
  const newLabel = {
    name: label.name + ' (Copy)',
    description: label.description,
    width: label.width,
    height: label.height,
    template: label.template,
    is_active: false
  };
  
  try {
    await createLabel(newLabel);
    notify('✅ Label duplicated successfully');
    await loadLabels();
  } catch (e) {
    notify('❌ Failed to duplicate label: ' + e.message, true);
  }
};

window.deleteSelectedLabel = async function(labelId) {
  const label = state.labels.find(l => l.id === labelId);
  if (!label) return;
  
  if (!confirm(`Are you sure you want to delete "${label.name}"? This action cannot be undone.`)) {
    return;
  }
  
  try {
    await deleteLabel(labelId);
    notify('✅ Label deleted successfully');
    
    // If we were editing this label, reset the form
    if (state.selectedLabel?.id === labelId) {
      resetForm();
    }
    
    await loadLabels();
  } catch (e) {
    notify('❌ Failed to delete label: ' + e.message, true);
  }
};

function notify(msg, isErr = false) {
  let n = $('#notification');
  if (!n) {
    n = document.createElement('div');
    n.id = 'notification';
    n.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 10000;
      padding: 12px 20px; border-radius: 8px; color: white; font-weight: bold;
      transform: translateY(-100px); opacity: 0; transition: all 0.3s ease;
      max-width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(n);
  }
  
  n.textContent = msg;
  n.style.background = isErr ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 'linear-gradient(135deg, #27ae60, #2d3436)';
  n.style.transform = 'translateY(0)';
  n.style.opacity = '1';
  
  setTimeout(() => { 
    n.style.transform = 'translateY(-100px)';
    n.style.opacity = '0';
  }, 3000);
}

export async function init() {
  wireControls();
  resetForm();
  await loadLabels();
}
