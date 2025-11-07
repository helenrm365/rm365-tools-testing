// js/modules/attendance/manualClocking.js
import { getEmployees, getEmployeesWithStatus, clockEmployee } from '../../services/api/attendanceApi.js';

let state = {
  employees: [],
  selectedEmployee: null
};

function $(sel) { return document.querySelector(sel); }

async function loadEmployees() {
  try {
    state.employees = await getEmployeesWithStatus();
    fillEmployeeSelect();
  } catch (e) {
    console.error('Error loading employees:', e);
    notify('❌ Failed to load employees', true);
  }
}

function fillEmployeeSelect() {
  const select = $('#employeeSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select an employee...</option>';
  
  state.employees.forEach(emp => {
    const option = document.createElement('option');
    option.value = emp.id;
    option.textContent = `${emp.name} - ${getStatusText(emp.status)}`;
    option.dataset.status = emp.status || 'unknown';
    select.appendChild(option);
  });
  
  // Reinitialize c-select for the updated dropdown
  if (window.initCSelects) {
    console.log('👤 Reinitializing employee dropdown c-select system');
    
    // Remove the existing c-select wrapper if it exists
    const existingWrapper = select.closest('.c-select');
    if (existingWrapper) {
      console.log('🔄 Removing existing c-select wrapper');
      const parent = existingWrapper.parentNode;
      const nextSibling = existingWrapper.nextSibling;
      parent.insertBefore(select, nextSibling);
      existingWrapper.remove();
      select.style.display = '';
      select.classList.remove('select-hidden');
      delete select.dataset.enhanced;
    }
    
    // Re-enhance the select element
    console.log('✨ Re-enhancing employee dropdown');
    window.initCSelects(select.parentElement);
    
    // Verify the enhancement worked
    const newWrapper = select.closest('.c-select');
    if (newWrapper) {
      console.log('✅ Employee dropdown successfully enhanced');
    } else {
      console.warn('⚠️ Employee dropdown enhancement may have failed');
    }
  } else {
    console.warn('⚠️ initCSelects not available for employee dropdown');
  }
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
  const employeeId = $('#employeeSelect').value;
  if (!employeeId) {
    notify('❌ Please select an employee', true);
    return;
  }

  const btn = $('#clockInBtn');
  btn.disabled = true;
  btn.textContent = 'Clocking In...';

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
    btn.disabled = false;
    btn.textContent = '⏰ Clock In';
  }
}

async function clockOut() {
  const employeeId = $('#employeeSelect').value;
  if (!employeeId) {
    notify('❌ Please select an employee', true);
    return;
  }

  const btn = $('#clockOutBtn');
  btn.disabled = true;
  btn.textContent = 'Clocking Out...';

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
    btn.disabled = false;
    btn.textContent = '⏰ Clock Out';
  }
}

function updateEmployeeStatus() {
  const employeeId = $('#employeeSelect').value;
  const statusDiv = $('#employeeStatus');
  const detailsDiv = $('#statusDetails');
  
  if (!employeeId) {
    statusDiv.style.display = 'none';
    return;
  }
  
  const employee = state.employees.find(emp => emp.id == employeeId);
  if (!employee) return;
  
  statusDiv.style.display = 'block';
  detailsDiv.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
      <div>
        <strong>Employee:</strong> ${employee.name}
      </div>
      <div>
        <strong>Current Status:</strong> ${getStatusText(employee.status)}
      </div>
      <div>
        <strong>Last Activity:</strong> ${employee.last_activity || 'No recent activity'}
      </div>
      <div>
        <strong>Duration:</strong> ${employee.duration || 'Not available'}
      </div>
    </div>
  `;
}

function loadRecentActivity() {
  // Placeholder for recent activity - would typically fetch from API
  const tableDiv = $('#recentActivityTable');
  tableDiv.innerHTML = `
    <table class="manual-table">
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
          <td colspan="4" style="padding: 2rem; text-align: center; color: #666;">
            Recent activity will appear here after clocking operations
          </td>
        </tr>
      </tbody>
    </table>
  `;
}

function attachEmployeeSelectListener() {
  const employeeSelect = $('#employeeSelect');
  const clockInBtn = $('#clockInBtn');
  const clockOutBtn = $('#clockOutBtn');

  if (employeeSelect && !employeeSelect._listenerAttached) {
    employeeSelect.addEventListener('change', () => {
      console.log('👤 Employee selection changed:', employeeSelect.value);
      const hasSelection = employeeSelect.value !== '';
      if (clockInBtn) clockInBtn.disabled = !hasSelection;
      if (clockOutBtn) clockOutBtn.disabled = !hasSelection;
      updateEmployeeStatus();
    });
    
    employeeSelect._listenerAttached = true;
    console.log('🔗 Employee select listener attached');
  }
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
  
  // Attach employee select listener
  attachEmployeeSelectListener();
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
  console.log("👤 Initializing attendance manual clocking module");
  
  // Ensure global dropdown backdrop exists
  let backdrop = document.getElementById('globalDropdownBackdrop');
  if (!backdrop) {
    console.log('🎭 Creating global dropdown backdrop for manual page');
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
  
  console.log("✅ Attendance manual clocking module initialized");
}