// js/modules/attendance/manualClocking.js
import { getEmployees, getEmployeesWithStatus, clockEmployee } from '../../services/api/attendanceApi.js';

let state = {
  employees: [],
  selectedEmployee: null
};

function $(sel) { return document.querySelector(sel); }

// ===== Custom Dropdown Functions =====
// Exposed on window so onclick attributes in HTML can access them

window.toggleDropdown = function(id) {
  const dropdown = document.getElementById(id);
  if (!dropdown) return;
  
  // Close other dropdowns
  document.querySelectorAll('.custom-dropdown').forEach(d => {
    if (d.id !== id) d.classList.remove('open');
  });
  dropdown.classList.toggle('open');
};

window.selectOption = function(element, dropdownId, value, text) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  
  if (selectedDisplay) selectedDisplay.textContent = text;
  if (hiddenInput) hiddenInput.value = value;
  
  dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected');
  dropdown.classList.remove('open');
  
  // Handle employee selection
  if (dropdownId === 'employee-dropdown') {
    onEmployeeSelect(value);
  }
};

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-dropdown')) {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  }
});

function onEmployeeSelect(empId) {
  const clockInBtn = $('#clockInBtn');
  const clockOutBtn = $('#clockOutBtn');
  const hasSelection = empId !== '';
  
  if (clockInBtn) clockInBtn.disabled = !hasSelection;
  if (clockOutBtn) clockOutBtn.disabled = !hasSelection;
  
  if (hasSelection) {
    state.selectedEmployee = state.employees.find(emp => String(emp.id) === String(empId));
  } else {
    state.selectedEmployee = null;
  }
  
  updateEmployeeStatus();
}

async function loadEmployees() {
  try {
    state.employees = await getEmployeesWithStatus();
    fillEmployeeSelect();
  } catch (e) {
    console.error('Error loading employees:', e);
    notify('❌ Failed to load employees', true);
    // Use fallback data
    state.employees = [
      { id: 1, name: 'Sample Employee 1', employee_code: 'EMP001', status: 'out' },
      { id: 2, name: 'Sample Employee 2', employee_code: 'EMP002', status: 'in' },
      { id: 3, name: 'Sample Employee 3', employee_code: 'EMP003', status: 'unknown' }
    ];
    fillEmployeeSelect();
  }
}

function fillEmployeeSelect() {
  const dropdown = $('#employee-dropdown');
  const optionsContainer = $('#employeeDropdownOptions');
  
  if (!dropdown || !optionsContainer) {
    console.error('❌ Employee dropdown elements not found');
    return;
  }
  
  // Clear existing options
  optionsContainer.innerHTML = '';
  
  // Add placeholder option
  const placeholderOpt = document.createElement('div');
  placeholderOpt.className = 'dropdown-option selected';
  placeholderOpt.textContent = 'Select Employee...';
  placeholderOpt.onclick = function() { selectOption(this, 'employee-dropdown', '', 'Select Employee...'); };
  optionsContainer.appendChild(placeholderOpt);
  
  // Add employee options
  state.employees.forEach(emp => {
    const opt = document.createElement('div');
    opt.className = 'dropdown-option';
    opt.textContent = `${emp.name} - ${getStatusText(emp.status)}`;
    opt.onclick = function() { selectOption(this, 'employee-dropdown', String(emp.id), `${emp.name} - ${getStatusText(emp.status)}`); };
    optionsContainer.appendChild(opt);
  });
  
  // Reset selected display
  const selectedDisplay = dropdown.querySelector('.dropdown-selected');
  if (selectedDisplay) selectedDisplay.textContent = 'Select Employee...';
  
  // Reset hidden input
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');
  if (hiddenInput) hiddenInput.value = '';
}

function getStatusText(status) {
  const texts = {
    'in': '✅ Checked In',
    'out': '⏰ Checked Out',
    'unknown': '❓ Not Clocked'
  };
  return texts[status] || 'Unknown';
}

async function clockIn() {
  const employeeId = $('#employeeSelect')?.value;
  if (!employeeId) {
    notify('❌ Please select an employee', true);
    return;
  }

  const btn = $('#clockInBtn');
  const btnTitle = btn?.querySelector('.btn-title');
  if (btnTitle) btnTitle.textContent = 'Clocking In...';
  if (btn) btn.disabled = true;

  try {
    const result = await clockEmployee(parseInt(employeeId));
    
    if (result.direction === 'in') {
      notify('✅ Employee clocked in successfully');
    } else {
      notify('ℹ️ Employee was already in, toggled to out');
    }
    
    await loadEmployees();
    updateEmployeeStatus();
    loadRecentActivity();
    
  } catch (e) {
    notify('❌ ' + e.message, true);
  } finally {
    if (btnTitle) btnTitle.textContent = 'Clock In';
    if (btn) btn.disabled = false;
  }
}

async function clockOut() {
  const employeeId = $('#employeeSelect')?.value;
  if (!employeeId) {
    notify('❌ Please select an employee', true);
    return;
  }

  const btn = $('#clockOutBtn');
  const btnTitle = btn?.querySelector('.btn-title');
  if (btnTitle) btnTitle.textContent = 'Clocking Out...';
  if (btn) btn.disabled = true;

  try {
    const result = await clockEmployee(parseInt(employeeId));
    
    if (result.direction === 'out') {
      notify('✅ Employee clocked out successfully');
    } else {
      notify('ℹ️ Employee was already out, toggled to in');
    }
    
    await loadEmployees();
    updateEmployeeStatus();
    loadRecentActivity();
    
  } catch (e) {
    notify('❌ ' + e.message, true);
  } finally {
    if (btnTitle) btnTitle.textContent = 'Clock Out';
    if (btn) btn.disabled = false;
  }
}

function updateEmployeeStatus() {
  const employeeId = $('#employeeSelect')?.value;
  const statusDiv = $('#employeeStatus');
  const detailsDiv = $('#statusDetails');
  
  if (!employeeId || !statusDiv) {
    if (statusDiv) statusDiv.style.display = 'none';
    return;
  }
  
  const employee = state.employees.find(emp => String(emp.id) === String(employeeId));
  if (!employee) {
    statusDiv.style.display = 'none';
    return;
  }
  
  statusDiv.style.display = 'block';
  detailsDiv.innerHTML = `
    <div class="status-item">
      <strong>Employee</strong>
      <span>${employee.name}</span>
    </div>
    <div class="status-item">
      <strong>Current Status</strong>
      <span>${getStatusText(employee.status)}</span>
    </div>
    <div class="status-item">
      <strong>Last Activity</strong>
      <span>${employee.last_activity || 'No recent activity'}</span>
    </div>
    <div class="status-item">
      <strong>Duration</strong>
      <span>${employee.duration || 'Not available'}</span>
    </div>
  `;
}

function loadRecentActivity() {
  // Placeholder for recent activity - would typically fetch from API
  const tableDiv = $('#recentActivityTable');
  if (!tableDiv) return;
  
  tableDiv.innerHTML = `
    <div class="activity-table-wrapper">
      <table class="activity-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Employee</th>
            <th>Action</th>
            <th>Method</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="4">
              <div class="empty-state">
                <i class="fas fa-clock"></i>
                <p>Recent activity will appear here after clocking operations</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function wireControls() {
  const clockInBtn = $('#clockInBtn');
  const clockOutBtn = $('#clockOutBtn');

  // Attach button listeners
  if (clockInBtn && !clockInBtn._listenerAttached) {
    clockInBtn.addEventListener('click', clockIn);
    clockInBtn._listenerAttached = true;
  }
  
  if (clockOutBtn && !clockOutBtn._listenerAttached) {
    clockOutBtn.addEventListener('click', clockOut);
    clockOutBtn._listenerAttached = true;
  }
  
  // Custom dropdown handles selection via onclick - no need for additional listeners
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
  
  setTimeout(() => { 
    n.style.transform = 'translateY(-100px)';
    n.style.opacity = '0';
  }, 3000);
}

export async function init() {
  // Ensure global dropdown backdrop exists
  let backdrop = document.getElementById('globalDropdownBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'globalDropdownBackdrop';
    backdrop.className = 'dropdown-backdrop';
    backdrop.style.display = 'none';
    document.body.appendChild(backdrop);
  }
  
  wireControls();
  await loadEmployees();
  loadRecentActivity();
  
  // Ensure buttons are properly initialized
  const clockInBtn = $('#clockInBtn');
  const clockOutBtn = $('#clockOutBtn');
  if (clockInBtn) clockInBtn.disabled = true;
  if (clockOutBtn) clockOutBtn.disabled = true;
}