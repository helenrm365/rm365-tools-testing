// js/modules/attendance-system/dashboard.js - Attendance dashboard with real-time status, punctuality, and employee attendance analysis
import { 
  getWorkHours, 
  getLocations,
  checkAttendanceTablesStatus,
  initializeAttendanceTables,
  getRealtimeStatus,
  getRealtimeStatusDetails,
  getPunctualityMetrics,
  getPunctualityDetails,
  getLogs
} from '../../services/api/attendanceApi.js';
import { showToast } from '../../ui/toast.js';
import { exportDashboardToPDF, exportDashboardToCSV, exportCombinedPDF, exportCombinedCSV, exportEmployeeCardToPDF, exportEmployeeCardToCSV } from '../../utils/dashboardExport.js';

// FilterControlPanel is loaded globally via script tag in index.html

// ====== State Management ======
let state = {
  realtimeStatus: {},
  realtimeDetails: { attendance: [], absences: [], breaks: [] },
  punctualityMetrics: {},
  punctualityDetails: { late: [], early: [], missing: [] },
  lunchtimeData: [],
  lunchtimeTodayData: [], // Today's data for card view
  lunchtimeDataDate: 'today', // 'today' or 'yesterday'
  locations: [],
  // Global filters that apply to all sections (except Real-Time Status for date range)
  globalFilters: {
    preset: 'today',  // 'today', 'week', 'month', 'year', 'custom'
    fromDate: null,
    toDate: null,
    location: '',
    nameSearch: ''
  },
  views: {
    realtime: 'stats',  // 'stats' or 'list'
    punctuality: 'stats',
    lunchtime: 'cards'  // 'cards' or 'list'
  },
  activeListTabs: {
    realtime: 'attendance',
    punctuality: 'late'
  }
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

function selectLocationOption(element, value, text) {
  const dropdown = document.getElementById('globalLocationDropdown');
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
  
  // Update state and apply filters
  state.globalFilters.location = value;
  console.log('[Dashboard] Location changed via custom dropdown:', value);
  applyGlobalFilters();
}

// Expose dropdown functions globally for inline onclick handlers
window.toggleDropdown = toggleDropdown;
window.selectLocationOption = selectLocationOption;

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
function $$(sel) { return document.querySelectorAll(sel); }

function formatHoursToHM(decimalHours) {
  if (!decimalHours || decimalHours === 0) return '0m';
  
  const totalMinutes = Math.round(decimalHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${minutes}m`;
  }
}

function getDateRangeForPreset(preset) {
  const today = new Date();
  let fromDate, toDate;
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  switch (preset) {
    case 'today':
      fromDate = toDate = formatDate(today);
      break;
    case 'week':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay()); // Start of week (Sunday)
      fromDate = formatDate(weekStart);
      toDate = formatDate(today);
      break;
    case 'month':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      fromDate = formatDate(monthStart);
      toDate = formatDate(today);
      break;
    case 'year':
      const yearStart = new Date(today.getFullYear(), 0, 1);
      fromDate = formatDate(yearStart);
      toDate = formatDate(today);
      break;
    case 'custom':
      // Use values from state
      fromDate = state.globalFilters.fromDate;
      toDate = state.globalFilters.toDate;
      break;
    default:
      fromDate = toDate = formatDate(today);
  }
  
  console.log(`[Dashboard] Date range for preset '${preset}':`, { fromDate, toDate });
  return { fromDate, toDate };
}

function setDefaultDates() {
  // Set date inputs to match the default preset (Today)
  const fromEl = $("#globalFromDate");
  const toEl = $("#globalToDate");
  
  // Get date range for the default preset (today)
  const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
  
  if (fromEl) fromEl.value = fromDate;
  if (toEl) toEl.value = toDate;
  
  // Store in state
  state.globalFilters.fromDate = fromDate;
  state.globalFilters.toDate = toDate;
}

// ====== API Functions ======
async function fetchRealtimeStatus() {
  try {
    // Real-time status uses location filter but always shows today's data
    const location = state.globalFilters.location || null;
    console.log('[Dashboard] Fetching realtime status with location:', location);
    return await getRealtimeStatus(location);
  } catch (error) {
    console.error('Error fetching realtime status:', error);
    return { today_attendance: 0, today_absences: 0, active_breaks: 0, total_employees: 0 };
  }
}

async function fetchRealtimeDetails(statusType) {
  try {
    // Real-time details use location filter, and date range for list view
    const location = state.globalFilters.location || null;
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    return await getRealtimeStatusDetails(statusType, location, fromDate, toDate);
  } catch (error) {
    console.error(`Error fetching ${statusType} details:`, error);
    return [];
  }
}

async function fetchPunctualityMetrics() {
  try {
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    const location = state.globalFilters.location || null;
    const name = state.globalFilters.nameSearch || null;
    console.log('[Dashboard] Fetching punctuality metrics:', { fromDate, toDate, location, name });
    return await getPunctualityMetrics(fromDate, toDate, location, name);
  } catch (error) {
    console.error('Error fetching punctuality metrics:', error);
    return { late_arrivals: 0, early_departures: 0, missing_punches: 0, late_arrival_rate: 0 };
  }
}

async function fetchPunctualityDetails(metricType) {
  try {
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    const location = state.globalFilters.location || null;
    const name = state.globalFilters.nameSearch || null;
    return await getPunctualityDetails(metricType, fromDate, toDate, location, name);
  } catch (error) {
    console.error(`Error fetching ${metricType} details:`, error);
    return [];
  }
}

async function fetchLunchtimeData() {
  try {
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    const location = state.globalFilters.location || null;
    const nameSearch = state.globalFilters.nameSearch || null;
    console.log('[Dashboard] Fetching lunchtime data:', { fromDate, toDate, location, nameSearch });
    return await getWorkHours(fromDate, toDate, location, nameSearch);
  } catch (error) {
    console.error('Error fetching lunchtime data:', error);
    return [];
  }
}

async function fetchLocations() {
  try {
    return await getLocations();
  } catch (error) {
    console.error('Error fetching locations:', error);
    return [];
  }
}

// ====== Display Functions ======
function displayRealtimeStatus(data) {
  const attendanceEl = $("#todayAttendance");
  const absencesEl = $("#todayAbsences");
  const breaksEl = $("#activeBreaks");
  
  if (attendanceEl) attendanceEl.textContent = data.today_attendance || 0;
  if (absencesEl) absencesEl.textContent = data.today_absences || 0;
  if (breaksEl) breaksEl.textContent = data.active_breaks || 0;
}

function displayPunctualityMetrics(data) {
  const lateEl = $("#lateArrivals");
  const earlyEl = $("#earlyDepartures");
  const missingEl = $("#missingPunches");
  const lateRateEl = $("#lateRate");
  const earlyRateEl = $("#earlyRate");
  const missingRateEl = $("#missingRate");
  
  if (lateEl) lateEl.textContent = data.late_arrivals || 0;
  if (earlyEl) earlyEl.textContent = data.early_departures || 0;
  if (missingEl) missingEl.textContent = data.missing_punches || 0;
  
  // Display rates
  if (lateRateEl) lateRateEl.textContent = data.late_arrival_rate ? `(${data.late_arrival_rate}%)` : '';
  if (earlyRateEl) earlyRateEl.textContent = data.early_departure_rate ? `(${data.early_departure_rate}%)` : '';
  if (missingRateEl) missingRateEl.textContent = data.missing_punch_rate ? `(${data.missing_punch_rate}%)` : '';
}

function displayRealtimeListView(data, tabType) {
  const listContent = $("#realtimeListContent");
  if (!listContent) return;
  
  // Apply client-side name filter for list view (grid view stats remain unfiltered by name)
  let filteredData = data;
  const nameFilter = state.globalFilters.nameSearch?.toLowerCase()?.trim();
  if (nameFilter && Array.isArray(data)) {
    filteredData = data.filter(emp => emp.name?.toLowerCase().includes(nameFilter));
  }
  
  if (!filteredData || filteredData.length === 0) {
    listContent.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <p>No employees in this category${nameFilter ? ' matching the filter' : ''}</p>
      </div>
    `;
    return;
  }
  
  const statusLabels = {
    'in': 'Clocked In',
    'out': 'Clocked Out',
    'on_break': 'On Break',
    'absent': 'Absent',
    'break_taken': 'Break Taken'
  };
  
  const statusColors = {
    'in': 'var(--success)',
    'out': 'var(--warning)',
    'on_break': 'var(--info)',
    'absent': 'var(--error)',
    'break_taken': 'var(--info)'
  };
  
  // Check if this is a date range query (has 'date' field) vs today-only (has 'time' field)
  const isDateRangeMode = filteredData.length > 0 && filteredData[0].date;
  
  let tableHeader = '';
  let tableRows = '';
  
  if (isDateRangeMode) {
    // Date range mode: show date column and different data structure
    if (tabType === 'attendance') {
      tableHeader = '<th>Date</th><th>Employee</th><th>Location</th><th>First In</th><th>Last Out</th><th>Status</th>';
      tableRows = filteredData.map(emp => `
        <tr>
          <td>${new Date(emp.date).toLocaleDateString()}</td>
          <td>${emp.name}</td>
          <td>${emp.location || '-'}</td>
          <td>${emp.first_in || '-'}</td>
          <td>${emp.last_out || '-'}</td>
          <td>
            <span class="status-badge" style="background: ${statusColors[emp.status] || 'var(--text-muted)'}">
              ${statusLabels[emp.status] || emp.status}
            </span>
          </td>
        </tr>
      `).join('');
    } else if (tabType === 'absences') {
      tableHeader = '<th>Date</th><th>Employee</th><th>Location</th><th>Status</th>';
      tableRows = filteredData.map(emp => `
        <tr>
          <td>${new Date(emp.date).toLocaleDateString()}</td>
          <td>${emp.name}</td>
          <td>${emp.location || '-'}</td>
          <td>
            <span class="status-badge" style="background: ${statusColors['absent']}">
              Absent
            </span>
          </td>
        </tr>
      `).join('');
    } else if (tabType === 'breaks') {
      tableHeader = '<th>Date</th><th>Employee</th><th>Location</th><th>Break Start</th><th>Break End</th><th>Duration</th>';
      tableRows = filteredData.map(emp => `
        <tr>
          <td>${new Date(emp.date).toLocaleDateString()}</td>
          <td>${emp.name}</td>
          <td>${emp.location || '-'}</td>
          <td>${emp.break_start || '-'}</td>
          <td>${emp.break_end || '-'}</td>
          <td>${emp.duration || '-'}</td>
        </tr>
      `).join('');
    }
  } else {
    // Today-only mode: original structure
    tableHeader = `<th>Employee</th><th>Location</th><th>${tabType === 'breaks' ? 'Break Started' : tabType === 'attendance' ? 'First Clock In' : 'Status'}</th><th>Current Status</th>`;
    tableRows = filteredData.map(emp => `
      <tr>
        <td>${emp.name}</td>
        <td>${emp.location || '-'}</td>
        <td>${emp.time || '-'}</td>
        <td>
          <span class="status-badge" style="background: ${statusColors[emp.status] || 'var(--text-muted)'}">
            ${statusLabels[emp.status] || emp.status}
          </span>
        </td>
      </tr>
    `).join('');
  }
  
  listContent.innerHTML = `
    <div class="table-container">
      <table class="modern-table">
        <thead>
          <tr>
            ${tableHeader}
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function displayPunctualityListView(data, metricType) {
  const listContent = $("#punctualityListContent");
  if (!listContent) return;
  
  // Apply client-side name filter for list view (grid view stats remain unfiltered by name)
  let filteredData = data;
  const nameFilter = state.globalFilters.nameSearch?.toLowerCase()?.trim();
  if (nameFilter && Array.isArray(data)) {
    filteredData = data.filter(item => item.name?.toLowerCase().includes(nameFilter));
  }
  
  if (!filteredData || filteredData.length === 0) {
    listContent.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <p>No records found for this period${nameFilter ? ' matching the filter' : ''}</p>
      </div>
    `;
    return;
  }
  
  let tableHeader = '';
  let tableRows = '';
  
  if (metricType === 'late') {
    tableHeader = '<th>Employee</th><th>Location</th><th>Date</th><th>Arrival Time</th>';
    tableRows = filteredData.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.location || '-'}</td>
        <td>${new Date(item.date).toLocaleDateString()}</td>
        <td><span class="time-late">${item.time}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'early') {
    tableHeader = '<th>Employee</th><th>Location</th><th>Date</th><th>Departure Time</th>';
    tableRows = filteredData.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.location || '-'}</td>
        <td>${new Date(item.date).toLocaleDateString()}</td>
        <td><span class="time-early">${item.time}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'missing') {
    tableHeader = '<th>Employee</th><th>Location</th><th>Date</th><th>Issue</th>';
    tableRows = filteredData.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.location || '-'}</td>
        <td>${new Date(item.date).toLocaleDateString()}</td>
        <td><span class="issue-badge">${item.issue}</span></td>
      </tr>
    `).join('');
  }
  
  listContent.innerHTML = `
    <div class="table-container">
      <table class="modern-table">
        <thead><tr>${tableHeader}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function displayLunchtimeTable(data) {
  const lunchtimeEl = $("#lunchtimeContent");
  if (!lunchtimeEl) return;

  if (!data || data.length === 0) {
    lunchtimeEl.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-utensils"></i>
        <p>No complete work days found for the selected period.</p>
      </div>
    `;
    return;
  }

  // Group by employee
  const employeeHours = {};
  data.forEach(item => {
    if (!employeeHours[item.employee]) {
      employeeHours[item.employee] = [];
    }
    employeeHours[item.employee].push(item);
  });

  const table = `
    <div class="table-container">
      <table class="modern-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Date</th>
            <th>First In</th>
            <th>First Out</th>
            <th>Second In</th>
            <th>Last Out</th>
            <th>Hours Worked</th>
            <th>Lunch Time</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(employeeHours).map(([employee, days]) => 
            days.map((day, index) => `
              <tr>
                <td>${index === 0 ? employee : ''}</td>
                <td>${new Date(day.date).toLocaleDateString()}</td>
                <td>${day.first_in || '-'}</td>
                <td>${day.first_out || '-'}</td>
                <td>${day.second_in || '-'}</td>
                <td>${day.last_out || '-'}</td>
                <td>${formatHoursToHM(day.hours_worked)}</td>
                <td>${day.lunch_hours ? formatHoursToHM(day.lunch_hours) : '-'}</td>
              </tr>
            `).join('')
          ).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top: 1rem; font-size: 0.9em; color: var(--text-muted);">
      <strong>Total Work Days:</strong> ${data.length} | 
      <strong>Average Hours per Day:</strong> ${formatHoursToHM(data.reduce((sum, item) => sum + item.hours_worked, 0) / data.length)} |
      <strong>Average Lunch Time:</strong> ${(() => {
        const lunchData = data.filter(item => item.lunch_hours !== null);
        return lunchData.length > 0 ? 
          formatHoursToHM(lunchData.reduce((sum, item) => sum + item.lunch_hours, 0) / lunchData.length) : 
          'N/A';
      })()}
    </div>
  `;

  lunchtimeEl.innerHTML = table;
}

// ====== View Toggle Functions ======
function toggleRealtimeView() {
  state.views.realtime = state.views.realtime === 'stats' ? 'list' : 'stats';
  
  const statsView = $("#realtimeStatsView");
  const listView = $("#realtimeListView");
  const toggleBtn = $("#toggleRealtimeView i");
  
  if (state.views.realtime === 'list') {
    statsView.style.display = 'none';
    listView.style.display = 'block';
    toggleBtn.className = 'fas fa-th-large';
    // Load details for active tab
    loadRealtimeDetails(state.activeListTabs.realtime);
  } else {
    statsView.style.display = 'grid';
    listView.style.display = 'none';
    toggleBtn.className = 'fas fa-list';
  }
}

function togglePunctualityView() {
  state.views.punctuality = state.views.punctuality === 'stats' ? 'list' : 'stats';
  
  const statsView = $("#punctualityStatsView");
  const listView = $("#punctualityListView");
  const toggleBtn = $("#togglePunctualityView i");
  
  if (state.views.punctuality === 'list') {
    statsView.style.display = 'none';
    listView.style.display = 'block';
    toggleBtn.className = 'fas fa-th-large';
    // Load details for active tab
    loadPunctualityDetails(state.activeListTabs.punctuality);
  } else {
    statsView.style.display = 'grid';
    listView.style.display = 'none';
    toggleBtn.className = 'fas fa-list';
  }
}

function toggleLunchtimeView() {
  state.views.lunchtime = state.views.lunchtime === 'cards' ? 'list' : 'cards';
  
  const cardsView = $("#lunchtimeCardsView");
  const listView = $("#lunchtimeListView");
  const toggleBtn = $("#toggleLunchtimeView i");
  
  if (state.views.lunchtime === 'list') {
    cardsView.style.display = 'none';
    listView.style.display = 'block';
    toggleBtn.className = 'fas fa-th-large';
    // Load date-filtered list data
    loadLunchtimeData();
  } else {
    cardsView.style.display = 'grid';
    listView.style.display = 'none';
    toggleBtn.className = 'fas fa-list';
    // Load today's card data
    loadLunchtimeTodayCards();
  }
}

async function fetchLunchtimeTodayData() {
  try {
    // Always fetch today's data for cards view
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const location = state.globalFilters.location || null;
    const nameSearch = state.globalFilters.nameSearch || null;
    console.log('[Dashboard] Fetching today\'s lunchtime data for cards:', { date: todayStr, location, nameSearch });
    
    let data = await getWorkHours(todayStr, todayStr, location, nameSearch);
    
    // If no data for today, try yesterday
    if (!data || data.length === 0) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      console.log('[Dashboard] No data for today, fetching yesterday:', yesterdayStr);
      data = await getWorkHours(yesterdayStr, yesterdayStr, location, nameSearch);
      if (data && data.length > 0) {
        // Mark as yesterday's data
        state.lunchtimeDataDate = 'yesterday';
      }
    } else {
      state.lunchtimeDataDate = 'today';
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching today\'s lunchtime data:', error);
    return [];
  }
}

async function loadLunchtimeTodayCards() {
  try {
    const data = await fetchLunchtimeTodayData();
    console.log('[Dashboard] Today\'s lunchtime data received:', data?.length || 0, 'records');
    state.lunchtimeTodayData = data;
    displayLunchtimeCards(data);
  } catch (error) {
    console.error('Failed to load today\'s lunchtime cards:', error);
  }
}

function displayLunchtimeCards(data) {
  const cardsEl = $("#lunchtimeCardsView");
  if (!cardsEl) return;

  if (!data || data.length === 0) {
    cardsEl.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-utensils"></i>
        <p>No attendance data available yet.</p>
      </div>
    `;
    return;
  }

  // Add date indicator if showing yesterday's data
  const dateLabel = state.lunchtimeDataDate === 'yesterday' 
    ? '<div class="lunchtime-date-label"><i class="fas fa-calendar-day"></i> Showing yesterday\'s data</div>' 
    : '';

  // Group by employee (in case of multiple entries per employee)
  const employeeData = {};
  data.forEach(item => {
    const empName = item.employee;
    if (!employeeData[empName]) {
      employeeData[empName] = {
        name: empName,
        firstIn: item.first_in,
        lastOut: item.last_out,
        hoursWorked: item.hours_worked || 0,
        lunchTime: item.lunch_hours || 0
      };
    } else {
      // Merge multiple entries (e.g., compare times)
      if (item.first_in && (!employeeData[empName].firstIn || item.first_in < employeeData[empName].firstIn)) {
        employeeData[empName].firstIn = item.first_in;
      }
      if (item.last_out && (!employeeData[empName].lastOut || item.last_out > employeeData[empName].lastOut)) {
        employeeData[empName].lastOut = item.last_out;
      }
      employeeData[empName].hoursWorked += item.hours_worked || 0;
      employeeData[empName].lunchTime += item.lunch_hours || 0;
    }
  });

  const cards = Object.values(employeeData).map(emp => `
    <div class="employee-card lunchtime-employee-card" data-employee="${emp.name}" data-first-in="${emp.firstIn || ''}" data-last-out="${emp.lastOut || ''}" data-hours-worked="${emp.hoursWorked || 0}" data-lunch-time="${emp.lunchTime || 0}" title="Click to view attendance logs">
      <div class="employee-card-header">
        <div class="employee-avatar">
          <i class="fas fa-user"></i>
        </div>
        <div class="export-dropdown employee-card-export" data-employee="${emp.name}">
          <button class="export-dropdown-btn btn-sm" title="Export employee data" onclick="event.stopPropagation();">
            <i class="fas fa-download"></i>
            <i class="fas fa-chevron-down dropdown-arrow"></i>
          </button>
          <div class="export-dropdown-menu">
            <button class="export-option" data-format="pdf" data-employee="${emp.name}" onclick="event.stopPropagation();">
              <i class="fas fa-file-pdf"></i>
              <span>Export as PDF</span>
            </button>
            <button class="export-option" data-format="csv" data-employee="${emp.name}" onclick="event.stopPropagation();">
              <i class="fas fa-file-csv"></i>
              <span>Export as CSV</span>
            </button>
          </div>
        </div>
      </div>
      <div class="employee-info">
        <h4>${emp.name}</h4>
        <div class="lunchtime-card-details">
          <div class="lunchtime-detail-item">
            <i class="fas fa-sign-in-alt"></i>
            <span class="detail-label">Arrival</span>
            <span class="detail-value">${emp.firstIn || '-'}</span>
          </div>
          <div class="lunchtime-detail-item">
            <i class="fas fa-utensils"></i>
            <span class="detail-label">Lunch</span>
            <span class="detail-value">${emp.lunchTime ? formatHoursToHM(emp.lunchTime) : '-'}</span>
          </div>
          <div class="lunchtime-detail-item">
            <i class="fas fa-clock"></i>
            <span class="detail-label">Worked</span>
            <span class="detail-value">${formatHoursToHM(emp.hoursWorked)}</span>
          </div>
          <div class="lunchtime-detail-item">
            <i class="fas fa-sign-out-alt"></i>
            <span class="detail-label">Leave</span>
            <span class="detail-value">${emp.lastOut || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  cardsEl.innerHTML = dateLabel + cards;
  
  // Add click handlers for employee cards (clicking on card area opens logs modal)
  cardsEl.querySelectorAll('.lunchtime-employee-card[data-employee]').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't open modal if clicking on export dropdown
      if (e.target.closest('.employee-card-export')) return;
      
      const employeeName = card.dataset.employee;
      if (employeeName) {
        showEmployeeLogsModal(employeeName);
      }
    });
  });
  
  // Setup export dropdowns for employee cards
  setupEmployeeCardExportDropdowns(cardsEl);
}

/**
 * Setup export dropdown handlers for employee cards
 */
function setupEmployeeCardExportDropdowns(container) {
  const exportDropdowns = container.querySelectorAll('.employee-card-export');
  
  exportDropdowns.forEach(dropdown => {
    const btn = dropdown.querySelector('.export-dropdown-btn');
    const menu = dropdown.querySelector('.export-dropdown-menu');
    
    if (!btn || !menu) return;
    
    // Toggle dropdown on button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Close other dropdowns
      document.querySelectorAll('.employee-card-export.open').forEach(d => {
        if (d !== dropdown) d.classList.remove('open');
      });
      
      dropdown.classList.toggle('open');
    });
    
    // Handle export option clicks
    menu.querySelectorAll('.export-option').forEach(option => {
      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        const format = option.dataset.format;
        const employeeName = option.dataset.employee;
        
        dropdown.classList.remove('open');
        await handleEmployeeCardExport(employeeName, format);
      });
    });
  });
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    exportDropdowns.forEach(d => d.classList.remove('open'));
  });
}

/**
 * Handle export for individual employee card
 * @param {string} employeeName - Name of the employee
 * @param {string} format - 'pdf' or 'csv'
 */
async function handleEmployeeCardExport(employeeName, format) {
  try {
    // Show loading toast
    showToast(`Generating ${format.toUpperCase()} for ${employeeName}...`, 'info');
    
    // Get employee card data
    const cardEl = document.querySelector(`.lunchtime-employee-card[data-employee="${employeeName}"]`);
    const employeeData = {
      name: employeeName,
      firstIn: cardEl?.dataset.firstIn || '-',
      lastOut: cardEl?.dataset.lastOut || '-',
      hoursWorked: formatHoursToHM(parseFloat(cardEl?.dataset.hoursWorked) || 0),
      lunchTime: formatHoursToHM(parseFloat(cardEl?.dataset.lunchTime) || 0)
    };
    
    // Get date range from filter panel
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    const fromDateDisplay = new Date(fromDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const toDateDisplay = new Date(toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const dateRangeText = fromDate === toDate ? fromDateDisplay : `${fromDateDisplay} - ${toDateDisplay}`;
    
    // Fetch logs for the employee within the date range
    const logs = await getLogs(fromDate, toDate, null, employeeName, null);
    
    // Filter to exact employee match and sort
    const filteredLogs = (logs || [])
      .filter(log => log.employee?.toLowerCase() === employeeName.toLowerCase())
      .sort((a, b) => {
        const dateTimeA = new Date(`${a.date}T${a.time}`);
        const dateTimeB = new Date(`${b.date}T${b.time}`);
        return dateTimeB - dateTimeA;
      });
    
    const filters = {
      dateRange: dateRangeText,
      location: state.globalFilters.location || null
    };
    
    let result;
    if (format === 'pdf') {
      result = await exportEmployeeCardToPDF(employeeData, filteredLogs, filters);
    } else if (format === 'csv') {
      result = exportEmployeeCardToCSV(employeeData, filteredLogs, filters);
    }
    
    if (result?.success) {
      showToast(`${format.toUpperCase()} exported successfully: ${result.filename}`, 'success');
    }
  } catch (error) {
    console.error('Employee card export error:', error);
    showToast(`Failed to export ${format.toUpperCase()}: ${error.message}`, 'error');
  }
}

// ====== Employee Logs Modal ======
const employeeLogsModalState = {
  currentPage: 1,
  pageSize: 10,
  totalPages: 1,
  allLogs: [],
  employeeName: '',
  dateRange: { fromDate: null, toDate: null },
  todaySummary: { firstIn: null, lastOut: null, hoursWorked: 0, lunchTime: 0 }
};

async function showEmployeeLogsModal(employeeName) {
  employeeLogsModalState.employeeName = employeeName;
  employeeLogsModalState.currentPage = 1;
  employeeLogsModalState.allLogs = [];
  
  // Get date range for display
  const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
  const fromDateDisplay = new Date(fromDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const toDateDisplay = new Date(toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const dateRangeText = fromDate === toDate ? fromDateDisplay : `${fromDateDisplay} - ${toDateDisplay}`;
  
  // Get today's summary from the card data
  const cardEl = document.querySelector(`.lunchtime-employee-card[data-employee="${employeeName}"]`);
  const todaySummary = {
    firstIn: cardEl?.dataset.firstIn || null,
    lastOut: cardEl?.dataset.lastOut || null,
    hoursWorked: parseFloat(cardEl?.dataset.hoursWorked) || 0,
    lunchTime: parseFloat(cardEl?.dataset.lunchTime) || 0
  };
  employeeLogsModalState.todaySummary = todaySummary;
  
  // Create modal HTML
  const modalHtml = `
    <div class="modal-overlay active" id="employeeLogsModal">
      <div class="modal-content" style="max-width: 800px; width: 90%;">
        <div class="modal-header" style="background: var(--bg-light); border-bottom: 1px solid var(--border);">
          <div>
            <h3 class="modal-title" style="color: var(--text); margin-bottom: 0.25rem;">
              <i class="fas fa-clipboard-list" style="margin-right: 0.5rem; color: var(--accent);"></i>
              Attendance Logs - ${employeeName}
            </h3>
            <p style="font-size: 0.875rem; color: var(--text-muted); margin: 0;">
              <i class="fas fa-calendar-alt" style="margin-right: 0.25rem;"></i>
              ${dateRangeText}
            </p>
          </div>
          <button class="modal-close" id="closeEmployeeLogsModal" style="color: var(--text-muted);">&times;</button>
        </div>
        <div class="modal-body" style="max-height: 60vh; overflow-y: auto; padding: 0;">
          <div id="employeeLogsContent" style="padding: 1rem;">
            <div class="loading-state" style="text-align: center; padding: 2rem;">
              <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent);"></i>
              <p style="margin-top: 1rem; color: var(--text-muted);">Loading logs...</p>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
          <div id="employeeLogsPagination" class="pagination-controls" style="display: flex; align-items: center; gap: 0.5rem;"></div>
          <button class="action-btn action-btn-secondary" id="confirmEmployeeLogsModal">
            Close
          </button>
        </div>
      </div>
    </div>
  `;
  
  // Inject modal into DOM
  let container = document.getElementById('employeeLogsModalContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'employeeLogsModalContainer';
    document.body.appendChild(container);
  }
  container.innerHTML = modalHtml;
  
  // Setup close handlers
  const modal = document.getElementById('employeeLogsModal');
  const closeBtn = document.getElementById('closeEmployeeLogsModal');
  const confirmBtn = document.getElementById('confirmEmployeeLogsModal');
  
  const closeModal = () => {
    modal.classList.remove('active');
    setTimeout(() => container.innerHTML = '', 300);
  };
  
  closeBtn?.addEventListener('click', closeModal);
  confirmBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  // Fetch logs
  await fetchEmployeeLogs(employeeName);
}

async function fetchEmployeeLogs(employeeName) {
  try {
    // Use date range from filter panel
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    
    console.log('[Dashboard] Fetching employee logs for:', employeeName, 'Date range:', fromDate, 'to', toDate);
    
    const logs = await getLogs(fromDate, toDate, null, employeeName, null);
    
    // Filter to exact employee match and sort by date descending
    employeeLogsModalState.allLogs = (logs || [])
      .filter(log => log.employee?.toLowerCase() === employeeName.toLowerCase())
      .sort((a, b) => {
        // Sort by date + time descending
        const dateTimeA = new Date(`${a.date}T${a.time}`);
        const dateTimeB = new Date(`${b.date}T${b.time}`);
        return dateTimeB - dateTimeA;
      });
    
    employeeLogsModalState.totalPages = Math.ceil(employeeLogsModalState.allLogs.length / employeeLogsModalState.pageSize) || 1;
    employeeLogsModalState.dateRange = { fromDate, toDate };
    
    renderEmployeeLogsTable();
  } catch (error) {
    console.error('Error fetching employee logs:', error);
    const content = document.getElementById('employeeLogsContent');
    if (content) {
      content.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 2rem;">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--error);"></i>
          <p style="margin-top: 1rem; color: var(--text-muted);">Failed to load logs. Please try again.</p>
        </div>
      `;
    }
  }
}

function renderEmployeeLogsTable() {
  const content = document.getElementById('employeeLogsContent');
  const paginationEl = document.getElementById('employeeLogsPagination');
  if (!content) return;
  
  const { allLogs, currentPage, pageSize, totalPages, dateRange } = employeeLogsModalState;
  
  // Format date range for display in empty message
  const fromDateDisplay = dateRange?.fromDate ? new Date(dateRange.fromDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const toDateDisplay = dateRange?.toDate ? new Date(dateRange.toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const dateRangeText = dateRange?.fromDate === dateRange?.toDate ? fromDateDisplay : `${fromDateDisplay} to ${toDateDisplay}`;
  
  if (allLogs.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 2rem;">
        <i class="fas fa-inbox" style="font-size: 2rem; color: var(--text-muted);"></i>
        <p style="margin-top: 1rem; color: var(--text-muted);">No attendance logs found for ${dateRangeText}.</p>
        <p style="font-size: 0.875rem; color: var(--text-muted);">Try adjusting the date range in the filter panel.</p>
      </div>
    `;
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }
  
  // Get current page data
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageLogs = allLogs.slice(startIdx, endIdx);
  
  // Build table
  const tableHtml = `
    <div class="table-container" style="overflow-x: auto;">
      <table class="modern-table" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: var(--bg-light);">
            <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text);">Date</th>
            <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text);">Time</th>
            <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text);">Direction</th>
            <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text);">Location</th>
          </tr>
        </thead>
        <tbody>
          ${pageLogs.map(log => {
            // API returns separate date and time fields
            const logDate = new Date(log.date);
            const dateStr = logDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = log.time || '-';
            const directionClass = log.direction === 'in' ? 'color: var(--success);' : 'color: var(--warning);';
            const directionIcon = log.direction === 'in' ? 'fa-sign-in-alt' : 'fa-sign-out-alt';
            const directionLabel = log.direction === 'in' ? 'Clock In' : 'Clock Out';
            
            return `
              <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 0.75rem 1rem; color: var(--text);">${dateStr}</td>
                <td style="padding: 0.75rem 1rem; color: var(--text); font-family: monospace;">${timeStr}</td>
                <td style="padding: 0.75rem 1rem;">
                  <span style="display: inline-flex; align-items: center; gap: 0.5rem; ${directionClass}">
                    <i class="fas ${directionIcon}"></i>
                    ${directionLabel}
                  </span>
                </td>
                <td style="padding: 0.75rem 1rem; color: var(--text-muted);">${log.location || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding: 0.5rem 1rem; color: var(--text-muted); font-size: 0.875rem;">
      Showing ${startIdx + 1}-${Math.min(endIdx, allLogs.length)} of ${allLogs.length} logs
    </div>
  `;
  
  content.innerHTML = tableHtml;
  
  // Render pagination
  if (paginationEl && totalPages > 1) {
    paginationEl.innerHTML = `
      <button class="action-btn action-btn-sm" ${currentPage <= 1 ? 'disabled' : ''} id="employeeLogsPrev">
        <i class="fas fa-chevron-left"></i>
      </button>
      <span style="color: var(--text); font-size: 0.875rem;">Page ${currentPage} of ${totalPages}</span>
      <button class="action-btn action-btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} id="employeeLogsNext">
        <i class="fas fa-chevron-right"></i>
      </button>
    `;
    
    document.getElementById('employeeLogsPrev')?.addEventListener('click', () => {
      if (employeeLogsModalState.currentPage > 1) {
        employeeLogsModalState.currentPage--;
        renderEmployeeLogsTable();
      }
    });
    
    document.getElementById('employeeLogsNext')?.addEventListener('click', () => {
      if (employeeLogsModalState.currentPage < employeeLogsModalState.totalPages) {
        employeeLogsModalState.currentPage++;
        renderEmployeeLogsTable();
      }
    });
  } else if (paginationEl) {
    paginationEl.innerHTML = '';
  }
}

// ====== Data Loading Functions ======
async function loadRealtimeStatus() {
  const data = await fetchRealtimeStatus();
  state.realtimeStatus = data;
  displayRealtimeStatus(data);
}

async function loadRealtimeDetails(statusType) {
  const data = await fetchRealtimeDetails(statusType);
  state.realtimeDetails[statusType] = data;
  displayRealtimeListView(data, statusType);
}

async function loadPunctualityMetrics() {
  console.log('[Dashboard] Loading punctuality metrics with preset:', state.globalFilters.preset);
  const data = await fetchPunctualityMetrics();
  console.log('[Dashboard] Punctuality metrics received:', data);
  state.punctualityMetrics = data;
  displayPunctualityMetrics(data);
}

async function loadPunctualityDetails(metricType) {
  const data = await fetchPunctualityDetails(metricType);
  state.punctualityDetails[metricType] = data;
  displayPunctualityListView(data, metricType);
}

async function loadLocations() {
  try {
    console.log('[Dashboard] Loading locations...');
    const locations = await fetchLocations();
    console.log('[Dashboard] Locations raw response:', locations);
    state.locations = Array.isArray(locations) ? locations : (locations?.data || locations?.locations || []);
    console.log('[Dashboard] Locations parsed:', state.locations);
    if (state.locations.length > 0) {
      populateLocationFilter();
    }
  } catch (error) {
    console.error('Failed to load locations:', error);
  }
}

function populateLocationFilter() {
  const optionsContainer = $("#globalLocationOptions");
  console.log('[Dashboard] Populating location filter. Element:', optionsContainer, 'Locations:', state.locations);
  if (!optionsContainer || state.locations.length === 0) return;
  
  // Clear existing options and rebuild with "All Locations" + dynamic locations
  optionsContainer.innerHTML = `
    <div class="dropdown-option selected" onclick="selectLocationOption(this, '', 'All Locations')">All Locations</div>
  `;
  
  state.locations.forEach(location => {
    const option = document.createElement('div');
    option.className = 'dropdown-option';
    option.setAttribute('onclick', `selectLocationOption(this, '${location}', '${location}')`);
    option.textContent = location;
    optionsContainer.appendChild(option);
  });
  console.log('[Dashboard] Location filter populated with', state.locations.length, 'options');
}

async function loadLunchtimeData() {
  try {
    console.log('[Dashboard] Loading lunchtime data with preset:', state.globalFilters.preset);
    const data = await fetchLunchtimeData();
    console.log('[Dashboard] Lunchtime data received:', data?.length || 0, 'records');
    state.lunchtimeData = data;
    displayLunchtimeTable(data);
  } catch (error) {
    console.error('Failed to load lunchtime data:', error);
  }
}

// ====== Global Filter Functions ======
function applyGlobalFilters() {
  // Read values from filter panel
  const locationFilter = $("#globalLocationFilter");
  const nameFilter = $("#globalNameFilter");
  const fromDate = $("#globalFromDate");
  const toDate = $("#globalToDate");
  
  console.log('[Dashboard] Applying filters:');
  console.log('  - Location element:', locationFilter);
  console.log('  - Location value:', locationFilter?.value);
  console.log('  - Name value:', nameFilter?.value);
  console.log('  - From date:', fromDate?.value);
  console.log('  - To date:', toDate?.value);
  
  state.globalFilters.location = locationFilter?.value || '';
  state.globalFilters.nameSearch = nameFilter?.value?.trim() || '';
  
  console.log('[Dashboard] State after update:', JSON.stringify(state.globalFilters));
  
  // Check if using custom dates
  if (state.globalFilters.preset === 'custom') {
    state.globalFilters.fromDate = fromDate?.value || null;
    state.globalFilters.toDate = toDate?.value || null;
  }
  
  // Reload all sections with new filters
  // Real-time status only uses location filter (always shows today)
  loadRealtimeStatus();
  if (state.views.realtime === 'list') {
    loadRealtimeDetails(state.activeListTabs.realtime);
  }
  
  // Punctuality and Lunchtime use all filters including date range
  loadPunctualityMetrics();
  if (state.views.punctuality === 'list') {
    loadPunctualityDetails(state.activeListTabs.punctuality);
  }
  
  // For lunchtime: list view uses date range, cards view always uses today
  if (state.views.lunchtime === 'list') {
    loadLunchtimeData();
  } else {
    loadLunchtimeTodayCards(); // Cards view still updates based on location/name filters
  }
  
  showToast('Filters applied', 'success');
}

function clearGlobalFilters() {
  const locationFilter = $("#globalLocationFilter");
  const nameFilter = $("#globalNameFilter");
  const presetBtns = $$('.date-preset-buttons .preset-btn');
  const locationDropdown = $("#globalLocationDropdown");
  
  // Reset hidden input value
  if (locationFilter) locationFilter.value = '';
  if (nameFilter) nameFilter.value = '';
  
  // Reset custom dropdown visual state
  if (locationDropdown) {
    const selected = locationDropdown.querySelector('.dropdown-selected');
    if (selected) selected.textContent = 'All Locations';
    
    // Reset selected option visually
    locationDropdown.querySelectorAll('.dropdown-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    const allOption = locationDropdown.querySelector('.dropdown-option');
    if (allOption) allOption.classList.add('selected');
  }
  
  // Reset to Today preset
  presetBtns.forEach(btn => btn.classList.remove('active'));
  const todayBtn = document.querySelector('.preset-btn[data-preset="today"]');
  if (todayBtn) todayBtn.classList.add('active');
  
  // Reset state
  state.globalFilters.location = '';
  state.globalFilters.nameSearch = '';
  state.globalFilters.preset = 'today';
  
  // Reload all sections
  loadRealtimeStatus();
  if (state.views.realtime === 'list') {
    loadRealtimeDetails(state.activeListTabs.realtime);
  }
  loadPunctualityMetrics();
  if (state.views.punctuality === 'list') {
    loadPunctualityDetails(state.activeListTabs.punctuality);
  }
  
  // For lunchtime: list view uses date range, cards view always uses today
  if (state.views.lunchtime === 'list') {
    loadLunchtimeData();
  } else {
    loadLunchtimeTodayCards();
  }
  
  showToast('Filters cleared', 'info');
}

// ====== Export Dropdown Functions ======
function setupExportDropdowns() {
  const exportDropdowns = document.querySelectorAll('.export-dropdown');
  
  exportDropdowns.forEach(dropdown => {
    const btn = dropdown.querySelector('.export-dropdown-btn');
    const menu = dropdown.querySelector('.export-dropdown-menu');
    
    if (!btn || !menu) return;
    
    // Toggle dropdown on button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Close other dropdowns
      exportDropdowns.forEach(d => {
        if (d !== dropdown) d.classList.remove('open');
      });
      
      dropdown.classList.toggle('open');
    });
    
    // Handle export option clicks
    menu.querySelectorAll('.export-option').forEach(option => {
      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        const format = option.dataset.format;
        const section = option.dataset.section;
        
        dropdown.classList.remove('open');
        await handleExport(section, format);
      });
    });
  });
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    exportDropdowns.forEach(d => d.classList.remove('open'));
  });
}

async function handleExport(section, format) {
  const btn = document.querySelector(`#${section}ExportBtn`);
  
  try {
    // Show loading state
    if (btn) {
      btn.classList.add('loading');
      const icon = btn.querySelector('i:first-child');
      if (icon) icon.className = 'fas fa-spinner';
    }
    
    // Get current date range for the report
    const { fromDate, toDate } = getDateRangeForPreset(state.globalFilters.preset);
    const fromDateDisplay = new Date(fromDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const toDateDisplay = new Date(toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const dateRangeText = fromDate === toDate ? fromDateDisplay : `${fromDateDisplay} - ${toDateDisplay}`;
    
    // Build filters object for the report
    const filters = {
      location: state.globalFilters.location || null,
      dateRange: dateRangeText,
      nameSearch: state.globalFilters.nameSearch || null
    };
    
    // Check if we're in grid view (stats view) - export all sections combined
    const isGridView = (section === 'realtime' && state.views.realtime === 'stats') ||
                       (section === 'punctuality' && state.views.punctuality === 'stats');
    
    let result;
    
    if (isGridView) {
      // Export all sections combined for grid view
      let sectionsData = {};
      
      if (section === 'realtime') {
        // Fetch all realtime sections: attendance, absences, breaks
        const [attendance, absences, breaks] = await Promise.all([
          fetchRealtimeDetails('attendance'),
          fetchRealtimeDetails('absences'),
          fetchRealtimeDetails('breaks')
        ]);
        
        // Store in state for caching
        state.realtimeDetails.attendance = attendance;
        state.realtimeDetails.absences = absences;
        state.realtimeDetails.breaks = breaks;
        
        sectionsData = { attendance, absences, breaks };
      } else if (section === 'punctuality') {
        // Fetch all punctuality sections: late, early, missing
        const [late, early, missing] = await Promise.all([
          fetchPunctualityDetails('late'),
          fetchPunctualityDetails('early'),
          fetchPunctualityDetails('missing')
        ]);
        
        // Store in state for caching
        state.punctualityDetails.late = late;
        state.punctualityDetails.early = early;
        state.punctualityDetails.missing = missing;
        
        sectionsData = { late, early, missing };
      }
      
      // Check if we have any data to export
      const hasData = Object.values(sectionsData).some(arr => arr && arr.length > 0);
      if (!hasData) {
        showToast('No data to export. Please ensure there is data available.', 'warning');
        return;
      }
      
      // Export combined
      if (format === 'pdf') {
        result = await exportCombinedPDF(sectionsData, section, filters);
      } else if (format === 'csv') {
        result = exportCombinedCSV(sectionsData, section, filters);
      }
    } else {
      // List view - export only the selected tab
      // Always fetch fresh data to ensure current filters are applied
      let reportType;
      let data;
      
      if (section === 'realtime') {
        reportType = state.activeListTabs.realtime;
        // Always fetch fresh data with current filters
        data = await fetchRealtimeDetails(reportType);
        state.realtimeDetails[reportType] = data;
        
        // Apply client-side name filter (same as display)
        const nameFilter = state.globalFilters.nameSearch?.toLowerCase()?.trim();
        if (nameFilter && Array.isArray(data)) {
          data = data.filter(emp => emp.name?.toLowerCase().includes(nameFilter));
        }
      } else if (section === 'punctuality') {
        reportType = state.activeListTabs.punctuality;
        // Always fetch fresh data with current filters
        data = await fetchPunctualityDetails(reportType);
        state.punctualityDetails[reportType] = data;
        
        // Apply client-side name filter (same as display)
        const nameFilter = state.globalFilters.nameSearch?.toLowerCase()?.trim();
        if (nameFilter && Array.isArray(data)) {
          data = data.filter(item => item.name?.toLowerCase().includes(nameFilter));
        }
      }
      
      if (!data || data.length === 0) {
        showToast('No data to export. Please ensure there is data available.', 'warning');
        return;
      }
      
      // Export single section
      if (format === 'pdf') {
        result = await exportDashboardToPDF(data, reportType, filters);
      } else if (format === 'csv') {
        result = exportDashboardToCSV(data, reportType, filters);
      }
    }
    
    if (result?.success) {
      showToast(`${format.toUpperCase()} exported successfully: ${result.filename}`, 'success');
    }
  } catch (error) {
    console.error('Export error:', error);
    showToast(`Failed to export ${format.toUpperCase()}: ${error.message}`, 'error');
  } finally {
    // Reset button state
    if (btn) {
      btn.classList.remove('loading');
      const icon = btn.querySelector('i:first-child');
      if (icon) icon.className = 'fas fa-download';
    }
  }
}

// ====== Event Handlers ======
function setupEventHandlers() {
  // Initialize Filter Control Panel (collapse/expand)
  FilterControlPanel.init('filterPanelCollapseBtn', 'filterPanelBody');
  
  // Setup custom dropdown close handler
  setupDropdownCloseHandler();
  
  // Setup export dropdown handlers
  setupExportDropdowns();
  
  // Toggle view buttons
  const toggleRealtimeBtn = $("#toggleRealtimeView");
  const togglePunctualityBtn = $("#togglePunctualityView");
  const toggleLunchtimeBtn = $("#toggleLunchtimeView");
  
  if (toggleRealtimeBtn) {
    toggleRealtimeBtn.addEventListener("click", toggleRealtimeView);
  }
  
  if (togglePunctualityBtn) {
    togglePunctualityBtn.addEventListener("click", togglePunctualityView);
  }
  
  if (toggleLunchtimeBtn) {
    toggleLunchtimeBtn.addEventListener("click", toggleLunchtimeView);
  }
  
  // Realtime list tabs
  const realtimeListTabs = $$('#realtimeListView .list-tab');
  realtimeListTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      realtimeListTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabType = tab.dataset.tab;
      state.activeListTabs.realtime = tabType;
      loadRealtimeDetails(tabType);
    });
  });
  
  // Punctuality list tabs
  const punctualityListTabs = $$('#punctualityListView .list-tab');
  punctualityListTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      punctualityListTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const metricType = tab.dataset.tab;
      state.activeListTabs.punctuality = metricType;
      loadPunctualityDetails(metricType);
    });
  });
  
  // Global date preset buttons
  const presetBtns = $$('.date-preset-buttons .preset-btn');
  const globalFromDate = $("#globalFromDate");
  const globalToDate = $("#globalToDate");
  
  console.log('[Dashboard] Found', presetBtns.length, 'preset buttons');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      console.log('[Dashboard] Preset button clicked:', btn.dataset.preset);
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.globalFilters.preset = btn.dataset.preset;
      
      // Update the date input fields to show the calculated range
      const { fromDate, toDate } = getDateRangeForPreset(btn.dataset.preset);
      if (globalFromDate) globalFromDate.value = fromDate;
      if (globalToDate) globalToDate.value = toDate;
      
      // Also store in state for consistency
      state.globalFilters.fromDate = fromDate;
      state.globalFilters.toDate = toDate;
      
      // Realtime list view now supports date range
      if (state.views.realtime === 'list') {
        loadRealtimeDetails(state.activeListTabs.realtime);
      }
      
      // Immediately apply the new date range to punctuality and lunchtime
      loadPunctualityMetrics();
      if (state.views.punctuality === 'list') {
        loadPunctualityDetails(state.activeListTabs.punctuality);
      }
      loadLunchtimeData();
    });
  });
  
  // Custom date inputs
  
  if (globalFromDate) {
    globalFromDate.addEventListener("change", () => {
      // Switch to custom preset when using date inputs
      presetBtns.forEach(b => b.classList.remove('active'));
      state.globalFilters.preset = 'custom';
      state.globalFilters.fromDate = globalFromDate.value;
    });
  }
  
  if (globalToDate) {
    globalToDate.addEventListener("change", () => {
      // Switch to custom preset when using date inputs
      presetBtns.forEach(b => b.classList.remove('active'));
      state.globalFilters.preset = 'custom';
      state.globalFilters.toDate = globalToDate.value;
    });
  }
  
  // Clickable stat cards - Realtime
  const realtimeCards = $$('#realtimeStatsView .stat-card.clickable');
  realtimeCards.forEach(card => {
    card.addEventListener('click', () => {
      const statusType = card.dataset.status;
      state.activeListTabs.realtime = statusType;
      // Switch to list view and show this tab
      const tabs = $$('#realtimeListView .list-tab');
      tabs.forEach(t => t.classList.remove('active'));
      const targetTab = document.querySelector(`#realtimeListView .list-tab[data-tab="${statusType}"]`);
      if (targetTab) targetTab.classList.add('active');
      
      if (state.views.realtime !== 'list') {
        toggleRealtimeView();
      } else {
        loadRealtimeDetails(statusType);
      }
    });
  });
  
  // Clickable stat cards - Punctuality
  const punctualityCards = $$('#punctualityStatsView .stat-card.clickable');
  punctualityCards.forEach(card => {
    card.addEventListener('click', () => {
      const metricType = card.dataset.metric;
      state.activeListTabs.punctuality = metricType;
      // Switch to list view and show this tab
      const tabs = $$('#punctualityListView .list-tab');
      tabs.forEach(t => t.classList.remove('active'));
      const targetTab = document.querySelector(`#punctualityListView .list-tab[data-tab="${metricType}"]`);
      if (targetTab) targetTab.classList.add('active');
      
      if (state.views.punctuality !== 'list') {
        togglePunctualityView();
      } else {
        loadPunctualityDetails(metricType);
      }
    });
  });
  
  // Global filter buttons
  const applyFiltersBtn = $("#applyGlobalFiltersBtn");
  const clearFiltersBtn = $("#clearGlobalFiltersBtn");
  const nameFilter = $("#globalNameFilter");
  
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener("click", applyGlobalFilters);
  }
  
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", clearGlobalFilters);
  }
  
  // Note: Location filter is now a custom dropdown - changes handled by selectLocationOption()
  
  // Debounced name search
  if (nameFilter) {
    let debounceTimeout;
    nameFilter.addEventListener("input", () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        if (nameFilter.value.length >= 2 || nameFilter.value.length === 0) {
          console.log('[Dashboard] Name filter changed to:', nameFilter.value);
          state.globalFilters.nameSearch = nameFilter.value.trim();
          
          // Name filter affects realtime list view only (not grid view stats)
          // Real-time status cards always show all employees, only list view filters by name
          if (state.views.realtime === 'list') {
            // Client-side filtering for realtime list (data already loaded)
            displayRealtimeListView(state.realtimeDetails[state.activeListTabs.realtime], state.activeListTabs.realtime);
          }
          
          // Name filter affects punctuality - both cards and list views
          // Both use server-side filtering, so need to reload data
          if (state.views.punctuality === 'stats') {
            loadPunctualityMetrics();
          } else {
            loadPunctualityDetails(state.activeListTabs.punctuality);
          }
          
          // Name search affects lunchtime data - check which view is active
          if (state.views.lunchtime === 'list') {
            loadLunchtimeData();
          } else {
            loadLunchtimeTodayCards();
          }
        }
      }, 300);
    });
  }
}

// ====== Main Init Function ======
export async function init() {
  // Check if tables exist
  try {
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
  }
  
  setDefaultDates();
  setupEventHandlers();
  
  // Load locations
  try {
    await loadLocations();
  } catch (error) {
    console.error('Failed to load locations:', error);
  }
  
  // Load all dashboard data in parallel
  try {
    await Promise.all([
      loadRealtimeStatus(),
      loadPunctualityMetrics(),
      loadLunchtimeTodayCards() // Load cards view by default (today's data)
    ]);
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
  }
}

// Export for external use
export { loadLunchtimeData, applyGlobalFilters, clearGlobalFilters };

