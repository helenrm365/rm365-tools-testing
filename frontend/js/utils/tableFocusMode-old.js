/**
 * Table Focus Mode Utility
 * 
 * Enables full-screen focus mode on tables by pressing "F" key.
 * When activated, hides all UI elements except the table for distraction-free viewing.
 * 
 * Triggers:
 * - Press "F" key when page has a focusable table
 * - Press "ESC" key or click the exit button to exit focus mode
 * 
 * Detection:
 * - Tables with .table-container class
 * - Tables with data-auto-sort="true" attribute
 * - Tables with data-focusable="true" attribute
 */

class TableFocusMode {
  constructor() {
    this.isActive = false;
    this.focusedTable = null;
    this.originalStyles = new Map();
    this.overlay = null;
    this.focusContainer = null;
    this.exitButton = null;
    this.hint = null;
    
    // Elements to hide in focus mode
    this.elementsToHide = [
      '.sidebar-container',
      '.sidebar-mobile-toggle',
      '.sidebar-overlay',
      '.header',
      '#universalFooter',
      '.universal-footer',
      '.page-header',
      '.page-title',
      '.page-subtitle',
      '.header-content',
      '.nav-tabs',
      '.nui-tabs',
      '.stats-grid',
      '.action-block:not(:has(.table-container)):not(:has(table))',
      '.block-header:not(:has(.table-container)):not(:has(table))',
      '.selection-bar',
      '.data-controls-bar',
      '.summary-cards-grid',
      '.filter-controls',
      '.bulk-actions',
      '.export-actions'
    ];
    
    this.init();
  }
  
  /**
   * Initialize the focus mode functionality
   */
  init() {
    // Listen for keydown events
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    
    // Create hint element
    this.createHint();
    
    // Re-check for tables when content changes (for SPA navigation)
    this.setupMutationObserver();
    
    // Initial check
    setTimeout(() => this.updateHintVisibility(), 500);
  }
  
  /**
   * Create the focus mode hint that appears when tables are present
   */
  createHint() {
    this.hint = document.createElement('div');
    this.hint.className = 'table-focus-hint';
    this.hint.innerHTML = `
      <i class="fas fa-expand"></i>
      <span>Press <kbd>F</kbd> for Focus Mode</span>
    `;
    this.hint.style.display = 'none';
    document.body.appendChild(this.hint);
    
    // Make hint clickable to enter focus mode
    this.hint.addEventListener('click', () => this.enterFocusMode());
  }
  
  /**
   * Set up mutation observer to detect when tables are added/removed
   */
  setupMutationObserver() {
    const observer = new MutationObserver(() => {
      // Debounce the check
      clearTimeout(this._checkTimeout);
      this._checkTimeout = setTimeout(() => this.updateHintVisibility(), 300);
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  /**
   * Update hint visibility based on whether focusable tables exist
   */
  updateHintVisibility() {
    const tables = this.getFocusableTables();
    
    if (tables.length > 0 && !this.isActive) {
      this.hint.style.display = 'flex';
    } else {
      this.hint.style.display = 'none';
    }
  }
  
  /**
   * Get all focusable tables on the page
   * @returns {HTMLElement[]} Array of table containers
   */
  getFocusableTables() {
    const seenTables = new Set(); // Track tables we've already processed
    const tableMap = new Map(); // Map table element -> container
    
    // First pass: Tables in .table-container (must have an actual <table> element)
    document.querySelectorAll('.table-container').forEach(container => {
      // Skip if explicitly marked as not focusable
      if (container.dataset.focusable === 'false') return;
      
      const table = container.querySelector('table');
      if (table && !seenTables.has(table)) {
        seenTables.add(table);
        tableMap.set(table, container);
      }
    });
    
    // Second pass: Tables with data-auto-sort or data-focusable (only if not already found)
    document.querySelectorAll('table[data-auto-sort="true"], table[data-focusable="true"]').forEach(table => {
      // Skip if we've already processed this table
      if (seenTables.has(table)) return;
      
      // Skip tables that are too small or have no data rows
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length === 0) return;
      
      // Check if the only row is a loading or empty state
      if (rows.length === 1) {
        const firstRow = rows[0];
        if (firstRow.querySelector('.loading-state, .empty-state, .loading-spinner')) {
          return;
        }
      }
      
      seenTables.add(table);
      
      // Find the closest scrollable parent or use the table itself
      const container = table.closest('.table-container, .standalone-table, .table-wrapper') || table.parentElement;
      tableMap.set(table, container);
    });
    
    // Return unique containers (dedupe by container reference)
    const uniqueContainers = [...new Set(tableMap.values())];
    return uniqueContainers;
  }
  
  /**
   * Handle keyboard events
   * @param {KeyboardEvent} e 
   */
  handleKeyDown(e) {
    // Don't trigger if user is typing in an input
    const activeElement = document.activeElement;
    const isTyping = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.isContentEditable
    );
    
    if (isTyping) return;
    
    // ESC to exit focus mode
    if (e.key === 'Escape' && this.isActive) {
      e.preventDefault();
      this.exitFocusMode();
      return;
    }
    
    // F to toggle focus mode (but not Ctrl+F or Cmd+F for browser find)
    if (e.key === 'f' || e.key === 'F') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      
      const tables = this.getFocusableTables();
      if (tables.length > 0) {
        e.preventDefault();
        
        if (this.isActive) {
          this.exitFocusMode();
        } else {
          this.enterFocusMode(tables[0]);
        }
      }
    }
  }
  
  /**
   * Enter focus mode
   * @param {HTMLElement} [tableContainer] - The table container to focus
   */
  enterFocusMode(tableContainer = null) {
    // Get and store the tables array once
    this.allTables = this.getFocusableTables();
    if (this.allTables.length === 0) return;
    
    this.focusedTable = tableContainer || this.allTables[0];
    this.isActive = true;
    
    // Hide hint
    this.hint.style.display = 'none';
    
    // Add focus mode class to body
    document.body.classList.add('table-focus-mode');
    document.documentElement.classList.add('table-focus-mode');
    
    // Create overlay
    this.createOverlay();
    
    // Clone the table container into the overlay
    this.createFocusContainer();
    
    // Hide other elements
    this.hideElements();
    
    // Announce for screen readers
    this.announceForA11y('Table focus mode activated. Press Escape or F to exit.');
  }
  
  /**
   * Create the dark overlay
   */
  createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'table-focus-overlay';
    document.body.appendChild(this.overlay);
    
    // Animate in
    requestAnimationFrame(() => {
      this.overlay.classList.add('visible');
    });
  }
  
  /**
   * Create the focus container with the table
   */
  createFocusContainer() {
    try {
      this.focusContainer = document.createElement('div');
      this.focusContainer.className = 'table-focus-container';
      
      // Create exit button
      this.exitButton = document.createElement('button');
      this.exitButton.className = 'table-focus-exit';
      this.exitButton.innerHTML = `
        <i class="fas fa-times"></i>
        <span>Exit Focus Mode</span>
        <kbd>ESC</kbd>
      `;
      this.exitButton.addEventListener('click', () => this.exitFocusMode());
      
      this.focusContainer.appendChild(this.exitButton);
      
      // Find and clone filter control panel if it exists
      const filterPanelClone = this.cloneFilterPanel();
      if (filterPanelClone) {
        this.focusContainer.appendChild(filterPanelClone);
      }
      
      // Create table wrapper
      const tableWrapper = document.createElement('div');
      tableWrapper.className = 'table-focus-wrapper';
      
      // Clone just the actual table element, not the whole container
      const actualTable = this.focusedTable.querySelector('table') || this.focusedTable;
      const clonedTable = actualTable.cloneNode(true);
      clonedTable.classList.add('focused-table');
      
      // Remove max-height restrictions for full view
      clonedTable.style.maxHeight = 'none';
      
      tableWrapper.appendChild(clonedTable);
      this.focusContainer.appendChild(tableWrapper);
      
      // Set up observer to sync table content when pagination changes
      this.setupTableObserver(this.focusedTable, tableWrapper);
      
      // Find and clone associated pagination
      const paginationClone = this.clonePagination(this.focusedTable);
      if (paginationClone) {
        this.focusContainer.appendChild(paginationClone);
      }
      
      document.body.appendChild(this.focusContainer);
      
      // If there are multiple tables, add tab buttons
      if (this.allTables && this.allTables.length > 1) {
        this.createTableTabs(this.allTables, tableWrapper);
      }
      
      // Animate in
      requestAnimationFrame(() => {
        this.focusContainer.classList.add('visible');
      });
    } catch (e) {
      console.error('Error creating focus container:', e);
      this.exitFocusMode();
    }
  }
  
  /**
   * Find and clone the filter control panel if it exists on the page
   * @returns {HTMLElement|null}
   */
  cloneFilterPanel() {
    // Look for filter control panel
    const filterPanel = document.querySelector('.unified-filter-panel, .filter-control-panel');
    
    if (!filterPanel) return null;
    
    // Clone the filter panel
    const clonedPanel = filterPanel.cloneNode(true);
    clonedPanel.classList.add('focused-filter-panel');
    
    // Wire up the filter panel controls to work with the original
    this.wireFilterPanelControls(clonedPanel, filterPanel);
    
    return clonedPanel;
  }
  
  /**
   * Wire up cloned filter panel controls to trigger original filter panel
   * @param {HTMLElement} clonedPanel 
   * @param {HTMLElement} originalPanel 
   */
  wireFilterPanelControls(clonedPanel, originalPanel) {
    // Store reference to original
    clonedPanel._originalPanel = originalPanel;
    
    try {
      // Wire up the collapse button directly for the cloned panel
      const clonedCollapseBtn = clonedPanel.querySelector('.filter-panel-collapse, #filterPanelCollapseBtn');
      const clonedBody = clonedPanel.querySelector('.filter-panel-body');
      
      if (clonedCollapseBtn && clonedBody) {
        // Remove any existing onclick handlers
        clonedCollapseBtn.onclick = null;
        
        clonedCollapseBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Toggle the collapsed state on the cloned panel
          const isCollapsed = clonedBody.classList.contains('collapsed');
          
          if (isCollapsed) {
            clonedBody.classList.remove('collapsed');
            clonedCollapseBtn.classList.remove('collapsed');
          } else {
            clonedBody.classList.add('collapsed');
            clonedCollapseBtn.classList.add('collapsed');
          }
          
          // Also sync with original
          const originalCollapseBtn = originalPanel.querySelector('.filter-panel-collapse, #filterPanelCollapseBtn');
          if (originalCollapseBtn) {
            originalCollapseBtn.click();
          }
        });
      }
      
      // Wire up checkboxes
      const clonedCheckboxes = clonedPanel.querySelectorAll('input[type="checkbox"]');
      clonedCheckboxes.forEach(clonedCheckbox => {
        if (!clonedCheckbox.id) return;
        const originalCheckbox = originalPanel.querySelector(`#${clonedCheckbox.id}`);
        if (originalCheckbox) {
          clonedCheckbox.addEventListener('change', () => {
            originalCheckbox.checked = clonedCheckbox.checked;
            originalCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      });
      
      // Wire up select elements
      const clonedSelects = clonedPanel.querySelectorAll('select');
      clonedSelects.forEach(clonedSelect => {
        if (!clonedSelect.id) return;
        const originalSelect = originalPanel.querySelector(`#${clonedSelect.id}`);
        if (originalSelect) {
          clonedSelect.addEventListener('change', () => {
            originalSelect.value = clonedSelect.value;
            originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      });
      
      // Wire up other buttons (apply, etc.) - but not collapse button
      const clonedButtons = clonedPanel.querySelectorAll('button:not(.filter-panel-collapse)');
      clonedButtons.forEach(clonedButton => {
        const buttonId = clonedButton.id;
        if (buttonId && buttonId !== 'filterPanelCollapseBtn') {
          const originalButton = originalPanel.querySelector(`#${buttonId}`);
          if (originalButton) {
            clonedButton.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              originalButton.click();
              // Sync panel state after click
              setTimeout(() => this.syncFilterPanelState(clonedPanel, originalPanel), 100);
            });
          }
        }
      });
      
      // Wire up custom dropdown clicks
      const clonedDropdowns = clonedPanel.querySelectorAll('.dropdown-option');
      clonedDropdowns.forEach(clonedOption => {
        clonedOption.addEventListener('click', (e) => {
          // The onclick handler on the original will be called via event bubbling
          // But we need to sync the display state
          setTimeout(() => this.syncFilterPanelState(clonedPanel, originalPanel), 100);
        });
      });
      
      // Set up observer to sync filter panel state
      this.setupFilterPanelObserver(clonedPanel, originalPanel);
    } catch (e) {
      console.warn('Error wiring filter panel controls:', e);
    }
  }
  
  /**
   * Set up mutation observer to sync filter panel state
   * @param {HTMLElement} clonedPanel 
   * @param {HTMLElement} originalPanel 
   */
  setupFilterPanelObserver(clonedPanel, originalPanel) {
    const observer = new MutationObserver(() => {
      this.syncFilterPanelState(clonedPanel, originalPanel);
    });
    
    observer.observe(originalPanel, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    
    // Store observer for cleanup
    clonedPanel._filterPanelObserver = observer;
  }
  
  /**
   * Sync cloned filter panel state with original
   * @param {HTMLElement} clonedPanel 
   * @param {HTMLElement} originalPanel 
   */
  syncFilterPanelState(clonedPanel, originalPanel) {
    try {
      // Sync checkbox states
      const originalCheckboxes = originalPanel.querySelectorAll('input[type="checkbox"]');
      originalCheckboxes.forEach(originalCheckbox => {
        if (!originalCheckbox.id) return;
        const clonedCheckbox = clonedPanel.querySelector(`#${originalCheckbox.id}`);
        if (clonedCheckbox) {
          clonedCheckbox.checked = originalCheckbox.checked;
        }
      });
      
      // Sync collapsed/expanded state
      const originalBody = originalPanel.querySelector('.filter-panel-body');
      const clonedBody = clonedPanel.querySelector('.filter-panel-body');
      if (originalBody && clonedBody) {
        clonedBody.className = originalBody.className;
      }
      
      // Sync filter count badge
      const originalBadge = originalPanel.querySelector('.filter-count-badge');
      const clonedBadge = clonedPanel.querySelector('.filter-count-badge');
      if (originalBadge && clonedBadge) {
        clonedBadge.textContent = originalBadge.textContent;
      }
      
      // Sync dropdown selected text
      const originalSelectedTexts = originalPanel.querySelectorAll('.dropdown-selected');
      originalSelectedTexts.forEach(originalSelected => {
        const parentDropdown = originalSelected.closest('.custom-dropdown');
        if (parentDropdown && parentDropdown.id) {
          const clonedDropdown = clonedPanel.querySelector(`#${parentDropdown.id}`);
          if (clonedDropdown) {
            const clonedSelected = clonedDropdown.querySelector('.dropdown-selected');
            if (clonedSelected) {
              clonedSelected.innerHTML = originalSelected.innerHTML;
            }
          }
        }
      });
    } catch (e) {
      console.warn('Error syncing filter panel state:', e);
    }
  }

  /**
   * Set up mutation observer to sync table content when original changes
   * @param {HTMLElement} originalTable - The original table container
   * @param {HTMLElement} wrapper - The focus mode wrapper
   */
  setupTableObserver(originalTable, wrapper) {
    // Disconnect any existing observer
    if (this.tableObserver) {
      this.tableObserver.disconnect();
    }
    
    // Flag to prevent recursive updates
    this._isUpdatingTable = false;
    
    this.tableObserver = new MutationObserver(() => {
      // Prevent recursive updates
      if (this._isUpdatingTable) return;
      
      // Debounce updates
      clearTimeout(this._tableUpdateTimeout);
      this._tableUpdateTimeout = setTimeout(() => {
        this._isUpdatingTable = true;
        this.updateClonedTable(originalTable, wrapper);
        // Reset flag after a short delay
        setTimeout(() => {
          this._isUpdatingTable = false;
        }, 100);
      }, 50);
    });
    
    // Find the actual table element to observe (specifically tbody for content changes)
    const tableElement = originalTable.querySelector('table tbody') || 
                         originalTable.querySelector('table') || 
                         originalTable;
    
    this.tableObserver.observe(tableElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  
  /**
   * Update the cloned table content from the original
   * @param {HTMLElement} originalTable - The original table container
   * @param {HTMLElement} wrapper - The focus mode wrapper
   */
  updateClonedTable(originalTable, wrapper) {
    // Find the actual table element to clone
    const actualTable = originalTable.querySelector('table') || originalTable;
    const clonedTable = actualTable.cloneNode(true);
    clonedTable.classList.add('focused-table');
    clonedTable.style.maxHeight = 'none';
    
    // Preserve scroll position
    const originalScrollTop = wrapper.scrollTop;
    
    // Replace content in wrapper
    wrapper.innerHTML = '';
    wrapper.appendChild(clonedTable);
    
    // Restore scroll position
    requestAnimationFrame(() => {
      wrapper.scrollTop = originalScrollTop;
    });
  }
  
  /**
   * Find and clone the pagination associated with a table
   * @param {HTMLElement} tableContainer 
   * @returns {HTMLElement|null}
   */
  clonePagination(tableContainer) {
    // Look for pagination in various places
    let pagination = null;
    
    // Check for sibling pagination
    const parent = tableContainer.parentElement;
    if (parent) {
      pagination = parent.querySelector('.table-pagination, .pagination-section, .pagination-block, .pagination-wrapper');
      
      // Also check next sibling
      let sibling = tableContainer.nextElementSibling;
      while (sibling && !pagination) {
        if (sibling.matches('.table-pagination, .pagination-section, .pagination-block') ||
            sibling.querySelector('.pagination-wrapper, .pagination-controls')) {
          pagination = sibling;
          break;
        }
        sibling = sibling.nextElementSibling;
      }
    }
    
    // Check in parent containers
    if (!pagination) {
      const container = tableContainer.closest('.sourcing-tab-panel, .action-block, section, .panel');
      if (container) {
        pagination = container.querySelector('.table-pagination, .pagination-section, .pagination-block');
      }
    }
    
    // Check by ID patterns
    if (!pagination) {
      const tableId = tableContainer.id || tableContainer.querySelector('table')?.id;
      if (tableId) {
        // Try common pagination ID patterns
        const paginationIds = [
          `${tableId}-pagination`,
          `${tableId.replace('Table', '')}Pagination`,
          `${tableId.replace('-table', '-pagination')}`,
          'paginationSection',
          'analysis-pagination',
          'matrix-pagination'
        ];
        for (const id of paginationIds) {
          pagination = document.getElementById(id);
          if (pagination) break;
        }
      }
    }
    
    if (!pagination) return null;
    
    // Clone the pagination
    const clonedPagination = pagination.cloneNode(true);
    clonedPagination.classList.add('focused-pagination');
    
    // Re-wire the pagination buttons to work with the original
    this.wirePaginationButtons(clonedPagination, pagination);
    
    return clonedPagination;
  }
  
  /**
   * Wire up cloned pagination buttons to trigger original pagination
   * @param {HTMLElement} clonedPagination 
   * @param {HTMLElement} originalPagination 
   */
  wirePaginationButtons(clonedPagination, originalPagination) {
    // Store reference to original for updates
    clonedPagination._originalPagination = originalPagination;
    
    // Find and wire prev button
    const clonedPrev = clonedPagination.querySelector('#prevPageBtn, .pagination-btn:first-of-type, [id*="prev"]');
    const originalPrev = originalPagination.querySelector('#prevPageBtn, .pagination-btn:first-of-type, [id*="prev"]');
    if (clonedPrev && originalPrev) {
      clonedPrev.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        originalPrev.click();
        // Update cloned pagination after a short delay
        setTimeout(() => this.updateClonedPagination(clonedPagination, originalPagination), 100);
      });
    }
    
    // Find and wire next button
    const clonedNext = clonedPagination.querySelector('#nextPageBtn, .pagination-btn:last-of-type, [id*="next"]');
    const originalNext = originalPagination.querySelector('#nextPageBtn, .pagination-btn:last-of-type, [id*="next"]');
    if (clonedNext && originalNext) {
      clonedNext.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        originalNext.click();
        // Update cloned pagination after a short delay
        setTimeout(() => this.updateClonedPagination(clonedPagination, originalPagination), 100);
      });
    }
    
    // Set up observer to sync pagination state
    this.setupPaginationObserver(clonedPagination, originalPagination);
  }
  
  /**
   * Set up mutation observer to sync pagination state
   * @param {HTMLElement} clonedPagination 
   * @param {HTMLElement} originalPagination 
   */
  setupPaginationObserver(clonedPagination, originalPagination) {
    const observer = new MutationObserver(() => {
      this.updateClonedPagination(clonedPagination, originalPagination);
    });
    
    observer.observe(originalPagination, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
    
    // Store observer for cleanup
    clonedPagination._paginationObserver = observer;
  }
  
  /**
   * Update cloned pagination to match original
   * @param {HTMLElement} clonedPagination 
   * @param {HTMLElement} originalPagination 
   */
  updateClonedPagination(clonedPagination, originalPagination) {
    // Update text content of info elements
    const clonedInfo = clonedPagination.querySelector('.pagination-info, #paginationInfo');
    const originalInfo = originalPagination.querySelector('.pagination-info, #paginationInfo');
    if (clonedInfo && originalInfo) {
      clonedInfo.innerHTML = originalInfo.innerHTML;
    }
    
    // Update page indicator
    const clonedIndicator = clonedPagination.querySelector('.page-indicator, #pageInfo, #pageIndicator');
    const originalIndicator = originalPagination.querySelector('.page-indicator, #pageInfo, #pageIndicator');
    if (clonedIndicator && originalIndicator) {
      clonedIndicator.innerHTML = originalIndicator.innerHTML;
    }
    
    // Update button states
    const clonedPrev = clonedPagination.querySelector('#prevPageBtn, .pagination-btn:first-of-type');
    const originalPrev = originalPagination.querySelector('#prevPageBtn, .pagination-btn:first-of-type');
    if (clonedPrev && originalPrev) {
      clonedPrev.disabled = originalPrev.disabled;
    }
    
    const clonedNext = clonedPagination.querySelector('#nextPageBtn, .pagination-btn:last-of-type');
    const originalNext = originalPagination.querySelector('#nextPageBtn, .pagination-btn:last-of-type');
    if (clonedNext && originalNext) {
      clonedNext.disabled = originalNext.disabled;
    }
  }
  
  /**
   * Create tabs for switching between multiple tables
   * @param {HTMLElement[]} tables 
   * @param {HTMLElement} wrapper 
   */
  createTableTabs(tables, wrapper) {
    const tabContainer = document.createElement('div');
    tabContainer.className = 'table-focus-tabs';
    
    tables.forEach((table, index) => {
      const tab = document.createElement('button');
      tab.className = 'table-focus-tab';
      if (table === this.focusedTable) {
        tab.classList.add('active');
      }
      
      // Try to get a label from the table or its parent
      const label = this.getTableLabel(table) || `Table ${index + 1}`;
      tab.textContent = label;
      
      tab.addEventListener('click', () => {
        this.switchTable(table, wrapper, tabContainer);
      });
      
      tabContainer.appendChild(tab);
    });
    
    this.focusContainer.insertBefore(tabContainer, wrapper);
  }
  
  /**
   * Get a label for a table from its context
   * @param {HTMLElement} tableContainer 
   * @returns {string|null}
   */
  getTableLabel(tableContainer) {
    // Try various methods to find a label
    const parent = tableContainer.closest('.action-block, .panel, section, .card');
    if (parent) {
      const title = parent.querySelector('.block-title, .panel-title, h2, h3, h4');
      if (title) {
        return title.textContent.trim();
      }
    }
    
    // Check for id
    const table = tableContainer.querySelector('table');
    if (table && table.id) {
      return table.id.replace(/-/g, ' ').replace(/([A-Z])/g, ' $1').trim();
    }
    
    return null;
  }
  
  /**
   * Switch to a different table in focus mode
   * @param {HTMLElement} tableContainer 
   * @param {HTMLElement} wrapper 
   * @param {HTMLElement} tabContainer 
   */
  switchTable(tableContainer, wrapper, tabContainer) {
    this.focusedTable = tableContainer;
    
    // Update tabs using stored allTables array
    tabContainer.querySelectorAll('.table-focus-tab').forEach((tab, index) => {
      tab.classList.toggle('active', this.allTables[index] === tableContainer);
    });
    
    // Replace table content - clone just the actual table element
    wrapper.innerHTML = '';
    const actualTable = tableContainer.querySelector('table') || tableContainer;
    const clonedTable = actualTable.cloneNode(true);
    clonedTable.classList.add('focused-table');
    clonedTable.style.maxHeight = 'none';
    wrapper.appendChild(clonedTable);
    
    // Set up observer for new table
    this.setupTableObserver(tableContainer, wrapper);
    
    // Remove existing pagination from focus container
    const existingPagination = this.focusContainer.querySelector('.focused-pagination');
    if (existingPagination) {
      // Disconnect observer if it exists
      if (existingPagination._paginationObserver) {
        existingPagination._paginationObserver.disconnect();
      }
      existingPagination.remove();
    }
    
    // Find and add pagination for new table
    const paginationClone = this.clonePagination(tableContainer);
    if (paginationClone) {
      this.focusContainer.appendChild(paginationClone);
    }
  }
  
  /**
   * Hide UI elements that should be hidden in focus mode
   */
  hideElements() {
    this.elementsToHide.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          // Store original display/visibility
          this.originalStyles.set(el, {
            display: el.style.display,
            visibility: el.style.visibility,
            opacity: el.style.opacity
          });
          
          el.style.visibility = 'hidden';
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        });
      } catch (e) {
        // Ignore invalid selectors
      }
    });
  }
  
  /**
   * Restore hidden elements
   */
  showElements() {
    this.originalStyles.forEach((styles, el) => {
      el.style.display = styles.display || '';
      el.style.visibility = styles.visibility || '';
      el.style.opacity = styles.opacity || '';
      el.style.pointerEvents = '';
    });
    this.originalStyles.clear();
  }
  
  /**
   * Exit focus mode
   */
  exitFocusMode() {
    if (!this.isActive) return;
    
    this.isActive = false;
    
    // Remove focus mode class
    document.body.classList.remove('table-focus-mode');
    document.documentElement.classList.remove('table-focus-mode');
    
    // Cleanup table observer
    if (this.tableObserver) {
      this.tableObserver.disconnect();
      this.tableObserver = null;
    }
    
    // Cleanup pagination observers
    if (this.focusContainer) {
      const pagination = this.focusContainer.querySelector('.focused-pagination');
      if (pagination && pagination._paginationObserver) {
        pagination._paginationObserver.disconnect();
      }
      
      // Cleanup filter panel observer
      const filterPanel = this.focusContainer.querySelector('.focused-filter-panel');
      if (filterPanel && filterPanel._filterPanelObserver) {
        filterPanel._filterPanelObserver.disconnect();
      }
    }
    
    // Animate out and remove overlay
    if (this.overlay) {
      this.overlay.classList.remove('visible');
      setTimeout(() => {
        this.overlay?.remove();
        this.overlay = null;
      }, 300);
    }
    
    // Animate out and remove focus container
    if (this.focusContainer) {
      this.focusContainer.classList.remove('visible');
      setTimeout(() => {
        this.focusContainer?.remove();
        this.focusContainer = null;
      }, 300);
    }
    
    // Restore hidden elements
    this.showElements();
    
    // Show hint again
    this.updateHintVisibility();
    
    // Announce for screen readers
    this.announceForA11y('Table focus mode deactivated.');
    
    this.focusedTable = null;
    this.allTables = null;
  }
  
  /**
   * Announce a message for screen readers
   * @param {string} message 
   */
  announceForA11y(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => announcement.remove(), 1000);
  }
}

// Create global instance
const tableFocusMode = new TableFocusMode();

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tableFocusMode };
}

// Expose globally for debugging
window.tableFocusMode = tableFocusMode;
