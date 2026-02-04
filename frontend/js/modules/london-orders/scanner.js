// frontend/js/modules/london-orders/scanner.js
// London Orders - Inventory Scanner Module
// Uses UK London branch inventory (uk_london_inventory table)
//
// Workflow Logic:
// - First Scan: Item appears with quantity -1, location defaults to "Auto"
// - Subsequent Scans: If item exists, adds another -1 to the current total
// - Positive Flip: When quantity becomes positive, "Auto" is removed, location forced to "Top Floor"
// - Negative Flip: When quantity goes back to negative, "Auto" reappears and becomes default
// - Negative numbers = take away from inventory
// - Positive numbers = add to inventory

import { getApiUrl } from '../../config.js';
import { getToken } from '../../services/state/sessionStore.js';
import { showNotification } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { checkTablesStatus, initializeTables } from '../../services/api/inventoryApi.js';

// Branch configuration
const BRANCH_CONFIG = {
  branchId: 'uk-london',
  branchName: 'UK London',
  apiPrefix: '/v1/inventory/management/uk-london',
  adjustmentsApiPrefix: '/v1/inventory/adjustments',
  scanningLogsApiPrefix: '/v1/inventory/scanning-logs/uk-london'
};

// Shelf field options
const SHELF_OPTIONS = {
  withAuto: [
    { value: 'auto', label: 'Auto' },
    { value: 'shelf_lt1_qty', label: '<1 Year' },
    { value: 'shelf_gt1_qty', label: '>1 Year' },
    { value: 'top_floor_total', label: 'Top Floor' }
  ],
  withoutAuto: [
    { value: 'top_floor_total', label: 'Top Floor' },
    { value: 'shelf_lt1_qty', label: '<1 Year' },
    { value: 'shelf_gt1_qty', label: '>1 Year' }
  ]
};

// Helper to get auth headers
function getAuthHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

class InventoryScannerManager {
  constructor() {
    // pendingItems: Array of { sku, itemId, name, quantity (negative or positive), shelfField, currentStock }
    this.pendingItems = [];
    this.searchResults = [];
    this.searchDebounceTimer = null;
    this.isSearching = false;
    this.initializeElements();
    this.attachEventListeners();
  }

  initializeElements() {
    // Scanner inputs
    this.skuInput = document.getElementById('skuInput');
    
    // Search dropdown elements
    this.searchDropdown = document.getElementById('searchDropdown');
    this.searchDropdownContent = document.getElementById('searchDropdownContent');
    this.searchSpinner = document.getElementById('searchSpinner');
    
    // Messages and lists
    
    // Messages and lists
    this.pendingItemsList = document.getElementById('pendingItemsList');
    this.pendingSubtitle = document.getElementById('pendingSubtitle');
    this.clearAllBtn = document.getElementById('clearAllBtn');
    this.pendingActionsWrapper = document.getElementById('pendingActionsWrapper');
    
    // Submit section
    this.submitSection = document.getElementById('submitSection');
    this.reasonInput = document.getElementById('reasonInput');
    this.cancelBtn = document.getElementById('cancelBtn');
    this.submitBtn = document.getElementById('submitBtn');
    
    // Modals
    this.confirmModal = document.getElementById('confirmModal');
    this.successModal = document.getElementById('successModal');
  }

  attachEventListeners() {
    // Debounced search on input
    this.skuInput?.addEventListener('input', (e) => {
      this.handleSearchInput(e.target.value);
    });
    
    // Handle keyboard navigation in dropdown
    this.skuInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // If dropdown is open and has results, select first one
        if (this.searchDropdown?.classList.contains('active') && this.searchResults.length > 0) {
          this.selectSearchResult(this.searchResults[0]);
        } else if (this.skuInput.value.trim()) {
          // Barcode scan: add to list (no auto-submit)
          this.scanItem(false);
        }
      } else if (e.key === 'Escape') {
        this.hideSearchDropdown();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateDropdown(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-input-wrapper')) {
        this.hideSearchDropdown();
      }
    });

    // Close dropdown on scroll/touch (mobile) to prevent it staying open after navigating
    const closeDropdown = () => this.hideSearchDropdown();
    window.addEventListener('scroll', closeDropdown, { passive: true, capture: true });
    document.addEventListener('scroll', closeDropdown, { passive: true, capture: true });
    document.addEventListener('touchmove', closeDropdown, { passive: true });
    window.addEventListener('touchstart', closeDropdown, { passive: true });
    this.pendingItemsList?.addEventListener('scroll', closeDropdown, { passive: true });
    
    // Clear all button
    this.clearAllBtn?.addEventListener('click', () => this.clearAllItems());
    
    // Submit section buttons
    this.cancelBtn?.addEventListener('click', () => this.clearAllItems());
    this.submitBtn?.addEventListener('click', () => this.showConfirmModal());
    
    // Confirm modal buttons
    document.getElementById('closeConfirmModalBtn')?.addEventListener('click', () => this.hideConfirmModal());
    document.getElementById('confirmCancelBtn')?.addEventListener('click', () => this.hideConfirmModal());
    document.getElementById('confirmSubmitBtn')?.addEventListener('click', () => this.submitAdjustments());
    
    // Success modal buttons
    document.getElementById('closeSuccessModalBtn')?.addEventListener('click', () => this.hideSuccessModal());
    document.getElementById('successOkBtn')?.addEventListener('click', () => this.hideSuccessModal());
  }

  // ===== Search Dropdown Methods =====
  
  handleSearchInput(query) {
    // Clear previous timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    const trimmedQuery = query.trim();
    
    // Hide dropdown and spinner if query is empty or too short
    if (!trimmedQuery || trimmedQuery.length < 2) {
      this.hideSearchDropdown();
      if (this.searchSpinner) {
        this.searchSpinner.style.display = 'none';
      }
      return;
    }
    
    // Debounce: wait 500ms after user stops typing
    this.searchDebounceTimer = setTimeout(() => {
      // Show spinner before search
      if (this.searchSpinner) {
        this.searchSpinner.style.display = 'flex';
      }
      this.performSearch(trimmedQuery);
    }, 500);
  }

  async performSearch(query) {
    if (this.isSearching) return;
    
    this.isSearching = true;
    
    try {
      const url = `${getApiUrl()}${BRANCH_CONFIG.apiPrefix}/items?search=${encodeURIComponent(query)}&per_page=20`;
      
      const response = await fetch(url, {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error('Search failed');
      }
      
      const data = await response.json();
      this.searchResults = data.items || [];
      
      this.renderSearchResults();
      
    } catch (error) {
      console.error('Search error:', error);
      this.searchResults = [];
      this.renderSearchResults();
    } finally {
      this.isSearching = false;
      if (this.searchSpinner) {
        this.searchSpinner.style.display = 'none';
      }
    }
  }

  renderSearchResults() {
    if (!this.searchDropdownContent) return;
    
    if (this.searchResults.length === 0) {
      this.searchDropdownContent.innerHTML = `
        <div class="search-no-results">
          <i class="fas fa-search"></i>
          <span>No products found</span>
        </div>
      `;
      this.showSearchDropdown();
      return;
    }
    
    this.searchDropdownContent.innerHTML = this.searchResults.map((item, index) => `
      <div class="search-result-item" data-index="${index}">
        <div class="search-result-info">
          <div class="search-result-name">${item.name || item.product_name || item.sku}</div>
          <div class="search-result-sku">${item.sku}</div>
        </div>
        <div class="search-result-stock">
          <span class="stock-label">Stock:</span>
          <span class="stock-value">${item.total_qty || 0}</span>
        </div>
      </div>
    `).join('');
    
    // Attach click listeners
    this.searchDropdownContent.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const index = parseInt(el.dataset.index);
        this.selectSearchResult(this.searchResults[index]);
      });
    });
    
    this.showSearchDropdown();
  }

  selectSearchResult(item) {
    if (!item) return;
    
    // Add item to pending list
    this.addItemToPending(item);
    
    // Clear input and hide dropdown
    if (this.skuInput) {
      this.skuInput.value = '';
      this.skuInput.focus();
    }
    this.hideSearchDropdown();
  }

  addItemToPending(itemInfo) {
    // Check if item already exists in pending list
    const existingIndex = this.pendingItems.findIndex(item => item.sku === itemInfo.sku);
    
    if (existingIndex >= 0) {
      // Item already exists - just show a message, don't modify quantity
      this.showMessage(`${itemInfo.name || itemInfo.sku} is already in the list`, 'info');
      this.playBeep();
      return;
    } else {
      // First add: Add new item with quantity 0, shelfField = 'auto'
      this.pendingItems.push({
        sku: itemInfo.sku,
        itemId: itemInfo.item_id,
        name: itemInfo.name || itemInfo.product_name || itemInfo.sku,
        quantity: 0,
        shelfField: 'auto',
        currentStock: itemInfo.total_qty || 0,
        shelfStock: {
          shelf_lt1_qty: itemInfo.shelf_lt1_qty || 0,
          shelf_gt1_qty: itemInfo.shelf_gt1_qty || 0,
          top_floor_total: itemInfo.top_floor_total || 0
        }
      });
      this.showMessage(`Added: ${itemInfo.name || itemInfo.sku} (Qty: 0)`, 'success');
    }
    
    this.playBeep();
    this.updatePendingList();
  }

  /**
   * Validate that the requested deduction doesn't exceed available stock
   * @param {string} sku - Product SKU
   * @param {number} quantity - Requested quantity (negative for deductions)
   * @param {string} shelfField - Target shelf field or 'auto'
   * @returns {object} { valid: boolean, message: string }
   */
  validateStockAvailability(sku, quantity, shelfField) {
    // Only validate for deductions (negative quantities)
    if (quantity >= 0) {
      return { valid: true };
    }

    const item = this.pendingItems.find(i => i.sku === sku);
    if (!item) {
      return { valid: true };
    }

    const deductionAmount = Math.abs(quantity);

    if (shelfField === 'auto') {
      if (deductionAmount > item.currentStock) {
        return {
          valid: false,
          message: `Cannot deduct ${deductionAmount} units. Only ${item.currentStock} available in stock.`
        };
      }
    } else {
      const shelfQty = item.shelfStock?.[shelfField] || 0;
      if (deductionAmount > shelfQty) {
        const shelfLabel = SHELF_OPTIONS.withoutAuto.find(opt => opt.value === shelfField)?.label || shelfField;
        return {
          valid: false,
          message: `Cannot deduct ${deductionAmount} units from ${shelfLabel}. Only ${shelfQty} available.`
        };
      }
    }

    return { valid: true };
  }

  validateStockAvailability(sku, quantity, shelfField) {
    // Only validate for negative quantities (deductions)
    if (quantity >= 0) {
      return { valid: true };
    }
    
    // Find the item in pending list to get stock info
    const item = this.pendingItems.find(i => i.sku === sku);
    if (!item) {
      // Item not in list yet, need to check if we have the info
      return { valid: true }; // Allow first add, validation will happen with full data
    }
    
    const deductionAmount = Math.abs(quantity);
    
    // Define shelf labels for error messages
    const shelfLabels = {
      'shelf_lt1_qty': '<1 Year',
      'shelf_gt1_qty': '>1 Year',
      'top_floor_total': 'Top Floor'
    };
    
    if (shelfField === 'auto') {
      // For 'auto', validate against total stock
      if (deductionAmount > item.currentStock) {
        return {
          valid: false,
          message: `Insufficient stock for ${sku}. Trying to remove ${deductionAmount}, but only ${item.currentStock} available in total.`
        };
      }
    } else {
      // For specific shelf, validate against that shelf's stock
      const shelfStock = item.shelfStock || {};
      const availableInShelf = shelfStock[shelfField] || 0;
      
      if (deductionAmount > availableInShelf) {
        const shelfName = shelfLabels[shelfField] || shelfField;
        return {
          valid: false,
          message: `Insufficient stock in ${shelfName} for ${sku}. Trying to remove ${deductionAmount}, but only ${availableInShelf} available in this shelf.`
        };
      }
    }
    
    return { valid: true };
  }

  navigateDropdown(direction) {
    const items = this.searchDropdownContent?.querySelectorAll('.search-result-item');
    if (!items || items.length === 0) return;
    
    const currentActive = this.searchDropdownContent.querySelector('.search-result-item.active');
    let nextIndex = 0;
    
    if (currentActive) {
      const currentIndex = parseInt(currentActive.dataset.index);
      currentActive.classList.remove('active');
      nextIndex = currentIndex + direction;
      
      // Wrap around
      if (nextIndex < 0) nextIndex = items.length - 1;
      if (nextIndex >= items.length) nextIndex = 0;
    } else {
      nextIndex = direction === 1 ? 0 : items.length - 1;
    }
    
    items[nextIndex]?.classList.add('active');
    items[nextIndex]?.scrollIntoView({ block: 'nearest' });
  }

  showSearchDropdown() {
    this.searchDropdown?.classList.add('active');
  }

  hideSearchDropdown() {
    this.searchDropdown?.classList.remove('active');
    this.searchResults = [];
  }

  showMessage(message, type = 'info') {
    showToast(message, type);
  }

  async scanItem(autoSubmit = false) {
    const sku = this.skuInput?.value.trim();
    
    if (!sku) {
      this.showMessage('Please scan or enter a barcode/SKU', 'error');
      this.skuInput?.focus();
      return;
    }
    
    try {
      // Look up the item in the inventory
      const itemInfo = await this.lookupItem(sku);
      
      if (!itemInfo) {
        this.showMessage(`Item not found: ${sku}`, 'error');
        this.playErrorBeep();
        this.skuInput.value = '';
        this.skuInput.focus();
        return;
      }
      
      // Check if item already exists in pending list (by SKU only)
      const existingIndex = this.pendingItems.findIndex(item => item.sku === itemInfo.sku);
      
      if (existingIndex >= 0) {
        // Subsequent scan: Add another -1 to the current total
        const item = this.pendingItems[existingIndex];
        const newQuantity = item.quantity - 1;
        
        // Validate stock availability
        const validation = this.validateStockAvailability(item.sku, newQuantity, item.shelfField);
        if (!validation.valid) {
          this.showMessage(validation.message, 'error');
          this.playErrorBeep();
          this.skuInput.value = '';
          this.skuInput.focus();
          return;
        }
        
        item.quantity = newQuantity;
        this.showMessage(`${itemInfo.name || itemInfo.sku} → Total: ${newQuantity}`, 'success');
      } else {
        // First scan: Add new item with quantity -1, shelfField = 'auto'
        // Validate stock availability
        const validation = this.validateStockAvailability(itemInfo.sku, -1, 'auto');
        if (!validation.valid) {
          this.showMessage(validation.message, 'error');
          this.playErrorBeep();
          this.skuInput.value = '';
          this.skuInput.focus();
          return;
        }
        
        this.pendingItems.push({
          sku: itemInfo.sku,
          itemId: itemInfo.item_id,
          name: itemInfo.name || itemInfo.product_name || sku,
          quantity: -1,
          shelfField: 'auto',
          currentStock: itemInfo.total_qty || 0,
          shelfStock: {
            shelf_lt1_qty: itemInfo.shelf_lt1_qty || 0,
            shelf_gt1_qty: itemInfo.shelf_gt1_qty || 0,
            top_floor_total: itemInfo.top_floor_total || 0
          }
        });
        this.showMessage(`Added: ${itemInfo.name || sku} (Qty: -1)`, 'success');
      }
      
      this.playBeep();
      this.updatePendingList();
      
      // Clear and refocus
      this.skuInput.value = '';
      this.skuInput.focus();
      
      // Auto-submit the scanned item immediately (bypass confirm)
      if (autoSubmit) {
        await this.submitAdjustments(true);
      }
      
    } catch (error) {
      console.error('Error scanning item:', error);
      this.showMessage(`Error: ${error.message}`, 'error');
      this.playErrorBeep();
    }
  }

  async lookupItem(sku) {
    // Try to find item in branch inventory
    const url = `${getApiUrl()}${BRANCH_CONFIG.apiPrefix}/items?search=${encodeURIComponent(sku)}&per_page=10`;
    
    const response = await fetch(url, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to lookup item');
    }
    
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Find exact match first, then partial match
      const exactMatch = data.items.find(item => 
        item.sku?.toLowerCase() === sku.toLowerCase() ||
        item.item_id === sku
      );
      
      if (exactMatch) {
        return exactMatch;
      }
      
      // Return first result if no exact match
      return data.items[0];
    }
    
    return null;
  }

  updatePendingList() {
    const totalItems = this.pendingItems.length;
    const addItems = this.pendingItems.filter(i => i.quantity > 0);
    const removeItems = this.pendingItems.filter(i => i.quantity < 0);
    const addTotal = addItems.reduce((sum, i) => sum + i.quantity, 0);
    const removeTotal = removeItems.reduce((sum, i) => sum + Math.abs(i.quantity), 0);
    
    // Update subtitle
    if (this.pendingSubtitle) {
      if (totalItems === 0) {
        this.pendingSubtitle.textContent = '0 items ready to submit';
      } else {
        const parts = [];
        if (addTotal > 0) parts.push(`+${addTotal} adding`);
        if (removeTotal > 0) parts.push(`-${removeTotal} removing`);
        this.pendingSubtitle.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''} (${parts.join(', ')})`;
      }
    }
    
    // Show/hide clear all button
    if (this.pendingActionsWrapper) {
      this.pendingActionsWrapper.style.display = totalItems > 0 ? 'flex' : 'none';
    }
    
    // Enable/disable submit section based on valid items (quantity !== 0)
    const hasValidItems = this.pendingItems.some(item => item.quantity !== 0);
    if (this.submitSection) {
      // Toggle disabled state on inputs and buttons
      if (this.reasonInput) {
        this.reasonInput.disabled = !hasValidItems;
      }
      if (this.cancelBtn) {
        this.cancelBtn.disabled = !hasValidItems;
      }
      if (this.submitBtn) {
        this.submitBtn.disabled = !hasValidItems;
      }
      // Add/remove visual disabled state
      if (hasValidItems) {
        this.submitSection.classList.remove('disabled');
      } else {
        this.submitSection.classList.add('disabled');
      }
    }
    
    // Update items list
    if (!this.pendingItemsList) return;
    
    if (totalItems === 0) {
      this.pendingItemsList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <p>No items scanned yet</p>
          <span class="empty-hint">Scan a barcode or enter an SKU above to get started</span>
        </div>
      `;
      return;
    }
    
    this.pendingItemsList.innerHTML = this.pendingItems.map((item, index) => {
      const isPositive = item.quantity > 0;
      const typeClass = isPositive ? 'add' : 'remove';
      const typeIcon = isPositive ? 'fa-plus-circle' : 'fa-minus-circle';
      const shelfOptions = this.getShelfOptionsHtml(item.shelfField, isPositive);
      
      return `
        <div class="pending-item ${typeClass}" data-index="${index}">
          <div class="pending-item-main">
            <button class="pending-item-remove" data-index="${index}" title="Remove item">
              <i class="fas fa-trash"></i>
            </button>
            <div class="pending-item-icon ${typeClass}">
              <i class="fas ${typeIcon}"></i>
            </div>
            <div class="pending-item-info">
              <div class="pending-item-name">${item.name}</div>
              <div class="pending-item-sku">${item.sku}</div>
              <div class="pending-item-meta">
                <span class="meta-tag stock">Current: ${item.currentStock}</span>
              </div>
            </div>
          </div>
          <div class="pending-item-controls">
            <div class="pending-item-shelf">
              <select class="shelf-select" data-index="${index}">
                ${shelfOptions}
              </select>
            </div>
            <div class="pending-item-qty">
              <button class="qty-adjust-btn minus" data-index="${index}" data-action="decrease" title="Decrease (more negative)">
                <i class="fas fa-minus"></i>
              </button>
              <input type="number" class="qty-value-input" data-index="${index}" value="${item.quantity}">
              <button class="qty-adjust-btn plus" data-index="${index}" data-action="increase" title="Increase (less negative / more positive)">
                <i class="fas fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Attach event listeners
    this.attachPendingItemListeners();
  }

  getShelfOptionsHtml(currentValue, isPositive) {
    const options = isPositive ? SHELF_OPTIONS.withoutAuto : SHELF_OPTIONS.withAuto;
    
    // If positive and current value is 'auto', force to 'top_floor_total'
    let selectedValue = currentValue;
    if (isPositive && currentValue === 'auto') {
      selectedValue = 'top_floor_total';
    }
    
    return options.map(opt => 
      `<option value="${opt.value}" ${opt.value === selectedValue ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
  }

  attachPendingItemListeners() {
    // Quantity buttons
    this.pendingItemsList.querySelectorAll('.qty-adjust-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        const action = btn.dataset.action;
        this.adjustItemQuantity(index, action);
      });
    });
    
    // Quantity input (direct edit)
    this.pendingItemsList.querySelectorAll('.qty-value-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(input.dataset.index);
        const newValue = parseInt(input.value);
        this.setItemQuantity(index, newValue);
      });
      
      // Also handle blur to catch changes
      input.addEventListener('blur', (e) => {
        const index = parseInt(input.dataset.index);
        const newValue = parseInt(input.value);
        if (!isNaN(newValue)) {
          this.setItemQuantity(index, newValue);
        }
      });
    });
    
    // Shelf select
    this.pendingItemsList.querySelectorAll('.shelf-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const index = parseInt(select.dataset.index);
        this.setItemShelf(index, select.value);
      });
    });
    
    // Remove buttons
    this.pendingItemsList.querySelectorAll('.pending-item-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        this.removeItem(index);
      });
    });
  }

  adjustItemQuantity(index, action) {
    if (index < 0 || index >= this.pendingItems.length) return;
    
    const item = this.pendingItems[index];
    const oldQuantity = item.quantity;
    let newQuantity = oldQuantity;
    
    if (action === 'increase') {
      // Going towards positive
      newQuantity++;
    } else if (action === 'decrease') {
      // Going towards negative
      newQuantity--;
      
      // Validate stock availability for deductions (only when actually negative)
      if (newQuantity < 0) {
        const validation = this.validateStockAvailability(item.sku, newQuantity, item.shelfField);
        if (!validation.valid) {
          this.showMessage(validation.message, 'error');
          this.playErrorBeep();
          return;
        }
      }
    }
    
    item.quantity = newQuantity;
    
    // Handle flip logic
    this.handleQuantityFlip(item, oldQuantity);
    
    this.updatePendingList();
  }

  setItemQuantity(index, newValue) {
    if (index < 0 || index >= this.pendingItems.length) return;
    if (isNaN(newValue)) return;
    
    const item = this.pendingItems[index];
    const oldQuantity = item.quantity;
    
    // Validate stock availability for deductions
    if (newValue < 0) {
      const validation = this.validateStockAvailability(item.sku, newValue, item.shelfField);
      if (!validation.valid) {
        this.showMessage(validation.message, 'error');
        this.playErrorBeep();
        // Reset to old value
        const inputEl = this.pendingItemsList?.querySelector(`input[data-index="${index}"]`);
        if (inputEl) inputEl.value = oldQuantity;
        return;
      }
    }
    
    item.quantity = newValue;
    
    // Handle flip logic
    this.handleQuantityFlip(item, oldQuantity);
    
    this.updatePendingList();
  }

  handleQuantityFlip(item, oldQuantity) {
    const wasNegative = oldQuantity < 0;
    const isNegative = item.quantity < 0;
    
    if (wasNegative && !isNegative) {
      // Flipped from negative to positive
      // Remove "Auto" option and force to "Top Floor"
      if (item.shelfField === 'auto') {
        item.shelfField = 'top_floor_total';
      }
    } else if (!wasNegative && isNegative) {
      // Flipped from positive to negative
      // "Auto" option should reappear and become default
      item.shelfField = 'auto';
    }
  }

  setItemShelf(index, shelfValue) {
    if (index < 0 || index >= this.pendingItems.length) return;
    
    const item = this.pendingItems[index];
    
    // Validate stock availability for the new shelf if quantity is negative
    if (item.quantity < 0) {
      const validation = this.validateStockAvailability(item.sku, item.quantity, shelfValue);
      if (!validation.valid) {
        this.showMessage(validation.message, 'error');
        this.playErrorBeep();
        // Reset select to old value
        const selectEl = this.pendingItemsList?.querySelector(`select[data-index="${index}"]`);
        if (selectEl) selectEl.value = item.shelfField;
        return;
      }
    }
    
    item.shelfField = shelfValue;
    // Update UI to reflect the change
    this.updatePendingList();
  }

  removeItem(index) {
    if (index < 0 || index >= this.pendingItems.length) return;
    
    this.pendingItems.splice(index, 1);
    this.updatePendingList();
    this.showMessage('Item removed', 'info');
  }

  clearAllItems() {
    this.pendingItems = [];
    this.updatePendingList();
    this.showMessage('All items cleared', 'info');
  }

  showConfirmModal() {
    if (this.pendingItems.length === 0) {
      this.showMessage('No items to submit', 'error');
      return;
    }
    
    const reason = this.reasonInput?.value.trim();
    if (!reason) {
      this.showMessage('Please enter a reason for the adjustment', 'error');
      this.reasonInput?.focus();
      return;
    }
    
    // Build summary
    const addItems = this.pendingItems.filter(i => i.quantity > 0);
    const removeItems = this.pendingItems.filter(i => i.quantity < 0);
    
    const addTotal = addItems.reduce((sum, i) => sum + i.quantity, 0);
    const removeTotal = removeItems.reduce((sum, i) => sum + Math.abs(i.quantity), 0);
    
    const summaryHtml = `
      <div class="confirm-summary-content">
        ${removeItems.length > 0 ? `
          <div class="summary-section remove">
            <strong><i class="fas fa-minus-circle"></i> Removing:</strong> 
            ${removeItems.length} item${removeItems.length !== 1 ? 's' : ''} (${removeTotal} units)
          </div>
        ` : ''}
        ${addItems.length > 0 ? `
          <div class="summary-section add">
            <strong><i class="fas fa-plus-circle"></i> Adding:</strong> 
            ${addItems.length} item${addItems.length !== 1 ? 's' : ''} (${addTotal} units)
          </div>
        ` : ''}
        <div class="summary-section reason">
          <strong><i class="fas fa-comment"></i> Reason:</strong> ${reason}
        </div>
      </div>
    `;
    
    document.getElementById('confirmSummary').innerHTML = summaryHtml;
    
    if (this.confirmModal) {
      this.confirmModal.classList.add('active');
    }
  }

  hideConfirmModal() {
    if (this.confirmModal) {
      this.confirmModal.classList.remove('active');
    }
  }

  async submitAdjustments(autoTrigger = false) {
    if (!autoTrigger) {
      this.hideConfirmModal();
    }
    
    const reason = this.reasonInput?.value.trim() || 'Scanner adjustment';
    
    try {
      if (!autoTrigger) {
        this.submitBtn.disabled = true;
        this.submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
      }
      
      const results = {
        success: [],
        failed: []
      };
      
      // Submit each adjustment
      // Quantity is already signed: negative = remove, positive = add
      for (const item of this.pendingItems) {
        try {
          const response = await fetch(`${getApiUrl()}${BRANCH_CONFIG.adjustmentsApiPrefix}/log`, {
            method: 'POST',
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              barcode: item.itemId || item.sku,
              quantity: item.quantity, // Already signed
              reason: reason,
              field: item.shelfField,
              branch_id: BRANCH_CONFIG.branchId
            })
          });
          
          const responseData = await response.json().catch(() => ({}));
          if (response.ok) {
            item.allocationDetails = this.buildAllocationDetails(responseData.metadata_updated);
            results.success.push(item);
          } else {
            results.failed.push({ item, error: responseData.detail || 'Unknown error' });
          }
        } catch (error) {
          results.failed.push({ item, error: error.message });
        }
      }
      
      // Log the submission to scanning logs (only if at least one succeeded)
      if (results.success.length > 0) {
        await this.logSubmissionToScanningLogs(results.success, reason);
      }
      
      // Show results - skip modal for auto-triggered (barcode scan)
      if (autoTrigger) {
        if (results.failed.length === 0) {
          this.showMessage(`Submitted: ${results.success.map(i => i.name || i.sku).join(', ')}`, 'success');
        } else {
          this.showMessage(`Failed to submit: ${results.failed.map(f => f.item.sku).join(', ')}`, 'error');
        }
      } else {
        this.showSuccessModal(results);
      }
      
      // Clear pending items if all succeeded
      if (results.failed.length === 0) {
        this.pendingItems = [];
        this.updatePendingList();
        if (this.reasonInput) this.reasonInput.value = '';
      }
      
    } catch (error) {
      console.error('Error submitting adjustments:', error);
      showNotification(`Error submitting adjustments: ${error.message}`, 'error');
    } finally {
      if (!autoTrigger) {
        this.submitBtn.disabled = false;
        this.submitBtn.innerHTML = '<i class="fas fa-check"></i> Submit All Adjustments';
      }
    }
  }

  /**
   * Log submission to scanning logs for audit trail
   */
  async logSubmissionToScanningLogs(successItems, reason) {
    try {
      const items = successItems.map(item => ({
        sku: item.sku,
        item_id: item.itemId || null,
        product_name: item.name || null,
        quantity: item.quantity,
        shelf_field: item.shelfField,
        allocation_details: item.allocationDetails || null
      }));

      const response = await fetch(`${getApiUrl()}${BRANCH_CONFIG.scanningLogsApiPrefix}/log`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reason: reason,
          items: items
        })
      });

      if (!response.ok) {
        console.warn('Failed to log submission to scanning logs:', await response.text());
      } else {
        console.log('Submission logged to scanning logs successfully');
      }
    } catch (error) {
      // Log error but don't fail the submission
      console.warn('Error logging to scanning logs:', error);
    }
  }

  buildAllocationDetails(metadataUpdated) {
    if (!Array.isArray(metadataUpdated)) {
      return null;
    }

    return metadataUpdated.map(update => ({
      shelf: update.field,
      quantity: update.delta
    }));
  }

  showSuccessModal(results) {
    const successCount = results.success.length;
    const failedCount = results.failed.length;
    
    const addItems = results.success.filter(i => i.quantity > 0);
    const removeItems = results.success.filter(i => i.quantity < 0);
    const addTotal = addItems.reduce((sum, i) => sum + i.quantity, 0);
    const removeTotal = removeItems.reduce((sum, i) => sum + Math.abs(i.quantity), 0);
    
    let messageEl = document.getElementById('successMessage');
    let detailsEl = document.getElementById('successDetails');
    
    if (failedCount === 0) {
      if (messageEl) {
        messageEl.textContent = `All ${successCount} adjustment${successCount !== 1 ? 's' : ''} have been successfully applied.`;
      }
      if (detailsEl) {
        const parts = [];
        if (addTotal > 0) parts.push(`+${addTotal} added`);
        if (removeTotal > 0) parts.push(`-${removeTotal} removed`);
        detailsEl.innerHTML = `<div class="success-stat">${parts.join(', ') || 'No changes'}</div>`;
      }
    } else {
      if (messageEl) {
        messageEl.textContent = `${successCount} adjustment${successCount !== 1 ? 's' : ''} applied, ${failedCount} failed.`;
      }
      if (detailsEl) {
        detailsEl.innerHTML = `
          <div class="success-stat warning">
            <i class="fas fa-exclamation-triangle"></i> 
            Failed items: ${results.failed.map(f => f.item.sku).join(', ')}
          </div>
        `;
      }
    }
    
    if (this.successModal) {
      this.successModal.classList.add('active');
    }
  }

  hideSuccessModal() {
    if (this.successModal) {
      this.successModal.classList.remove('active');
    }
  }

  playBeep() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.1;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
      // Audio not supported
    }
  }

  playErrorBeep() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 300;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.1;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      // Audio not supported
    }
  }

  destroy() {
    // Cleanup if needed
    this.pendingItems = [];
  }
}

// Module state
let scannerManager = null;

export async function init(path) {
  console.log('[London Scanner] Initializing...');
  
  // Check tables status and initialize if needed (like Label Generator)
  try {
    showToast('Checking database tables...', 'info');
    const statusResult = await checkTablesStatus(BRANCH_CONFIG.branchId);
    if (statusResult.status === 'success' && !statusResult.all_tables_exist) {
      showToast('Initializing inventory tables...', 'info');
      console.log('[London Scanner] Some tables missing, initializing...', statusResult.tables_status);
      await initializeTables(BRANCH_CONFIG.branchId);
      console.log('[London Scanner] Tables initialized successfully');
    }
  } catch (error) {
    console.error('[London Scanner] Error checking/initializing tables:', error);
    // Continue anyway - scanner operations will handle errors
  }
  
  if (scannerManager) {
    scannerManager.destroy();
  }
  
  scannerManager = new InventoryScannerManager();
  
  console.log('[London Scanner] Initialized');
}

export async function cleanup() {
  console.log('[London Scanner] Cleaning up...');
  
  if (scannerManager) {
    scannerManager.destroy();
    scannerManager = null;
  }
}

export { cleanup as destroy };
