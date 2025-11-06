// js/modules/attendance/overview.js - Comprehensive attendance overview with charts
import { 
  getDailyStats, 
  getWeeklyChart, 
  getWorkHours, 
  getSummary,
  getEmployeesWithStatus,
  getLocations 
} from '../../services/api/attendanceApi.js';

// ====== State Management ======
let state = {
  dailyStats: {},
  summaryData: [],
  chartData: [],
  workHoursData: [],
  currentChart: null,
  locations: [],
  filters: {
    location: '',
    nameSearch: ''
  }
};

// ====== Utility Functions ======
function $(sel) { return document.querySelector(sel); }

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

function setDateDefaults() {
  const fromEl = $("#fromDate");
  const toEl = $("#toDate");
  
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  
  if (fromEl) fromEl.value = weekAgo.toISOString().slice(0, 10);
  if (toEl) toEl.value = today.toISOString().slice(0, 10);
}

// ====== API Functions ======
async function fetchDailyStats(location = null, nameSearch = null) {
  try {
    return await getDailyStats(location, nameSearch);
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return {
      total_employees: 0,
      checked_in: 0,
      checked_out: 0,
      absent: 0
    };
  }
}

async function fetchWeeklyChart(fromDate, toDate, location = null, nameSearch = null) {
  try {
    const result = await getWeeklyChart(fromDate, toDate, location, nameSearch);
    return result;
  } catch (error) {
    console.error('❌ Error fetching weekly chart:', error);
    return [];
  }
}

async function fetchWorkHours(fromDate, toDate, location = null, nameSearch = null) {
  try {
    return await getWorkHours(fromDate, toDate, location, nameSearch);
  } catch (error) {
    console.error('Error fetching work hours:', error);
    return [];
  }
}

async function fetchSummary(fromDate, toDate, location = null, nameSearch = null) {
  try {
    return await getSummary(fromDate, toDate, location, nameSearch);
  } catch (error) {
    console.error('Error fetching summary:', error);
    return [];
  }
}

async function fetchCurrentStatus() {
  try {
    return await getEmployeesWithStatus(state.filters.location || null, state.filters.nameSearch || null);
  } catch (error) {
    console.error('Error fetching current status:', error);
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
function displayDailyStats(stats) {
  const totalEl = $("#totalEmployees");
  const checkedInEl = $("#checkedIn");
  const checkedOutEl = $("#checkedOut");
  const absentEl = $("#absentToday");
  
  if (totalEl) totalEl.textContent = stats.total_employees || 0;
  if (checkedInEl) checkedInEl.textContent = stats.checked_in || 0;
  if (checkedOutEl) checkedOutEl.textContent = stats.checked_out || 0;
  if (absentEl) absentEl.textContent = stats.absent || 0;
}

function createWeeklyAttendanceChart(chartData) {
  const canvas = $("#attendanceChart");
  if (!canvas) {
    console.error("❌ Chart canvas not found with ID 'attendanceChart'");
    return;
  }

  // Force hide any backdrops that might be overlaying the chart
  const allBackdrops = document.querySelectorAll('.dropdown-backdrop');
  allBackdrops.forEach(bd => {
    if (bd.style.display !== 'none' || bd.classList.contains('show')) {
      bd.style.display = 'none';
      bd.classList.remove('show');
    }
  });

  // Destroy existing chart
  if (state.currentChart) {
    try {
      state.currentChart.destroy();
    } catch (e) {
      console.warn("⚠️ Error destroying chart:", e);
    }
    state.currentChart = null;
  }

  if (!chartData || chartData.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '16px Sora, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('No attendance data available for the selected period', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Function to actually create the chart
  function doCreateChart() {
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
      console.error('❌ Chart.js is not loaded');
      const ctx = canvas.getContext('2d');
      ctx.font = '16px Sora, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(220, 53, 69, 0.8)';
      ctx.textAlign = 'center';
      ctx.fillText('Chart.js library not loaded', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Ensure Chart is properly initialized
    if (!Chart.defaults) {
      console.error('❌ Chart.js not properly initialized');
      return;
    }

    // Ensure canvas has proper dimensions
    const canvasContainer = canvas.parentElement;
    const containerRect = canvasContainer.getBoundingClientRect();
    
    // Force canvas resize if needed
    if (containerRect.width > 0 && containerRect.height > 0) {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }

    // Process data for chart
    const employees = [...new Set(chartData.map(d => d.employee))];
    const dates = [...new Set(chartData.map(d => d.date))].sort();
    
    if (employees.length === 0 || dates.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '16px Sora, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.textAlign = 'center';
      ctx.fillText('No valid attendance data found', canvas.width / 2, canvas.height / 2);
      return;
    }
    
    const datasets = employees.map((employee, index) => {
      const employeeData = dates.map(date => {
        const dayData = chartData.find(d => d.employee === employee && d.date === date);
        return dayData ? dayData.daily_logs : 0;
      });
      
      // Modern UI color palette - subtle, professional colors
      const colorPalette = [
        { primary: 'rgba(59, 130, 246, 0.8)', background: 'rgba(59, 130, 246, 0.1)' },   // Blue
        { primary: 'rgba(16, 185, 129, 0.8)', background: 'rgba(16, 185, 129, 0.1)' },   // Emerald
        { primary: 'rgba(245, 158, 11, 0.8)', background: 'rgba(245, 158, 11, 0.1)' },   // Amber
        { primary: 'rgba(139, 92, 246, 0.8)', background: 'rgba(139, 92, 246, 0.1)' },   // Violet
        { primary: 'rgba(236, 72, 153, 0.8)', background: 'rgba(236, 72, 153, 0.1)' },   // Pink
        { primary: 'rgba(6, 182, 212, 0.8)', background: 'rgba(6, 182, 212, 0.1)' },     // Cyan
        { primary: 'rgba(34, 197, 94, 0.8)', background: 'rgba(34, 197, 94, 0.1)' },     // Green
        { primary: 'rgba(251, 146, 60, 0.8)', background: 'rgba(251, 146, 60, 0.1)' }    // Orange
      ];
      
      const colors = colorPalette[index % colorPalette.length];
      
      return {
        label: employee,
        data: employeeData,
        backgroundColor: colors.background,
        borderColor: colors.primary,
        borderWidth: 2,
        fill: false,
        tension: 0.3,
        pointBackgroundColor: colors.primary,
        pointBorderColor: colors.primary,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    });
    
    try {
      const ctx = canvas.getContext('2d');
      
      // Clear canvas before creating new chart
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      state.currentChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dates.map(date => {
            const d = new Date(date);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          backgroundColor: 'transparent',
          plugins: {
            title: {
              display: true,
              text: 'Weekly Attendance by Employee',
              font: { 
                size: 16, 
                weight: '600',
                family: 'Sora, system-ui, sans-serif'
              },
              color: 'rgba(255, 255, 255, 0.9)',
              padding: { bottom: 20 }
            },
            legend: {
              display: true,
              position: 'top',
              align: 'start',
              labels: {
                color: 'rgba(255, 255, 255, 0.8)',
                font: {
                  family: 'Sora, system-ui, sans-serif',
                  size: 12,
                  weight: '500'
                },
                padding: 16,
                usePointStyle: true,
                pointStyle: 'circle'
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              titleColor: 'rgba(255, 255, 255, 0.9)',
              bodyColor: 'rgba(255, 255, 255, 0.8)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              borderWidth: 1,
              cornerRadius: 8,
              titleFont: {
                family: 'Sora, system-ui, sans-serif',
                weight: '600'
              },
              bodyFont: {
                family: 'Sora, system-ui, sans-serif'
              },
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${context.parsed.y} logs`;
                }
              }
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: 'Date',
                color: 'rgba(255, 255, 255, 0.7)',
                font: {
                  family: 'Sora, system-ui, sans-serif',
                  size: 12,
                  weight: '500'
                }
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.6)',
                font: {
                  family: 'Sora, system-ui, sans-serif',
                  size: 11
                }
              },
              grid: {
                color: 'rgba(255, 255, 255, 0.1)',
                lineWidth: 1
              },
              border: {
                color: 'rgba(255, 255, 255, 0.2)'
              }
            },
            y: {
              title: {
                display: true,
                text: 'Number of Logs',
                color: 'rgba(255, 255, 255, 0.7)',
                font: {
                  family: 'Sora, system-ui, sans-serif',
                  size: 12,
                  weight: '500'
                }
              },
              beginAtZero: true,
              ticks: {
                stepSize: 1,
                color: 'rgba(255, 255, 255, 0.6)',
                font: {
                  family: 'Sora, system-ui, sans-serif',
                  size: 11
                }
              },
              grid: {
                color: 'rgba(255, 255, 255, 0.1)',
                lineWidth: 1
              },
              border: {
                color: 'rgba(255, 255, 255, 0.2)'
              }
            }
          },
          interaction: {
            intersect: false,
            mode: 'index'
          },
          elements: {
            point: {
              hoverBorderWidth: 3
            },
            line: {
              borderCapStyle: 'round',
              borderJoinStyle: 'round'
            }
          }
        }
      });
      
      // Make chart visible
      canvas.classList.add('visible');
      canvas.style.opacity = '1';
      
    } catch (error) {
      console.error('❌ Failed to create chart:', error);
      const ctx = canvas.getContext('2d');
      ctx.font = '16px Sora, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(220, 53, 69, 0.8)';
      ctx.textAlign = 'center';
      ctx.fillText('Failed to create chart: ' + error.message, canvas.width / 2, canvas.height / 2);
    }
  }

  // Try to create chart, with retry if Chart.js not ready
  if (typeof Chart === 'undefined') {
    let retries = 0;
    const maxRetries = 10;
    const checkChart = () => {
      if (typeof Chart !== 'undefined') {
        doCreateChart();
      } else if (retries < maxRetries) {
        retries++;
        setTimeout(checkChart, 100);
      } else {
        console.error('❌ Chart.js failed to load after maximum retries');
        const ctx = canvas.getContext('2d');
        ctx.font = '16px Sora, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(220, 53, 69, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText('Chart.js failed to load', canvas.width / 2, canvas.height / 2);
      }
    };
    checkChart();
  } else {
    doCreateChart();
  }
}

function displaySummaryTable(summaryData) {
  const resultsEl = $("#summaryResults");
  if (!resultsEl) return;

  if (!summaryData || summaryData.length === 0) {
    resultsEl.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">No data found for the selected period.</p>';
    resultsEl.style.display = 'block';
    return;
  }

  const table = `
    <h4>📋 Summary Report</h4>
    <table class="modern-table" style="width: 100%; margin-top: 1rem;">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Total Logs</th>
          <th>Activity Level</th>
        </tr>
      </thead>
      <tbody>
        ${summaryData.map(item => {
          const activityLevel = item.count >= 10 ? 'High' : item.count >= 5 ? 'Medium' : 'Low';
          const levelClass = item.count >= 10 ? 'status-in' : item.count >= 5 ? 'status-warning' : 'status-out';
          
          return `
            <tr>
              <td>${item.name}</td>
              <td>${item.count}</td>
              <td><span class="status-badge ${levelClass}">${activityLevel}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top: 1rem; font-size: 0.9em; color: #666;">
      <strong>Total Logs:</strong> ${summaryData.reduce((sum, item) => sum + item.count, 0)} | 
      <strong>Active Employees:</strong> ${summaryData.length}
    </div>
  `;

  resultsEl.innerHTML = table;
  resultsEl.style.display = 'block';
}

function displayWorkHoursTable(workHoursData) {
  const workHoursEl = $("#workHoursResults");
  if (!workHoursEl) {
    const summaryEl = $("#summaryResults");
    if (summaryEl) {
      const workHoursContainer = document.createElement('div');
      workHoursContainer.id = 'workHoursResults';
      workHoursContainer.className = 'modern-box';
      workHoursContainer.style.marginTop = '2rem';
      summaryEl.parentNode.insertBefore(workHoursContainer, summaryEl.nextSibling);
    } else {
      return;
    }
  }

  const workHoursContainer = $("#workHoursResults");
  if (!workHoursData || workHoursData.length === 0) {
    workHoursContainer.innerHTML = '<h4>⏰ Work Hours</h4><p style="color: #666;">No complete work days found (missing clock in/out pairs).</p>';
    workHoursContainer.style.display = 'block';
    return;
  }

  // Group by employee
  const employeeHours = {};
  workHoursData.forEach(item => {
    if (!employeeHours[item.employee]) {
      employeeHours[item.employee] = [];
    }
    employeeHours[item.employee].push(item);
  });

  const table = `
    <h4>⏰ Work Hours Analysis</h4>
    <table class="modern-table" style="width: 100%; margin-top: 1rem;">
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
    <div style="margin-top: 1rem; font-size: 0.9em; color: #666;">
      <strong>Total Work Days:</strong> ${workHoursData.length} | 
      <strong>Average Hours per Day:</strong> ${formatHoursToHM(workHoursData.reduce((sum, item) => sum + item.hours_worked, 0) / workHoursData.length)} |
      <strong>Average Lunch Time:</strong> ${(() => {
        const lunchData = workHoursData.filter(item => item.lunch_hours !== null);
        return lunchData.length > 0 ? 
          formatHoursToHM(lunchData.reduce((sum, item) => sum + item.lunch_hours, 0) / lunchData.length) : 
          'N/A';
      })()}
    </div>
  `;

  workHoursContainer.innerHTML = table;
  workHoursContainer.style.display = 'block';
}

function displayCurrentStatus(employees) {
  const statusEl = $("#currentStatusTable");
  if (!statusEl) return;

  if (!employees || employees.length === 0) {
    statusEl.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">No employee data available.</p>';
    return;
  }

  const table = `
    <table class="modern-table" style="width: 100%; margin-top: 1rem;">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Location</th>
          <th>Card UID</th>
          <th>Current Status</th>
          <th>Last Activity</th>
        </tr>
      </thead>
      <tbody>
        ${employees.map(emp => {
          const status = emp.status || 'unknown';
          const statusClass = status === 'in' ? 'status-in' : 
                             status === 'out' ? 'status-out' : 'status-unknown';
          const statusDisplay = status === 'in' ? 'IN' : 
                               status === 'out' ? 'OUT' : 'UNKNOWN';
          
          // Handle different possible date formats for last_activity
          let lastActivity = 'Never';
          if (emp.last_activity) {
            if (typeof emp.last_activity === 'string') {
              lastActivity = emp.last_activity;
            } else if (emp.last_activity instanceof Date) {
              lastActivity = emp.last_activity.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit' 
              });
            }
          } else if (emp.log_time) {
            // Fallback to log_time if last_activity is not available
            if (typeof emp.log_time === 'string') {
              lastActivity = new Date(emp.log_time).toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit' 
              });
            }
          }
          
          return `
            <tr>
              <td>${emp.name || 'Unknown'}</td>
              <td><span class="status-badge secondary">${emp.location || 'N/A'}</span></td>
              <td><code>${emp.card_uid || 'N/A'}</code></td>
              <td><span class="status-badge ${statusClass}">${statusDisplay}</span></td>
              <td>${lastActivity}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top: 1rem; font-size: 0.9em; color: #666;">
      <strong>Total Employees:</strong> ${employees.length} | 
      <strong>Currently In:</strong> ${employees.filter(e => e.status === 'in').length} |
      <strong>Currently Out:</strong> ${employees.filter(e => e.status === 'out').length}
    </div>
  `;

  statusEl.innerHTML = table;
}

// ====== Main Functions ======
async function loadDailyStats() {
  try {
    const stats = await fetchDailyStats();
    state.dailyStats = stats;
    displayDailyStats(stats);
  } catch (error) {
    console.error('Failed to load daily stats:', error);
  }
}

async function loadCurrentStatus() {
  try {
    const employees = await fetchCurrentStatus();
    displayCurrentStatus(employees);
  } catch (error) {
    console.error('Failed to load current status:', error);
    const statusEl = $("#currentStatusTable");
    if (statusEl) {
      statusEl.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 2rem;">Failed to load employee status. Please try again.</p>';
    }
  }
}

async function loadLocations() {
  try {
    const locations = await fetchLocations();
    state.locations = locations;
    populateLocationFilter();
  } catch (error) {
    console.error('Failed to load locations:', error);
  }
}

function populateLocationFilter() {
  const locationFilter = $("#locationFilter");
  if (!locationFilter) return;
  
  // Clear existing options (except "All Locations")
  locationFilter.innerHTML = '<option value="">All Locations</option>';
  
  // Add location options
  state.locations.forEach(location => {
    const option = document.createElement('option');
    option.value = location;
    option.textContent = location;
    locationFilter.appendChild(option);
  });
  
  // Reinitialize c-select for the updated dropdown
  if (window.initCSelects) {
    console.log('📍 Reinitializing location dropdown c-select system');
    
    // Remove the existing c-select wrapper if it exists
    const existingWrapper = locationFilter.closest('.c-select');
    if (existingWrapper) {
      console.log('🔄 Removing existing c-select wrapper');
      const parent = existingWrapper.parentNode;
      const nextSibling = existingWrapper.nextSibling;
      parent.insertBefore(locationFilter, nextSibling);
      existingWrapper.remove();
      locationFilter.style.display = '';
      locationFilter.classList.remove('select-hidden');
      delete locationFilter.dataset.enhanced;
    }
    
    // Re-enhance the select element
    console.log('✨ Re-enhancing location dropdown');
    window.initCSelects(locationFilter.parentElement);
    
    // Verify the enhancement worked
    const newWrapper = locationFilter.closest('.c-select');
    if (newWrapper) {
      console.log('✅ Location dropdown successfully enhanced');
    } else {
      console.warn('⚠️ Location dropdown enhancement may have failed');
    }
  } else {
    console.warn('⚠️ initCSelects not available for location dropdown');
  }
}

function applyFilters() {
  const locationFilter = $("#locationFilter");
  const nameFilter = $("#nameFilter");
  
  state.filters.location = locationFilter?.value || '';
  state.filters.nameSearch = nameFilter?.value?.trim() || '';
  
  console.log('Applying unified filters:', state.filters);
  
  // Reload ALL data with filters
  loadAllData();
}

function clearFilters() {
  const locationFilter = $("#locationFilter");
  const nameFilter = $("#nameFilter");
  
  if (locationFilter) locationFilter.value = '';
  if (nameFilter) nameFilter.value = '';
  
  state.filters.location = '';
  state.filters.nameSearch = '';
  
  console.log('All filters cleared');
  
  // Reload ALL data without filters
  loadAllData();
}

async function loadAllData() {
  const fromDate = $("#fromDate")?.value;
  const toDate = $("#toDate")?.value;

  if (!fromDate || !toDate) {
    console.log("Missing date range, skipping data load");
    return;
  }

  try {
    // Show loading state
    const btn = $("#applyFiltersBtn");
    const originalText = btn?.textContent;
    if (btn) btn.textContent = "🔄 Loading...";

    const location = state.filters.location || null;
    const nameSearch = state.filters.nameSearch || null;

    // Fetch data with better error handling - don't let one failure block others
    const results = await Promise.allSettled([
      fetchDailyStats(location, nameSearch),
      fetchSummary(fromDate, toDate, location, nameSearch),
      fetchWeeklyChart(fromDate, toDate, location, nameSearch),
      fetchWorkHours(fromDate, toDate, location, nameSearch),
      fetchCurrentStatus()
    ]);

    // Extract results, using fallbacks for failed requests
    const [dailyStats, summaryData, chartData, workHoursData, currentStatus] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.warn(`Failed to fetch data for request ${index}:`, result.reason);
        // Return appropriate fallbacks
        switch (index) {
          case 0: return { total_employees: 0, checked_in: 0, checked_out: 0, absent: 0 };
          case 1: case 2: case 3: case 4: return [];
          default: return [];
        }
      }
    });

    // Store in state
    state.dailyStats = dailyStats;
    state.summaryData = summaryData;
    state.chartData = chartData;
    state.workHoursData = workHoursData;

    // Display all results (charts last to ensure DOM is ready)
    displayDailyStats(dailyStats);
    displaySummaryTable(summaryData);
    displayWorkHoursTable(workHoursData);
    displayCurrentStatus(currentStatus);
    
    setTimeout(() => {
      createWeeklyAttendanceChart(chartData);
    }, 100);

    // Restore button
    if (btn && originalText) btn.textContent = originalText;

  } catch (error) {
    console.error('Failed to load data:', error);
    // Don't show alert, just log the error
    const btn = $("#applyFiltersBtn");
    if (btn) btn.textContent = "Apply Filters";
  }
}

// ====== Event Handlers ======
function setupEventHandlers() {
  // Filter event handlers
  const applyFiltersBtn = $("#applyFiltersBtn");
  const clearFiltersBtn = $("#clearFiltersBtn");
  const nameFilter = $("#nameFilter");
  const locationFilter = $("#locationFilter");
  
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener("click", applyFilters);
  }
  
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", clearFilters);
  }
  
  // Auto-apply filters when name filter changes (with debounce)
  if (nameFilter) {
    let debounceTimeout;
    nameFilter.addEventListener("input", () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        if (nameFilter.value.length >= 2 || nameFilter.value.length === 0) {
          applyFilters();
        }
      }, 300);
    });
  }

  // Auto-apply filters when location changes
  if (locationFilter) {
    locationFilter.addEventListener("change", applyFilters);
  }

  // Auto-reload on date change
  const fromDate = $("#fromDate");
  const toDate = $("#toDate");
  
  if (fromDate) {
    fromDate.addEventListener("change", () => {
      if (fromDate.value && toDate?.value) {
        loadAllData();
      }
    });
  }
  
  if (toDate) {
    toDate.addEventListener("change", () => {
      if (fromDate?.value && toDate.value) {
        loadAllData();
      }
    });
  }
}

// ====== Main Init Function ======
export async function init() {
  // Ensure global dropdown backdrop exists and is hidden (only for attendance page)
  let backdrop = document.getElementById('globalDropdownBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'globalDropdownBackdrop';
    backdrop.className = 'dropdown-backdrop';
    backdrop.style.display = 'none';
    document.body.appendChild(backdrop);
  }
  
  // Force hide any active backdrops to prevent chart overlay issues (attendance page only)
  const allBackdrops = document.querySelectorAll('.dropdown-backdrop');
  allBackdrops.forEach(bd => {
    bd.style.display = 'none';
    bd.classList.remove('show');
  });
  
  setDateDefaults();
  
  setupEventHandlers();
  
  // Load locations first
  try {
    await loadLocations();
  } catch (error) {
    console.error('Failed to load locations:', error);
    showErrorMessage('Failed to load locations. Please check your connection and try again.');
  }
  
  // Load all data with the unified system
  try {
    await loadAllData();
  } catch (error) {
    console.error('Failed to load attendance data:', error);
    showErrorMessage('Failed to load attendance data. Please check your connection and try again.');
  }
}

function showErrorMessage(message) {
  const view = document.querySelector('#view');
  if (!view) return;
  
  // Only show error if the page is mostly empty (to avoid overwriting partial data)
  const dailyStatsCard = view.querySelector('.daily-stats-card');
  if (!dailyStatsCard || dailyStatsCard.children.length === 0) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'padding: 2rem; text-align: center; color: #dc3545; background: rgba(220, 53, 69, 0.1); border-radius: 8px; margin: 1rem;';
    errorDiv.innerHTML = `
      <h3 style="margin-top: 0;">⚠️ Unable to Load Data</h3>
      <p>${message}</p>
      <button class="modern-button" onclick="window.location.reload()" style="margin-top: 1rem;">
        🔄 Retry
      </button>
    `;
    view.insertBefore(errorDiv, view.firstChild);
  }
}

// Export for external use
export { loadAllData, applyFilters, clearFilters };
