// Simple test for attendance overview without authentication
console.log('🧪 Testing attendance overview APIs without auth...');

// Test the APIs directly without auth
const API = 'https://rm365-tools-testing-production.up.railway.app';

async function testAPI(endpoint, name) {
  try {
    const response = await fetch(`${API}${endpoint}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`✅ ${name}:`, data);
    return data;
  } catch (error) {
    console.error(`❌ ${name}:`, error.message);
    return null;
  }
}

// Test all the endpoints the overview page uses
async function runTests() {
  console.log('Starting API tests...');
  
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  
  await testAPI('/api/v1/attendance/daily-stats', 'Daily Stats');
  await testAPI('/api/v1/attendance/employees/status', 'Employee Status');
  await testAPI(`/api/v1/attendance/summary?from_date=${weekAgo}&to_date=${today}`, 'Summary');
  await testAPI(`/api/v1/attendance/weekly-chart?from_date=${weekAgo}&to_date=${today}`, 'Weekly Chart');
  await testAPI(`/api/v1/attendance/work-hours?from_date=${weekAgo}&to_date=${today}`, 'Work Hours');
}

// Make it available globally
window.runAttendanceTests = runTests;

// Auto-run if in debug mode
if (window.location.search.includes('debug=true')) {
  runTests();
}
