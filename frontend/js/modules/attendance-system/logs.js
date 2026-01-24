// js/modules/attendance-system/logs.js - Integrated logs functionality with auto-load
import { getAttendanceLogs, getLogs, exportLogs, checkAttendanceTablesStatus, initializeAttendanceTables } from '../../services/api/attendanceApi.js';
import { exportAttendanceToPDF } from '../../utils/attendancePdfExport.js';
import { showToast } from '../../ui/toast.js';

// ====== State Management ======
let state = {
  logs: [],
  currentSortKey: "datetime",
  currentSortAsc: false // default: most recent first
};

// ====== Custom Dropdown Functions ======
function toggleDropdown(dropdownId) {
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

function selectOption(element, dropdownId, value, text) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;

  // Update the displayed text
  const selected = dropdown.querySelector('.dropdown-selected');
  if (selected) {
    selected.textContent = text;
  }

  // Update the hidden input value
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
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
}

// Expose dropdown functions globally for inline onclick handlers
window.toggleDropdown = toggleDropdown;
window.selectOption = selectOption;

// Close dropdowns when clicking outside
function setupDropdownCloseHandler() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
      document.querySelectorAll('.custom-dropdown.open').forEach(d => {
        d.classList.remove('open');
      });
    }
  });
}

// ====== Utility Functions ======
function $(sel) { return document.querySelector(sel); }

function setDateDefaults() {
  const startEl = $("#fromDate");
  const endEl = $("#toDate");
  
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  
  if (startEl) startEl.value = weekAgo.toISOString().slice(0, 10);
  if (endEl) endEl.value = today.toISOString().slice(0, 10);
}

// ====== Load and Display Logs ======
async function loadLogs() {
  const startDate = $("#fromDate")?.value;
  const endDate = $("#toDate")?.value;
  const searchTerm = $("#nameFilter")?.value;
  const location = $("#locationFilter")?.value;
  const actionType = $("#actionFilter")?.value;
  const sortBy = $("#sortFilter")?.value || 'date_desc';

  if (!startDate || !endDate) {
    const message = "Please select both start and end dates";
    alert(message);
    return;
  }

  // Show loading state
  const btn = $("#filterBtn");
  const originalHTML = btn?.innerHTML;
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Loading...</span>';

  try {
    // Call API with individual parameters including location
    let logs = await getLogs(startDate, endDate, location, searchTerm, searchTerm);
    
    // Filter by action type if specified
    if (actionType) {
      logs = logs.filter(log => log.direction === actionType);
    }
    
    // Sort logs based on sortBy value
    logs = sortLogsByFilter(logs, sortBy);
    
    state.logs = logs;

    // Display results
    displayLogs(logs);
    updateStats(logs);
    updateQuickStats(logs, startDate, endDate);
    showResults();

    // Enable export buttons
    ["#exportCsvBtn", "#exportPdfBtn", "#printBtn", "#exportExcelBtn"].forEach(sel => {
      const btn = $(sel);
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    });

  } catch (error) {
    console.error("Failed to load logs:", error);
    alert("Failed to load logs. Please try again.");
  } finally {
    // Restore button
    if (btn && originalHTML) btn.innerHTML = originalHTML;
  }
}

function sortLogsByFilter(logs, sortBy) {
  const sorted = [...logs];
  
  switch(sortBy) {
    case 'date_asc':
      sorted.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
      break;
    case 'date_desc':
      sorted.sort((a, b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`));
      break;
    case 'name_asc':
      sorted.sort((a, b) => a.employee.localeCompare(b.employee));
      break;
    case 'name_desc':
      sorted.sort((a, b) => b.employee.localeCompare(a.employee));
      break;
    default:
      sorted.sort((a, b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`));
  }
  
  return sorted;
}

function updateQuickStats(logs, startDate, endDate) {
  const totalLogsEl = $("#totalLogs");
  const dateRangeEl = $("#dateRange");
  const uniqueEmployeesEl = $("#uniqueEmployees");
  const uniqueLocationsEl = $("#uniqueLocations");
  
  if (totalLogsEl) totalLogsEl.textContent = logs.length;
  
  if (dateRangeEl && startDate && endDate) {
    const start = new Date(startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const end = new Date(endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    dateRangeEl.textContent = `${start} - ${end}`;
  }
  
  if (uniqueEmployeesEl) {
    const unique = new Set(logs.map(log => log.employee)).size;
    uniqueEmployeesEl.textContent = unique;
  }
  
  if (uniqueLocationsEl) {
    const locations = new Set(logs.map(log => log.location).filter(Boolean));
    uniqueLocationsEl.textContent = locations.size > 0 ? Array.from(locations).join(', ') : 'All';
  }
}

function displayLogs(logs) {
  const container = $("#logsTable");
  
  if (!container) {
    console.error("❌ No logsTable container found!");
    return;
  }

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search"></i>
        <p>No logs found for the selected criteria.</p>
      </div>
    `;
    return;
  }

  const table = `
    <div class="table-container">
    <table class="logs-table">
      <thead>
        <tr>
          <th data-key="employee">
            Employee <span class="sort-icon"></span>
          </th>
          <th data-key="date">
            Date <span class="sort-icon"></span>
          </th>
          <th data-key="time">
            Time <span class="sort-icon"></span>
          </th>
          <th data-key="direction">
            Action <span class="sort-icon"></span>
          </th>
        </tr>
      </thead>
      <tbody>
        ${logs.map(log => `
          <tr>
            <td>${log.employee}</td>
            <td>${log.date}</td>
            <td>${log.time}</td>
            <td>
              <span class="status-badge ${log.direction === 'in' ? 'status-in' : 'status-out'}">
                <i class="fas ${log.direction === 'in' ? 'fa-sign-in-alt' : 'fa-sign-out-alt'}"></i>
                ${log.direction === 'in' ? 'Clock In' : 'Clock Out'}
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;

  container.innerHTML = table;
  setupSorting();
  
  // Apply default sorting (most recent first)
  sortLogsTable(state.currentSortKey, state.currentSortAsc);
}

function updateStats(logs) {
  const statsEl = $("#logsStats");
  if (!statsEl || !logs) return;

  const totalLogs = logs.length;
  const clockIns = logs.filter(log => log.direction === 'in').length;
  const clockOuts = logs.filter(log => log.direction === 'out').length;
  const uniqueEmployees = new Set(logs.map(log => log.employee)).size;

  statsEl.innerHTML = `
    <div style="display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.9em;">
      <span><strong>${totalLogs}</strong> total logs</span>
      <span><strong>${clockIns}</strong> clock ins</span>
      <span><strong>${clockOuts}</strong> clock outs</span>
      <span><strong>${uniqueEmployees}</strong> employees</span>
    </div>
  `;
}

function showResults() {
  const resultsEl = $("#logsResultsSection");
  if (resultsEl) {
    resultsEl.style.display = "block";
    resultsEl.scrollIntoView({ behavior: "smooth" });
  }
}

// ====== Sorting Functions ======
function setupSorting() {
  document.querySelectorAll("#logsTable th[data-key]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");

      if (state.currentSortKey === key) {
        state.currentSortAsc = !state.currentSortAsc;
      } else {
        state.currentSortKey = key;
        state.currentSortAsc = true;
      }

      // Reset all icons
      document.querySelectorAll("#logsTable th[data-key]").forEach(h => {
        const icon = h.querySelector(".sort-icon");
        if (icon) {
          icon.className = "sort-icon";
        }
      });

      const icon = th.querySelector(".sort-icon");
      if (icon) {
        icon.classList.add("fas");
        icon.classList.add(state.currentSortAsc ? "fa-sort-amount-down-alt" : "fa-sort-amount-up-alt");
      }

      sortLogsTable(key, state.currentSortAsc);
    });
  });
}

function sortLogsTable(key, asc = true) {
  const tbody = document.querySelector("#logsTable tbody");
  if (!tbody) return;
  
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const colIndex = getColumnIndex(key);

  rows.sort((a, b) => {
    const getText = (row, index) => {
      const cell = row.querySelector(`td:nth-child(${index})`);
      return cell ? cell.innerText.toLowerCase() : '';
    };

    if (key === "datetime" || key === "date") {
      // Date in col 2, Time in col 3 (1-based indexing)
      const aDate = new Date(`${getText(a, 2)}T${getText(a, 3)}`);
      const bDate = new Date(`${getText(b, 2)}T${getText(b, 3)}`);
      return asc ? aDate - bDate : bDate - aDate;
    }

    const aVal = getText(a, colIndex);
    const bVal = getText(b, colIndex);
    return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  tbody.innerHTML = "";
  rows.forEach(row => tbody.appendChild(row));
}

function getColumnIndex(key) {
  const keyMap = {
    'employee': 1,
    'date': 2,
    'time': 3,
    'direction': 4
  };
  return keyMap[key] || 1;
}

// ====== Search Functions ======
function setupSearch() {
  const searchInput = $("#nameFilter");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      // Real-time search could be implemented here
      // For now, search happens on button click
    });

    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        loadLogs();
      }
    });
  }
}

function clearFilters() {
  // Clear all filter inputs
  const nameFilter = $("#nameFilter");
  const locationFilter = $("#locationFilter");
  const actionFilter = $("#actionFilter");
  const sortFilter = $("#sortFilter");
  
  if (nameFilter) nameFilter.value = "";
  if (locationFilter) locationFilter.value = "";
  if (actionFilter) actionFilter.value = "";
  if (sortFilter) sortFilter.value = "date_desc";
  
  // Reset dropdown displays
  const locationDropdown = document.getElementById('location-dropdown');
  if (locationDropdown) {
    const selected = locationDropdown.querySelector('.dropdown-selected');
    if (selected) selected.textContent = 'All Locations';
  }
  
  const actionDropdown = document.getElementById('action-dropdown');
  if (actionDropdown) {
    const selected = actionDropdown.querySelector('.dropdown-selected');
    if (selected) selected.textContent = 'All Actions';
  }
  
  const sortDropdown = document.getElementById('sort-dropdown');
  if (sortDropdown) {
    const selected = sortDropdown.querySelector('.dropdown-selected');
    if (selected) selected.textContent = 'Date (Newest First)';
  }
  
  // Reset date defaults
  setDateDefaults();
  
  // Clear results
  const resultsEl = $("#logsResultsSection");
  if (resultsEl) {
    resultsEl.style.display = "none";
  }
  
  // Disable export buttons
  ["#exportCsvBtn", "#exportPdfBtn", "#printBtn", "#exportExcelBtn"].forEach(sel => {
    const btn = $(sel);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.6";
    }
  });
}

// ====== Export Functions ======
async function handleExportCsv() {
  const btn = $("#exportCsvBtn");
  const titleEl = btn?.querySelector('.export-title');
  const originalTitle = titleEl?.textContent;
  
  try {
    const startDate = $("#fromDate")?.value;
    const endDate = $("#toDate")?.value;

    if (!startDate || !endDate || !state.logs || state.logs.length === 0) {
      alert("Please load logs first");
      return;
    }

    // Show loading state
    if (titleEl) titleEl.textContent = "🔄 Exporting...";
    if (btn) btn.disabled = true;

    // Generate CSV from current logs
    const csvContent = createCsvFromLogs(state.logs);
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `attendance-logs-${startDate}-to-${endDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

  } catch (error) {
    console.error("Failed to export CSV:", error);
    alert("Failed to export CSV. Please try again.");
  } finally {
    // Restore button state
    if (titleEl && originalTitle) titleEl.textContent = originalTitle;
    if (btn) btn.disabled = false;
  }
}

function createCsvFromLogs(logs) {
  if (!logs || logs.length === 0) {
    return "No logs to export";
  }

  // CSV headers
  const headers = ["Employee", "Date", "Time", "Action"];
  const csvRows = [headers.join(",")];

  // Add data rows
  logs.forEach(log => {
    const row = [
      `"${log.employee}"`,
      log.date,
      log.time,
      log.direction === 'in' ? 'Clock In' : 'Clock Out'
    ];
    csvRows.push(row.join(","));
  });

  return csvRows.join("\n");
}

async function handleExportPdf() {
  const logsTable = $("#logsTable");
  if (!logsTable || !state.logs || state.logs.length === 0) {
    alert("No logs to export");
    return;
  }

  const btn = $("#exportPdfBtn");
  const titleEl = btn?.querySelector('.export-title');
  const originalTitle = titleEl?.textContent;

  try {
    // Show loading state
    if (titleEl) titleEl.textContent = "🔄 Exporting...";
    if (btn) btn.disabled = true;

    const startDate = $("#fromDate")?.value;
    const endDate = $("#toDate")?.value;
    
    // Use the new professional PDF export
    await exportAttendanceToPDF(state.logs, startDate, endDate);

  } catch (error) {
    console.error("Failed to export PDF:", error);
    alert("Failed to export PDF. Please try again.");
  } finally {
    // Restore button state
    if (titleEl && originalTitle) titleEl.textContent = originalTitle;
    if (btn) btn.disabled = false;
  }
}

function createPrintableTable(logs) {
  if (!logs || logs.length === 0) {
    return '<p>No logs found for the selected period.</p>';
  }

  const rows = logs.map(log => `
    <tr>
      <td>${log.employee}</td>
      <td>${log.date}</td>
      <td>${log.time}</td>
      <td>
        <span class="${log.direction === 'in' ? 'status-in' : 'status-out'}">
          ${log.direction === 'in' ? '✅ Clock In' : '❌ Clock Out'}
        </span>
      </td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Employee</th>
          <th>Date</th>
          <th>Time</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

async function handlePrint() {
  const logsTable = $("#logsTable");
  if (!logsTable || !state.logs || state.logs.length === 0) {
    alert("No logs to print");
    return;
  }

  const btn = $("#printBtn");
  const titleEl = btn?.querySelector('.export-title');
  const originalTitle = titleEl?.textContent;

  try {
    // Show loading state
    if (titleEl) titleEl.textContent = "🔄 Printing...";
    if (btn) btn.disabled = true;

    const startDate = $("#fromDate")?.value;
    const endDate = $("#toDate")?.value;
    
    // Generate PDF and open print dialog
    await exportAttendanceToPDF(state.logs, startDate, endDate, true);

  } catch (error) {
    console.error("Failed to print:", error);
    alert("Failed to generate print document. Please try again.");
  } finally {
    // Restore button state
    if (titleEl && originalTitle) titleEl.textContent = originalTitle;
    if (btn) btn.disabled = false;
  }
}

// ====== Event Handlers Setup ======
function setupEventHandlers() {
  // Load logs button (filter button)
  const loadBtn = $("#filterBtn");
  if (loadBtn) {
    loadBtn.addEventListener("click", loadLogs);
  }

  // Clear button
  const clearBtn = $("#clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearFilters);
  }

  // Export buttons
  const exportCsvBtn = $("#exportCsvBtn");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", handleExportCsv);
  }

  const exportPdfBtn = $("#exportPdfBtn");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", handleExportPdf);
  }

  const printBtn = $("#printBtn");
  if (printBtn) {
    printBtn.addEventListener("click", handlePrint);
  }
}

// ====== Main Init Function ======
export async function init() {
  showToast('Setting up logs interface...', 'info');
  
  // Check if tables exist (quick status check)
  try {
    showToast('Checking database status...', 'info');
    const status = await checkAttendanceTablesStatus();
    if (!status.all_tables_exist) {
      console.warn('Attendance tables do not exist, initializing...', status.tables_status);
      showToast('Initializing database tables...', 'info');
      const initResult = await initializeAttendanceTables();
      if (initResult.status === 'success') {
        showToast(`✅ Tables ready: ${initResult.tables.join(', ')}`, 'success');
      } else {
        showToast('❌ Failed to initialize tables: ' + initResult.message, 'error');
      }
    }
  } catch (error) {
    console.error('Error checking/initializing tables:', error);
    // Continue loading - tables may still work
  }
  
  setDateDefaults();
  
  setupDropdownCloseHandler();
  setupSearch();
  setupEventHandlers();
  
  showToast('Loading attendance logs...', 'info');
  // Auto-load logs for the last week
  try {
    await loadLogs();
  } catch (error) {
    console.warn("⚠️ Could not auto-load logs:", error);
  }
}
