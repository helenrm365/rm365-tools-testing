// js/modules/attendance/logs.js - Integrated logs functionality with auto-load
import { getAttendanceLogs, getLogs, exportLogs } from '../../services/api/attendanceApi.js';

// ====== State Management ======
let state = {
  logs: [],
  currentSortKey: "datetime",
  currentSortAsc: false // default: most recent first
};

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

  if (!startDate || !endDate) {
    const message = "Please select both start and end dates";
    alert(message);
    return;
  }

  // Show loading state
  const btn = $("#filterBtn");
  const originalText = btn?.textContent;
  if (btn) btn.textContent = "🔄 Loading...";

  try {
    // Call API with individual parameters including location
    const logs = await getLogs(startDate, endDate, location, searchTerm, searchTerm);
    state.logs = logs;

    // Display results
    displayLogs(logs);
    updateStats(logs);
    showResults();

    // Enable export buttons
    ["#exportCsvBtn", "#exportPdfBtn", "#printBtn"].forEach(sel => {
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
    // Restore button text
    if (btn && originalText) btn.textContent = originalText;
  }
}

function displayLogs(logs) {
  const container = $("#logsTable");
  
  if (!container) {
    console.error("❌ No logsTable container found!");
    return;
  }

  if (!logs || logs.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">No logs found for the selected criteria.</p>';
    return;
  }

  const table = `
    <div class="table-container">
    <table class="modern-table">
      <thead>
        <tr>
          <th data-key="employee" style="cursor: pointer;">
            Employee <span class="sort-icon"></span>
          </th>
          <th data-key="date" style="cursor: pointer;">
            Date <span class="sort-icon"></span>
          </th>
          <th data-key="time" style="cursor: pointer;">
            Time <span class="sort-icon"></span>
          </th>
          <th data-key="direction" style="cursor: pointer;">
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
              <span class="status-badge ${log.direction === 'in' ? 'status-in' : 'status-out'}" style="padding: 4px 8px; border-radius: 4px; ${log.direction === 'in' ? 'background-color: #d4edda; color: #155724;' : 'background-color: #f8d7da; color: #721c24;'}">
                ${log.direction === 'in' ? '✅ Clock In' : '❌ Clock Out'}
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
  const resultsEl = $("#logsResults");
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
  const fromDate = $("#fromDate");
  const toDate = $("#toDate");
  const nameFilter = $("#nameFilter");
  const locationFilter = $("#locationFilter");
  
  if (nameFilter) nameFilter.value = "";
  if (locationFilter) locationFilter.value = "";
  
  // Reset date defaults
  setDateDefaults();
  
  // Clear results
  const resultsEl = $("#logsResults");
  if (resultsEl) {
    resultsEl.style.display = "none";
  }
  
  // Disable export buttons
  ["#exportCsvBtn", "#exportPdfBtn", "#printBtn"].forEach(sel => {
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

function handleExportPdf() {
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
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Attendance Logs Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
            .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #007bff; color: white; font-weight: bold; }
            tr:nth-child(even) { background-color: #f2f2f2; }
            .status-in { background-color: #d4edda; color: #155724; padding: 4px 8px; border-radius: 4px; }
            .status-out { background-color: #f8d7da; color: #721c24; padding: 4px 8px; border-radius: 4px; }
            .footer { margin-top: 30px; font-size: 0.9em; color: #666; text-align: center; }
          </style>
        </head>
        <body>
          <h1>📋 Attendance Logs Report</h1>
          <div class="info">
            <p><strong>Report Period:</strong> ${startDate} to ${endDate}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Total Records:</strong> ${state.logs.length}</p>
          </div>
          ${createPrintableTable(state.logs)}
          <div class="footer">
            <p>Generated by RM365 Attendance System</p>
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
    
    // Wait for content to load, then print
    setTimeout(() => {
      printWindow.print();
    }, 500);

  } finally {
    // Restore button state after a short delay
    setTimeout(() => {
      if (titleEl && originalTitle) titleEl.textContent = originalTitle;
      if (btn) btn.disabled = false;
    }, 600);
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

function handlePrint() {
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

    // Use the same PDF function but trigger browser print
    handleExportPdf();

  } finally {
    // Restore button state after a short delay
    setTimeout(() => {
      if (titleEl && originalTitle) titleEl.textContent = originalTitle;
      if (btn) btn.disabled = false;
    }, 600);
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
  console.log("📋 Initializing attendance logs module");
  
  setDateDefaults();
  
  setupSearch();
  setupEventHandlers();
  
  // Auto-load logs for the last week
  try {
    console.log("🔄 Auto-loading logs for the last week...");
    await loadLogs();
    console.log("✅ Attendance logs module initialized with auto-loaded data");
  } catch (error) {
    console.warn("⚠️ Could not auto-load logs:", error);
    console.log("✅ Attendance logs module initialized (manual load required)");
  }
}
