// js/modules/labels/history.js
import { listPrintJobs, getPrintJob, deletePrintJob, deletePrintJobs, downloadPDF, downloadCSV } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';
import { confirmModal } from '../../ui/confirmationModal.js';

let currentLimit = 10;
let allJobs = [];
let selectedJobIds = new Set();

function $(sel) { return document.querySelector(sel); }

// ====== Custom Dropdown Functions ======
function toggleHistoryDropdown(dropdownId) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;

  // Close all other dropdowns first
  document.querySelectorAll('.custom-dropdown.open').forEach(d => {
    if (d.id !== dropdownId) {
      d.classList.remove('open');
    }
  });

  dropdown.classList.toggle('open');
}

function selectHistoryLimit(element, value, text) {
  const dropdown = document.getElementById('limit-dropdown');
  if (!dropdown) return;

  // Update the displayed text (preserve the icon, only update the span)
  const selected = dropdown.querySelector('.dropdown-selected');
  if (selected) {
    const textSpan = selected.querySelector('span');
    if (textSpan) {
      textSpan.textContent = text;
    } else {
      // Fallback if no span exists
      selected.innerHTML = `<i class="fas fa-list-ol"></i><span>${text}</span>`;
    }
  }

  // Update the hidden input value
  const hiddenInput = document.getElementById('limitSelect');
  if (hiddenInput) {
    hiddenInput.value = value;
  }

  // Update selected state visually
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
    opt.classList.remove('selected');
  });
  element.classList.add('selected');

  // Close the dropdown
  dropdown.classList.remove('open');

  // Trigger reload with new limit
  currentLimit = parseInt(value);
  loadHistory();
}

// Expose dropdown functions globally for inline onclick handlers
window.toggleHistoryDropdown = toggleHistoryDropdown;
window.selectHistoryLimit = selectHistoryLimit;

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-dropdown')) {
    document.querySelectorAll('.custom-dropdown.open').forEach(d => {
      d.classList.remove('open');
    });
  }
});

// Fallback test data for when API is unavailable
const FALLBACK_TEST_JOBS = [
  {
    id: 1001,
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
    created_by: 'admin@example.com',
    line_date: '2026-01-10',
    item_count: 24,
    total_uk_6m: 156,
    total_fr_6m: 89
  },
  {
    id: 1000,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    created_by: 'warehouse@example.com',
    line_date: '2026-01-09',
    item_count: 12,
    total_uk_6m: 78,
    total_fr_6m: 45
  },
  {
    id: 999,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    created_by: 'admin@example.com',
    line_date: null,
    item_count: 8,
    total_uk_6m: 42,
    total_fr_6m: 28
  },
  {
    id: 998,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
    created_by: 'manager@example.com',
    line_date: '2026-01-07',
    item_count: 35,
    total_uk_6m: 210,
    total_fr_6m: 125
  },
  {
    id: 997,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), // 3 days ago
    created_by: 'admin@example.com',
    line_date: '2026-01-06',
    item_count: 18,
    total_uk_6m: 95,
    total_fr_6m: 62
  }
];

const FALLBACK_TEST_JOB_DETAILS = {
  1001: [
    { sku: 'SKU-001', product_name: 'Premium Widget A', item_id: 'ITEM-001', uk_6m_data: 12, fr_6m_data: 8, price: 24.99 },
    { sku: 'SKU-002', product_name: 'Standard Widget B', item_id: 'ITEM-002', uk_6m_data: 8, fr_6m_data: 5, price: 19.99 },
    { sku: 'SKU-003', product_name: 'Economy Widget C', item_id: 'ITEM-003', uk_6m_data: 15, fr_6m_data: 10, price: 14.99 }
  ],
  1000: [
    { sku: 'SKU-010', product_name: 'Deluxe Gadget X', item_id: 'ITEM-010', uk_6m_data: 20, fr_6m_data: 12, price: 49.99 },
    { sku: 'SKU-011', product_name: 'Basic Gadget Y', item_id: 'ITEM-011', uk_6m_data: 10, fr_6m_data: 6, price: 29.99 }
  ]
};

let useFallbackData = false;

async function loadHistory() {
  try {
    const container = $('#historyTable');
    const subtitleEl = $('#jobCountSubtitle');
    
    container.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading history...</p>
      </div>
    `;
    
    let jobs = [];
    
    try {
      const response = await listPrintJobs(currentLimit);
      jobs = response.jobs || [];
      useFallbackData = false;
    } catch (apiError) {
      console.warn('API unavailable, using fallback test data:', apiError.message);
      jobs = FALLBACK_TEST_JOBS.slice(0, currentLimit);
      useFallbackData = true;
      showToast('Using test data (API unavailable)', 'warning');
    }
    
    allJobs = jobs;
    
    // Update subtitle with count
    const testIndicator = useFallbackData ? ' (Test Data)' : '';
    subtitleEl.textContent = `${allJobs.length} job${allJobs.length !== 1 ? 's' : ''} found${testIndicator}`;
    
    if (allJobs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h3>No Label Jobs Found</h3>
          <p>Create your first label job in the <a href="/labels/generator">Generator</a>.</p>
        </div>
      `;
      // Hide bulk actions when no jobs
      $('#bulkActionsRow').style.display = 'none';
      return;
    }
    
    // Show bulk actions when we have jobs
    $('#bulkActionsRow').style.display = 'flex';
    
    renderJobsTable();
    updateBulkActionsUI();
  } catch (e) {
    console.error('Error loading label history:', e);
    showToast('Failed to load label history', 'error');
    $('#historyTable').innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <h3>Failed to Load History</h3>
        <p>There was an error loading the label history. Please try again.</p>
        <button class="action-btn primary-btn" onclick="location.reload()">
          <i class="fas fa-redo"></i>
          <span>Retry</span>
        </button>
      </div>
    `;
  }
}

function updateBulkActionsUI() {
  const selectedCount = selectedJobIds.size;
  const allSelected = allJobs.length > 0 && selectedCount === allJobs.length;
  
  // Update select all checkbox
  const selectAllCheckbox = $('#selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = selectedCount > 0 && !allSelected;
  }
  
  // Update selection count text
  const selectionCountEl = $('#selectionCount');
  if (selectionCountEl) {
    selectionCountEl.textContent = selectedCount > 0 ? `${selectedCount} selected` : '';
  }
  
  // Update delete selected button
  const deleteSelectedBtn = $('#deleteSelectedBtn');
  const selectedCountBtn = $('#selectedCountBtn');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = selectedCount === 0;
  }
  if (selectedCountBtn) {
    selectedCountBtn.textContent = selectedCount;
  }
}

function setupActionHandlers() {
  const container = $('#historyTable');
  if (!container) return;
  
  // Use event delegation for dynamically created buttons
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.action-btn[data-action]');
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
  
  // Checkbox delegation
  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('job-checkbox')) {
      handleCheckboxChange(e);
    }
  });
}

function renderJobsTable() {
  const container = $('#historyTable');
  
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="col-checkbox"><i class="fas fa-check-square"></i></th>
          <th><i class="fas fa-hashtag"></i> Job ID</th>
          <th><i class="fas fa-calendar-alt"></i> Created</th>
          <th><i class="fas fa-calendar-day"></i> Line Date</th>
          <th style="text-align: center;"><i class="fas fa-cubes"></i> Items</th>
          <th style="text-align: center;"><i class="fas fa-flag"></i> UK 6M</th>
          <th style="text-align: center;"><i class="fas fa-flag"></i> FR 6M</th>
          <th style="text-align: center;"><i class="fas fa-cog"></i> Actions</th>
        </tr>
      </thead>
      <tbody>
        ${allJobs.map(job => `
          <tr class="${selectedJobIds.has(job.id) ? 'selected' : ''}">
            <td class="col-checkbox">
              <label class="card-checkbox compact">
                <input type="checkbox" class="job-checkbox" data-job-id="${job.id}" 
                       ${selectedJobIds.has(job.id) ? 'checked' : ''}>
                <span class="checkbox-custom"></span>
              </label>
            </td>
            <td class="col-id">#${job.id}</td>
            <td class="col-created">
              <div class="created-main">${formatDateTime(job.created_at)}</div>
              ${job.created_by ? `<div class="created-by">${job.created_by}</div>` : ''}
            </td>
            <td class="col-line-date">${job.line_date || '<span class="muted-text">Not set</span>'}</td>
            <td class="col-items"><strong>${job.item_count || 0}</strong></td>
            <td class="col-uk">${job.total_uk_6m || 0}</td>
            <td class="col-fr">${job.total_fr_6m || 0}</td>
            <td class="col-actions">
              <div class="action-buttons">
                <button class="action-btn primary-btn btn-sm" data-action="view" data-job-id="${job.id}" title="View Details">
                  <i class="fas fa-eye"></i>
                  <span>View</span>
                </button>
                <button class="action-btn secondary-btn btn-sm" data-action="pdf" data-job-id="${job.id}" title="Download PDF">
                  <i class="fas fa-file-pdf"></i>
                  <span>PDF</span>
                </button>
                <button class="action-btn secondary-btn btn-sm" data-action="csv" data-job-id="${job.id}" title="Download CSV">
                  <i class="fas fa-file-csv"></i>
                  <span>CSV</span>
                </button>
                <button class="action-btn danger-btn btn-sm btn-icon-only" data-action="delete" data-job-id="${job.id}" title="Delete Job">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
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
    const detailsPanel = $('#historyDetails');
    const contentDiv = $('#runDetailsContent');
    const titleEl = $('#detailsTitle');
    const subtitleEl = $('#detailsSubtitle');
    
    detailsPanel.style.display = 'block';
    titleEl.textContent = `Job #${jobId}`;
    subtitleEl.textContent = 'Loading...';
    contentDiv.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading details...</p>
      </div>
    `;
    
    // Scroll to details panel
    detailsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    let rows = [];
    
    if (useFallbackData) {
      // Use fallback test data
      rows = FALLBACK_TEST_JOB_DETAILS[jobId] || [
        { sku: 'TEST-SKU-001', product_name: 'Test Product 1', item_id: 'TEST-ITEM-001', uk_6m_data: 10, fr_6m_data: 5, price: 19.99 },
        { sku: 'TEST-SKU-002', product_name: 'Test Product 2', item_id: 'TEST-ITEM-002', uk_6m_data: 8, fr_6m_data: 4, price: 24.99 },
        { sku: 'TEST-SKU-003', product_name: 'Test Product 3', item_id: 'TEST-ITEM-003', uk_6m_data: 15, fr_6m_data: 9, price: 14.99 }
      ];
    } else {
      const response = await getPrintJob(jobId);
      rows = response.rows || [];
    }
    
    const testIndicator = useFallbackData ? ' (Test Data)' : '';
    subtitleEl.textContent = `${rows.length} item${rows.length !== 1 ? 's' : ''} in this job${testIndicator}`;
    
    if (rows.length === 0) {
      contentDiv.innerHTML = `
        <div class="empty-state">
          <p>No items in this job.</p>
        </div>
      `;
      return;
    }
    
    contentDiv.innerHTML = `
      <table>
        <thead>
          <tr>
            <th><i class="fas fa-barcode"></i> SKU</th>
            <th><i class="fas fa-box"></i> Product Name</th>
            <th><i class="fas fa-tag"></i> Item ID</th>
            <th style="text-align: center;"><i class="fas fa-flag"></i> UK 6M</th>
            <th style="text-align: center;"><i class="fas fa-flag"></i> FR 6M</th>
            <th style="text-align: right;"><i class="fas fa-pound-sign"></i> Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td class="sku-cell">${row.sku || 'N/A'}</td>
              <td>${row.product_name || 'N/A'}</td>
              <td class="item-id-cell">${row.item_id || 'N/A'}</td>
              <td style="text-align: center;">${row.uk_6m_data || 0}</td>
              <td style="text-align: center;">${row.fr_6m_data || 0}</td>
              <td class="price-cell">£${parseFloat(row.price || 0).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('Error loading job details:', e);
    showToast('Failed to load job details', 'error');
  }
}

async function downloadJobPDF(jobId) {
  if (useFallbackData) {
    showToast('PDF download not available in test mode', 'warning');
    return;
  }
  try {
    showToast('Generating PDF...', 'info');
    await downloadPDF(jobId);
    showToast('PDF downloaded successfully', 'success');
  } catch (e) {
    console.error('Error downloading PDF:', e);
    showToast('Failed to download PDF: ' + e.message, 'error');
  }
}

async function downloadJobCSV(jobId) {
  if (useFallbackData) {
    showToast('CSV download not available in test mode', 'warning');
    return;
  }
  try {
    showToast('Generating CSV...', 'info');
    await downloadCSV(jobId);
    showToast('CSV downloaded successfully', 'success');
  } catch (e) {
    console.error('Error downloading CSV:', e);
    showToast('Failed to download CSV: ' + e.message, 'error');
  }
}

async function deleteJob(jobId) {
  const confirmed = await confirmModal({
    title: 'Delete Label Job',
    message: `Are you sure you want to delete job #${jobId}? This action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: 'fa-trash-alt'
  });
  
  if (!confirmed) {
    return;
  }
  
  if (useFallbackData) {
    // Simulate delete in test mode
    const index = allJobs.findIndex(j => j.id === jobId);
    if (index > -1) {
      allJobs.splice(index, 1);
    }
    selectedJobIds.delete(jobId);
    showToast('Job deleted (test mode)', 'success');
    renderJobsTable();
    updateBulkActionsUI();
    return;
  }
  
  try {
    await deletePrintJob(jobId);
    showToast('Job deleted successfully', 'success');
    selectedJobIds.delete(jobId);
    await loadHistory();
  } catch (e) {
    console.error('Error deleting job:', e);
    showToast('Failed to delete job: ' + e.message, 'error');
  }
}

function handleSelectAll(e) {
  const isChecked = e.target.checked;
  if (isChecked) {
    allJobs.forEach(job => selectedJobIds.add(job.id));
  } else {
    selectedJobIds.clear();
  }
  renderJobsTable();
  updateBulkActionsUI();
}

function handleCheckboxChange(e) {
  const jobId = parseInt(e.target.dataset.jobId);
  if (e.target.checked) {
    selectedJobIds.add(jobId);
  } else {
    selectedJobIds.delete(jobId);
  }
  // Update row selection state
  const row = e.target.closest('tr');
  if (row) {
    row.classList.toggle('selected', e.target.checked);
  }
  updateBulkActionsUI();
}

async function handleDeleteSelected() {
  if (selectedJobIds.size === 0) {
    showToast('No jobs selected', 'warning');
    return;
  }
  
  const jobCount = selectedJobIds.size;
  const confirmed = await confirmModal({
    title: 'Delete Selected Jobs',
    message: `Are you sure you want to delete ${jobCount} selected job(s)? This action cannot be undone.`,
    confirmText: `Delete ${jobCount} Job${jobCount > 1 ? 's' : ''}`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: 'fa-trash-alt'
  });
  
  if (!confirmed) {
    return;
  }
  
  if (useFallbackData) {
    // Simulate delete in test mode
    const jobIdsArray = Array.from(selectedJobIds);
    allJobs = allJobs.filter(j => !jobIdsArray.includes(j.id));
    selectedJobIds.clear();
    showToast(`${jobCount} job(s) deleted (test mode)`, 'success');
    renderJobsTable();
    updateBulkActionsUI();
    return;
  }
  
  try {
    showToast(`Deleting ${jobCount} job(s)...`, 'info');
    const jobIdsArray = Array.from(selectedJobIds);
    const response = await deletePrintJobs(jobIdsArray, false);
    showToast(response.message, 'success');
    selectedJobIds.clear();
    await loadHistory();
  } catch (e) {
    console.error('Error deleting selected jobs:', e);
    showToast('Failed to delete jobs: ' + e.message, 'error');
  }
}

async function handleDeleteAll() {
  const jobCount = allJobs.length;
  if (jobCount === 0) {
    showToast('No jobs to delete', 'warning');
    return;
  }
  
  const firstConfirm = await confirmModal({
    title: 'WARNING: Delete All Jobs',
    message: `This will delete ALL ${jobCount} label print jobs permanently! Are you absolutely sure you want to continue? This action CANNOT be undone.`,
    confirmText: 'Yes, Continue',
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: 'fa-exclamation-triangle'
  });
  
  if (!firstConfirm) {
    return;
  }
  
  const finalConfirm = await confirmModal({
    title: 'Final Confirmation',
    message: `This is your final confirmation. Delete ALL ${jobCount} jobs?`,
    confirmText: `Delete ALL ${jobCount} Jobs`,
    cancelText: 'Cancel',
    confirmVariant: 'danger',
    icon: 'fa-trash-alt'
  });
  
  if (!finalConfirm) {
    return;
  }
  
  if (useFallbackData) {
    // Simulate delete in test mode
    allJobs = [];
    selectedJobIds.clear();
    showToast(`All ${jobCount} jobs deleted (test mode)`, 'success');
    renderJobsTable();
    updateBulkActionsUI();
    $('#bulkActionsRow').style.display = 'none';
    $('#jobCountSubtitle').textContent = '0 jobs found (Test Data)';
    $('#historyTable').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <h3>No Label Jobs Found</h3>
        <p>Create your first label job in the <a href="/labels/generator">Generator</a>.</p>
      </div>
    `;
    return;
  }
  
  try {
    showToast('Deleting all jobs...', 'info');
    const response = await deletePrintJobs(null, true);
    showToast(response.message, 'success');
    selectedJobIds.clear();
    await loadHistory();
  } catch (e) {
    console.error('Error deleting all jobs:', e);
    showToast('Failed to delete all jobs: ' + e.message, 'error');
  }
}

function wireControls() {
  // Refresh button
  const refreshBtn = $('#refreshHistoryBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadHistory);
  }
  
  // Select all checkbox
  const selectAllCheckbox = $('#selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', handleSelectAll);
  }
  
  // Delete selected button
  const deleteSelectedBtn = $('#deleteSelectedBtn');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
  }
  
  // Delete all button
  const deleteAllBtn = $('#deleteAllBtn');
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', handleDeleteAll);
  }
  
  // Close details button
  const closeDetailsBtn = $('#closeDetailsBtn');
  if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener('click', () => {
      $('#historyDetails').style.display = 'none';
    });
  }
}

export async function init() {
  wireControls();
  setupActionHandlers();
  await loadHistory();
}
