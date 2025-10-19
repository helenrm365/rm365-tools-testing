// js/modules/sales-imports/upload.js
import { uploadCSV, validateCSV } from '../../services/api/salesImportsApi.js';

export async function init() {
  console.log('[Sales Imports Upload] Module initialized');
  
  // File upload functionality
  let selectedFile = null;

  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const uploadArea = document.getElementById('uploadArea');
  const validateBtn = document.getElementById('validateBtn');
  const importBtn = document.getElementById('importBtn');
  const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');

  if (!fileInput || !uploadArea) {
    console.error('[Upload] Required elements not found in DOM');
    return;
  }

  // Browse button click - prevent propagation to avoid double trigger
  browseBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  // Upload area click - only trigger if not clicking the button
  uploadArea.addEventListener('click', (e) => {
    if (e.target === browseBtn || browseBtn?.contains(e.target)) {
      return; // Let button handler do its job
    }
    fileInput.click();
  });

  // File selected
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  });

  // Drag and drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#0056b3';
    uploadArea.style.background = 'rgba(0,123,255,0.1)';
  });

  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#007bff';
    uploadArea.style.background = 'rgba(0,123,255,0.05)';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#007bff';
    uploadArea.style.background = 'rgba(0,123,255,0.05)';
    
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      fileInput.files = e.dataTransfer.files; // Update the file input
      handleFileSelect(file);
    } else {
      alert('Please select a CSV file');
    }
  });

  function handleFileSelect(file) {
    selectedFile = file;
    console.log('File selected:', file.name, file.size, 'bytes');
    
    // Show file details
    const fileDetails = document.getElementById('fileDetails');
    const fileInfo = document.getElementById('fileInfo');
    
    if (fileInfo) {
      fileInfo.innerHTML = `
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 1rem;">
          <strong>File Name:</strong> <span>${file.name}</span>
          <strong>File Size:</strong> <span>${(file.size / 1024).toFixed(2)} KB</span>
          <strong>File Type:</strong> <span>${file.type || 'text/csv'}</span>
          <strong>Last Modified:</strong> <span>${new Date(file.lastModified).toLocaleString()}</span>
        </div>
      `;
    }
    
    if (fileDetails) {
      fileDetails.style.display = 'block';
    }
    
    // Enable validate button, disable import
    if (validateBtn) validateBtn.disabled = false;
    if (importBtn) importBtn.disabled = true;
    
    // Clear previous results
    const validationResults = document.getElementById('validationResults');
    const importResults = document.getElementById('importResults');
    if (validationResults) validationResults.style.display = 'none';
    if (importResults) importResults.style.display = 'none';
    
    // Reset upload area to initial state with new file name
    uploadArea.innerHTML = `
      <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
      <h4>File Selected: ${file.name}</h4>
      <p style="color: #666; margin: 1rem 0;">Drop a different CSV file here or click to browse</p>
      <input type="file" id="fileInput" accept=".csv" style="display: none;">
      <button class="modern-button" id="browseBtn">
        📁 Browse Files
      </button>
    `;
    
    // Re-attach event listeners to the new elements
    const newFileInput = document.getElementById('fileInput');
    const newBrowseBtn = document.getElementById('browseBtn');
    
    if (newBrowseBtn) {
      newBrowseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        newFileInput.click();
      });
    }
    
    if (newFileInput) {
      newFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          handleFileSelect(file);
        }
      });
    }
    
    // Keep drag and drop on upload area
    uploadArea.addEventListener('click', (e) => {
      if (e.target === newBrowseBtn || newBrowseBtn?.contains(e.target)) {
        return;
      }
      newFileInput.click();
    });
    
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#0056b3';
      uploadArea.style.background = 'rgba(0,123,255,0.1)';
    });

    uploadArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#007bff';
      uploadArea.style.background = 'rgba(0,123,255,0.05)';
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#007bff';
      uploadArea.style.background = 'rgba(0,123,255,0.05)';
      
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        newFileInput.files = e.dataTransfer.files;
        handleFileSelect(file);
      } else {
        alert('Please select a CSV file');
      }
    });
  }

  // Download template
  downloadTemplateBtn?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/v1/sales-imports/template');
      if (!response.ok) throw new Error('Failed to download template');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sales_import_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Error downloading template: ' + error.message);
    }
  });

  // Validate file
  validateBtn?.addEventListener('click', async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }
    
    const validationResults = document.getElementById('validationResults');
    const validationContent = document.getElementById('validationContent');
    
    if (validationContent) {
      validationContent.innerHTML = '<p style="text-align: center; padding: 1rem;">⏳ Validating...</p>';
    }
    if (validationResults) {
      validationResults.style.display = 'block';
    }
    validateBtn.disabled = true;
    
    try {
      console.log('Validating file:', selectedFile.name);
      const result = await validateCSV(selectedFile);
      console.log('Validation result:', result);
      
      if (validationContent) {
        if (result.valid) {
          validationContent.innerHTML = `
            <div style="color: #28a745;">
              <h4>✅ ${result.message}</h4>
              <p><strong>Total Rows:</strong> ${result.total_rows || 'N/A'}</p>
              <p><strong>Columns:</strong> ${result.column_count || result.columns?.length || 'N/A'}</p>
              ${result.interpretation ? `<p><strong>Column Interpretation:</strong> ${result.interpretation}</p>` : ''}
              ${result.columns ? `<p style="font-size: 0.9rem; color: #666;"><strong>Headers:</strong> ${result.columns.join(', ')}</p>` : ''}
            </div>
          `;
          if (importBtn) importBtn.disabled = false;
        } else {
          validationContent.innerHTML = `
            <div style="color: #dc3545;">
              <h4>❌ Validation Failed</h4>
              <p>${result.message}</p>
              ${result.expected_order ? `<p style="margin-top: 1rem;"><strong>Expected Column Order:</strong><br/>${result.expected_order}</p>` : ''}
              ${result.errors ? `<ul>${result.errors.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
            </div>
          `;
          if (importBtn) importBtn.disabled = true;
        }
      }
    } catch (error) {
      console.error('Validation error:', error);
      if (validationContent) {
        validationContent.innerHTML = `
          <div style="color: #dc3545;">
            <h4>❌ Error</h4>
            <p>${error.message}</p>
          </div>
        `;
      }
    } finally {
      validateBtn.disabled = false;
    }
  });

  // Import file
  importBtn?.addEventListener('click', async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }
    
    if (!confirm('Are you sure you want to import this file? This will add all records to the database.')) {
      return;
    }
    
    const importResults = document.getElementById('importResults');
    const importContent = document.getElementById('importContent');
    
    if (importContent) {
      importContent.innerHTML = '<p style="text-align: center; padding: 1rem;">⏳ Importing data...</p>';
    }
    if (importResults) {
      importResults.style.display = 'block';
    }
    importBtn.disabled = true;
    if (validateBtn) validateBtn.disabled = true;
    
    try {
      console.log('Importing file:', selectedFile.name);
      const result = await uploadCSV(selectedFile);
      console.log('Import result:', result);
      
      if (importContent) {
        if (result.status === 'success') {
          importContent.innerHTML = `
            <div style="color: #28a745;">
              <h4>✅ Import Successful!</h4>
              <p><strong>Total Rows:</strong> ${result.total_rows || 'N/A'}</p>
              <p><strong>Imported:</strong> ${result.imported_count || result.total_rows || 'N/A'}</p>
              ${result.has_errors ? `<p><strong>Errors:</strong> ${result.errors?.length || 0}</p>` : ''}
              <p style="margin-top: 1rem; font-style: italic;">Redirecting to UK Sales Data...</p>
            </div>
          `;
          
          // Redirect to UK Sales Data page after 2 seconds
          setTimeout(() => {
            window.location.href = '/sales-imports/uk-sales';
          }, 2000);
        } else {
          importContent.innerHTML = `
            <div style="color: #dc3545;">
              <h4>❌ Import Failed</h4>
              <p>${result.message || 'An error occurred during import'}</p>
              ${result.errors ? `<ul>${result.errors.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
            </div>
          `;
          importBtn.disabled = false;
          if (validateBtn) validateBtn.disabled = false;
        }
      }
    } catch (error) {
      console.error('Import error:', error);
      if (importContent) {
        importContent.innerHTML = `
          <div style="color: #dc3545;">
            <h4>❌ Error</h4>
            <p>${error.message}</p>
          </div>
        `;
      }
      importBtn.disabled = false;
      if (validateBtn) validateBtn.disabled = false;
    }
  });

  console.log('[Upload] Page initialized');
}
