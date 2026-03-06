// js/modules/attendance-system/logs.js - Integrated logs functionality with auto-load
import { getAttendanceLogs, getLogs, exportLogs, checkAttendanceTablesStatus, initializeAttendanceTables, getLocations } from '../../services/api/attendanceApi.js';
import { exportAttendanceToPDF } from '../../utils/attendancePdfExport.js';
import { showToast } from '../../ui/toast.js';
import { initDatePicker } from '../../ui/datePicker.js';
import { initDropdown } from '../../ui/dropdown.js';

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

// ====== Load Locations ======
async function loadLocations() {
  try {
    const locations = await getLocations();
    const locationList = Array.isArray(locations) ? locations : (locations?.data || locations?.locations || []);
    const locationSelect = $("#locationFilter");
    if (!locationSelect || locationList.length === 0) return;

    const currentValue = locationSelect.value;
    locationSelect.innerHTML = `
      <option value="">All Locations</option>
      ${locationList.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
    `;
    if (currentValue) locationSelect.value = currentValue;
  } catch (error) {
    console.error('Failed to load locations:', error);
  }
}

// ====== Load and Display Logs ======
async function loadLogs(scroll = true) {
  const startDate = $("#fromDate")?.value;
  const endDate = $("#toDate")?.value;
  const searchTerm = $("#nameFilter")?.value;
  const location = $("#locationFilter")?.value;
  const actionType = $("#actionFilter")?.value;
  const sortBy = $("#sortFilter")?.value || 'asc';

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
    updateQuickStats(logs, startDate, endDate, location);
    showResults(scroll);

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
  const asc = sortBy !== 'desc';
  const d   = asc ? 1 : -1;
  return [...logs].sort((a, b) => {
    const l = (a.location || '').localeCompare(b.location || ''); if (l) return l * d;
    const n = (a.employee || '').localeCompare(b.employee || ''); if (n) return n * d;
    return (new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`)) * d;
  });
}

function updateQuickStats(logs, startDate, endDate, locationFilter) {
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
    if (locationFilter) {
      // A specific location is selected — always show it, regardless of what logs say
      uniqueLocationsEl.textContent = locationFilter;
    } else {
      // All Locations selected — derive from the returned log data
      const locations = new Set(logs.map(log => log.location).filter(Boolean));
      uniqueLocationsEl.textContent = locations.size > 0 ? Array.from(locations).join(', ') : 'All';
    }
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

function showResults(scroll = true) {
  const resultsEl = $("#logsResultsSection");
  if (resultsEl) {
    resultsEl.style.display = "block";
    if (scroll) resultsEl.scrollIntoView({ behavior: "smooth" });
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
  if (sortFilter) sortFilter.value = "asc";
  
  // Reset date defaults
  setDateDefaults();
  if (fromPicker) fromPicker.refresh();
  if (toPicker) toPicker.refresh();
  
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

// ====== Calendar Pickers ======
let fromPicker = null;
let toPicker = null;

function setupCalendars() {
  fromPicker = initDatePicker('#fromDate');
  toPicker = initDatePicker('#toDate');
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

// ====== Excel Export ======
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

async function handleExportExcel() {
  if (!state.logs || state.logs.length === 0) {
    alert("Please load logs first");
    return;
  }

  const btn = $("#exportExcelBtn");
  const titleEl = btn?.querySelector('.export-title');
  const originalTitle = titleEl?.textContent;

  try {
    if (titleEl) titleEl.textContent = "Exporting...";
    if (btn) btn.disabled = true;

    // Load ExcelJS via CDN
    await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
    const ExcelJS = window.ExcelJS;
    if (!ExcelJS) throw new Error('ExcelJS failed to load');

    // Sort: location ASC > employee ASC > date ASC > time ASC
    const sorted = [...state.logs].sort((a, b) => {
      const locCmp = (a.location || '').localeCompare(b.location || '');
      if (locCmp !== 0) return locCmp;
      const nameCmp = (a.employee || '').localeCompare(b.employee || '');
      if (nameCmp !== 0) return nameCmp;
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.time.localeCompare(b.time);
    });

    // Thresholds by country (must match backend)
    // UK (default): 08:30 - 17:30
    // FR (France):  10:00 - 18:30
    const LATE_TIME_UK  = '08:30:00';
    const EARLY_TIME_UK = '17:30:00';
    const LATE_TIME_FR  = '10:00:00';
    const EARLY_TIME_FR = '18:30:00';

    function argb(hex) { return 'FF' + hex.toUpperCase(); }

    // ── Fills & fonts ────────────────────────────────────────────────────────
    const FILLS = {
      plain:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
      lateIn:     { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('FFCCCC') } }, // light red
      earlyOut:   { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('FFE0B2') } }, // light orange
      clockIn:    { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('C6EFCE') } }, // light green
      clockOut:   { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('F4CCCC') } }, // rose red
      longLunch:  { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('FFF59D') } }, // amber-yellow
      missing:    { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('FF4444') } }, // bright red
    };
    const FONTS = {
      plain:      { color: { argb: 'FF000000' }, name: 'Calibri', size: 11 },
      lateIn:     { color: { argb: argb('7B0000') }, name: 'Calibri', size: 11 },
      earlyOut:   { color: { argb: argb('7B3F00') }, name: 'Calibri', size: 11 },
      clockIn:    { color: { argb: argb('1A5C1A') }, name: 'Calibri', size: 11 },
      clockOut:   { color: { argb: argb('6B0E1E') }, name: 'Calibri', size: 11 },
      longLunch:  { color: { argb: argb('5C4400') }, name: 'Calibri', size: 11 }, // dark brown on yellow
      missing:    { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Calibri', size: 11 },
    };

    const thinBorder = {
      top:    { style: 'thin', color: { argb: 'FFBFBFBF' } },
      bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      left:   { style: 'thin', color: { argb: 'FFBFBFBF' } },
      right:  { style: 'thin', color: { argb: 'FFBFBFBF' } },
    };

    // ── Classify each punch by employee+date context ─────────────────────────
    // Groups logs by employee+date, sorts each group by time, then classifies
    // using work hour thresholds based on first clock-in location:
    //   FR (France): late >= 10:00, early < 18:30
    //   UK (default): late >= 08:30, early < 17:30
    //   First IN             → late_in (if >= threshold) or normal_in
    //   Subsequent INs       → lunch_in (or long_lunch_in if break > 60 min)
    //   All OUTs except last → lunch_out (or long_lunch_out if break > 60 min)
    //   Last OUT             → early_out (if < threshold) or normal_out
    //   Unbalanced in/out    → missing (all punches that day)
    function timeToMinutes(t) {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    }

    function classifyLogs(logs) {
      const groups = {};
      logs.forEach(log => {
        const key = `${log.employee}__${log.date}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(log);
      });

      const classMap = new Map();
      for (const entries of Object.values(groups)) {
        const byTime = [...entries].sort((a, b) => a.time.localeCompare(b.time));
        const ins    = byTime.filter(l => l.direction === 'in');
        const outs   = byTime.filter(l => l.direction === 'out');

        if (ins.length !== outs.length) {
          byTime.forEach(l => classMap.set(l, 'missing'));
          continue;
        }

        // Determine work hours based on first clock-in's location country
        const firstIn = ins[0];
        const isFrance = firstIn && firstIn.clock_country === 'FR';
        const lateTime  = isFrance ? LATE_TIME_FR  : LATE_TIME_UK;
        const earlyTime = isFrance ? EARLY_TIME_FR : EARLY_TIME_UK;

        // First pass: base classifications
        byTime.forEach(l => {
          if (l.direction === 'in') {
            const idx = ins.indexOf(l);
            classMap.set(l, idx === 0
              ? (l.time >= lateTime ? 'late_in' : 'normal_in')
              : 'lunch_in');
          } else {
            const idx = outs.indexOf(l);
            classMap.set(l, idx === outs.length - 1
              ? (l.time < earlyTime ? 'early_out' : 'normal_out')
              : 'lunch_out');
          }
        });

        // Second pass: flag lunch breaks over 60 minutes
        // Pair: outs[i] (lunch clock-out) → ins[i+1] (lunch clock-in back)
        for (let i = 0; i < outs.length - 1; i++) {
          const lunchOut = outs[i];
          const lunchIn  = ins[i + 1];
          const duration = timeToMinutes(lunchIn.time) - timeToMinutes(lunchOut.time);
          if (duration > 60) {
            classMap.set(lunchOut, 'long_lunch_out');
            classMap.set(lunchIn,  'long_lunch_in');
          }
        }
      }
      return classMap;
    }

    // Returns [timeFill, timeFont, actionFill, actionFont]
    function getCellStyles(classification) {
      switch (classification) {
        case 'late_in':
          return [FILLS.lateIn,    FONTS.lateIn,    FILLS.clockIn,    FONTS.clockIn];
        case 'normal_in':
        case 'lunch_in':
          return [FILLS.plain,     FONTS.plain,     FILLS.clockIn,    FONTS.clockIn];
        case 'long_lunch_in':
        case 'long_lunch_out':
          return [FILLS.longLunch, FONTS.longLunch, FILLS.longLunch,  FONTS.longLunch];
        case 'early_out':
          return [FILLS.earlyOut,  FONTS.earlyOut,  FILLS.clockOut,   FONTS.clockOut];
        case 'normal_out':
        case 'lunch_out':
          return [FILLS.plain,     FONTS.plain,     FILLS.clockOut,   FONTS.clockOut];
        default:
          return [FILLS.plain,     FONTS.plain,     FILLS.plain,      FONTS.plain];
      }
    }

    const classMap = classifyLogs(state.logs);

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance Logs');

    worksheet.columns = [
      { key: 'location', width: 16 },
      { key: 'employee', width: 28 },
      { key: 'date',     width: 14 },
      { key: 'time',     width: 10 },
      { key: 'action',   width: 14 },
    ];

    // Header row — direct cell addressing avoids row-level style bleed
    const HEADERS = ['Location', 'Employee', 'Date', 'Time', 'Action'];
    HEADERS.forEach((h, ci) => {
      const cell     = worksheet.getCell(1, ci + 1);
      cell.value     = h;
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
      cell.font      = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Calibri', size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = {
        top:    { style: 'thin',   color: { argb: 'FF1F3864' } },
        bottom: { style: 'medium', color: { argb: 'FF1F3864' } },
        left:   { style: 'thin',   color: { argb: 'FF1F3864' } },
        right:  { style: 'thin',   color: { argb: 'FF1F3864' } },
      };
    });
    worksheet.getRow(1).height = 20;

    // Data rows — each cell styled individually based on punch classification
    sorted.forEach((log, rowIdx) => {
      const rowNum         = rowIdx + 2;
      const classification = classMap.get(log) || 'normal_in';
      const isMissing      = classification === 'missing';
      const [timeFill, timeFont, actionFill, actionFont] = getCellStyles(classification);

      const values = [
        log.location || '',
        log.employee || '',
        log.date     || '',
        log.time     || '',
        log.direction === 'in' ? 'Clock In' : 'Clock Out',
      ];

      values.forEach((val, ci) => {
        const cell     = worksheet.getCell(rowNum, ci + 1);
        cell.value     = val;
        cell.alignment = { vertical: 'middle' };
        cell.border    = thinBorder;

        if (isMissing) {
          // Entire row all-red for missing punch days
          cell.fill = FILLS.missing;
          cell.font = FONTS.missing;
        } else if (ci === 3) { // Time column
          cell.fill = timeFill;
          cell.font = timeFont;
        } else if (ci === 4) { // Action column
          cell.fill = actionFill;
          cell.font = actionFont;
        } else {
          cell.fill = FILLS.plain;
          cell.font = FONTS.plain;
        }
      });
    });

    // Generate file and trigger download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const link   = document.createElement('a');
    const startDate = $("#fromDate")?.value || '';
    const endDate   = $("#toDate")?.value   || '';
    link.href     = url;
    link.download = `attendance-logs-${startDate}-to-${endDate}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);

  } catch (error) {
    console.error("Failed to export Excel:", error);
    alert("Failed to export Excel. Please try again.");
  } finally {
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

  const exportExcelBtn = $("#exportExcelBtn");
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener("click", handleExportExcel);
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
  await loadLocations();
  
  setupCalendars();
  initDropdown('#locationFilter');
  initDropdown('#actionFilter');
  initDropdown('#sortFilter');
  setupSearch();
  setupEventHandlers();
  
  showToast('Loading attendance logs...', 'info');
  // Auto-load logs for the last week (no scroll on page load)
  try {
    await loadLogs(false);
  } catch (error) {
    console.warn("⚠️ Could not auto-load logs:", error);
  }
}
