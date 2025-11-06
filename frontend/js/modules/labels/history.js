// js/modules/labels/history.js
import { listPrintJobs, getPrintJob, deletePrintJob, downloadPDF, downloadCSV } from '../../services/api/labelsApi.js';
import { showToast } from '../../ui/toast.js';

let currentLimit = 10;
let allJobs = [];

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

function renderJobsTable() {
  const container = $('#historyTable');
  
  container.innerHTML = `
    <table class="modern-table" style="width: 100%;">
      <thead>
        <tr>
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
          <tr>
            <td style="font-weight: 500; font-family: monospace;">#${job.id}</td>
            <td>
              <div>${formatDateTime(job.created_at)}</div>
              ${job.created_by ? `<div style="font-size: 0.85em; color: #666;">${job.created_by}</div>` : ''}
            </td>
            <td>${job.line_date || '<span style="color: #999;">Not set</span>'}</td>
            <td style="text-align: center;">
              <span style="font-weight: 500; font-size: 1.1em;">${job.item_count || 0}</span>
            </td>
            <td style="text-align: center;">${job.total_uk_6m || 0}</td>
            <td style="text-align: center;">${job.total_fr_6m || 0}</td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button class="modern-button" style="padding: 6px 12px; font-size: 0.9rem;" 
                        onclick="viewJobDetails(${job.id})" title="View Details">
                  👁️ View
                </button>
                <button class="modern-button" style="padding: 6px 12px; font-size: 0.9rem;" 
                        onclick="downloadJobPDF(${job.id})" title="Download PDF">
                  📄 PDF
                </button>
                <button class="modern-button" style="padding: 6px 12px; font-size: 0.9rem;" 
                        onclick="downloadJobCSV(${job.id})" title="Download CSV">
                  📊 CSV
                </button>
                <button class="modern-button" style="padding: 6px 12px; font-size: 0.9rem; background: #e74c3c;" 
                        onclick="deleteJob(${job.id})" title="Delete Job">
                  🗑️
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

// Global functions
window.viewJobDetails = async function(jobId) {
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
        <table class="modern-table" style="width: 100%; font-size: 0.9rem;">
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
      <div style="margin-top: 1rem; text-align: right;">
        <button class="modern-button" onclick="closeJobDetails()">Close</button>
      </div>
    `;
  } catch (e) {
    console.error('Error loading job details:', e);
    showToast('❌ Failed to load job details', 'error');
  }
};

window.closeJobDetails = function() {
  $('#historyDetails').style.display = 'none';
};

window.downloadJobPDF = async function(jobId) {
  try {
    showToast('📄 Generating PDF...', 'info');
    await downloadPDF(jobId);
    showToast('✅ PDF downloaded successfully', 'success');
  } catch (e) {
    console.error('Error downloading PDF:', e);
    showToast('❌ Failed to download PDF: ' + e.message, 'error');
  }
};

window.downloadJobCSV = async function(jobId) {
  try {
    showToast('📊 Generating CSV...', 'info');
    await downloadCSV(jobId);
    showToast('✅ CSV downloaded successfully', 'success');
  } catch (e) {
    console.error('Error downloading CSV:', e);
    showToast('❌ Failed to download CSV: ' + e.message, 'error');
  }
};

window.deleteJob = async function(jobId) {
  if (!confirm(`Are you sure you want to delete job #${jobId}? This action cannot be undone.`)) {
    return;
  }
  
  try {
    await deletePrintJob(jobId);
    showToast('✅ Job deleted successfully', 'success');
    await loadHistory(); // Reload the list
  } catch (e) {
    console.error('Error deleting job:', e);
    showToast('❌ Failed to delete job: ' + e.message, 'error');
  }
};

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
  await loadHistory();
}
