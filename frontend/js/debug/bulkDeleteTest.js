// frontend/js/debug/bulkDeleteTest.js
/**
 * Debug utility to test bulk delete functionality
 * Use this in browser console to test bulk delete without UI
 */

import { bulkDeleteEmployees } from '../services/api/enrollmentApi.js';

// Add to window for console access
window.testBulkDelete = async function(ids = []) {
  console.log('🧪 [Test] Testing bulk delete with IDs:', ids);
  
  if (!ids.length) {
    console.log('🧪 [Test] No IDs provided, using test IDs. Make sure these exist in your database first!');
    // You can add some test IDs here if needed
    return;
  }
  
  try {
    console.log('🧪 [Test] Sending bulk delete request...');
    const result = await bulkDeleteEmployees(ids);
    console.log('🧪 [Test] ✅ Success! Result:', result);
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
    console.log('👥 [Test] All employee IDs:', ids);
    return ids;
  } catch (error) {
    console.error('👥 [Test] Failed to get employee IDs:', error);
    throw error;
  }
};

console.log('🧪 [Debug] Bulk delete test utilities loaded!');
console.log('🧪 [Debug] Available functions:');
console.log('  - testBulkDelete([1, 2, 3]) - Test bulk delete with specific IDs');
console.log('  - getAllEmployeeIds() - Get all employee IDs for testing');