/**
 * Global Table Sorting Utility
 * 
 * Enables client-side sorting on any table by adding the 'sortable' class to <th> elements.
 * Automatically detects data types (numbers, dates, text) and sorts accordingly.
 * 
 * Usage:
 * 1. Add 'sortable' class to any <th> you want to make sortable
 * 2. Call initializeTableSorting() after your table is rendered
 * 3. Or use data-auto-sort="true" on the table to enable automatic sorting
 * 
 * Example:
 *   <table data-auto-sort="true">
 *     <thead>
 *       <tr>
 *         <th class="sortable">Name</th>
 *         <th class="sortable">Price</th>
 *         <th>Actions</th> <!-- not sortable -->
 *       </tr>
 *     </thead>
 *     <tbody>
 *       <!-- rows -->
 *     </tbody>
 *   </table>
 */

class TableSorter {
  constructor() {
    this.sortState = new Map(); // Store sort direction per table+column
  }

  /**
   * Initialize sorting for all tables with data-auto-sort="true"
   */
  initializeAutoSort() {
    const autoSortTables = document.querySelectorAll('table[data-auto-sort="true"]');
    autoSortTables.forEach(table => this.enableSorting(table));
  }

  /**
   * Enable sorting on a specific table
   * @param {HTMLTableElement|string} tableOrSelector - Table element or CSS selector
   */
  enableSorting(tableOrSelector) {
    const table = typeof tableOrSelector === 'string' 
      ? document.querySelector(tableOrSelector) 
      : tableOrSelector;
    
    if (!table) {
      console.warn('Table not found:', tableOrSelector);
      return;
    }

    // Check if table is already initialized to prevent duplicate listeners
    if (table.dataset.sortingEnabled === 'true') {
      return;
    }
    table.dataset.sortingEnabled = 'true';

    // Get ALL headers to calculate correct column indices
    const allHeaders = table.querySelectorAll('thead th');
    const sortableHeaders = table.querySelectorAll('th.sortable');
    
    sortableHeaders.forEach((header) => {
      // Skip if already initialized
      if (header.dataset.sortEnabled === 'true') return;
      
      // Find the actual column index by looking through all headers
      let actualColumnIndex = -1;
      allHeaders.forEach((th, idx) => {
        if (th === header) {
          actualColumnIndex = idx;
        }
      });
      
      if (actualColumnIndex === -1) return;
      
      // Store the actual column index on the header for reference
      header.dataset.columnIndex = actualColumnIndex;
      header.dataset.sortEnabled = 'true';
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      
      // Add sort icon if not present
      if (!header.querySelector('.sort-icon')) {
        const icon = document.createElement('i');
        icon.className = 'fas fa-sort sort-icon';
        icon.style.marginLeft = '0.5rem';
        icon.style.fontSize = '0.75rem';
        icon.style.opacity = '0.5';
        header.appendChild(icon);
      }

      // Use named function to allow proper removal if needed
      const clickHandler = () => this.sortTable(table, actualColumnIndex, header);
      header.addEventListener('click', clickHandler);
      // Store handler for potential cleanup
      header._sortClickHandler = clickHandler;
    });
  }

  /**
   * Sort table by column index
   * @param {HTMLTableElement} table 
   * @param {number} columnIndex - The actual column index in the table cells
   * @param {HTMLTableCellElement} clickedHeader - The header that was clicked
   */
  sortTable(table, columnIndex, clickedHeader) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length === 0) return;

    // Get sort direction using a stable table ID
    let tableId = table.id;
    if (!tableId) {
      // Generate and store a stable ID if table doesn't have one
      if (!table.dataset.sortTableId) {
        table.dataset.sortTableId = 'table_' + Date.now();
      }
      tableId = table.dataset.sortTableId;
    }
    
    const stateKey = `${tableId}_${columnIndex}`;
    const currentSort = this.sortState.get(stateKey) || 'none';
    const newSort = currentSort === 'asc' ? 'desc' : 'asc';
    this.sortState.set(stateKey, newSort);

    // Update all header icons - reset all to neutral, then set clicked one
    const sortableHeaders = table.querySelectorAll('th.sortable');
    sortableHeaders.forEach((header) => {
      const icon = header.querySelector('.sort-icon');
      if (!icon) return;
      
      if (header === clickedHeader) {
        icon.className = newSort === 'asc' 
          ? 'fas fa-sort-up sort-icon' 
          : 'fas fa-sort-down sort-icon';
        icon.style.opacity = '1';
      } else {
        icon.className = 'fas fa-sort sort-icon';
        icon.style.opacity = '0.5';
      }
    });

    // Sort rows
    const sortedRows = this.sortRows(rows, columnIndex, newSort);

    // Re-append rows in sorted order
    sortedRows.forEach(row => tbody.appendChild(row));
  }

  /**
   * Sort array of table rows
   * @param {HTMLTableRowElement[]} rows 
   * @param {number} columnIndex 
   * @param {string} direction - 'asc' or 'desc'
   */
  sortRows(rows, columnIndex, direction) {
    return rows.sort((rowA, rowB) => {
      const cellA = rowA.cells[columnIndex];
      const cellB = rowB.cells[columnIndex];

      if (!cellA || !cellB) return 0;

      // Get cell values
      let valueA = this.getCellValue(cellA);
      let valueB = this.getCellValue(cellB);

      // Detect data type and compare
      const comparison = this.compareValues(valueA, valueB);
      
      return direction === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Extract value from table cell
   * @param {HTMLTableCellElement} cell 
   */
  getCellValue(cell) {
    // Check for data-sort-value attribute (allows custom sort values)
    if (cell.dataset.sortValue !== undefined) {
      return cell.dataset.sortValue;
    }

    // Get text content, trim whitespace
    let value = cell.textContent.trim();

    // Handle common prefixes (currency, etc.)
    value = value.replace(/^[£$€¥₹]\s*/, ''); // Remove currency symbols
    value = value.replace(/,/g, ''); // Remove thousands separators

    return value;
  }

  /**
   * Smart comparison of values (auto-detects type)
   * @param {string} a 
   * @param {string} b 
   */
  compareValues(a, b) {
    // Empty values go to bottom
    if (a === '' && b !== '') return 1;
    if (a !== '' && b === '') return -1;
    if (a === '' && b === '') return 0;

    // Try to parse as number
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }

    // Try to parse as date
    const dateA = this.parseDate(a);
    const dateB = this.parseDate(b);
    
    if (dateA && dateB) {
      return dateA - dateB;
    }

    // Default: string comparison (case-insensitive)
    return a.toLowerCase().localeCompare(b.toLowerCase());
  }

  /**
   * Attempt to parse various date formats
   * @param {string} value 
   */
  parseDate(value) {
    // Common date patterns
    const patterns = [
      /^\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}/, // DD/MM/YYYY
      /^\d{2}\/\d{2}\/\d{2}/, // DD/MM/YY
      /^\d{1,2}\s+[A-Za-z]+\s+\d{4}/, // D Month YYYY
    ];

    const matches = patterns.some(pattern => pattern.test(value));
    if (matches) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  /**
   * Disable sorting on a table
   * @param {HTMLTableElement|string} tableOrSelector 
   */
  disableSorting(tableOrSelector) {
    const table = typeof tableOrSelector === 'string' 
      ? document.querySelector(tableOrSelector) 
      : tableOrSelector;
    
    if (!table) return;

    // Remove table-level flag
    table.removeAttribute('data-sorting-enabled');

    const headers = table.querySelectorAll('th.sortable[data-sort-enabled="true"]');
    headers.forEach(header => {
      // Remove click handler if stored
      if (header._sortClickHandler) {
        header.removeEventListener('click', header._sortClickHandler);
        delete header._sortClickHandler;
      }
      
      header.removeAttribute('data-sort-enabled');
      header.style.cursor = '';
      const icon = header.querySelector('.sort-icon');
      if (icon) icon.remove();
    });
    
    // Clear sort state for this table
    const tableId = table.id || 'table_' + Math.random();
    const keysToDelete = [];
    this.sortState.forEach((value, key) => {
      if (key.startsWith(tableId + '_')) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.sortState.delete(key));
  }
}

// Create global instance
const tableSorter = new TableSorter();

/**
 * Initialize table sorting (can be called multiple times)
 * @param {HTMLTableElement|string} [tableOrSelector] - Specific table, or undefined for auto-sort tables
 */
function initializeTableSorting(tableOrSelector) {
  if (tableOrSelector) {
    tableSorter.enableSorting(tableOrSelector);
  } else {
    tableSorter.initializeAutoSort();
  }
}

/**
 * Disable sorting on a table
 * @param {HTMLTableElement|string} tableOrSelector 
 */
function disableTableSorting(tableOrSelector) {
  tableSorter.disableSorting(tableOrSelector);
}

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => tableSorter.initializeAutoSort());
} else {
  tableSorter.initializeAutoSort();
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializeTableSorting, disableTableSorting, tableSorter };
}
