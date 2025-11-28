// Debug utility to test API calls
import { get } from '../services/api/http.js';
import { getToken } from '../services/state/sessionStore.js';

export function testAllAPIs() {
  console.log('Current auth token:', getToken() ? 'Present' : 'Missing');
  
  const tests = [
    { name: 'Daily Stats', endpoint: '/api/v1/attendance/daily-stats' },
    { name: 'Employee Status', endpoint: '/api/v1/attendance/employees/status' },
    { 
      name: 'Summary', 
      endpoint: '/api/v1/attendance/summary?from_date=2025-08-29&to_date=2025-09-05' 
    },
    { 
      name: 'Weekly Chart', 
      endpoint: '/api/v1/attendance/weekly-chart?from_date=2025-08-29&to_date=2025-09-05' 
    },
    { 
      name: 'Work Hours', 
      endpoint: '/api/v1/attendance/work-hours?from_date=2025-08-29&to_date=2025-09-05' 
    }
  ];
  
  tests.forEach(async (test, index) => {
    setTimeout(async () => {
      try {
        const result = await get(test.endpoint);
      } catch (error) {
        console.error(`❌ ${test.name}:`, error.message);
      }
    }, index * 1000); // Stagger requests by 1 second
  });
}

// Make it available globally for testing
window.testAllAPIs = testAllAPIs;
