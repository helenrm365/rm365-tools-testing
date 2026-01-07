// js/modules/labels/history.js
import { listPrintJobs, getPrintJob, deletePrintJob, deletePrintJobs, downloadPDF, downloadCSV } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';
import { confirmModal } from '../../ui/confirmationModal.js';

let currentLimit = 10;
let allJobs = [];
let selectedJobIds = new Set();

function $(sel) { return document.querySelector(sel); }

async function loadHistory() {
  try {
    const container = $('#historyTable');
    container.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem; color: #999;">Loading history...</p>';
    
    const response = await listPrintJobs(currentLimit);
    allJobs = response.jobs || [];
    
    if (allJobs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: #666;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
          <h3>No Label Jobs Found</h3>
          <p>Create your first label job in the <a href="/labels/generator" class="modern-link">Generator</a>.</p>
        </div>
      `;
      return;
    }
    
    renderJobsTable();
  } catch (e) {
    console.error('Error loading label history:', e);
    showToast('❌ Failed to load label history', 'error');
    $('#historyTable').innerHTML = `
      <div style="text-align: center; padding: 3rem; color: #e74c3c;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
        <h3>Failed to Load History</h3>
        <p>There was an error loading the label history. Please try again.</p>
        <button class="modern-button" onclick="location.reload()">🔄 Retry</button>
      </div>
    `;
  }
}

function setupActionHandlers() {
  const container = $('#historyTable');
  if (!container) return;
  
  // Use event delegation for dynamically created buttons
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const jobId = parseInt(btn.dataset.jobId);
    
    if (!jobId) return;
    
    switch (action) {
      case 'view':
        await viewJobDetails(jobId);
        break;
      case 'pdf':
        await downloadJobPDF(jobId);
        break;
      case 'csv':
        await downloadJobCSV(jobId);
        break;
      case 'delete':
        await deleteJob(jobId);
        break;
    }
  });
}

function renderJobsTable() {
  const container = $('#historyTable');
  const bulkActionsContainer = $('#bulkActionsBar');
  
  const hasJobs = allJobs.length > 0;
  const selectedCount = selectedJobIds.size;
  const allSelected = hasJobs && selectedCount === allJobs.length;
  
  // Render bulk actions bar separately
  if (hasJobs) {
    bulkActionsContainer.innerHTML = `
      <div class="bulk-actions-bar">
        <div class="bulk-actions-left">
          <label class="select-all-label">
            <input type="checkbox" id="selectAllCheckbox" class="select-all-checkbox" ${allSelected ? 'checked' : ''}>
            <span>Select All</span>
          </label>
          <span class="selection-count">
            ${selectedCount > 0 ? `${selectedCount} selected` : ''}
          </span>
        </div>
        <div class="bulk-actions-right">
          <button id="deleteSelectedBtn" class="modern-button delete-selected-btn" 
                  ${selectedCount === 0 ? 'disabled' : ''}>
            <i class="fas fa-trash"></i> Delete Selected (${selectedCount})
          </button>
          <button id="deleteAllBtn" class="modern-button delete-all-btn">
            <i class="fas fa-trash-alt"></i> Delete All
          </button>
        </div>
      </div>
    `;
  } else {
    bulkActionsContainer.innerHTML = '';
  }
  
  container.innerHTML = `
    <div class="table-container">
    <table class="modern-table">
      <thead>
        <tr>
          <th style="width: 50px; text-align: center;"><i class="fas fa-check-square"></i></th>
          <th style="text-align: left;">Job ID</th>
          <th style="text-align: left;">Created</th>
          <th style="text-align: left;">Line Date</th>
          <th style="text-align: center;">Items</th>
          <th style="text-align: center;">UK 6M</th>
          <th style="text-align: center;">FR 6M</th>
          <th style="text-align: center;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${allJobs.map(job => `
          <tr class="${selectedJobIds.has(job.id) ? 'job-row-selected' : ''}">
            <td style="text-align: center;">
              <input type="checkbox" class="job-checkbox" data-job-id="${job.id}" 
                     ${selectedJobIds.has(job.id) ? 'checked' : ''}>
            </td>
            <td style="font-weight: 500; font-family: monospace;">#${job.id}</td>
            <td>
              <div>${formatDateTime(job.created_at)}</div>
              ${job.created_by ? `<div class="created-by-text">${job.created_by}</div>` : ''}
            </td>
            <td>${job.line_date || '<span class="muted-text">Not set</span>'}</td>
            <td style="text-align: center;">
              <span style="font-weight: 500; font-size: 1.1em;">${job.item_count || 0}</span>
            </td>
            <td style="text-align: center;">${job.total_uk_6m || 0}</td>
            <td style="text-align: center;">${job.total_fr_6m || 0}</td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="modern-button action-btn" style="padding: 6px 12px; font-size: 0.9rem;" 
                        data-action="view" data-job-id="${job.id}" title="View Details">
                  👁️ View
                </button>
                <button class="modern-button action-btn" style="padding: 6px 12px; font-size: 0.9rem;" 
                        data-action="pdf" data-job-id="${job.id}" title="Download PDF">
                  📄 PDF
                </button>
                <button class="modern-button action-btn" style="padding: 6px 12px; font-size: 0.9rem;" 
                        data-action="csv" data-job-id="${job.id}" title="Download CSV">
                  📊 CSV
                </button>
                <button class="modern-button action-btn" style="padding: 6px 12px; font-size: 0.9rem; background: #e74c3c;" 
                        data-action="delete" data-job-id="${job.id}" title="Delete Job">
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
  
  // Wire up bulk action handlers
  if (hasJobs) {
    const selectAllCheckbox = $('#selectAllCheckbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', handleSelectAll);
    }
    
    const deleteSelectedBtn = $('#deleteSelectedBtn');
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
    }
    
    const deleteAllBtn = $('#deleteAllBtn');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', handleDeleteAll);
    }
    
    // Individual checkboxes
    document.querySelectorAll('.job-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', handleCheckboxChange);
    });
  }
}

function formatDateTime(isoString) {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-GB', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch (e) {
    return isoString;
  }
}

async function viewJobDetails(jobId) {
  try {
    const detailsDiv = $('#historyDetails');
    const contentDiv = $('#runDetailsContent');
    
    detailsDiv.style.display = 'block';
    contentDiv.innerHTML = '<p style="text-align: center; padding: 1rem;">Loading details...</p>';
    
    const response = await getPrintJob(jobId);
    const rows = response.rows || [];
    
    if (rows.length === 0) {
      contentDiv.innerHTML = '<p style="text-align: center; color: #999;">No items in this job.</p>';
      return;
    }
    
    contentDiv.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <h5>Job #${jobId} - ${rows.length} Items</h5>
      </div>
      <div style="max-height: 400px; overflow-y: auto;">
        <div class="table-container">
        <table class="modern-table" style="font-size: 0.9rem;">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product Name</th>
              <th>Item ID</th>
              <th style="text-align: center;">UK 6M</th>
              <th style="text-align: center;">FR 6M</th>
              <th style="text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td style="font-family: monospace; font-weight: 500;">${row.sku || 'N/A'}</td>
                <td>${row.product_name || 'N/A'}</td>
                <td style="font-family: monospace; font-size: 0.85em; color: #666;">${row.item_id || 'N/A'}</td>
                <td style="text-align: center;">${row.uk_6m_data || 0}</td>
                <td style="text-align: center;">${row.fr_6m_data || 0}</td>
                <td style="text-align: right;">£${parseFloat(row.price || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </div>
      <div style="margin-top: 1rem; text-align: right;">
        <button class="modern-button" id="closeDetailsBtn">Close</button>
      </div>
    `;
    
    // Add close button handler
    const closeBtn = $('#closeDetailsBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        $('#historyDetails').style.display = 'none';
      });
    }
  } catch (e) {
    console.error('Error loading job details:', e);
    showToast('❌ Failed to load job details', 'error');
  }
}

async function downloadJobPDF(jobId) {
  try {
    showToast('📄 Generating PDF...', 'info');
    await downloadPDF(jobId);
    showToast('✅ PDF downloaded successfully', 'success');
  } catch (e) {
    console.error('Error downloading PDF:', e);
    showToast('❌ Failed to download PDF: ' + e.message, 'error');
  }
}

async function downloadJobCSV(jobId) {
  try {
    showToast('📊 Generating CSV...', 'info');
    await downloadCSV(jobId);
    showToast('✅ CSV downloaded successfully', 'success');
  } catch (e) {
    console.error('Error downloading CSV:', e);
    showToast('❌ Failed to download CSV: ' + e.message, 'error');
  }
}

async function deleteJob(jobId) {
  const confirmed = await confirmModal({
    title: 'Delete Label Job',
    message: `Are you sure you want to delete job #${jobId}? This action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
  
  if (!confirmed) {
    return;
  }
  
  try {
    await deletePrintJob(jobId);
    showToast('✅ Job deleted successfully', 'success');
    selectedJobIds.delete(jobId);
    await loadHistory(); // Reload the list
  } catch (e) {
    console.error('Error deleting job:', e);
    showToast('❌ Failed to delete job: ' + e.message, 'error');
  }
}

function handleSelectAll(e) {
  const isChecked = e.target.checked;
  if (isChecked) {
    // Select all jobs
    allJobs.forEach(job => selectedJobIds.add(job.id));
  } else {
    // Deselect all
    selectedJobIds.clear();
  }
  renderJobsTable();
}

function handleCheckboxChange(e) {
  const jobId = parseInt(e.target.dataset.jobId);
  if (e.target.checked) {
    selectedJobIds.add(jobId);
  } else {
    selectedJobIds.delete(jobId);
  }
  renderJobsTable();
}

async function handleDeleteSelected() {
  if (selectedJobIds.size === 0) {
    showToast('⚠️ No jobs selected', 'warning');
    return;
  }
  
  const jobCount = selectedJobIds.size;
  const confirmed = await confirmModal({
    title: 'Delete Selected Jobs',
    message: `Are you sure you want to delete ${jobCount} selected job(s)? This action cannot be undone.`,
    confirmText: `Delete ${jobCount} Job${jobCount > 1 ? 's' : ''}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
  
  if (!confirmed) {
    return;
  }
  
  try {
    showToast(`🗑️ Deleting ${jobCount} job(s)...`, 'info');
    const jobIdsArray = Array.from(selectedJobIds);
    const response = await deletePrintJobs(jobIdsArray, false);
    showToast(`✅ ${response.message}`, 'success');
    selectedJobIds.clear();
    await loadHistory();
  } catch (e) {
    console.error('Error deleting selected jobs:', e);
    showToast('❌ Failed to delete jobs: ' + e.message, 'error');
  }
}

async function handleDeleteAll() {
  const jobCount = allJobs.length;
  if (jobCount === 0) {
    showToast('⚠️ No jobs to delete', 'warning');
    return;
  }
  
  const firstConfirm = await confirmModal({
    title: '⚠️ WARNING: Delete All Jobs',
    message: `This will delete ALL ${jobCount} label print jobs permanently!\n\nAre you absolutely sure you want to continue? This action CANNOT be undone.`,
    confirmText: 'Continue to Final Confirmation',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '⚠️'
  });
  
  if (!firstConfirm) {
    return;
  }
  
  // Double confirmation for delete all
  const finalConfirm = await confirmModal({
    title: 'Final Confirmation',
    message: `This is your final confirmation. Delete ALL ${jobCount} jobs?`,
    confirmText: `Delete ALL ${jobCount} Jobs`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: '🗑️'
  });
  
  if (!finalConfirm) {
    return;
  }
  
  try {
    showToast('🗑️ Deleting all jobs...', 'info');
    const response = await deletePrintJobs(null, true);
    showToast(`✅ ${response.message}`, 'success');
    selectedJobIds.clear();
    await loadHistory();
  } catch (e) {
    console.error('Error deleting all jobs:', e);
    showToast('❌ Failed to delete all jobs: ' + e.message, 'error');
  }
}

function wireControls() {
  const limitSelect = $('#limitSelect');
  if (limitSelect) {
    limitSelect.addEventListener('change', (e) => {
      currentLimit = parseInt(e.target.value);
      loadHistory();
    });
  }
  
  const refreshBtn = $('#refreshHistoryBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadHistory);
  }
}

export async function init() {
  wireControls();
  setupActionHandlers();
  await loadHistory();
}
