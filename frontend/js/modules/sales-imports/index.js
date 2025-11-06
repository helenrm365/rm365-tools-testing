// js/modules/sales-imports/index.js
import { get } from '../../services/api/http.js';

let currentModule = null;

export async function init(path) {
  console.log('[Sales Imports] Initializing module for path:', path);
  
  // Route to appropriate module based on path
  if (path === '/sales-imports/uk-sales') {
    currentModule = await import('./ukSales.js');
    await currentModule.init();
  } else if (path === '/sales-imports/fr-sales') {
    currentModule = await import('./frSales.js');
    await currentModule.init();
  } else if (path === '/sales-imports/nl-sales') {
    currentModule = await import('./nlSales.js');
    await currentModule.init();
  } else if (path === '/sales-imports/history') {
    currentModule = await import('./history.js');
    await currentModule.init();
  } else if (path === '/sales-imports' || path === '/sales-imports/home') {
    // Home page is static HTML - just initialize tables
    await initializeTables();
    // No module needed - home.html is just navigation buttons
    currentModule = null;
  }
}

async function initializeTables() {
  try {
    console.log('[Sales Imports] Checking and initializing tables...');
    const result = await get('/api/v1/sales-imports/initialize');
    
    if (result.status === 'success') {
      console.log('[Sales Imports] Tables initialized:', result.message);
      if (result.created_tables && result.created_tables.length > 0) {
        console.log('[Sales Imports] Created tables:', result.created_tables);
      }
    } else {
      console.error('[Sales Imports] Failed to initialize tables:', result.message);
    }
  } catch (error) {
    console.error('[Sales Imports] Error initializing tables:', error);
  }
}

export async function cleanup() {
  console.log('[Sales Imports] Cleaning up module');
  if (currentModule && currentModule.cleanup) {
    currentModule.cleanup();
  }
  currentModule = null;
}
