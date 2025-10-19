// js/modules/labels/generator.js
import { getLabelData, generateLabels, downloadLabels } from '../../services/api/labelsApi.js';

let state = {
  previewData: null,
  generatedData: null
};

function $(sel) { return document.querySelector(sel); }

async function previewData() {
  const startDate = $('#startDate').value;
  const endDate = $('#endDate').value;
  const search = $('#searchTerm').value.trim();
  
  if (!startDate || !endDate) {
    notify('❌ Please select both start and end dates', true);
    return;
  }
  
  if (startDate > endDate) {
    notify('❌ Start date cannot be after end date', true);
    return;
  }

  const previewBtn = $('#previewBtn');
  previewBtn.disabled = true;
  previewBtn.textContent = 'Loading...';
  
  try {
    const result = await getLabelData(startDate, endDate, search);
    state.previewData = result;
    displayPreview(result);
    notify('✅ Preview loaded successfully');
  } catch (e) {
    notify('❌ ' + e.message, true);
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = '👁️ Preview Data';
  }
}

async function generateLabelData() {
  const startDate = $('#startDate').value;
  const endDate = $('#endDate').value;
  const search = $('#searchTerm').value.trim();
  const format = $('#formatSelect').value;
  
  if (!startDate || !endDate) {
    notify('❌ Please select both start and end dates', true);
    return;
  }

  const generateBtn = $('#generateBtn');
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';
  
  try {
    const result = await generateLabels(startDate, endDate, search, format);
    state.generatedData = result;
    displayGenerated(result);
    $('#downloadBtn').disabled = false;
    notify('✅ Labels generated successfully');
  } catch (e) {
    notify('❌ ' + e.message, true);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = '🏷️ Generate Labels';
  }
}

async function downloadLabelFile() {
  const startDate = $('#startDate').value;
  const endDate = $('#endDate').value;
  const search = $('#searchTerm').value.trim();
  const format = $('#formatSelect').value;
  
  if (!startDate || !endDate) {
    notify('❌ Please select both start and end dates', true);
    return;
  }

  const downloadBtn = $('#downloadBtn');
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Downloading...';
  
  try {
    await downloadLabels(startDate, endDate, search, format);
    notify('✅ Download started');
  } catch (e) {
    notify('❌ ' + e.message, true);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = '⬇️ Download';
  }
}

function displayPreview(result) {
  const section = $('#previewSection');
  const statsDiv = $('#previewStats');
  const tableDiv = $('#previewTable');
  
  section.style.display = 'block';
  
  statsDiv.innerHTML = `
    <div class="alert" style="background: rgba(0,123,255,0.1); border-left: 4px solid #007bff; padding: 1rem;">
      <strong>Found ${result.count} records</strong> for the selected criteria
    </div>
  `;
  
  if (result.data && result.data.length > 0) {
    const headers = Object.keys(result.data[0]);
    tableDiv.innerHTML = `
      <table class="grid modern-table" style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
        <thead>
          <tr style="background: rgba(0,0,0,0.05);">
            ${headers.map(h => `<th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${result.data.slice(0, 10).map(row => `
            <tr style="border-bottom: 1px solid #eee;">
              ${headers.map(h => `<td style="padding: 8px;">${row[h] || '—'}</td>`).join('')}
            </tr>
          `).join('')}
          ${result.data.length > 10 ? `
            <tr>
              <td colspan="${headers.length}" style="padding: 12px; text-align: center; font-style: italic; color: #666;">
                ... and ${result.data.length - 10} more records
              </td>
            </tr>
          ` : ''}
        </tbody>
      </table>
    `;
  } else {
    tableDiv.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem; color: #999;">No data found for the selected criteria.</p>';
  }
}

function displayGenerated(result) {
  const section = $('#generatedSection');
  const statsDiv = $('#generatedStats');
  const previewDiv = $('#generatedPreview');
  
  section.style.display = 'block';
  
  statsDiv.innerHTML = `
    <div class="alert" style="background: rgba(40,167,69,0.1); border-left: 4px solid #28a745; padding: 1rem;">
      <strong>Successfully generated ${result.count} labels</strong> at ${new Date(result.generated_at).toLocaleString()}
    </div>
  `;
  
  // Show preview of generated content (first 1000 characters)
  const preview = result.content ? result.content.substring(0, 1000) : '';
  previewDiv.textContent = preview + (result.content && result.content.length > 1000 ? '\n\n... (truncated)' : '');
}

function wireControls() {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  $('#endDate').value = today.toISOString().split('T')[0];
  $('#startDate').value = weekAgo.toISOString().split('T')[0];

  $('#previewBtn')?.addEventListener('click', previewData);
  $('#generateBtn')?.addEventListener('click', generateLabelData);
  $('#downloadBtn')?.addEventListener('click', downloadLabelFile);
}

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
  
  // Auto-hide after 3 seconds
  setTimeout(() => { 
    n.style.transform = 'translateY(-100px)';
    n.style.opacity = '0';
  }, 3000);
}

export async function init() {
  wireControls();
}
