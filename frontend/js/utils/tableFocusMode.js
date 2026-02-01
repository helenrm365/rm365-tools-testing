/**
 * Table Focus Mode Utility (Optimized)
 * 
 * Enables full-screen focus mode on tables by pressing "F" key.
 * Uses a simple overlay approach - covers everything with a full-screen
 * container showing the original elements (moved, not cloned).
 * 
 * Triggers:
 * - Press "F" key when page has a focusable table
 * - Press "ESC" key or click the exit button to exit focus mode
 */

class TableFocusMode {
  constructor() {
    this.isActive = false;
    this.focusedElements = {
      table: null,
      filterPanel: null,
      controlsBar: null,
      pagination: null
    };
    this.originalPositions = {};
    this.focusContainer = null;
    this.exitButton = null;
    this.hint = null;
    
    this.init();
  }
  
  /**
   * Initialize the focus mode functionality
   */
  init() {
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.createHint();
    this.setupMutationObserver();
    setTimeout(() => this.updateHintVisibility(), 500);
  }
  
  /**
   * Create the focus mode hint
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
    
    this.hint.addEventListener('click', () => {
      if (!this.isActive && this.getFocusableTable()) {
        this.enterFocusMode();
      }
    });
  }
  
  /**
   * Setup mutation observer to detect new tables
   */
  setupMutationObserver() {
    const observer = new MutationObserver(() => {
      if (this._checkTimeout) clearTimeout(this._checkTimeout);
      this._checkTimeout = setTimeout(() => this.updateHintVisibility(), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  
  /**
   * Update hint visibility based on focusable tables
   */
  updateHintVisibility() {
    const table = this.getFocusableTable();
    if (table && !this.isActive) {
      this.hint.style.display = 'flex';
    } else {
      this.hint.style.display = 'none';
    }
  }
  
  /**
   * Get the first focusable table on the page
   * @returns {HTMLElement|null}
   */
  getFocusableTable() {
    // Don't find tables inside our focus container
    const container = document.querySelector('.table-container:not([data-focusable="false"]):not(.table-focus-container *)');
    if (container && container.querySelector('table')) {
      return container;
    }
    
    const table = document.querySelector('table[data-auto-sort="true"]:not(.table-focus-container *), table[data-focusable="true"]:not(.table-focus-container *)');
    if (table) {
      return table.closest('.table-container, .standalone-table, .table-wrapper') || table.parentElement;
    }
    
    return null;
  }
  
  /**
   * Get associated filter panel
   * @returns {HTMLElement|null}
   */
  getFilterPanel() {
    return document.querySelector('.unified-filter-panel:not(.table-focus-container *), .filter-control-panel:not(.table-focus-container *)');
  }
  
  /**
   * Get associated data controls bar (search, zoom, action buttons)
   * @returns {HTMLElement|null}
   */
  getControlsBar() {
    // Check for data-controls-bar (inventory), selection-bar (labels), or action-block with search (magento data)
    const dataControlsBar = document.querySelector('.data-controls-bar:not(.table-focus-container *)');
    if (dataControlsBar) return dataControlsBar;
    
    const selectionBar = document.querySelector('.selection-bar:not(.table-focus-container *)');
    if (selectionBar) return selectionBar;
    
    // For Magento Data pages - find the search action-block (has search input)
    const searchBlock = document.querySelector('.action-block:has(#magentoSearchInput):not(.table-focus-container *)');
    if (searchBlock) return searchBlock;
    
    return null;
  }

  /**
   * Get associated pagination
   * @param {HTMLElement} tableContainer
   * @returns {HTMLElement|null}
   */
  getPagination(tableContainer) {
    const parent = tableContainer.parentElement;
    if (parent) {
      const pagination = parent.querySelector('.table-pagination, .pagination-section');
      if (pagination) return pagination;
      
      let sibling = tableContainer.nextElementSibling;
      while (sibling) {
        if (sibling.matches('.table-pagination, .pagination-section') ||
            sibling.querySelector('.pagination-wrapper, .pagination-controls')) {
          return sibling;
        }
        sibling = sibling.nextElementSibling;
      }
    }
    
    const container = tableContainer.closest('.sourcing-tab-panel, .action-block, section, .panel, .management-content');
    if (container) {
      return container.querySelector('.table-pagination, .pagination-section');
    }
    
    return null;
  }
  
  /**
   * Handle keyboard events
   * @param {KeyboardEvent} e
   */
  handleKeyDown(e) {
    const activeElement = document.activeElement;
    const isTyping = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.isContentEditable
    );
    
    if (isTyping) return;
    
    if (e.key === 'Escape' && this.isActive) {
      e.preventDefault();
      e.stopPropagation();
      this.exitFocusMode();
      return;
    }
    
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (this.isActive) {
        e.preventDefault();
        this.exitFocusMode();
      } else {
        const table = this.getFocusableTable();
        if (table) {
          e.preventDefault();
          this.enterFocusMode();
        }
      }
    }
  }
  
  /**
   * Store original position of an element
   */
  storeOriginalPosition(element, key) {
    if (!element) return;
    this.originalPositions[key] = {
      parent: element.parentElement,
      nextSibling: element.nextElementSibling
    };
  }
  
  /**
   * Restore element to its original position
   */
  restoreToOriginalPosition(element, key) {
    if (!element || !this.originalPositions[key]) return;
    
    const { parent, nextSibling } = this.originalPositions[key];
    if (parent) {
      if (nextSibling && nextSibling.parentElement === parent) {
        parent.insertBefore(element, nextSibling);
      } else {
        parent.appendChild(element);
      }
    }
  }
  
  /**
   * Enter focus mode
   */
  enterFocusMode() {
    const table = this.getFocusableTable();
    if (!table) return;
    
    this.isActive = true;
    this.focusedElements.table = table;
    this.focusedElements.filterPanel = this.getFilterPanel();
    this.focusedElements.controlsBar = this.getControlsBar();
    this.focusedElements.pagination = this.getPagination(table);
    
    // Hide hint
    this.hint.style.display = 'none';
    
    // Add focus mode class to prevent scrolling
    document.body.classList.add('table-focus-mode');
    document.documentElement.classList.add('table-focus-mode');
    
    // Create focus container (solid background covers everything)
    this.focusContainer = document.createElement('div');
    this.focusContainer.className = 'table-focus-container';
    
    // Move filter panel into focus container
    if (this.focusedElements.filterPanel) {
      this.storeOriginalPosition(this.focusedElements.filterPanel, 'filterPanel');
      this.focusedElements.filterPanel.classList.add('focused-filter-panel');
      this.focusContainer.appendChild(this.focusedElements.filterPanel);
    }
    
    // Move data controls bar into focus container
    if (this.focusedElements.controlsBar) {
      this.storeOriginalPosition(this.focusedElements.controlsBar, 'controlsBar');
      this.focusedElements.controlsBar.classList.add('focused-controls-bar');
      this.focusContainer.appendChild(this.focusedElements.controlsBar);
    }
    
    // Create table wrapper and move table into it
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-focus-wrapper';
    
    this.storeOriginalPosition(this.focusedElements.table, 'table');
    this.focusedElements.table.classList.add('focused-table');
    tableWrapper.appendChild(this.focusedElements.table);
    this.focusContainer.appendChild(tableWrapper);
    
    // Move pagination into focus container
    if (this.focusedElements.pagination) {
      this.storeOriginalPosition(this.focusedElements.pagination, 'pagination');
      this.focusedElements.pagination.classList.add('focused-pagination');
      this.focusContainer.appendChild(this.focusedElements.pagination);
    }
    
    document.body.appendChild(this.focusContainer);
    
    // Create exit button inside focus container
    this.createExitButton();
    
    // Trigger visibility
    requestAnimationFrame(() => {
      this.focusContainer.classList.add('visible');
    });
    
    // Announce for screen readers
    this.announceForA11y('Table focus mode activated. Press Escape or F to exit.');
  }
  
  /**
   * Create exit button
   */
  createExitButton() {
    this.exitButton = document.createElement('button');
    this.exitButton.className = 'table-focus-exit';
    this.exitButton.innerHTML = `
      <i class="fas fa-times"></i>
      <span>Exit Focus Mode</span>
      <kbd>ESC</kbd>
    `;
    this.exitButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.exitFocusMode();
    });
    this.focusContainer.appendChild(this.exitButton);
  }
  
  /**
   * Exit focus mode - restore everything
   */
  exitFocusMode() {
    if (!this.isActive) return;
    
    this.isActive = false;
    
    // Remove focus mode class
    document.body.classList.remove('table-focus-mode');
    document.documentElement.classList.remove('table-focus-mode');
    
    // Restore filter panel to original position
    if (this.focusedElements.filterPanel) {
      this.focusedElements.filterPanel.classList.remove('focused-filter-panel');
      this.restoreToOriginalPosition(this.focusedElements.filterPanel, 'filterPanel');
    }
    
    // Restore controls bar to original position
    if (this.focusedElements.controlsBar) {
      this.focusedElements.controlsBar.classList.remove('focused-controls-bar');
      this.restoreToOriginalPosition(this.focusedElements.controlsBar, 'controlsBar');
    }
    
    // Restore table to original position
    if (this.focusedElements.table) {
      this.focusedElements.table.classList.remove('focused-table');
      this.restoreToOriginalPosition(this.focusedElements.table, 'table');
    }
    
    // Restore pagination to original position
    if (this.focusedElements.pagination) {
      this.focusedElements.pagination.classList.remove('focused-pagination');
      this.restoreToOriginalPosition(this.focusedElements.pagination, 'pagination');
    }
    
    // Remove focus container (includes exit button)
    if (this.focusContainer) {
      this.focusContainer.classList.remove('visible');
      this.focusContainer.remove();
      this.focusContainer = null;
    }
    
    this.exitButton = null;
    
    // Reset stored positions
    this.originalPositions = {};
    
    // Reset focused elements
    this.focusedElements = { table: null, filterPanel: null, controlsBar: null, pagination: null };
    
    // Show hint again
    this.updateHintVisibility();
    
    // Announce for screen readers
    this.announceForA11y('Table focus mode deactivated.');
  }
  
  /**
   * Announce message for screen readers
   */
  announceForA11y(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => announcement.remove(), 1000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.tableFocusMode = new TableFocusMode();
  });
} else {
  window.tableFocusMode = new TableFocusMode();
}
