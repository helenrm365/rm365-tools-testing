// frontend/js/modules/magentodata/aggregated-filters.js
import { get, post, del, put } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';
import { initDatePicker } from '../../ui/datePicker.js';
import { initDropdown } from '../../ui/dropdown.js';
import { refreshAggregatedDataForRegion, getCustomRangeAggregatedData, getShippingMethods } from '../../services/api/magentoDataApi.js?v=9';

const API = '/v1/magentodata';

let currentRegion = null;
let searchDebounceTimer = null;
let excludedCustomers = [];
let excludedCustomerGroups = [];
let availableCustomerGroups = [];
let currentThreshold = null;
let currentQtyThreshold = null;
let currentSmartQtyRules = []; // Array of rules
let pendingCustomerAdds = []; // Customers to be added when Apply is clicked - {email, fullName, region, ruleType, divisor, productSku, productName}
let pendingCustomerRemoves = []; // Customer IDs to be removed when Apply is clicked
let pendingCustomerRuleUpdates = []; // Customer rule updates - {customerId, ruleType, divisor, productSku, productName}
let customersWithNoRules = []; // Customers to keep on list even with no rules - {email, fullName}
let pendingGroupAdds = []; // Customer groups to be added when Apply is clicked
let pendingGroupRemoves = []; // Customer group IDs to be removed when Apply is clicked
let availableStatuses = [];
let excludedStatuses = [];
let pendingStatusAdds = []; // Statuses to be added when Apply is clicked
let pendingStatusRemoves = []; // Status IDs to be removed when Apply is clicked
let currentSmartDateRules = []; // Array of date rules
let exchangeRates = null; // Cached exchange rates
let conversionDebounceTimer = null; // Debounce timer for currency conversion updates
let isApplying = false; // Global flag to prevent concurrent apply operations
let productSearchDebounceTimer = null; // Debounce timer for product search

/**
 * Show the filters modal for a specific region
 */
export function showFiltersModal(region) {
    currentRegion = region;
    
    // Reset pending changes
    pendingCustomerAdds = [];
    pendingCustomerRemoves = [];
    pendingCustomerRuleUpdates = [];
    customersWithNoRules = []; // Reset customers with no rules tracking
    pendingGroupAdds = [];
    pendingGroupRemoves = [];
    pendingStatusAdds = [];
    pendingStatusRemoves = [];
    
    const modal = createFiltersModal(region);
    document.body.appendChild(modal);
    
    // Load initial data
    loadExcludedCustomers();
    loadCustomerGroups();
    loadExcludedCustomerGroups();
    loadAvailableStatuses(region);
    loadExcludedStatuses();
    loadThreshold();
    loadQtyThreshold();
    loadSmartQtyRules();
    loadSmartDateRules();
    loadExchangeRates(region);
    
    // Focus on customer search input
    setTimeout(() => {
        const searchInput = modal.querySelector('.customer-search-input');
        if (searchInput) searchInput.focus();
    }, 100);
}

/**
 * Create the filters modal HTML
 */
function createFiltersModal(region) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay filters-modal-overlay active';
    overlay.id = 'filters-modal-overlay';
    overlay.innerHTML = `
        <div class="modal modal-lg" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-chart-bar"></i>
                </div>
                <h2 class="modal-title">6-Month Aggregation Rules - ${region.toUpperCase()}</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="modal-body">
                <!-- Customer Exclusions -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Excluded Customers</span>
                    </div>
                    <p class="filter-description">
                        Orders from these customers will not be included in the 6-month aggregated magento data.
                    </p>
                    
                    <div class="search-container">
                        <input 
                            type="text" 
                            class="nui-input nui-input-default" 
                            placeholder="Search by email or name..."
                            id="customer-search-${region}"
                        />
                        <div class="search-results-dropdown" id="search-results-${region}"></div>
                    </div>
                    
                    <div class="excluded-toggle-row" id="excluded-header-${region}">
                        <span class="excluded-count" id="excluded-count-${region}">0 customers excluded</span>
                        <button class="btn-text" id="excluded-toggle-${region}">
                            <span class="toggle-icon">▼</span> Show List
                        </button>
                    </div>
                    
                    <div class="excluded-list collapsed" id="excluded-list-${region}">
                        <div class="excluded-empty">No customers excluded yet</div>
                    </div>
                </div>
                
                <!-- Customer Group Exclusions -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Excluded Customer Groups</span>
                    </div>
                    <p class="filter-description">
                        Orders from these customer groups will not be included in the 6-month aggregated magento data.
                    </p>
                    
                    <div class="select-with-button">
                        <select id="customer-group-select-${region}">
                            <option value="">Select a customer group to exclude...</option>
                        </select>
                        <button class="btn btn-solid btn-success btn-sm" id="add-group-btn-${region}">
                            <i class="fas fa-plus"></i> Add
                        </button>
                    </div>
                    
                    <div class="excluded-toggle-row" id="excluded-groups-header-${region}">
                        <span class="excluded-count" id="excluded-groups-count-${region}">0 groups excluded</span>
                        <button class="btn-text" id="excluded-groups-toggle-${region}">
                            <span class="toggle-icon">▼</span> Show List
                        </button>
                    </div>
                    
                    <div class="excluded-list collapsed" id="excluded-groups-list-${region}">
                        <div class="excluded-empty">No customer groups excluded yet</div>
                    </div>
                </div>
                
                <!-- Order Status Exclusions -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Excluded Order Statuses</span>
                    </div>
                    <p class="filter-description">
                        Orders with these statuses will not be included in the 6-month aggregated magento data.
                    </p>
                    
                    <div class="select-with-button">
                        <select id="status-select-${region}">
                            <option value="">Select a status to exclude...</option>
                        </select>
                        <button class="btn btn-solid btn-success btn-sm" id="add-status-btn-${region}">
                            <i class="fas fa-plus"></i> Add
                        </button>
                    </div>
                    
                    <div class="excluded-toggle-row" id="excluded-statuses-header-${region}">
                        <span class="excluded-count" id="excluded-statuses-count-${region}">0 statuses excluded</span>
                        <button class="btn-text" id="excluded-statuses-toggle-${region}">
                            <span class="toggle-icon">▼</span> Show List
                        </button>
                    </div>
                    
                    <div class="excluded-list collapsed" id="excluded-statuses-list-${region}">
                        <div class="excluded-empty">No statuses excluded yet</div>
                    </div>
                </div>
                
                <!-- Grand Total Threshold -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Grand Total Threshold</span>
                    </div>
                    <p class="filter-description">
                        Orders with a grand total above this amount will be excluded from 6-month aggregated magento.
                        <strong>All currencies are automatically converted</strong> to ${region === 'uk' ? 'GBP (£)' : 'EUR (€)'} at current exchange rates for comparison.
                        <span id="currency-conversion-info-${region}" class="exchange-rate-info">
                            <i class="fas fa-sync fa-spin"></i> Loading exchange rates...
                        </span>
                    </p>
                    
                    <div class="input-with-prefix">
                        <span class="input-prefix">${region === 'uk' ? '£' : '€'}</span>
                        <input 
                            type="number" 
                            class="nui-input nui-input-default" 
                            placeholder="Leave empty for no threshold"
                            step="0.01"
                            min="0"
                            id="threshold-input-${region}"
                        />
                    </div>
                    
                    <div class="threshold-status" id="threshold-current-${region}">
                        Current: <strong>No threshold</strong> (all orders included)
                    </div>
                </div>
                
                <!-- Quantity Threshold -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Quantity Threshold</span>
                    </div>
                    <p class="filter-description">
                        Orders with a quantity above this amount will be excluded from 6-month aggregated magento.
                    </p>
                    
                    <div class="input-with-prefix">
                        <span class="input-prefix">Qty</span>
                        <input 
                            type="number" 
                            class="nui-input nui-input-default" 
                            placeholder="Leave empty for no threshold"
                            step="1"
                            min="0"
                            id="qty-threshold-input-${region}"
                        />
                    </div>
                    
                    <div class="threshold-status" id="qty-threshold-current-${region}">
                        Current: <strong>No threshold</strong> (all orders included)
                    </div>
                </div>

                <!-- Smart Quantity Filter -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Smart Quantity Filter</span>
                    </div>
                    <p class="filter-description">
                        Automatically adjust product quantities in aggregated data based on rules. Rules are applied in order during aggregation.
                    </p>
                    
                    <!-- Current Rules List -->
                    <div class="rules-list" id="smart-rules-list-${region}">
                        <div class="rules-empty">No rules configured. Add a rule below.</div>
                    </div>
                    
                    <!-- Add New Rule Form -->
                    <div class="rule-config-card">
                        <div class="rule-config-header">Add New Rule</div>
                        
                        <div class="rule-config-row">
                            <label class="rule-label">If quantity ≥</label>
                            <input 
                                type="number" 
                                class="nui-input nui-input-default" 
                                placeholder="100"
                                step="1"
                                min="1"
                                id="smart-qty-threshold-${region}"
                            />
                        </div>
                        
                        <div class="rule-config-row">
                            <label class="rule-label">Then</label>
                            <select id="smart-qty-action-select-${region}">
                                <option value="divide" selected>Divide by</option>
                                <option value="multiply">Multiply by</option>
                                <option value="subtract">Subtract</option>
                                <option value="set_to">Set to</option>
                            </select>
                            <input 
                                type="number" 
                                class="nui-input nui-input-default" 
                                placeholder="2"
                                step="0.1"
                                min="0.1"
                                id="smart-qty-divisor-${region}"
                            />
                        </div>
                        
                        <div class="rule-preview" id="smart-filter-preview-${region}">
                            <i class="fas fa-info-circle"></i> 
                            <span id="smart-filter-preview-text-${region}">Configure rule above to see preview</span>
                        </div>
                        
                        <div class="rule-actions">
                            <button class="btn btn-solid btn-success btn-sm" id="smart-filter-add-${region}">
                                <i class="fas fa-plus"></i> Add Rule
                            </button>
                            <button class="btn btn-solid btn-danger btn-sm" id="smart-filter-clear-all-${region}">
                                <i class="fas fa-trash"></i> Clear All
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Smart Date Filter -->
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Smart Date Rules</span>
                    </div>
                    <p class="filter-description">
                        Apply specific adjustment logic to orders created within a specific date range. These rules override smart quantity rules.
                    </p>
                    
                    <!-- Current Date Rules List -->
                    <div class="rules-list" id="smart-date-rules-list-${region}">
                        <div class="rules-empty">No date rules configured. Add a rule below.</div>
                    </div>
                    
                    <!-- Add New Date Rule Form -->
                    <div class="rule-config-card">
                        <div class="rule-config-header">Add Date Rule</div>
                        
                        <div class="rule-config-row">
                            <label class="rule-label">Range</label>
                            <input type="text" class="nui-input nui-input-default" id="smart-date-start-${region}">
                            <span class="rule-separator">to</span>
                            <input type="text" class="nui-input nui-input-default" id="smart-date-end-${region}">
                        </div>
                        
                        <div class="rule-config-row">
                            <label class="rule-label">Action</label>
                            <select id="smart-date-action-select-${region}">
                                <option value="exclude" selected>Exclude Entirely</option>
                                <option value="divide">Divide Qty by</option>
                                <option value="multiply">Multiply Qty by</option>
                                <option value="set_to">Set Qty to</option>
                            </select>
                            <input 
                                type="number" 
                                class="nui-input nui-input-default" 
                                placeholder="Value"
                                step="0.1"
                                min="0.1"
                                id="smart-date-value-${region}"
                                style="display: none;"
                            />
                        </div>
                        
                        <div class="rule-actions">
                            <button class="btn btn-solid btn-success btn-sm" id="smart-date-add-${region}">
                                <i class="fas fa-plus"></i> Add Rule
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Apply Options -->
                <div class="nui-field apply-options">
                    <label class="checkbox-label">
                        <input type="checkbox" class="form-checkbox" id="apply-to-custom-range-${region}">
                        <span>Also apply to Custom Range view</span>
                    </label>
                    <p class="filter-description">
                        If checked, the current custom range analysis (if active) will be refreshed with these filters.
                    </p>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-solid btn-default rounded-lg" onclick="this.closest('.modal-overlay').remove()">
                    Cancel
                </button>
                <button class="btn btn-solid btn-success" id="filters-apply-${region}">
                    <i class="fas fa-check"></i> Apply & Refresh 6M Data
                </button>
            </div>
        </div>
    `;
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
    
    // Setup event listeners
    setTimeout(() => {
        setupEventListeners(region);
        initDatePicker(`#smart-date-start-${region}`);
        initDatePicker(`#smart-date-end-${region}`);
    }, 0);
    
    return overlay;
}

/**
 * Setup all event listeners for the modal
 */
function setupEventListeners(region) {
    // Customer search input
    const searchInput = document.getElementById(`customer-search-${region}`);
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length >= 2) {
                debounceSearch(region, query);
            } else {
                hideSearchResults(region);
            }
        });
        
        // Close search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.customer-search-container')) {
                hideSearchResults(region);
            }
        });
    }
    
    // Setup native select handlers
    setupSelectHandlers(region);
    
    // Excluded customers list toggle
    const toggleBtn = document.getElementById(`excluded-toggle-${region}`);
    const excludedList = document.getElementById(`excluded-list-${region}`);
    if (toggleBtn && excludedList) {
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = excludedList.classList.contains('collapsed');
            if (isCollapsed) {
                excludedList.classList.remove('collapsed');
                toggleBtn.innerHTML = '<span class="toggle-icon">▲</span> Hide List';
            } else {
                excludedList.classList.add('collapsed');
                toggleBtn.innerHTML = '<span class="toggle-icon">▼</span> Show List';
            }
        });
    }
    
    // Customer group add button
    const addGroupBtn = document.getElementById(`add-group-btn-${region}`);
    const groupSelect = document.getElementById(`customer-group-select-${region}`);
    if (addGroupBtn && groupSelect) {
        addGroupBtn.addEventListener('click', () => {
            const selectedGroup = groupSelect.value;
            if (selectedGroup) {
                addCustomerGroupToPending(selectedGroup);
                // Reset select
                groupSelect.value = '';
            }
        });
    }
    
    // Excluded customer groups list toggle
    const groupsToggleBtn = document.getElementById(`excluded-groups-toggle-${region}`);
    const excludedGroupsList = document.getElementById(`excluded-groups-list-${region}`);
    if (groupsToggleBtn && excludedGroupsList) {
        groupsToggleBtn.addEventListener('click', () => {
            const isCollapsed = excludedGroupsList.classList.contains('collapsed');
            if (isCollapsed) {
                excludedGroupsList.classList.remove('collapsed');
                groupsToggleBtn.innerHTML = '<span class="toggle-icon">▲</span> Hide List';
            } else {
                excludedGroupsList.classList.add('collapsed');
                groupsToggleBtn.innerHTML = '<span class="toggle-icon">▼</span> Show List';
            }
        });
    }

    // Status list toggle
    const statusToggleBtn = document.getElementById(`excluded-statuses-toggle-${region}`);
    const statusList = document.getElementById(`excluded-statuses-list-${region}`);
    if (statusToggleBtn && statusList) {
        statusToggleBtn.addEventListener('click', () => {
            const isCollapsed = statusList.classList.contains('collapsed');
            if (isCollapsed) {
                statusList.classList.remove('collapsed');
                statusToggleBtn.innerHTML = '<span class="toggle-icon">▲</span> Hide List';
            } else {
                statusList.classList.add('collapsed');
                statusToggleBtn.innerHTML = '<span class="toggle-icon">▼</span> Show List';
            }
        });
    }

    // Status add button
    const addStatusBtn = document.getElementById(`add-status-btn-${region}`);
    const statusSelect = document.getElementById(`status-select-${region}`);
    if (addStatusBtn && statusSelect) {
        addStatusBtn.addEventListener('click', () => {
            const status = statusSelect.value;
            if (status) {
                addExcludedStatus(status);
                // Reset select
                statusSelect.value = '';
            } else {
                showToast('Please select a status to exclude', 'warning');
            }
        });
    }
    
    // Apply filters button - use 'once' option to prevent duplicate listeners
    const applyBtn = document.getElementById(`filters-apply-${region}`);
    if (applyBtn) {
        applyBtn.addEventListener('click', () => applyAllFilters(region), { once: true });
    }
    
    // Threshold input - update conversion display as user types
    const thresholdInput = document.getElementById(`threshold-input-${region}`);
    if (thresholdInput) {
        thresholdInput.addEventListener('input', (e) => {
            debounceConversionUpdate(region, e.target.value);
        });
    }
    
    // Smart qty filter inputs - update preview as user types
    const smartThresholdInput = document.getElementById(`smart-qty-threshold-${region}`);
    const smartDivisorInput = document.getElementById(`smart-qty-divisor-${region}`);
    const smartAddBtn = document.getElementById(`smart-filter-add-${region}`);
    const smartClearAllBtn = document.getElementById(`smart-filter-clear-all-${region}`);
    
    if (smartThresholdInput) {
        smartThresholdInput.addEventListener('input', () => updateSmartFilterPreview());
    }
    if (smartDivisorInput) {
        smartDivisorInput.addEventListener('input', () => updateSmartFilterPreview());
    }
    if (smartAddBtn) {
        smartAddBtn.addEventListener('click', () => addSmartQtyRule());
    }
    if (smartClearAllBtn) {
        smartClearAllBtn.addEventListener('click', () => clearAllSmartQtyRules());
    }

    // Smart Date Rules listeners
    const smartDateAddBtn = document.getElementById(`smart-date-add-${region}`);

    if (smartDateAddBtn) {
        smartDateAddBtn.addEventListener('click', () => addSmartDateRule());
    }
}

/**
 * Setup custom dropdown handlers for the modal
 */
/**
 * Setup native select change handlers for the modal
 */
function setupSelectHandlers(region) {
    // Smart qty action select - show/hide value input based on action
    const smartQtyActionSelect = document.getElementById(`smart-qty-action-select-${region}`);
    if (smartQtyActionSelect) {
        smartQtyActionSelect.addEventListener('change', () => {
            updateSmartFilterPreview();
        });
    }
    
    // Smart date action select - show/hide value input based on action
    const smartDateActionSelect = document.getElementById(`smart-date-action-select-${region}`);
    if (smartDateActionSelect) {
        smartDateActionSelect.addEventListener('change', () => {
            const value = smartDateActionSelect.value;
            const valueInput = document.getElementById(`smart-date-value-${region}`);
            if (valueInput) {
                valueInput.style.display = value === 'exclude' ? 'none' : 'block';
            }
        });
    }
    
    // Initialize nui-dropdown for dynamically added selects
    initDropdown(`#customer-group-select-${region}`);
    initDropdown(`#status-select-${region}`);
    initDropdown(`#smart-qty-action-select-${region}`);
    initDropdown(`#smart-date-action-select-${region}`);
}

/**
 * Show custom confirmation dialog
 */
function showConfirmDialog(message) {
    return new Promise((resolve) => {
        // Hide the parent filters modal while showing confirmation
        const filtersModal = document.getElementById('filters-modal-overlay');
        if (filtersModal) {
            filtersModal.style.display = 'none';
        }
        
        // Create overlay with solid dark background
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            z-index: 10001;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        // Create dialog using modal classes for consistency
        const dialog = document.createElement('div');
        dialog.className = 'modal';
        dialog.style.cssText = `
            max-width: 420px;
            width: 90%;
        `;
        dialog.onclick = (e) => e.stopPropagation();
        
        dialog.innerHTML = `
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-sync-alt"></i>
                </div>
                <h2 class="modal-title">Confirm Rule Changes</h2>
                <button class="modal-close" id="confirm-close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <p style="color: var(--text-secondary); line-height: 1.5; margin: 0;">
                    ${message}
                </p>
            </div>
            <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="confirm-cancel" class="btn btn-solid btn-default rounded-lg">Cancel</button>
                <button id="confirm-ok" class="btn btn-solid btn-success">Apply & Refresh</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        // Helper function to close and restore parent
        const closeAndRestore = () => {
            overlay.remove();
            if (filtersModal) {
                filtersModal.style.display = '';
            }
        };
        
        // Get button references
        const cancelBtn = dialog.querySelector('#confirm-cancel');
        const okBtn = dialog.querySelector('#confirm-ok');
        const closeBtn = dialog.querySelector('#confirm-close-btn');
        
        // Handle close button (X)
        closeBtn.addEventListener('click', () => {
            closeAndRestore();
            resolve(false);
        });
        
        // Handle cancel button
        cancelBtn.addEventListener('click', () => {
            closeAndRestore();
            resolve(false);
        });
        
        // Handle clicking overlay background
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeAndRestore();
                resolve(false);
            }
        });
        
        okBtn.addEventListener('click', () => {
            overlay.remove();
            // Keep the parent modal hidden - it will be closed after apply completes
            resolve(true);
        });
        
        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeAndRestore();
                document.removeEventListener('keydown', handleEscape);
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Apply all filter changes at once
 * Version: 2026-01-09-v2 - Enhanced double-execution prevention with global flag
 */
async function applyAllFilters(region) {
    console.log('[Filters] applyAllFilters called for region:', region, 'isApplying:', isApplying);
    
    // FIRST GUARD: Check global flag
    if (isApplying) {
        console.warn('[Filters] ⚠️ Apply operation already in progress! Blocking duplicate execution.');
        showToast('⚠️ Filters are already being applied, please wait...', 'warning');
        return;
    }
    
    const applyBtn = document.getElementById(`filters-apply-${region}`);
    if (!applyBtn) return;
    
    // SECOND GUARD: Check button state
    if (applyBtn.disabled) {
        console.warn('[Filters] ⚠️ Button already disabled! Blocking duplicate execution.');
        return;
    }
    
    // Set global flag and disable button IMMEDIATELY
    isApplying = true;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Confirming...';
    console.log('[Filters] ✅ Guards activated. isApplying=true, button disabled.');
    const applyToCustomRangeCheckbox = document.getElementById(`apply-to-custom-range-${region}`);
    const shouldApplyToCustomRange = applyToCustomRangeCheckbox ? applyToCustomRangeCheckbox.checked : false;
    
    // Show custom confirmation dialog
    const confirmMessage = 'Apply all filter changes and refresh 6M aggregated magento data?';
    const confirmed = await showConfirmDialog(confirmMessage);
    if (!confirmed) {
        console.log('[Filters] User cancelled confirmation.');
        // Re-enable if user cancels
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply & Refresh 6M Data';
        isApplying = false;
        return;
    }
    
    console.log('[Filters] User confirmed. Starting filter application...');
    applyBtn.textContent = 'Applying...';
    
    let hasErrors = false;
    const errors = [];
    
    try {
        // 1. Save customer exclusions (add and remove)
        for (const customer of pendingCustomerAdds) {
            try {
                // Build URL with rule parameters
                let url = `${API}/filters/customers/${customer.region}?email=${encodeURIComponent(customer.email)}&full_name=${encodeURIComponent(customer.fullName || '')}`;
                url += `&rule_type=${encodeURIComponent(customer.ruleType || 'exclude_all')}`;
                url += `&divisor=${customer.divisor || 2}`;
                if (customer.productSku) {
                    url += `&product_sku=${encodeURIComponent(customer.productSku)}`;
                }
                if (customer.productName) {
                    url += `&product_name=${encodeURIComponent(customer.productName)}`;
                }
                
                const response = await post(url);
                if (response.status !== 'success' && response.status !== 'info') {
                    // Use specific error message if available (e.g., conflict message)
                    const errorMsg = response.error || response.message || `Failed to add ${customer.email}`;
                    errors.push(errorMsg);
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error adding customer:', error);
                errors.push(`Error adding ${customer.email}`);
                hasErrors = true;
            }
        }
        
        for (const customerId of pendingCustomerRemoves) {
            try {
                const response = await del(`${API}/filters/customers/${customerId}`);
                if (response.status !== 'success') {
                    errors.push(`Failed to remove customer ID ${customerId}`);
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error removing customer:', error);
                errors.push(`Error removing customer ID ${customerId}`);
                hasErrors = true;
            }
        }
        
        // 1b. Save customer rule updates
        for (const update of pendingCustomerRuleUpdates) {
            try {
                let url = `${API}/filters/customers/${update.customerId}?rule_type=${encodeURIComponent(update.ruleType)}`;
                url += `&divisor=${update.divisor || 2}`;
                if (update.productSku) {
                    url += `&product_sku=${encodeURIComponent(update.productSku)}`;
                }
                if (update.productName) {
                    url += `&product_name=${encodeURIComponent(update.productName)}`;
                }
                
                const response = await put(url, {});
                if (response.status !== 'success') {
                    errors.push(`Failed to update rule for customer ID ${update.customerId}`);
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error updating customer rule:', error);
                errors.push(`Error updating customer rule`);
                hasErrors = true;
            }
        }
        
        // 2. Save customer group exclusions (add and remove)
        for (const customerGroup of pendingGroupAdds) {
            try {
                const response = await post(`${API}/filters/customer-groups/${region}?customer_group=${encodeURIComponent(customerGroup)}`);
                if (response.status !== 'success' && response.status !== 'info') {
                    errors.push(`Failed to add ${customerGroup}`);
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error adding customer group:', error);
                errors.push(`Error adding ${customerGroup}`);
                hasErrors = true;
            }
        }
        
        for (const groupId of pendingGroupRemoves) {
            try {
                const response = await del(`${API}/filters/customer-groups/${groupId}`);
                if (response.status !== 'success') {
                    errors.push(`Failed to remove customer group ID ${groupId}`);
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error removing customer group:', error);
                errors.push(`Error removing customer group ID ${groupId}`);
                hasErrors = true;
            }
        }
        
        // 3. Save grand total threshold (or clear it if empty)
        const thresholdInput = document.getElementById(`threshold-input-${region}`);
        if (thresholdInput) {
            const value = thresholdInput.value.trim();
            try {
                let response;
                if (value === '') {
                    // Clear the threshold by sending null
                    response = await post(`${API}/filters/threshold/${region}`);
                } else {
                    const threshold = parseFloat(value);
                    if (!isNaN(threshold) && threshold >= 0) {
                        response = await post(`${API}/filters/threshold/${region}?threshold=${threshold}`);
                    } else {
                        errors.push('Invalid grand total threshold value');
                        hasErrors = true;
                    }
                }
                
                if (response && response.status !== 'success' && response.status !== 'info') {
                    errors.push('Failed to save grand total threshold');
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error saving threshold:', error);
                errors.push('Error saving grand total threshold');
                hasErrors = true;
            }
        }
        
        // 4. Save qty threshold (or clear it if empty)
        const qtyThresholdInput = document.getElementById(`qty-threshold-input-${region}`);
        if (qtyThresholdInput) {
            const value = qtyThresholdInput.value.trim();
            try {
                let response;
                if (value === '') {
                    // Clear the threshold by sending null
                    response = await post(`${API}/filters/qty-threshold/${region}`);
                } else {
                    const qtyThreshold = parseInt(value);
                    if (!isNaN(qtyThreshold) && qtyThreshold >= 0) {
                        response = await post(`${API}/filters/qty-threshold/${region}?qty_threshold=${qtyThreshold}`);
                    } else {
                        errors.push('Invalid quantity threshold value');
                        hasErrors = true;
                    }
                }
                
                if (response && response.status !== 'success' && response.status !== 'info') {
                    errors.push('Failed to save quantity threshold');
                    hasErrors = true;
                }
            } catch (error) {
                console.error('Error saving qty threshold:', error);
                errors.push('Error saving quantity threshold');
                hasErrors = true;
            }
        }

        // 5. Save status exclusions
        for (const status of pendingStatusAdds) {
            try {
                const response = await post(`${API}/filters/status/${region}?status=${encodeURIComponent(status)}`);
                if (response.status !== 'success' && response.status !== 'info') {
                    errors.push(`Failed to exclude status: ${status}`);
                    hasErrors = true;
                }
            } catch (error) {
                 errors.push(`Error excluding status: ${status}`);
                 hasErrors = true;
            }
        }

        for (const id of pendingStatusRemoves) {
            try {
                 const response = await del(`${API}/filters/status/${id}`);
                 if (response.status !== 'success') {
                     errors.push(`Failed to remove status exclusion`);
                     hasErrors = true;
                 }
            } catch (error) {
                 errors.push(`Error removing status exclusion`);
                 hasErrors = true;
            }
        }
        
        // 6. Smart qty rules are already saved individually via Add Rule button
        // No need to save them here
        
        // 7. Refresh 6M aggregated data
        if (!hasErrors) {
            showToast('💾 Filters saved! Refreshing 6M aggregated data...', 'info');
            
            try {
                const refreshResult = await refreshAggregatedDataForRegion(region);
                if (refreshResult.status === 'success') {
                    showToast(`✅ Filters applied and 6M data refreshed! ${refreshResult.rows_aggregated} SKUs processed.`, 'success');
                    
                    // Close the modal (this also prevents further clicks)
                    const modalOverlay = document.querySelector('.filters-modal-overlay');
                    if (modalOverlay) {
                        modalOverlay.remove();
                        console.log('[Filters] Modal removed.');
                    }
                    
                    // Reset guards AFTER modal is removed
                    isApplying = false;
                    console.log('[Filters] Guards reset after modal removal.');
                    
                    // Reload the page data if on aggregated view
                    const reloadEvent = new CustomEvent('aggregated-data-refreshed', { detail: { region } });
                    document.dispatchEvent(reloadEvent);

                    // Apply to custom range if requested and active
                    if (shouldApplyToCustomRange && window.customRangeActive && window.customRangeActive.region === region) {
                        showToast('🔄 Refreshing Custom Range data...', 'info');
                        try {
                            const { rangeType, rangeValue, shippingMethod: activeShippingMethod } = window.customRangeActive;
                            // Force useExclusions=true since we just applied filters
                            const response = await getCustomRangeAggregatedData(region, rangeType, rangeValue, true, 1000, 0, '', activeShippingMethod || '');
                            
                            if (response.status === 'success' && response.data) {
                                // Update global state
                                window.customRangeActive.data = response.data;
                                window.customRangeActive.totalCount = response.total_count;
                                window.customRangeActive.useExclusions = true;
                                
                                // Dispatch event to update view
                                window.dispatchEvent(new CustomEvent('customRangeApplied', {
                                    detail: {
                                        region,
                                        rangeLabel: window.customRangeActive.rangeLabel
                                    }
                                }));
                                showToast('✅ Custom Range data refreshed!', 'success');
                            }
                        } catch (e) {
                            console.error('Error refreshing custom range:', e);
                            showToast('⚠️ Failed to refresh custom range data', 'warning');
                        }
                    }
                } else {
                    showToast(`⚠️ Filters saved but refresh failed: ${refreshResult.message}`, 'warning');
                }
            } catch (error) {
                console.error('Error refreshing data:', error);
                showToast('⚠️ Filters saved but refresh failed', 'warning');
            }
        } else {
            showToast(`⚠️ Some changes failed to save:\n${errors.join('\n')}`, 'error');
            // Reset guards on error
            isApplying = false;
            applyBtn.disabled = false;
            applyBtn.textContent = 'Apply & Refresh 6M Data';
            // Restore the modal visibility
            const filtersModal = document.getElementById('filters-modal-overlay');
            if (filtersModal) {
                filtersModal.style.display = '';
            }
        }
        
    } catch (error) {
        console.error('[Filters] Error applying filters:', error);
        showToast('❌ Failed to apply filters', 'error');
        // Reset guards on error
        isApplying = false;
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply & Refresh 6M Data';
        // Restore the modal visibility
        const filtersModal = document.getElementById('filters-modal-overlay');
        if (filtersModal) {
            filtersModal.style.display = '';
        }
    }
    // Note: No finally block - guards are reset in success path after modal closes, or immediately on error
}

/**
 * Debounce search input
 */
function debounceSearch(region, query) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        searchCustomers(region, query);
    }, 300);
}

/**
 * Search for customers
 */
async function searchCustomers(region, query) {
    try {
        const response = await get(`${API}/filters/customers/search/${region}?q=${encodeURIComponent(query)}`);
        
        if (response.status === 'success') {
            displaySearchResults(region, response.customers);
        }
    } catch (error) {
        console.error('Error searching customers:', error);
    }
}

/**
 * Display search results
 */
function displaySearchResults(region, customers) {
    const resultsContainer = document.getElementById(`search-results-${region}`);
    if (!resultsContainer) return;
    
    // Filter out customers that are already excluded or pending exclusion
    const currentlyExcludedEmails = [
        ...excludedCustomers.filter(c => !pendingCustomerRemoves.includes(c.id)).map(c => c.customer_email),
        ...pendingCustomerAdds.map(c => c.email)
    ];
    
    const filteredCustomers = customers.filter(customer => !currentlyExcludedEmails.includes(customer.email));
    
    if (filteredCustomers.length === 0) {
        resultsContainer.innerHTML = '<div class="search-no-results">No customers found</div>';
        resultsContainer.classList.add('visible');
        return;
    }
    
    resultsContainer.innerHTML = filteredCustomers.map(customer => `
        <div class="search-result-item" data-email="${escapeHtml(customer.email)}" data-name="${escapeHtml(customer.full_name || '')}">
            <div class="result-email">${escapeHtml(customer.email)}</div>
            ${customer.full_name ? `<div class="result-name">${escapeHtml(customer.full_name)}</div>` : ''}
        </div>
    `).join('');
    
    resultsContainer.classList.add('visible');
    
    // Add click handlers
    resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const email = item.dataset.email;
            const name = item.dataset.name;
            addExcludedCustomer(region, email, name);
            hideSearchResults(region);
            
            // Clear search input
            const searchInput = document.getElementById(`customer-search-${region}`);
            if (searchInput) searchInput.value = '';
        });
    });
}

/**
 * Hide search results
 */
function hideSearchResults(region) {
    const resultsContainer = document.getElementById(`search-results-${region}`);
    if (resultsContainer) {
        resultsContainer.classList.remove('visible');
    }
}

/**
 * Load excluded customers list
 */
async function loadExcludedCustomers() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/customers/${currentRegion}`);
        
        if (response.status === 'success') {
            excludedCustomers = response.customers;
            displayExcludedCustomers();
        }
    } catch (error) {
        console.error('Error loading excluded customers:', error);
    }
}

/**
 * Display excluded customers list - grouped by email with multiple rules
 */
function displayExcludedCustomers() {
    const listContainer = document.getElementById(`excluded-list-${currentRegion}`);
    const countElement = document.getElementById(`excluded-count-${currentRegion}`);
    
    if (!listContainer) return;
    
    // Combine current + pending adds - pending removes
    const allRules = [
        ...excludedCustomers.filter(c => !pendingCustomerRemoves.includes(c.id)).map(c => {
            // Check if there's a pending rule update for this customer
            const pendingUpdate = pendingCustomerRuleUpdates.find(u => u.customerId === c.id);
            if (pendingUpdate) {
                return { ...c, rule_type: pendingUpdate.ruleType, divisor: pendingUpdate.divisor, 
                         product_sku: pendingUpdate.productSku, product_name: pendingUpdate.productName, hasPendingUpdate: true };
            }
            return c;
        }),
        ...pendingCustomerAdds.map((c, idx) => ({ 
            id: `pending-${idx}`, email: c.email, full_name: c.fullName, isPending: true,
            rule_type: c.ruleType || 'exclude_all', divisor: c.divisor || 2, 
            product_sku: c.productSku, product_name: c.productName 
        }))
    ];
    
    // Group rules by email
    const customerGroups = {};
    allRules.forEach(rule => {
        if (!customerGroups[rule.email]) {
            customerGroups[rule.email] = {
                email: rule.email,
                full_name: rule.full_name,
                rules: []
            };
        }
        customerGroups[rule.email].rules.push(rule);
    });
    
    // Add customers with no rules (kept on list but all rules removed)
    customersWithNoRules.forEach(customer => {
        if (!customerGroups[customer.email]) {
            customerGroups[customer.email] = {
                email: customer.email,
                full_name: customer.fullName,
                rules: [],
                hasNoRules: true
            };
        }
    });
    
    const groupedCustomers = Object.values(customerGroups);
    const totalRules = allRules.length;
    
    // Update count
    if (countElement) {
        const uniqueCustomers = groupedCustomers.length;
        const pendingCount = pendingCustomerAdds.length + pendingCustomerRemoves.length + pendingCustomerRuleUpdates.length;
        const pendingText = pendingCount > 0 ? ` (${pendingCount} pending)` : '';
        
        if (uniqueCustomers === 0) {
            countElement.textContent = 'No customers excluded';
        } else if (totalRules === uniqueCustomers) {
            countElement.textContent = uniqueCustomers === 1 ? `1 customer excluded${pendingText}` : 
                                       `${uniqueCustomers} customers excluded${pendingText}`;
        } else {
            countElement.textContent = `${uniqueCustomers} customers, ${totalRules} rules${pendingText}`;
        }
    }
    
    if (groupedCustomers.length === 0) {
        listContainer.innerHTML = '<div class="excluded-empty">No customers excluded yet</div>';
        return;
    }
    
    listContainer.innerHTML = groupedCustomers.map(customer => {
        const hasProductRules = customer.rules.some(r => r.rule_type === 'divide_product');
        const hasBaseRule = customer.rules.some(r => r.rule_type === 'exclude_all' || r.rule_type === 'divide_all');
        const allPending = customer.rules.length > 0 && customer.rules.every(r => r.isPending);
        const anyPendingRemove = customer.rules.some(r => pendingCustomerRemoves.includes(r.id));
        const allPendingRemove = customer.rules.length > 0 && customer.rules.every(r => pendingCustomerRemoves.includes(r.id) || r.isPending);
        const anyPendingUpdate = customer.rules.some(r => r.hasPendingUpdate);
        const hasNoRules = customer.hasNoRules || customer.rules.length === 0;
        
        // Get all rule IDs for this customer (for remove all functionality)
        const ruleIds = customer.rules.filter(r => !r.isPending).map(r => r.id);
        const pendingRuleIndices = customer.rules.filter(r => r.isPending).map(r => r.id);
        
        return `
            <div class="excluded-customer-group ${allPending ? 'pending-add' : ''} ${allPendingRemove ? 'pending-remove' : ''} ${anyPendingUpdate ? 'pending-update' : ''} ${hasNoRules ? 'no-rules' : ''}">
                <div class="excluded-customer-header">
                    <div class="excluded-item-info">
                        <div class="excluded-item-email">
                            ${escapeHtml(customer.email)}
                            ${allPending ? '<span class="pending-badge">NEW</span>' : ''}
                            ${allPendingRemove && !allPending ? '<span class="pending-badge remove">REMOVING</span>' : ''}
                            ${hasNoRules && !allPending ? '<span class="pending-badge warning">NO RULES</span>' : ''}
                        </div>
                        ${customer.full_name ? `<div class="excluded-item-name">${escapeHtml(customer.full_name)}</div>` : ''}
                    </div>
                    <div class="excluded-item-actions">
                        <button class="excluded-item-add-rule" data-email="${escapeHtml(customer.email)}" data-full-name="${escapeHtml(customer.full_name || '')}" data-has-base-rule="${hasBaseRule}" title="Add Rule">
                            <i class="fas fa-plus"></i>
                        </button>
                        <button class="excluded-customer-remove-all" data-rule-ids="${ruleIds.join(',')}" data-pending-indices="${pendingRuleIndices.join(',')}" data-email="${escapeHtml(customer.email)}" title="Remove Customer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="excluded-customer-rules">
                    ${customer.rules.length === 0 ? 
                        '<div class="excluded-rule-empty">This customer currently has no rules. Add a rule or remove the customer.</div>' :
                        customer.rules.map(rule => {
                        const isPendingRemove = pendingCustomerRemoves.includes(rule.id);
                        const ruleClass = rule.isPending ? 'pending-add' : 
                                         isPendingRemove ? 'pending-remove' : 
                                         rule.hasPendingUpdate ? 'pending-update' : '';
                        const ruleBadge = rule.isPending ? '<span class="pending-badge small">NEW</span>' :
                                         isPendingRemove ? '<span class="pending-badge remove small">REMOVE</span>' : 
                                         rule.hasPendingUpdate ? '<span class="pending-badge update small">UPDATED</span>' : '';
                        const ruleDisplay = formatRuleDisplay(rule.rule_type, rule.divisor, rule.product_sku, rule.product_name);
                        
                        return `
                            <div class="excluded-rule-item ${ruleClass}" data-rule-id="${rule.id}">
                                <div class="excluded-rule-content">
                                    ${ruleDisplay} ${ruleBadge}
                                </div>
                                <div class="excluded-rule-actions">
                                    <button class="excluded-item-edit" data-id="${rule.id}" data-email="${escapeHtml(rule.email)}" title="Edit Rule">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="excluded-item-remove" data-id="${rule.id}" title="${isPendingRemove ? 'Undo' : 'Remove'}">
                                        ${isPendingRemove ? '<i class="fas fa-undo"></i>' : '<i class="fas fa-times"></i>'}
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
    
    // Add "Add Rule" handlers - shows modal with rule type selection
    listContainer.querySelectorAll('.excluded-item-add-rule').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.dataset.email;
            const fullName = btn.dataset.fullName;
            const hasBaseRule = btn.dataset.hasBaseRule === 'true';
            showAddRuleModal(email, fullName, hasBaseRule);
        });
    });
    
    // Add "Remove Customer" handlers - removes all rules for the customer
    listContainer.querySelectorAll('.excluded-customer-remove-all').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.dataset.email;
            const ruleIds = btn.dataset.ruleIds ? btn.dataset.ruleIds.split(',').filter(id => id).map(id => parseInt(id)) : [];
            const pendingIndices = btn.dataset.pendingIndices ? btn.dataset.pendingIndices.split(',').filter(id => id) : [];
            
            // Check if this customer is in the "no rules" state
            const isNoRulesCustomer = customersWithNoRules.some(c => c.email === email);
            
            // Check if all rules are already pending removal
            const allPendingRemove = ruleIds.length > 0 && ruleIds.every(id => pendingCustomerRemoves.includes(id));
            
            if ((allPendingRemove || isNoRulesCustomer) && pendingIndices.length === 0) {
                // Undo the removal
                ruleIds.forEach(id => {
                    const idx = pendingCustomerRemoves.indexOf(id);
                    if (idx >= 0) pendingCustomerRemoves.splice(idx, 1);
                });
                // Also remove from customersWithNoRules if present
                const noRulesIdx = customersWithNoRules.findIndex(c => c.email === email);
                if (noRulesIdx >= 0) {
                    customersWithNoRules.splice(noRulesIdx, 1);
                }
                showToast(`📝 Cancelled removing ${email}`, 'info');
            } else {
                // Remove all pending adds for this customer
                for (let i = pendingCustomerAdds.length - 1; i >= 0; i--) {
                    if (pendingCustomerAdds[i].email === email) {
                        pendingCustomerAdds.splice(i, 1);
                    }
                }
                // Stage all existing rules for removal
                ruleIds.forEach(id => {
                    if (!pendingCustomerRemoves.includes(id)) {
                        pendingCustomerRemoves.push(id);
                    }
                });
                // Also remove from customersWithNoRules - we're fully deleting this customer
                const noRulesIdx = customersWithNoRules.findIndex(c => c.email === email);
                if (noRulesIdx >= 0) {
                    customersWithNoRules.splice(noRulesIdx, 1);
                }
                showToast(`📝 ${email} will be removed (click Apply to save)`, 'info');
            }
            displayExcludedCustomers();
        });
    });
    
    // Add edit handlers
    listContainer.querySelectorAll('.excluded-item-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const customerId = btn.dataset.id;
            const email = btn.dataset.email;
            showRuleEditModal(customerId, email);
        });
    });
    
    // Add remove handlers (for individual rules)
    listContainer.querySelectorAll('.excluded-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const customerId = btn.dataset.id;
            if (customerId.startsWith('pending-')) {
                // Remove from pending adds
                const idx = parseInt(customerId.split('-')[1]);
                const removed = pendingCustomerAdds.splice(idx, 1)[0];
                showToast(`📝 Cancelled adding rule for ${removed.email}`, 'info');
                displayExcludedCustomers();
            } else {
                const id = parseInt(customerId);
                if (pendingCustomerRemoves.includes(id)) {
                    // Undo the pending remove
                    const idx = pendingCustomerRemoves.indexOf(id);
                    pendingCustomerRemoves.splice(idx, 1);
                    const customer = excludedCustomers.find(c => c.id === id);
                    
                    // If customer was in customersWithNoRules because all rules were pending remove,
                    // and now we're undoing one, remove them from the no-rules list
                    if (customer) {
                        const noRulesIdx = customersWithNoRules.findIndex(c => c.email === customer.email);
                        if (noRulesIdx >= 0) {
                            customersWithNoRules.splice(noRulesIdx, 1);
                        }
                    }
                    
                    showToast(`📝 Cancelled removing rule for ${customer?.email || 'customer'}`, 'info');
                    displayExcludedCustomers();
                } else {
                    // Stage for removal (individual rule)
                    const customer = excludedCustomers.find(c => c.id === id);
                    pendingCustomerRemoves.push(id);
                    
                    // Check if all rules for this customer are now pending removal
                    if (customer) {
                        const customerRules = excludedCustomers.filter(c => c.email === customer.email);
                        const customerPendingAdds = pendingCustomerAdds.filter(c => c.email === customer.email);
                        const allRulesRemoved = customerRules.every(r => pendingCustomerRemoves.includes(r.id));
                        const noPendingAdds = customerPendingAdds.length === 0;
                        
                        // If all existing rules are staged for removal and no pending adds,
                        // keep the customer on the list with no rules
                        if (allRulesRemoved && noPendingAdds) {
                            // Add to customersWithNoRules if not already there
                            if (!customersWithNoRules.some(c => c.email === customer.email)) {
                                customersWithNoRules.push({
                                    email: customer.email,
                                    fullName: customer.full_name || ''
                                });
                            }
                        }
                    }
                    
                    showToast(`📝 Rule will be removed (click Apply to save)`, 'info');
                    displayExcludedCustomers();
                }
            }
        });
    });
}

/**
 * Format rule display for customer exclusion
 */
function formatRuleDisplay(ruleType, divisor, productSku, productName) {
    switch (ruleType) {
        case 'exclude_all':
            return '<span class="rule-badge rule-exclude"><i class="fas fa-ban"></i> Exclude All Orders</span>';
        case 'divide_all':
            return `<span class="rule-badge rule-divide"><i class="fas fa-divide"></i> Divide All by ${divisor || 2}</span>`;
        case 'divide_product':
            const productDisplay = productName ? escapeHtml(productName) : escapeHtml(productSku || 'Unknown');
            return `<span class="rule-badge rule-divide-product"><i class="fas fa-box"></i> Divide "${productDisplay}" by ${divisor || 2}</span>`;
        default:
            return '<span class="rule-badge rule-exclude"><i class="fas fa-ban"></i> Exclude All</span>';
    }
}

/**
 * Show modal to edit customer exclusion rule
 */
function showRuleEditModal(customerId, email) {
    // Hide the parent filters modal
    const filtersModal = document.getElementById('filters-modal-overlay');
    if (filtersModal) {
        filtersModal.style.display = 'none';
    }
    
    // Find the customer data
    let customer;
    if (customerId.toString().startsWith('pending-')) {
        const idx = parseInt(customerId.split('-')[1]);
        const pending = pendingCustomerAdds[idx];
        customer = {
            id: customerId,
            email: pending.email,
            full_name: pending.fullName,
            rule_type: pending.ruleType || 'exclude_all',
            divisor: pending.divisor || 2,
            product_sku: pending.productSku,
            product_name: pending.productName,
            isPending: true
        };
    } else {
        customer = excludedCustomers.find(c => c.id === parseInt(customerId));
        if (!customer) return;
        
        // Check for pending update
        const pendingUpdate = pendingCustomerRuleUpdates.find(u => u.customerId === parseInt(customerId));
        if (pendingUpdate) {
            customer = { ...customer, rule_type: pendingUpdate.ruleType, divisor: pendingUpdate.divisor,
                         product_sku: pendingUpdate.productSku, product_name: pendingUpdate.productName };
        }
    }
    
    // Check if customer already has a base rule (other than the current one being edited)
    const customerRules = excludedCustomers.filter(c => c.email === customer.email);
    const existingBaseRule = customerRules.find(c => 
        c.id !== customer.id && 
        (c.rule_type === 'exclude_all' || c.rule_type === 'divide_all')
    );
    const currentRuleIsBaseRule = customer.rule_type === 'exclude_all' || customer.rule_type === 'divide_all';
    
    // Determine which base rule options should be disabled
    // If there's already a different base rule, disable base rule options (except current rule type if it's a base rule)
    const disableExcludeAll = existingBaseRule && existingBaseRule.rule_type !== 'exclude_all' && customer.rule_type !== 'exclude_all';
    const disableDivideAll = existingBaseRule && existingBaseRule.rule_type !== 'divide_all' && customer.rule_type !== 'divide_all';
    // If current rule is a product rule, and there's already a base rule, disable both base options
    const hasOtherBaseRule = existingBaseRule !== undefined;
    
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay rule-edit-modal-overlay active';
    modalOverlay.innerHTML = `
        <div class="modal modal-sm" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-user-cog"></i>
                </div>
                <h2 class="modal-title">Edit Exclusion Rule</h2>
                <button class="modal-close rule-edit-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="modal-body">
                <div class="rule-edit-customer-info">
                    <strong>${escapeHtml(customer.email)}</strong>
                    ${customer.full_name ? `<br><span class="text-muted">${escapeHtml(customer.full_name)}</span>` : ''}
                </div>
                
                <div class="nui-field">
                    <label class="nui-label">Rule Type</label>
                    <select id="rule-type-select">
                        <option value="exclude_all" ${customer.rule_type === 'exclude_all' || !customer.rule_type ? 'selected' : ''} ${hasOtherBaseRule && customer.rule_type !== 'exclude_all' ? 'disabled' : ''}>
                            Exclude All Orders
                        </option>
                        <option value="divide_all" ${customer.rule_type === 'divide_all' ? 'selected' : ''} ${hasOtherBaseRule && customer.rule_type !== 'divide_all' ? 'disabled' : ''}>
                            Divide All Orders
                        </option>
                        <option value="divide_product" ${customer.rule_type === 'divide_product' ? 'selected' : ''}>
                            Divide Specific Product
                        </option>
                    </select>
                </div>
                
                <div class="nui-field divisor-group" id="divisor-group" style="display: ${customer.rule_type === 'exclude_all' ? 'none' : 'block'};">
                    <label class="nui-label">Divide By</label>
                    <input type="number" class="nui-input nui-input-default" id="rule-divisor" value="${customer.divisor || 2}" min="1" step="0.5">
                    <p class="filter-description">The quantity will be divided by this number.</p>
                </div>
                
                <div class="nui-field product-search-group" id="product-search-group" style="display: ${customer.rule_type === 'divide_product' ? 'block' : 'none'};">
                    <label class="nui-label">Product</label>
                    <div class="search-container">
                        <input 
                            type="text" 
                            class="nui-input nui-input-default" 
                            placeholder="Search for a product..."
                            id="product-search-input"
                            value="${customer.product_name || customer.product_sku || ''}"
                        />
                        <div class="search-results-dropdown" id="product-search-results"></div>
                    </div>
                    <input type="hidden" id="selected-product-sku" value="${customer.product_sku || ''}">
                    <input type="hidden" id="selected-product-name" value="${customer.product_name || ''}">
                    <p class="filter-description">Search for products this customer has ordered.</p>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-solid btn-default rounded-lg rule-edit-cancel">Cancel</button>
                <button class="btn btn-solid btn-success rule-edit-save">
                    <i class="fas fa-check"></i> Save Rule
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalOverlay);
    
    // Initialize nui-dropdown for the rule type select
    initDropdown('#rule-type-select');
    
    // Rule type select change handler
    const ruleTypeSelect = modalOverlay.querySelector('#rule-type-select');
    
    const closeModal = () => {
        modalOverlay.remove();
        // Restore the parent filters modal
        if (filtersModal) {
            filtersModal.style.display = '';
        }
    };
    
    modalOverlay.querySelector('.rule-edit-close').addEventListener('click', closeModal);
    modalOverlay.querySelector('.rule-edit-cancel').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    
    ruleTypeSelect.addEventListener('change', (e) => {
        const value = e.target.value;
        
        // Toggle visibility of divisor and product search
        const divisorGroup = modalOverlay.querySelector('#divisor-group');
        const productGroup = modalOverlay.querySelector('#product-search-group');
        
        if (value === 'exclude_all') {
            divisorGroup.style.display = 'none';
            productGroup.style.display = 'none';
        } else if (value === 'divide_all') {
            divisorGroup.style.display = 'block';
            productGroup.style.display = 'none';
        } else if (value === 'divide_product') {
            divisorGroup.style.display = 'block';
            productGroup.style.display = 'block';
        }
    });
    
    // Product search
    const productSearchInput = modalOverlay.querySelector('#product-search-input');
    const productSearchResults = modalOverlay.querySelector('#product-search-results');
    
    productSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length >= 2) {
            debounceProductSearch(customer.email, query, productSearchResults, productSearchInput);
        } else {
            productSearchResults.classList.remove('visible');
        }
    });
    
    // Close product search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.product-search-group')) {
            productSearchResults.classList.remove('visible');
        }
    });
    
    // Save button
    modalOverlay.querySelector('.rule-edit-save').addEventListener('click', () => {
        const ruleType = ruleTypeSelect.value;
        const divisor = parseFloat(modalOverlay.querySelector('#rule-divisor').value) || 2;
        const productSku = modalOverlay.querySelector('#selected-product-sku').value;
        const productName = modalOverlay.querySelector('#selected-product-name').value;
        
        // Validate product selection for divide_product
        if (ruleType === 'divide_product' && !productSku) {
            showToast('Please select a product for the divide rule', 'warning');
            return;
        }
        
        // Check for conflicting or duplicate base rules when changing to a base rule type
        if (ruleType === 'exclude_all' || ruleType === 'divide_all') {
            // Find all rules for this customer (excluding current rule being edited)
            const customerRules = excludedCustomers.filter(c => c.email === customer.email);
            const existingBaseRule = customerRules.find(c => 
                c.id !== customer.id && 
                (c.rule_type === 'exclude_all' || c.rule_type === 'divide_all')
            );
            
            if (existingBaseRule) {
                const existingType = existingBaseRule.rule_type === 'exclude_all' ? 'Exclude All' : 'Divide All';
                const newType = ruleType === 'exclude_all' ? 'Exclude All' : 'Divide All';
                
                if (existingBaseRule.rule_type === ruleType) {
                    // Trying to create duplicate base rule of same type
                    showToast(`Customer already has "${existingType}" rule. Edit the existing rule instead.`, 'error');
                } else {
                    // Trying to mix exclude_all and divide_all
                    showToast(`Cannot have both "${newType}" and "${existingType}" rules for the same customer. Delete the existing rule first.`, 'error');
                }
                return;
            }
            
            // Also check pending adds for duplicate base rules
            const pendingBaseRule = pendingCustomerAdds.find(c => 
                c.email === customer.email && 
                (c.ruleType === 'exclude_all' || c.ruleType === 'divide_all')
            );
            if (pendingBaseRule && !customer.isPending) {
                const pendingType = pendingBaseRule.ruleType === 'exclude_all' ? 'Exclude All' : 'Divide All';
                showToast(`A pending "${pendingType}" rule already exists for this customer.`, 'error');
                return;
            }
        }
        
        // Save the rule update
        saveCustomerRuleUpdate(customerId, ruleType, divisor, productSku, productName, customer.isPending);
        closeModal();
    });
}

/**
 * Get human-readable label for rule type
 */
function getRuleTypeLabel(ruleType) {
    switch (ruleType) {
        case 'exclude_all': return '<i class="fas fa-ban"></i> Exclude All Orders';
        case 'divide_all': return '<i class="fas fa-divide"></i> Divide All Orders';
        case 'divide_product': return '<i class="fas fa-box"></i> Divide Specific Product';
        default: return '<i class="fas fa-ban"></i> Exclude All Orders';
    }
}

/**
 * Debounce product search
 */
function debounceProductSearch(customerEmail, query, resultsContainer, inputElement) {
    if (productSearchDebounceTimer) {
        clearTimeout(productSearchDebounceTimer);
    }
    
    productSearchDebounceTimer = setTimeout(async () => {
        try {
            const response = await get(`${API}/filters/customer-products/${currentRegion}/${encodeURIComponent(customerEmail)}?search=${encodeURIComponent(query)}`);
            
            if (response.status === 'success' && response.products && response.products.length > 0) {
                resultsContainer.innerHTML = response.products.map(product => `
                    <div class="search-result-item" data-sku="${escapeHtml(product.sku)}" data-name="${escapeHtml(product.name)}">
                        <div class="result-sku">${escapeHtml(product.sku)}</div>
                        <div class="result-name">${escapeHtml(product.name)}</div>
                        <div class="result-qty">${product.total_qty} ordered</div>
                    </div>
                `).join('');
                
                // Add click handlers
                resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const sku = item.dataset.sku;
                        const name = item.dataset.name;
                        
                        inputElement.value = name || sku;
                        document.getElementById('selected-product-sku').value = sku;
                        document.getElementById('selected-product-name').value = name;
                        resultsContainer.classList.remove('visible');
                    });
                });
                
                resultsContainer.classList.add('visible');
            } else {
                resultsContainer.innerHTML = '<div class="search-no-results">No products found for this customer</div>';
                resultsContainer.classList.add('visible');
            }
        } catch (error) {
            console.error('Error searching products:', error);
            resultsContainer.innerHTML = '<div class="search-no-results">Error searching products</div>';
            resultsContainer.classList.add('visible');
        }
    }, 300);
}

/**
 * Save customer rule update to pending changes
 */
function saveCustomerRuleUpdate(customerId, ruleType, divisor, productSku, productName, isPending) {
    if (isPending) {
        // Update the pending add
        const idx = parseInt(customerId.toString().split('-')[1]);
        pendingCustomerAdds[idx].ruleType = ruleType;
        pendingCustomerAdds[idx].divisor = divisor;
        pendingCustomerAdds[idx].productSku = productSku;
        pendingCustomerAdds[idx].productName = productName;
    } else {
        // Add or update in pendingCustomerRuleUpdates
        const existingIdx = pendingCustomerRuleUpdates.findIndex(u => u.customerId === parseInt(customerId));
        const update = {
            customerId: parseInt(customerId),
            ruleType,
            divisor,
            productSku,
            productName
        };
        
        if (existingIdx >= 0) {
            pendingCustomerRuleUpdates[existingIdx] = update;
        } else {
            pendingCustomerRuleUpdates.push(update);
        }
    }
    
    showToast('📝 Rule updated (click Apply to save)', 'info');
    displayExcludedCustomers();
}

/**
 * Show modal to add a new rule for an existing customer
 * If hasBaseRule is true, only divide_product is available
 */
function showAddRuleModal(email, fullName, hasBaseRule) {
    // Hide the parent filters modal
    const filtersModal = document.getElementById('filters-modal-overlay');
    if (filtersModal) {
        filtersModal.style.display = 'none';
    }
    
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay rule-edit-modal-overlay active';
    modalOverlay.innerHTML = `
        <div class="modal modal-sm" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-plus-circle"></i>
                </div>
                <h2 class="modal-title">Add Rule</h2>
                <button class="modal-close rule-edit-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="modal-body">
                <div class="rule-edit-customer-info">
                    <strong>${escapeHtml(email)}</strong>
                    ${fullName ? `<br><span class="text-muted">${escapeHtml(fullName)}</span>` : ''}
                </div>
                
                <div class="nui-field">
                    <label class="nui-label">Rule Type</label>
                    <select id="add-rule-type-select">
                        <option value="exclude_all" ${hasBaseRule ? 'disabled' : ''} ${!hasBaseRule ? 'selected' : ''}>
                            Exclude All Orders
                        </option>
                        <option value="divide_all" ${hasBaseRule ? 'disabled' : ''}>
                            Divide All Orders
                        </option>
                        <option value="divide_product" ${hasBaseRule ? 'selected' : ''}>
                            Divide Specific Product
                        </option>
                    </select>
                </div>
                
                <div class="nui-field divisor-group" id="add-divisor-group" style="display: ${hasBaseRule ? 'block' : 'none'};">
                    <label class="nui-label">Divide By</label>
                    <input type="number" class="nui-input nui-input-default" id="add-rule-divisor" value="2" min="1" step="0.5">
                    <p class="filter-description">The quantity will be divided by this number.</p>
                </div>
                
                <div class="nui-field product-search-group" id="add-product-search-group" style="display: ${hasBaseRule ? 'block' : 'none'};">
                    <label class="nui-label">Product</label>
                    <div class="search-container">
                        <input 
                            type="text" 
                            class="nui-input nui-input-default" 
                            placeholder="Search for a product..."
                            id="add-product-search-input"
                        />
                        <div class="search-results-dropdown" id="add-product-search-results"></div>
                    </div>
                    <input type="hidden" id="add-selected-product-sku" value="">
                    <input type="hidden" id="add-selected-product-name" value="">
                    <p class="filter-description">Search for products this customer has ordered.</p>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-solid btn-default rounded-lg rule-edit-cancel">Cancel</button>
                <button class="btn btn-solid btn-success rule-add-save">
                    <i class="fas fa-plus"></i> Add Rule
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalOverlay);
    
    // Initialize nui-dropdown for the rule type select
    initDropdown('#add-rule-type-select');
    
    const ruleTypeSelect = modalOverlay.querySelector('#add-rule-type-select');
    
    const closeModal = () => {
        modalOverlay.remove();
        // Restore the parent filters modal
        if (filtersModal) {
            filtersModal.style.display = '';
        }
    };
    
    modalOverlay.querySelector('.rule-edit-close').addEventListener('click', closeModal);
    modalOverlay.querySelector('.rule-edit-cancel').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    
    // Rule type select change handler
    ruleTypeSelect.addEventListener('change', (e) => {
        const value = e.target.value;
        
        // Toggle visibility of divisor and product search
        const divisorGroup = modalOverlay.querySelector('#add-divisor-group');
        const productGroup = modalOverlay.querySelector('#add-product-search-group');
        
        if (value === 'exclude_all') {
            divisorGroup.style.display = 'none';
            productGroup.style.display = 'none';
        } else if (value === 'divide_all') {
            divisorGroup.style.display = 'block';
            productGroup.style.display = 'none';
        } else if (value === 'divide_product') {
            divisorGroup.style.display = 'block';
            productGroup.style.display = 'block';
        }
    });
    
    // Product search
    const productSearchInput = modalOverlay.querySelector('#add-product-search-input');
    const productSearchResults = modalOverlay.querySelector('#add-product-search-results');
    
    productSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length >= 2) {
            debounceProductSearchForAddRule(email, query, productSearchResults, productSearchInput, modalOverlay);
        } else {
            productSearchResults.classList.remove('visible');
        }
    });
    
    // Save button
    modalOverlay.querySelector('.rule-add-save').addEventListener('click', () => {
        const ruleType = ruleTypeSelect.value;
        const divisor = parseFloat(modalOverlay.querySelector('#add-rule-divisor').value) || 2;
        const productSku = modalOverlay.querySelector('#add-selected-product-sku').value;
        const productName = modalOverlay.querySelector('#add-selected-product-name').value;
        
        // Validate
        if (ruleType === 'divide_product' && !productSku) {
            showToast('Please select a product for the rule', 'warning');
            return;
        }
        
        // Check for duplicate product rule
        if (ruleType === 'divide_product') {
            const existingRule = excludedCustomers.find(c => c.email === email && c.product_sku === productSku);
            const pendingRule = pendingCustomerAdds.find(c => c.email === email && c.productSku === productSku);
            
            if (existingRule || pendingRule) {
                showToast('This product already has a rule for this customer', 'warning');
                return;
            }
        }
        
        // Add to pending adds
        pendingCustomerAdds.push({
            email,
            fullName,
            region: currentRegion,
            ruleType,
            divisor,
            productSku: ruleType === 'divide_product' ? productSku : null,
            productName: ruleType === 'divide_product' ? productName : null
        });
        
        const ruleLabel = ruleType === 'exclude_all' ? 'Exclude All' : 
                         ruleType === 'divide_all' ? 'Divide All' : 'Product rule';
        showToast(`📝 ${ruleLabel} added for ${email} (click Apply to save)`, 'info');
        displayExcludedCustomers();
        closeModal();
    });
}

/**
 * Debounce product search for add rule modal
 */
function debounceProductSearchForAddRule(customerEmail, query, resultsContainer, inputElement, modalOverlay) {
    if (productSearchDebounceTimer) {
        clearTimeout(productSearchDebounceTimer);
    }
    
    productSearchDebounceTimer = setTimeout(async () => {
        try {
            const response = await get(`${API}/filters/customer-products/${currentRegion}/${encodeURIComponent(customerEmail)}?search=${encodeURIComponent(query)}`);
            
            if (response.status === 'success' && response.products && response.products.length > 0) {
                resultsContainer.innerHTML = response.products.map(product => `
                    <div class="search-result-item" data-sku="${escapeHtml(product.sku)}" data-name="${escapeHtml(product.name)}">
                        <div class="result-sku">${escapeHtml(product.sku)}</div>
                        <div class="result-name">${escapeHtml(product.name)}</div>
                        <div class="result-qty">${product.total_qty} ordered</div>
                    </div>
                `).join('');
                
                // Add click handlers
                resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const sku = item.dataset.sku;
                        const name = item.dataset.name;
                        
                        inputElement.value = name || sku;
                        modalOverlay.querySelector('#add-selected-product-sku').value = sku;
                        modalOverlay.querySelector('#add-selected-product-name').value = name;
                        resultsContainer.classList.remove('visible');
                    });
                });
                
                resultsContainer.classList.add('visible');
            } else {
                resultsContainer.innerHTML = '<div class="search-no-results">No products found for this customer</div>';
                resultsContainer.classList.add('visible');
            }
        } catch (error) {
            console.error('Error searching products:', error);
            resultsContainer.innerHTML = '<div class="search-no-results">Error searching products</div>';
            resultsContainer.classList.add('visible');
        }
    }, 300);
}

/**
 * Show modal to add a new product rule for an existing customer
 */
function showAddProductRuleModal(email, fullName) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay rule-edit-modal-overlay active';
    modalOverlay.innerHTML = `
        <div class="modal modal-sm" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-plus-circle"></i>
                </div>
                <h2 class="modal-title">Add Product Rule</h2>
                <button class="modal-close rule-edit-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="modal-body">
                <div class="rule-edit-customer-info">
                    <strong>${escapeHtml(email)}</strong>
                    ${fullName ? `<br><span class="text-muted">${escapeHtml(fullName)}</span>` : ''}
                </div>
                
                <div class="nui-field">
                    <label class="nui-label">Divide By</label>
                    <input type="number" class="nui-input nui-input-default" id="new-rule-divisor" value="2" min="1" step="0.5">
                    <p class="filter-description">The quantity for the selected product will be divided by this number.</p>
                </div>
                
                <div class="nui-field">
                    <label class="nui-label">Product</label>
                    <div class="search-container">
                        <input 
                            type="text" 
                            class="nui-input nui-input-default" 
                            placeholder="Search for a product..."
                            id="new-product-search-input"
                        />
                        <div class="search-results-dropdown" id="new-product-search-results"></div>
                    </div>
                    <input type="hidden" id="new-selected-product-sku" value="">
                    <input type="hidden" id="new-selected-product-name" value="">
                    <p class="filter-description">Search for products this customer has ordered.</p>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-solid btn-default rounded-lg rule-edit-cancel">Cancel</button>
                <button class="btn btn-solid btn-success rule-add-save">
                    <i class="fas fa-plus"></i> Add Rule
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalOverlay);
    
    // Setup event listeners
    const closeModal = () => modalOverlay.remove();
    
    modalOverlay.querySelector('.rule-edit-close').addEventListener('click', closeModal);
    modalOverlay.querySelector('.rule-edit-cancel').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    
    // Product search
    const productSearchInput = modalOverlay.querySelector('#new-product-search-input');
    const productSearchResults = modalOverlay.querySelector('#new-product-search-results');
    
    productSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length >= 2) {
            debounceProductSearchForNewRule(email, query, productSearchResults, productSearchInput, modalOverlay);
        } else {
            productSearchResults.classList.remove('visible');
        }
    });
    
    // Save button
    modalOverlay.querySelector('.rule-add-save').addEventListener('click', () => {
        const divisor = parseFloat(modalOverlay.querySelector('#new-rule-divisor').value) || 2;
        const productSku = modalOverlay.querySelector('#new-selected-product-sku').value;
        const productName = modalOverlay.querySelector('#new-selected-product-name').value;
        
        // Validate
        if (!productSku) {
            showToast('Please select a product for the rule', 'warning');
            return;
        }
        
        // Check if this product already has a rule for this customer
        const existingRule = excludedCustomers.find(c => c.email === email && c.product_sku === productSku);
        const pendingRule = pendingCustomerAdds.find(c => c.email === email && c.productSku === productSku);
        
        if (existingRule || pendingRule) {
            showToast('This product already has a rule for this customer', 'warning');
            return;
        }
        
        // Add to pending adds
        pendingCustomerAdds.push({
            email,
            fullName,
            region: currentRegion,
            ruleType: 'divide_product',
            divisor,
            productSku,
            productName
        });
        
        showToast(`📝 Product rule added for ${email} (click Apply to save)`, 'info');
        displayExcludedCustomers();
        closeModal();
    });
}

/**
 * Debounce product search for new rule modal
 */
function debounceProductSearchForNewRule(customerEmail, query, resultsContainer, inputElement, modalOverlay) {
    if (productSearchDebounceTimer) {
        clearTimeout(productSearchDebounceTimer);
    }
    
    productSearchDebounceTimer = setTimeout(async () => {
        try {
            const response = await get(`${API}/filters/customer-products/${currentRegion}/${encodeURIComponent(customerEmail)}?search=${encodeURIComponent(query)}`);
            
            if (response.status === 'success' && response.products && response.products.length > 0) {
                resultsContainer.innerHTML = response.products.map(product => `
                    <div class="search-result-item" data-sku="${escapeHtml(product.sku)}" data-name="${escapeHtml(product.name)}">
                        <div class="result-sku">${escapeHtml(product.sku)}</div>
                        <div class="result-name">${escapeHtml(product.name)}</div>
                        <div class="result-qty">${product.total_qty} ordered</div>
                    </div>
                `).join('');
                
                // Add click handlers
                resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const sku = item.dataset.sku;
                        const name = item.dataset.name;
                        
                        inputElement.value = name || sku;
                        modalOverlay.querySelector('#new-selected-product-sku').value = sku;
                        modalOverlay.querySelector('#new-selected-product-name').value = name;
                        resultsContainer.classList.remove('visible');
                    });
                });
                
                resultsContainer.classList.add('visible');
            } else {
                resultsContainer.innerHTML = '<div class="search-no-results">No products found for this customer</div>';
                resultsContainer.classList.add('visible');
            }
        } catch (error) {
            console.error('Error searching products:', error);
            resultsContainer.innerHTML = '<div class="search-no-results">Error searching products</div>';
            resultsContainer.classList.add('visible');
        }
    }, 300);
}

/**
 * Add customer to exclusion list (staged - not saved until Apply is clicked)
 */
function addExcludedCustomer(region, email, fullName) {
    // Check if already in current exclusions or pending adds
    const alreadyExcluded = excludedCustomers.some(c => c.email === email);
    const alreadyPending = pendingCustomerAdds.some(c => c.email === email);
    
    if (alreadyExcluded || alreadyPending) {
        showToast(`ℹ️ ${email} is already in the exclusion list`, 'info');
        return;
    }
    
    // Add to pending adds with default rule type
    pendingCustomerAdds.push({ 
        email, 
        fullName, 
        region, 
        ruleType: 'exclude_all', 
        divisor: 2,
        productSku: null,
        productName: null
    });
    showToast(`📝 ${email} will be excluded (click Apply to save)`, 'info');
    
    // Refresh display to show pending change
    displayExcludedCustomers();
}

/**
 * Remove customer from exclusion list (staged - not saved until Apply is clicked)
 */
function removeExcludedCustomer(customerId) {
    // Find the customer in current exclusions
    const customer = excludedCustomers.find(c => c.id === customerId);
    
    if (customer) {
        // Add to pending removes
        pendingCustomerRemoves.push(customerId);
        showToast(`📝 ${customer.email} will be removed (click Apply to save)`, 'info');
        
        // Refresh display to show pending change
        displayExcludedCustomers();
    }
}

/**
 * Load available customer groups for a region
 */
async function loadCustomerGroups() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/customer-groups/${currentRegion}`);
        
        if (response && response.status === 'success') {
            availableCustomerGroups = response.customer_groups || [];
            displayCustomerGroupsDropdown();
        }
    } catch (error) {
        console.error('Error loading customer groups:', error);
    }
}

/**
 * Display customer groups in select dropdown
 */
function displayCustomerGroupsDropdown() {
    const select = document.getElementById(`customer-group-select-${currentRegion}`);
    if (!select) return;
    
    // Keep the first placeholder option, clear others
    const placeholderOption = select.querySelector('option[value=""]');
    select.innerHTML = '';
    if (placeholderOption) {
        select.appendChild(placeholderOption);
    } else {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a customer group to exclude...';
        select.appendChild(placeholder);
    }
    
    // Add options for each customer group
    availableCustomerGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = group;
        select.appendChild(option);
    });
}

/**
 * Load excluded customer groups list
 */
async function loadExcludedCustomerGroups() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/excluded-customer-groups/${currentRegion}`);
        
        if (response.status === 'success') {
            excludedCustomerGroups = response.customer_groups || [];
            displayExcludedCustomerGroups();
        }
    } catch (error) {
        console.error('Error loading excluded customer groups:', error);
    }
}

/**
 * Display excluded customer groups list
 */
function displayExcludedCustomerGroups() {
    if (!currentRegion) return;
    
    const listContainer = document.getElementById(`excluded-groups-list-${currentRegion}`);
    const countDisplay = document.getElementById(`excluded-groups-count-${currentRegion}`);
    
    if (!listContainer || !countDisplay) return;
    
    // Combine current exclusions with pending adds, remove pending removes
    const displayGroups = [
        ...excludedCustomerGroups.filter(g => !pendingGroupRemoves.includes(g.id)),
        ...pendingGroupAdds.map(group => ({ customer_group: group, isPending: true }))
    ];
    
    // Update count
    countDisplay.textContent = `${displayGroups.length} group${displayGroups.length !== 1 ? 's' : ''} excluded`;
    
    // Update dropdown to exclude already-excluded groups
    updateCustomerGroupDropdown();
    
    if (displayGroups.length === 0) {
        listContainer.innerHTML = '<div class="excluded-empty">No customer groups excluded yet</div>';
        return;
    }
    
    // Display list of excluded groups
    listContainer.innerHTML = displayGroups.map(group => {
        const isPendingRemove = group.id && pendingGroupRemoves.includes(group.id);
        const itemClass = group.isPending ? 'excluded-item pending-add' : 
                         isPendingRemove ? 'excluded-item pending-remove' : 
                         'excluded-item';
        
        const groupId = group.isPending ? `pending-${pendingGroupAdds.indexOf(group.customer_group)}` : group.id;
        
        return `
            <div class="${itemClass}">
                <div class="excluded-item-info">
                    <div class="excluded-item-name">${group.customer_group}</div>
                    ${group.isPending ? 
                        '<span class="badge badge-pending">Pending</span>' : 
                        isPendingRemove ? 
                        '<span class="badge badge-removing">Removing...</span>' : ''}
                </div>
                <button class="excluded-item-remove" data-id="${groupId}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
    
    // Add click handlers for remove buttons
    listContainer.querySelectorAll('.excluded-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupId = btn.dataset.id;
            if (groupId.startsWith('pending-')) {
                // Remove from pending adds
                const idx = parseInt(groupId.split('-')[1]);
                const removed = pendingGroupAdds.splice(idx, 1)[0];
                showToast(`📝 Cancelled excluding ${removed}`, 'info');
                displayExcludedCustomerGroups();
            } else {
                const id = parseInt(groupId);
                if (pendingGroupRemoves.includes(id)) {
                    // Undo the pending remove
                    const idx = pendingGroupRemoves.indexOf(id);
                    pendingGroupRemoves.splice(idx, 1);
                    const group = excludedCustomerGroups.find(g => g.id === id);
                    showToast(`📝 Cancelled removing ${group?.customer_group || 'group'}`, 'info');
                    displayExcludedCustomerGroups();
                } else {
                    // Stage for removal
                    removeCustomerGroupFromPending(id);
                }
            }
        });
    });
}

/**
 * Update customer group select to exclude already-excluded groups
 */
function updateCustomerGroupDropdown() {
    if (!currentRegion) return;
    
    const select = document.getElementById(`customer-group-select-${currentRegion}`);
    if (!select) return;
    
    // Get all currently excluded groups (including pending adds)
    const currentlyExcluded = [
        ...excludedCustomerGroups.filter(g => !pendingGroupRemoves.includes(g.id)).map(g => g.customer_group),
        ...pendingGroupAdds
    ];
    
    // Filter available groups to exclude already-excluded ones
    const filteredGroups = availableCustomerGroups.filter(group => !currentlyExcluded.includes(group));
    
    // Clear and populate options
    select.innerHTML = '';
    
    if (filteredGroups.length === 0 && availableCustomerGroups.length > 0) {
        // All groups excluded - show message in placeholder
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'All customer groups are already excluded';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
    } else {
        // Add placeholder option
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a customer group to exclude...';
        select.appendChild(placeholder);
        
        filteredGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group;
            select.appendChild(option);
        });
    }
}

/**
 * Add customer group to pending list
 */
function addCustomerGroupToPending(customerGroup) {
    // Check if already in current exclusions or pending adds
    const alreadyExcluded = excludedCustomerGroups.some(g => g.customer_group === customerGroup);
    const alreadyPending = pendingGroupAdds.includes(customerGroup);
    
    if (alreadyExcluded || alreadyPending) {
        showToast(`ℹ️ ${customerGroup} is already in the exclusion list`, 'info');
        return;
    }
    
    // Add to pending adds
    pendingGroupAdds.push(customerGroup);
    showToast(`📝 ${customerGroup} will be excluded (click Apply to save)`, 'info');
    
    // Refresh display to show pending change
    displayExcludedCustomerGroups();
}

/**
 * Remove customer group from pending list
 */
function removeCustomerGroupFromPending(groupId) {
    // Find the group in current exclusions
    const group = excludedCustomerGroups.find(g => g.id === groupId);
    
    if (group) {
        // Add to pending removes
        pendingGroupRemoves.push(groupId);
        showToast(`📝 ${group.customer_group} will be removed (click Apply to save)`, 'info');
        
        // Refresh display to show pending change
        displayExcludedCustomerGroups();
    }
}

/**
 * Load threshold
 */
/**
 * Load current threshold
 */
async function loadThreshold() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/threshold/${currentRegion}`);
        
        if (response.status === 'success') {
            currentThreshold = response.threshold;
            displayThreshold();
        }
    } catch (error) {
        console.error('Error loading threshold:', error);
    }
}

/**
 * Display current threshold
 */
function displayThreshold() {
    const thresholdInput = document.getElementById(`threshold-input-${currentRegion}`);
    const currentDisplay = document.getElementById(`threshold-current-${currentRegion}`);
    const currencySymbol = currentRegion === 'uk' ? '£' : '€';
    
    if (thresholdInput) {
        if (currentThreshold !== null && currentThreshold !== undefined) {
            thresholdInput.value = currentThreshold;
        } else {
            thresholdInput.value = ''; // Clear input if no threshold
        }
    }
    
    if (currentDisplay) {
        if (currentThreshold !== null && currentThreshold !== undefined) {
            currentDisplay.innerHTML = `Current: <strong>${currencySymbol}${parseFloat(currentThreshold).toFixed(2)}</strong> (orders above this are excluded)`;
        } else {
            currentDisplay.innerHTML = 'Current: <strong>No threshold</strong> (all orders included)';
        }
    }
}

/**
 * Save threshold
 */
async function saveThreshold(region) {
    const input = document.getElementById(`threshold-input-${region}`);
    const saveBtn = document.getElementById(`threshold-save-${region}`);
    
    if (!input || !saveBtn) return;
    
    const threshold = parseFloat(input.value);
    
    if (isNaN(threshold) || threshold < 0) {
        showToast('❌ Please enter a valid threshold amount', 'error');
        return;
    }
    
    saveBtn.disabled = true;
    
    try {
        const response = await post(`${API}/filters/threshold/${region}?threshold=${threshold}`);
        
        if (response.status === 'success') {
            showToast(`✅ ${response.message}`, 'success');
            currentThreshold = threshold;
            displayThreshold();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error saving threshold:', error);
        showToast('❌ Failed to save threshold', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

/**
 * Load qty threshold
 */
async function loadQtyThreshold() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/qty-threshold/${currentRegion}`);
        
        if (response.status === 'success') {
            currentQtyThreshold = response.qty_threshold;
            displayQtyThreshold();
        }
    } catch (error) {
        console.error('Error loading qty threshold:', error);
    }
}

/**
 * Display current qty threshold
 */
function displayQtyThreshold() {
    const qtyThresholdInput = document.getElementById(`qty-threshold-input-${currentRegion}`);
    const currentDisplay = document.getElementById(`qty-threshold-current-${currentRegion}`);
    
    if (qtyThresholdInput) {
        if (currentQtyThreshold !== null && currentQtyThreshold !== undefined) {
            qtyThresholdInput.value = currentQtyThreshold;
        } else {
            qtyThresholdInput.value = ''; // Clear input if no threshold
        }
    }
    
    if (currentDisplay) {
        if (currentQtyThreshold !== null && currentQtyThreshold !== undefined) {
            currentDisplay.innerHTML = `Current: <strong>${currentQtyThreshold}</strong> (orders with qty above this are excluded)`;
        } else {
            currentDisplay.innerHTML = 'Current: <strong>No threshold</strong> (all orders included)';
        }
    }
}

/**
 * Save qty threshold
 */
async function saveQtyThreshold(region) {
    const input = document.getElementById(`qty-threshold-input-${region}`);
    const saveBtn = document.getElementById(`qty-threshold-save-${region}`);
    
    if (!input || !saveBtn) return;
    
    const qtyThreshold = parseInt(input.value);
    
    if (isNaN(qtyThreshold) || qtyThreshold < 0) {
        showToast('❌ Please enter a valid quantity threshold', 'error');
        return;
    }
    
    saveBtn.disabled = true;
    
    try {
        const response = await post(`${API}/filters/qty-threshold/${region}?qty_threshold=${qtyThreshold}`);
        
        if (response.status === 'success') {
            showToast(`✅ ${response.message}`, 'success');
            currentQtyThreshold = qtyThreshold;
            displayQtyThreshold();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error saving qty threshold:', error);
        showToast('❌ Failed to save qty threshold', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

/**
 * Load smart qty rules
 */
async function loadSmartQtyRules() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/smart-qty-rules/${currentRegion}`);
        
        if (response.status === 'success') {
            currentSmartQtyRules = response.rules || [];
            displaySmartQtyRules();
        }
    } catch (error) {
        console.error('Error loading smart qty rules:', error);
    }
}

/**
 * Display current smart qty rules
 */
function displaySmartQtyRules() {
    const rulesListContainer = document.getElementById(`smart-rules-list-${currentRegion}`);
    
    if (!rulesListContainer) return;
    
    if (currentSmartQtyRules.length === 0) {
        rulesListContainer.innerHTML = '<div class="rules-empty">No rules configured. Add a rule below.</div>';
    } else {
        let html = '<div class="rules-items">';
        
        currentSmartQtyRules.forEach((rule, index) => {
            const actionText = {
                'divide': `÷ ${rule.divisor}`,
                'multiply': `× ${rule.divisor}`,
                'subtract': `− ${rule.divisor}`,
                'set_to': `→ ${rule.divisor}`
            }[rule.action];
            
            html += `
                <div class="rule-item" data-rule-id="${rule.id}">
                    <div class="rule-number">#${index + 1}</div>
                    <div class="rule-content">
                        <div class="rule-text">If qty ≥ <strong>${rule.threshold}</strong>, ${actionText}</div>
                    </div>
                    <button class="rule-delete-btn excluded-item-remove" data-rule-id="${rule.id}" title="Delete this rule">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        rulesListContainer.innerHTML = html;
        
        // Attach delete handlers
        document.querySelectorAll('.rule-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ruleId = parseInt(btn.dataset.ruleId);
                deleteSmartQtyRule(ruleId);
            });
        });
    }
}

/**
 * Update smart filter preview for new rule form
 */
function updateSmartFilterPreview() {
    const thresholdInput = document.getElementById(`smart-qty-threshold-${currentRegion}`);
    const actionSelect = document.getElementById(`smart-qty-action-select-${currentRegion}`);
    const divisorInput = document.getElementById(`smart-qty-divisor-${currentRegion}`);
    const previewText = document.getElementById(`smart-filter-preview-text-${currentRegion}`);
    
    if (!thresholdInput || !actionSelect || !divisorInput || !previewText) return;
    
    const threshold = parseInt(thresholdInput.value);
    const action = actionSelect.value || 'divide';
    const divisor = parseFloat(divisorInput.value);
    
    if (isNaN(threshold) || isNaN(divisor) || threshold < 1 || divisor < 0.1) {
        previewText.textContent = 'Configure rule above to see preview';
        return;
    }
    
    let result;
    if (action === 'divide') {
        result = Math.round(threshold / divisor);
    } else if (action === 'multiply') {
        result = Math.round(threshold * divisor);
    } else if (action === 'subtract') {
        result = Math.max(0, threshold - divisor);
    } else if (action === 'set_to') {
        result = divisor;
    }
    
    const actionText = {
        'divide': `÷ ${divisor}`,
        'multiply': `× ${divisor}`,
        'subtract': `− ${divisor}`,
        'set_to': `→ ${divisor}`
    }[action];
    
    previewText.innerHTML = `Example: <strong>${threshold}</strong> ${actionText} = <strong>${result}</strong>`;
}

/**
 * Add a new smart qty rule
 */
async function addSmartQtyRule() {
    if (!currentRegion) return;
    
    const thresholdInput = document.getElementById(`smart-qty-threshold-${currentRegion}`);
    const actionSelect = document.getElementById(`smart-qty-action-select-${currentRegion}`);
    const divisorInput = document.getElementById(`smart-qty-divisor-${currentRegion}`);
    
    if (!thresholdInput || !actionSelect || !divisorInput) return;
    
    const threshold = parseInt(thresholdInput.value);
    const action = actionSelect.value || 'divide';
    const divisor = parseFloat(divisorInput.value);
    
    if (isNaN(threshold) || threshold < 1) {
        showToast('⚠️ Threshold must be a positive number', 'warning');
        thresholdInput.focus();
        return;
    }
    
    if (isNaN(divisor) || divisor < 0.1) {
        showToast('⚠️ Value must be at least 0.1', 'warning');
        divisorInput.focus();
        return;
    }
    
    try {
        const response = await post(
            `${API}/filters/smart-qty-rules/${currentRegion}?threshold=${threshold}&action=${action}&divisor=${divisor}`
        );
        
        if (response.status === 'success' || response.success) {
            showToast(`✅ Smart rule added`, 'success');
            
            // Clear form
            thresholdInput.value = '';
            divisorInput.value = '';
            
            // Reload rules
            await loadSmartQtyRules();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error adding smart qty rule:', error);
        showToast('❌ Failed to add smart qty rule', 'error');
    }
}

/**
 * Delete a smart qty rule
 */
async function deleteSmartQtyRule(ruleId) {
    if (!confirm('Delete this rule?')) {
        return;
    }
    
    try {
        const response = await del(`${API}/filters/smart-qty-rules/${ruleId}`);
        
        if (response.status === 'success' || response.success) {
            showToast(`✅ Rule deleted`, 'success');
            await loadSmartQtyRules();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error deleting smart qty rule:', error);
        showToast('❌ Failed to delete rule', 'error');
    }
}

/**
 * Clear all smart qty rules
 */
async function clearAllSmartQtyRules() {
    if (!currentRegion) return;
    
    if (!confirm(`Clear all smart quantity rules for ${currentRegion.toUpperCase()}? This will affect the next aggregation.`)) {
        return;
    }
    
    try {
        const response = await del(`${API}/filters/smart-qty-rules/region/${currentRegion}`);
        
        if (response.status === 'success' || response.success) {
            showToast(`✅ All rules cleared`, 'success');
            currentSmartQtyRules = [];
            displaySmartQtyRules();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error clearing rules:', error);
        showToast('❌ Failed to clear rules', 'error');
    }
}

/*
 * ==========================================
 * Smart Date Rules Logic
 * ==========================================
 */

/**
 * Load smart date rules from backend
 */
async function loadSmartDateRules() {
    if (!currentRegion) return;
    
    try {
        const response = await get(`${API}/filters/smart-date-rules/${currentRegion}`);
        
        if (response.status === 'success') {
            currentSmartDateRules = response.rules || [];
            displaySmartDateRules();
        }
    } catch (error) {
        console.error('Error loading smart date rules:', error);
    }
}

/**
 * Display current smart date rules
 */
function displaySmartDateRules() {
    const rulesListContainer = document.getElementById(`smart-date-rules-list-${currentRegion}`);
    
    if (!rulesListContainer) return;
    
    if (currentSmartDateRules.length === 0) {
        rulesListContainer.innerHTML = '<div class="rules-empty">No date rules configured. Add a rule below.</div>';
    } else {
        let html = '<div class="rules-items">';
        
        currentSmartDateRules.forEach((rule, index) => {
            let actionText = '';
            if (rule.action === 'exclude') {
                actionText = '<strong>Exclude</strong> from data';
            } else {
                const verb = {
                    'divide': 'Divide Qty by',
                    'multiply': 'Multiply Qty by',
                    'set_to': 'Set Qty to'
                }[rule.action] || rule.action;
                actionText = `${verb} <strong>${rule.value}</strong>`;
            }
            
            // Format dates "YYYY-MM-DD"
            const dateDisplay = `${rule.start_date} <i class="fas fa-arrow-right" style="font-size: 0.8em; margin: 0 5px;"></i> ${rule.end_date}`;
            
            html += `
                <div class="rule-item" data-rule-id="${rule.id}">
                    <div class="rule-number">#${index + 1}</div>
                    <div class="rule-content">
                        <div class="rule-text">
                            <span class="rule-date-badge">${dateDisplay}</span>
                            <span class="rule-action">${actionText}</span>
                        </div>
                    </div>
                    <button class="rule-delete-btn-date excluded-item-remove" data-rule-id="${rule.id}" title="Delete this rule">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        rulesListContainer.innerHTML = html;
        
        // Attach delete handlers for date rules
        document.querySelectorAll('.rule-delete-btn-date').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ruleId = parseInt(btn.dataset.ruleId);
                deleteSmartDateRule(ruleId);
            });
        });
    }
}

/**
 * Add a new smart date rule
 */
async function addSmartDateRule() {
    if (!currentRegion) return;
    
    const startInput = document.getElementById(`smart-date-start-${currentRegion}`);
    const endInput = document.getElementById(`smart-date-end-${currentRegion}`);
    const actionSelect = document.getElementById(`smart-date-action-select-${currentRegion}`);
    const valueInput = document.getElementById(`smart-date-value-${currentRegion}`);
    
    if (!startInput || !endInput || !actionSelect || !valueInput) return;
    
    const startDate = startInput.value;
    const endDate = endInput.value;
    const action = actionSelect.value || 'exclude';
    let value = null;
    
    if (!startDate || !endDate) {
        showToast('⚠️ Please select both start and end dates', 'warning');
        return;
    }
    
    if (startDate > endDate) {
        showToast('⚠️ Start date cannot be after end date', 'warning');
        return;
    }
    
    if (action !== 'exclude') {
        value = parseFloat(valueInput.value);
        if (isNaN(value) || value < 0) {
            showToast('⚠️ Please enter a valid non-negative value', 'warning');
            valueInput.focus();
            return;
        }
    }
    
    try {
        let url = `${API}/filters/smart-date-rules/${currentRegion}?start_date=${startDate}&end_date=${endDate}&action=${action}`;
        if (value !== null) {
            url += `&value=${value}`;
        }
        
        const response = await post(url);
        
        if (response.status === 'success' || response.success) {
            showToast(`✅ Date rule added`, 'success');
            
            // Clear inputs
            startInput.value = '';
            endInput.value = '';
            valueInput.value = '';
            valueInput.style.display = 'none'; // Hide value input
            
            // Reset select to default
            actionSelect.value = 'exclude';
            
            // Reload rules
            await loadSmartDateRules();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error adding smart date rule:', error);
        showToast('❌ Failed to add date rule', 'error');
    }
}

/**
 * Delete a smart date rule
 */
async function deleteSmartDateRule(ruleId) {
    if (!confirm('Delete this date rule?')) {
        return;
    }
    
    try {
        const response = await del(`${API}/filters/smart-date-rules/${ruleId}`);
        
        if (response.status === 'success' || response.success) {
            showToast(`✅ Date rule deleted`, 'success');
            await loadSmartDateRules();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error deleting smart date rule:', error);
        showToast('❌ Failed to delete date rule', 'error');
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Load exchange rates and display conversion info
 */
async function loadExchangeRates(region) {
    const infoElement = document.getElementById(`currency-conversion-info-${region}`);
    
    if (!infoElement) return;
    
    try {
        const response = await get(`${API}/currency/rates`);
        
        if (response.status === 'success') {
            exchangeRates = response;
            
            // Get initial threshold value to display
            const thresholdInput = document.getElementById(`threshold-input-${region}`);
            const initialValue = thresholdInput?.value || '';
            
            updateConversionDisplay(region, initialValue);
        } else {
            throw new Error('Failed to load rates');
        }
    } catch (error) {
        console.error('Error loading exchange rates:', error);
        infoElement.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Using fallback exchange rates';
        infoElement.style.color = '#e67e22';
    }
}

/**
 * Debounce the conversion display update
 */
function debounceConversionUpdate(region, value) {
    clearTimeout(conversionDebounceTimer);
    conversionDebounceTimer = setTimeout(() => {
        updateConversionDisplay(region, value);
    }, 300); // 300ms debounce - nice and responsive
}

/**
 * Update the conversion display with the current input value
 */
function updateConversionDisplay(region, value) {
    const infoElement = document.getElementById(`currency-conversion-info-${region}`);
    
    if (!infoElement || !exchangeRates) return;
    
    // Check if value is empty or not a valid number
    const trimmedValue = (value || '').trim();
    const amount = parseFloat(trimmedValue);
    
    if (!trimmedValue || isNaN(amount) || amount === 0) {
        // Show default message
        infoElement.innerHTML = '<i class="fas fa-exchange-alt"></i> Enter an amount to see live conversions';
        infoElement.style.color = '#95a5a6';
        return;
    }
    
    const conversions = exchangeRates.conversions;
    let conversionHtml = '<i class="fas fa-exchange-alt"></i> Live conversion: ';
    
    if (region === 'uk') {
        // UK uses GBP as base
        const usd = (amount * conversions.GBP_to_USD).toFixed(2);
        const eur = (amount * conversions.GBP_to_EUR).toFixed(2);
        const cny = (amount * exchangeRates.rates.CNY).toFixed(2);
        conversionHtml += `<strong>£${amount.toFixed(2)}</strong> = $${usd} USD = €${eur} EUR = ¥${cny} CNY`;
    } else {
        // FR/NL use EUR as base
        const usd = (amount * conversions.EUR_to_USD).toFixed(2);
        const gbp = (amount / conversions.GBP_to_EUR).toFixed(2);
        const cny = (amount * (exchangeRates.rates.CNY / exchangeRates.rates.EUR)).toFixed(2);
        conversionHtml += `<strong>€${amount.toFixed(2)}</strong> = $${usd} USD = £${gbp} GBP = ¥${cny} CNY`;
    }
    
    infoElement.innerHTML = conversionHtml;
    infoElement.style.color = '#27ae60';
}

// Add helper functions to window for the inline handlers
window.updateRangeInputs = function(radio) {
    const daysInput = document.getElementById('rangeDays');
    const monthsInput = document.getElementById('rangeMonths');
    const sinceInput = document.getElementById('rangeSince');
    
    if (!daysInput || !monthsInput || !sinceInput) return;
    
    daysInput.disabled = true;
    monthsInput.disabled = true;
    sinceInput.disabled = true;
    
    daysInput.style.opacity = '0.5';
    monthsInput.style.opacity = '0.5';
    sinceInput.style.opacity = '0.5';
    
    if (radio.value === 'days') {
        daysInput.disabled = false;
        daysInput.style.opacity = '1';
        daysInput.focus();
    } else if (radio.value === 'months') {
        monthsInput.disabled = false;
        monthsInput.style.opacity = '1';
        monthsInput.focus();
    } else if (radio.value === 'since') {
        sinceInput.disabled = false;
        sinceInput.style.opacity = '1';
        sinceInput.focus();
    }
};

window.runCustomAnalysis = async function(region) {
    const rangeType = document.querySelector('input[name="rangeType"]:checked').value;
    const useExclusions = document.getElementById('useExclusions').checked;
    const shippingMethodSelect = document.getElementById('shippingMethodSelect');
    const shippingMethod = shippingMethodSelect ? shippingMethodSelect.value : '';
    let rangeValue;
    
    if (rangeType === 'days') {
        rangeValue = document.getElementById('rangeDays').value;
    } else if (rangeType === 'months') {
        rangeValue = document.getElementById('rangeMonths').value;
    } else if (rangeType === 'since') {
        rangeValue = document.getElementById('rangeSince').value;
    }
    
    if (!rangeValue) {
        alert('Please enter a valid range value');
        return;
    }
    // Close modal
    const overlay = document.querySelector('.filters-modal-overlay');
    if (overlay) overlay.remove();
    
    // Also close the custom range modal overlay
    const modalOverlay = document.querySelector('.modal-overlay');
    if (modalOverlay) modalOverlay.remove();
    
    // Show loading toast
    const { showToast } = await import('../../ui/toast.js');
    const shippingLabel = shippingMethod ? ` (${shippingMethod})` : '';
    showToast(`Loading custom range data${shippingLabel}...`, 'info');
    
    try {
        // Call the custom range API
        const response = await getCustomRangeAggregatedData(region, rangeType, rangeValue, useExclusions, 1000, 0, '', shippingMethod);
        
        if (response.status === 'success' && response.data) {
            // Store the custom range parameters and data globally
            const rangeLabel = rangeType === 'days' ? `Last ${rangeValue} Days` :
                              rangeType === 'months' ? `Last ${rangeValue} Months` :
                              `Since ${rangeValue}`;
            
            window.customRangeActive = {
                region,
                rangeType,
                rangeValue,
                useExclusions,
                shippingMethod,
                rangeLabel,
                data: response.data,
                totalCount: response.total_count
            };
            
            // Dispatch event to notify the page to switch to custom range view
            window.dispatchEvent(new CustomEvent('customRangeApplied', {
                detail: {
                    region,
                    rangeLabel: rangeLabel + shippingLabel
                }
            }));
            
            showToast(`Custom range applied: ${rangeLabel}${shippingLabel}`, 'success');
        } else {
            showToast(`Error: ${response.message || 'Failed to load custom range data'}`, 'error');
        }
    } catch (error) {
        console.error('Error running custom analysis:', error);
        showToast(`Error: ${error.message}`, 'error');
    }
};

/**
 * Show the custom range modal for a specific region
 */
export function showCustomRangeModal(region) {
    // Remove any existing modal first
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = createCustomRangeModal(region);
    document.body.appendChild(modal);
}

function createCustomRangeModal(region) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    
    overlay.innerHTML = `
        <div class="modal" onclick="event.stopPropagation()" style="max-width: 500px;">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-calendar-day"></i>
                </div>
                <h2 class="modal-title">Custom Range Analysis - ${region.toUpperCase()}</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="modal-body">
                <div class="nui-field">
                    <div class="nui-label">
                        <span>Select Time Range</span>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 12px;">
                        <!-- Last X Days -->
                        <label class="radio-option">
                            <input type="radio" name="rangeType" value="days" checked>
                            <span>Last</span>
                            <input type="number" id="rangeDays" class="nui-input nui-input-default" value="30" min="1" style="width: 80px; margin: 0 8px;">
                            <span>Days</span>
                        </label>
                        
                        <!-- Last X Months -->
                        <label class="radio-option">
                            <input type="radio" name="rangeType" value="months">
                            <span>Last</span>
                            <input type="number" id="rangeMonths" class="nui-input nui-input-default" value="6" min="1" disabled style="width: 80px; margin: 0 8px; opacity: 0.5;">
                            <span>Months</span>
                        </label>
                        
                        <!-- Since Date -->
                        <label class="radio-option">
                            <input type="radio" name="rangeType" value="since">
                            <span>Since</span>
                            <input type="text" id="rangeSince" class="nui-input nui-input-default" disabled style="margin-left: 8px; opacity: 0.5;">
                        </label>
                    </div>
                </div>
                
                <div class="nui-field" style="margin-top: 24px; border-top: 1px solid var(--bg-light); padding-top: 24px;">
                    <div class="nui-label">
                        <span>Shipping Method</span>
                    </div>
                    
                    <div style="margin-top: 12px;">
                        <select id="shippingMethodSelect" class="nui-input nui-input-default" style="width: 100%;">
                            <option value="">All Shipping Methods</option>
                        </select>
                        <p class="filter-description" style="margin-top: 8px;">
                            Filter results to only show products sold via a specific shipping method.
                        </p>
                    </div>
                </div>
                
                <div class="nui-field" style="margin-top: 24px; border-top: 1px solid var(--bg-light); padding-top: 24px;">
                    <div class="nui-label">
                        <span>Exclusions</span>
                    </div>
                    
                    <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin-top: 12px;">
                        <input type="checkbox" id="useExclusions" checked style="width: 18px; height: 18px;">
                        <span>Apply configured customer & group exclusions</span>
                    </label>
                    <p class="filter-description" style="margin-top: 8px; margin-left: 30px;">
                        If checked, customers and groups in the exclusion list will be filtered out.
                    </p>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-solid btn-default rounded-lg" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button class="btn btn-solid btn-success" onclick="runCustomAnalysis('${region}')">
                    <i class="fas fa-play"></i> Run Analysis
                </button>
            </div>
        </div>
    `;
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
    
    // Init the shipping method dropdown immediately so it's styled from the start
    const shippingSelect = overlay.querySelector('#shippingMethodSelect');
    if (shippingSelect) {
        initDropdown(shippingSelect, { color: 'default' });
    }
    
    // Setup radio button handlers to enable/disable inputs
    setTimeout(() => {
        const radios = overlay.querySelectorAll('input[name="rangeType"]');
        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                const daysInput = overlay.querySelector('#rangeDays');
                const monthsInput = overlay.querySelector('#rangeMonths');
                const sinceInput = overlay.querySelector('#rangeSince');
                
                daysInput.disabled = radio.value !== 'days';
                daysInput.style.opacity = radio.value === 'days' ? '1' : '0.5';
                
                monthsInput.disabled = radio.value !== 'months';
                monthsInput.style.opacity = radio.value === 'months' ? '1' : '0.5';
                
                sinceInput.disabled = radio.value !== 'since';
                sinceInput.style.opacity = radio.value === 'since' ? '1' : '0.5';
            });
        });
        initDatePicker('#rangeSince');
    }, 0);
    
    // Load shipping methods async — MutationObserver on the dropdown will auto-sync
    (async () => {
        try {
            const result = await getShippingMethods(region);
            if (result.status === 'success' && result.shipping_methods) {
                const select = overlay.querySelector('#shippingMethodSelect');
                if (select) {
                    result.shipping_methods.forEach(method => {
                        const option = document.createElement('option');
                        option.value = method;
                        option.textContent = method;
                        select.appendChild(option);
                    });
                }
            }
        } catch (e) {
            console.warn('Could not load shipping methods:', e);
        }
    })();
    
    return overlay;
}

/**
 * Show custom range results in a modal
 */
function showCustomRangeResults(results) {
    const { region, rangeType, rangeValue, data, totalCount } = results;
    
    const rangeLabel = rangeType === 'days' ? `Last ${rangeValue} Days` :
                      rangeType === 'months' ? `Last ${rangeValue} Months` :
                      `Since ${rangeValue}`;
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    
    // Create table rows
    const tableRows = data.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.sku || 'N/A'}</td>
            <td>${item.name || 'N/A'}</td>
            <td>${item.total_qty || 0}</td>
        </tr>
    `).join('');
    
    overlay.innerHTML = `
        <div class="modal modal-lg" onclick="event.stopPropagation()">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <i class="fas fa-chart-line"></i>
                </div>
                <h2 class="modal-title">Custom Range Analysis Results - ${region.toUpperCase()}</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                <div style="margin-bottom: 20px; padding: 16px; background: var(--bg-light); border-radius: 12px;">
                    <h3 style="margin: 0 0 8px 0; color: var(--text);">
                        <i class="fas fa-info-circle"></i> Analysis Details
                    </h3>
                    <p style="margin: 4px 0; color: var(--text-muted);">
                        <strong>Range:</strong> ${rangeLabel}<br>
                        <strong>Total SKUs:</strong> ${totalCount}<br>
                        <strong>Showing:</strong> Top ${data.length} results
                    </p>
                </div>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; color: var(--text);">
                        <thead>
                            <tr style="background: var(--bg-light); border-bottom: 2px solid var(--bg);">
                                <th style="padding: 12px; text-align: left; font-weight: 600;">#</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">SKU</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">Name</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">Total Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows || '<tr><td colspan="4" style="padding: 20px; text-align: center;">No data found</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-solid btn-default rounded-lg" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            </div>
        </div>
    `;
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}




/**
 * Load available order statuses
 */
async function loadAvailableStatuses(region) {
    const select = document.getElementById(`status-select-${region}`);
    if (!select) return;
    
    try {
        // Show loading state
        select.innerHTML = '<option value="">Loading statuses...</option>';
        select.disabled = true;
        
        const response = await get(`${API}/filters/status/available/${region}`);
        
        if (response && response.status === 'success') {
            availableStatuses = response.statuses || [];
            updateStatusDropdown();
            select.disabled = false;
        } else {
            select.innerHTML = '<option value="">Failed to load statuses</option>';
        }
    } catch (error) {
        console.error('Error loading statuses:', error);
        select.innerHTML = '<option value="">Error loading statuses</option>';
    }
}

/**
 * Update the status select to exclude already-excluded statuses
 */
function updateStatusDropdown() {
    if (!currentRegion) return;
    
    const select = document.getElementById(`status-select-${currentRegion}`);
    if (!select) return;
    
    // Get all currently excluded statuses (including pending adds)
    const currentlyExcluded = [
        ...excludedStatuses.filter(s => !pendingStatusRemoves.includes(s.id)).map(s => s.status),
        ...pendingStatusAdds
    ];
    
    // Filter available statuses to exclude already-excluded ones
    const filteredStatuses = availableStatuses.filter(status => !currentlyExcluded.includes(status));
    
    // Clear and populate options
    select.innerHTML = '';
    
    if (filteredStatuses.length === 0 && availableStatuses.length > 0) {
        // All statuses excluded - show message
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'All statuses are already excluded';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
    } else {
        // Add placeholder option
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a status to exclude...';
        select.appendChild(placeholder);
        
        filteredStatuses.forEach(status => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = status;
            select.appendChild(option);
        });
    }
}

/**
 * Load excluded statuses
 */
async function loadExcludedStatuses() {
    if (!currentRegion) return;
    try {
        const response = await get(`${API}/filters/status/excluded/${currentRegion}`);
        if (response && response.status === 'success') {
            excludedStatuses = response.excluded || [];
            displayExcludedStatuses();
        }
    } catch (error) {
        console.error('Error loading excluded statuses:', error);
    }
}

/**
 * Display excluded statuses
 */
function displayExcludedStatuses() {
    if (!currentRegion) return;
    
    const listContainer = document.getElementById(`excluded-statuses-list-${currentRegion}`);
    const countDisplay = document.getElementById(`excluded-statuses-count-${currentRegion}`);
    
    if (!listContainer || !countDisplay) return;
    
    // Combine current exclusions with pending adds, remove pending removes
    const displayStatuses = [
        ...excludedStatuses.filter(s => !pendingStatusRemoves.includes(s.id)),
        ...pendingStatusAdds.map(status => ({ status: status, isPending: true }))
    ];
    
    // Update count
    countDisplay.textContent = `${displayStatuses.length} status${displayStatuses.length !== 1 ? 'es' : ''} excluded`;
    
    // Update dropdown to exclude already-excluded statuses
    updateStatusDropdown();
    
    if (displayStatuses.length === 0) {
        listContainer.innerHTML = '<div class="excluded-empty">No statuses excluded yet</div>';
        return;
    }
    
    // Display list of excluded statuses
    listContainer.innerHTML = displayStatuses.map(status => {
        const isPendingRemove = status.id && pendingStatusRemoves.includes(status.id);
        const itemClass = status.isPending ? 'excluded-item pending-add' : 
                         isPendingRemove ? 'excluded-item pending-remove' : 
                         'excluded-item';
        
        const statusId = status.isPending ? `pending-${pendingStatusAdds.indexOf(status.status)}` : status.id;
        
        return `
            <div class="${itemClass}">
                <div class="excluded-item-info">
                    <div class="excluded-item-name">${status.status}</div>
                    ${status.isPending ? 
                        '<span class="badge badge-pending">Pending</span>' : 
                        isPendingRemove ? 
                        '<span class="badge badge-removing">Removing...</span>' : ''}
                </div>
                <button class="excluded-item-remove" data-id="${statusId}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
    
    // Add click handlers for remove buttons
    listContainer.querySelectorAll('.excluded-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const statusId = btn.dataset.id;
            if (statusId.startsWith('pending-')) {
                // Remove from pending adds
                const idx = parseInt(statusId.split('-')[1]);
                const removed = pendingStatusAdds.splice(idx, 1)[0];
                showToast(`📝 Cancelled excluding ${removed}`, 'info');
                displayExcludedStatuses();
            } else {
                const id = parseInt(statusId);
                if (pendingStatusRemoves.includes(id)) {
                    // Undo the pending remove
                    const idx = pendingStatusRemoves.indexOf(id);
                    pendingStatusRemoves.splice(idx, 1);
                    const status = excludedStatuses.find(s => s.id === id);
                    showToast(`📝 Cancelled removing ${status?.status || 'status'}`, 'info');
                    displayExcludedStatuses();
                } else {
                    // Stage for removal
                    pendingStatusRemoves.push(id);
                    displayExcludedStatuses();
                }
            }
        });
    });
}

/**
 * Add status to pending list
 */
function addExcludedStatus(status) {
    // Check if already in pending adds
    if (pendingStatusAdds.includes(status)) {
        showToast('Status is already staged for exclusion', 'warning');
        return;
    }
    
    // Check if already in existing exclusions (and not staged for removal)
    const existing = excludedStatuses.find(s => s.status === status);
    if (existing) {
        if (pendingStatusRemoves.includes(existing.id)) {
            // It was staged for removal, cancel the removal
            const idx = pendingStatusRemoves.indexOf(existing.id);
            pendingStatusRemoves.splice(idx, 1);
            displayExcludedStatuses();
            showToast(`Restored exclusion for ${status}`, 'info');
            return;
        } else {
            showToast('Status is already excluded', 'warning');
            return;
        }
    }
    
    pendingStatusAdds.push(status);
    displayExcludedStatuses();
    
    // Reset the dropdown selection
    const select = document.getElementById(`status-select-${currentRegion}`);
    if (select) select.value = '';
}
