// frontend/js/debug/bulkDeleteTest.js
/**
 * Debug utility to test bulk delete functionality
 * Use this in browser console to test bulk delete without UI
 */

import { bulkDeleteEmployees } from '../services/api/enrollmentApi.js';

// Add to window for console access
window.testBulkDelete = async function(ids = []) {
  if (!ids.length) {
    // You can add some test IDs here if needed
    return;
  }
  
  try {
    const result = await bulkDeleteEmployees(ids);
    return result;
  } catch (error) {
    console.error('🧪 [Test] ❌ Error:', error);
    console.error('🧪 [Test] Error details:', {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
};

// Also add a function to get all employee IDs for testing
window.getAllEmployeeIds = async function() {
  try {
    const { getEmployees } = await import('../services/api/enrollmentApi.js');
    const employees = await getEmployees();
    const ids = employees.map(emp => emp.id);
    return ids;
  } catch (error) {
    console.error('👥 [Test] Failed to get employee IDs:', error);
    throw error;
  }
};
console.log('  - testBulkDelete([1, 2, 3]) - Test bulk delete with specific IDs');
console.log('  - getAllEmployeeIds() - Get all employee IDs for testing');