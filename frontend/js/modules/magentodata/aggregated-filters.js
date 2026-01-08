// frontend/js/modules/magentodata/aggregated-filters.js
import { get, post, del } from '../../services/api/http.js';
import { showToast } from '../../ui/toast.js';
import { refreshAggregatedDataForRegion, getCustomRangeAggregatedData } from '../../services/api/magentoDataApi.js';

const API = '/v1/magentodata';

let currentRegion = null;
let searchDebounceTimer = null;
let excludedCustomers = [];
let excludedCustomerGroups = [];
let availableCustomerGroups = [];
let currentThreshold = null;
let currentQtyThreshold = null;
let currentSmartQtyRules = []; // Array of rules
let pendingCustomerAdds = []; // Customers to be added when Apply is clicked
let pendingCustomerRemoves = []; // Customer IDs to be removed when Apply is clicked
let pendingGroupAdds = []; // Customer groups to be added when Apply is clicked
let pendingGroupRemoves = []; // Customer group IDs to be removed when Apply is clicked
let availableStatuses = [];
let excludedStatuses = [];
let pendingStatusAdds = []; // Statuses to be added when Apply is clicked
let pendingStatusRemoves = []; // Status IDs to be removed when Apply is clicked
let exchangeRates = null; // Cached exchange rates
let conversionDebounceTimer = null; // Debounce timer for currency conversion updates

/**
 * Show the filters modal for a specific region
 */
export function showFiltersModal(region) {
    currentRegion = region;
    
    // Reset pending changes
    pendingCustomerAdds = [];
    pendingCustomerRemoves = [];
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
    overlay.className = 'filters-modal-overlay';
    overlay.innerHTML = `
        <div class="filters-modal" onclick="event.stopPropagation()">
            <div class="filters-modal-header">
                <h2><i class="fas fa-chart-bar"></i> 6M Aggregated Magento Filters - ${region.toUpperCase()}</h2>
                <button class="filters-modal-close" onclick="this.closest('.filters-modal-overlay').remove()">
                    ✕
                </button>
            </div>
            
            <div class="filters-modal-body">
                <!-- Customer Exclusions -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">👥</span>
                        <h3 class="filter-section-title">Excluded Customers</h3>
                    </div>
                    <p class="filter-section-description">
                        Orders from these customers will not be included in the 6-month aggregated magento data.
                    </p>
                    
                    <div class="customer-search-container">
                        <input 
                            type="text" 
                            class="customer-search-input" 
                            placeholder="Search by email or name..."
                            id="customer-search-${region}"
                        />
                        <div class="customer-search-results" id="search-results-${region}"></div>
                    </div>
                    
                    <div class="excluded-customers-header" id="excluded-header-${region}">
                        <span class="excluded-customers-count" id="excluded-count-${region}">0 customers excluded</span>
                        <button class="excluded-customers-toggle" id="excluded-toggle-${region}">
                            <span class="toggle-icon">▼</span> Show List
                        </button>
                    </div>
                    
                    <div class="excluded-customers-list collapsed" id="excluded-list-${region}">
                        <div class="excluded-customers-empty">No customers excluded yet</div>
                    </div>
                </div>
                
                <!-- Customer Group Exclusions -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">👨‍👩‍👧‍👦</span>
                        <h3 class="filter-section-title">Excluded Customer Groups</h3>
                    </div>
                    <p class="filter-section-description">
                        Orders from these customer groups will not be included in the 6-month aggregated magento data.
                    </p>
                    
                    <div class="customer-group-select-container">
                        <select 
                            class="customer-group-select" 
                            id="customer-group-select-${region}"
                        >
                            <option value="">Select a customer group to exclude...</option>
                        </select>
                        <button class="add-group-btn" id="add-group-btn-${region}">
                            <i class="fas fa-plus"></i> Add
                        </button>
                    </div>
                    
                    <div class="excluded-groups-header" id="excluded-groups-header-${region}">
                        <span class="excluded-groups-count" id="excluded-groups-count-${region}">0 groups excluded</span>
                        <button class="excluded-groups-toggle" id="excluded-groups-toggle-${region}">
                            <span class="toggle-icon">▼</span> Show List
                        </button>
                    </div>
                    
                    <div class="excluded-groups-list collapsed" id="excluded-groups-list-${region}">
                        <div class="excluded-groups-empty">No customer groups excluded yet</div>
                    </div>
                </div>
                
                <!-- Order Status Exclusions -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">🚦</span>
                        <h3 class="filter-section-title">Excluded Order Statuses</h3>
                    </div>
                    <p class="filter-section-description">
                        Orders with these statuses will not be included in the 6-month aggregated magento data.
                    </p>
                    
                    <div class="customer-group-select-container">
                        <select 
                            class="customer-group-select" 
                            id="status-select-${region}"
                        >
                            <option value="">Select a status to exclude...</option>
                        </select>
                        <button class="add-group-btn" id="add-status-btn-${region}">
                            <i class="fas fa-plus"></i> Add
                        </button>
                    </div>
                    
                    <div class="excluded-groups-header" id="excluded-statuses-header-${region}">
                        <span class="excluded-groups-count" id="excluded-statuses-count-${region}">0 statuses excluded</span>
                        <button class="excluded-groups-toggle" id="excluded-statuses-toggle-${region}">
                            <span class="toggle-icon">▼</span> Show List
                        </button>
                    </div>
                    
                    <div class="excluded-groups-list collapsed" id="excluded-statuses-list-${region}">
                        <div class="excluded-groups-empty">No statuses excluded yet</div>
                    </div>
                </div>
                
                <!-- Grand Total Threshold -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">💰</span>
                        <h3 class="filter-section-title">Grand Total Threshold</h3>
                    </div>
                    <p class="filter-section-description">
                        Orders with a grand total above this amount will be excluded from 6-month aggregated magento.
                        <strong>All currencies are automatically converted</strong> to ${region === 'uk' ? 'GBP (£)' : 'EUR (€)'} at current exchange rates for comparison.
                        <span id="currency-conversion-info-${region}" style="display: block; margin-top: 0.5rem; font-size: 0.9em; color: var(--accent-color);">
                            <i class="fas fa-sync fa-spin"></i> Loading exchange rates...
                        </span>
                    </p>
                    
                    <div class="threshold-input-wrapper">
                        <span class="threshold-currency-symbol">${region === 'uk' ? '£' : '€'}</span>
                        <input 
                            type="number" 
                            class="threshold-input" 
                            placeholder="Leave empty for no threshold"
                            step="0.01"
                            min="0"
                            id="threshold-input-${region}"
                        />
                    </div>
                    
                    <div class="threshold-current" id="threshold-current-${region}">
                        Current: <strong>No threshold</strong> (all orders included)
                    </div>
                </div>
                
                <!-- Quantity Threshold -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon"><i class="fas fa-box"></i></span>
                        <h3 class="filter-section-title">Quantity Threshold</h3>
                    </div>
                    <p class="filter-section-description">
                        Orders with a quantity above this amount will be excluded from 6-month aggregated magento.
                    </p>
                    
                    <div class="threshold-input-wrapper">
                        <span class="threshold-currency-symbol">Qty</span>
                        <input 
                            type="number" 
                            class="threshold-input" 
                            placeholder="Leave empty for no threshold"
                            step="1"
                            min="0"
                            id="qty-threshold-input-${region}"
                        />
                    </div>
                    
                    <div class="threshold-current" id="qty-threshold-current-${region}">
                        Current: <strong>No threshold</strong> (all orders included)
                    </div>
                </div>

                <!-- Smart Quantity Filter -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon"><i class="fas fa-magic"></i></span>
                        <h3 class="filter-section-title">Smart Quantity Filter</h3>
                    </div>
                    <p class="filter-section-description">
                        Automatically adjust product quantities in aggregated data based on rules. Rules are applied in order during aggregation.
                    </p>
                    
                    <!-- Current Rules List -->
                    <div class="smart-rules-list" id="smart-rules-list-${region}">
                        <div class="smart-rules-empty">No rules configured. Add a rule below.</div>
                    </div>
                    
                    <!-- Add New Rule Form -->
                    <div class="smart-filter-config">
                        <div class="smart-filter-header">Add New Rule</div>
                        
                        <div class="smart-filter-row">
                            <label class="smart-filter-label">If quantity ≥</label>
                            <input 
                                type="number" 
                                class="smart-filter-input" 
                                placeholder="100"
                                step="1"
                                min="1"
                                id="smart-qty-threshold-${region}"
                            />
                        </div>
                        
                        <div class="smart-filter-row">
                            <label class="smart-filter-label">Then</label>
                            <select class="smart-filter-select" id="smart-qty-action-${region}">
                                <option value="divide">Divide by</option>
                                <option value="multiply">Multiply by</option>
                                <option value="subtract">Subtract</option>
                                <option value="set_to">Set to</option>
                            </select>
                            <input 
                                type="number" 
                                class="smart-filter-input" 
                                placeholder="2"
                                step="0.1"
                                min="0.1"
                                id="smart-qty-divisor-${region}"
                            />
                        </div>
                        
                        <div class="smart-filter-preview" id="smart-filter-preview-${region}">
                            <i class="fas fa-info-circle"></i> 
                            <span id="smart-filter-preview-text-${region}">Configure rule above to see preview</span>
                        </div>
                        
                        <div class="smart-filter-actions">
                            <button class="smart-filter-add-btn" id="smart-filter-add-${region}">
                                <i class="fas fa-plus"></i> Add Rule
                            </button>
                            <button class="smart-filter-clear-all-btn" id="smart-filter-clear-all-${region}">
                                <i class="fas fa-trash"></i> Clear All
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Apply Options -->
                <div class="filter-section" style="border-top: 1px solid var(--border-color); margin-top: 20px; padding-top: 20px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" id="apply-to-custom-range-${region}" style="width: 18px; height: 18px;">
                        <span style="font-weight: 500;">Also apply to Custom Range view</span>
                    </label>
                    <p class="filter-section-description" style="margin-top: 5px; margin-left: 28px;">
                        If checked, the current custom range analysis (if active) will be refreshed with these filters.
                    </p>
                </div>
            </div>
            
            <div class="filters-modal-footer">
                <button class="filters-cancel-btn" onclick="this.closest('.filters-modal-overlay').remove()">
                    Cancel
                </button>
                <button class="filters-apply-btn" id="filters-apply-${region}">
                    Apply & Refresh 6M Data
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
    setTimeout(() => setupEventListeners(region), 0);
    
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
                statusSelect.value = ''; // Reset select
            } else {
                showToast('Please select a status to exclude', 'warning');
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
                statusSelect.value = ''; // Reset select
            } else {
                showToast('Please select a status to exclude', 'warning');
            }
        });
    }
    
    // Apply filters button
    const applyBtn = document.getElementById(`filters-apply-${region}`);
    if (applyBtn) {
        applyBtn.addEventListener('click', () => applyAllFilters(region));
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
    const smartActionSelect = document.getElementById(`smart-qty-action-${region}`);
    const smartDivisorInput = document.getElementById(`smart-qty-divisor-${region}`);
    const smartAddBtn = document.getElementById(`smart-filter-add-${region}`);
    const smartClearAllBtn = document.getElementById(`smart-filter-clear-all-${region}`);
    
    if (smartThresholdInput) {
        smartThresholdInput.addEventListener('input', () => updateSmartFilterPreview());
    }
    if (smartActionSelect) {
        smartActionSelect.addEventListener('change', () => updateSmartFilterPreview());
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
}

/**
 * Show custom confirmation dialog
 */
function showConfirmDialog(message) {
    return new Promise((resolve) => {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10001;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.2s ease;
        `;
        
        // Create dialog
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--surface-color);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            animation: slideUp 0.3s ease;
        `;
        
        dialog.innerHTML = `
            <div style="margin-bottom: 20px;">
                <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">
                    Confirm Filter Changes
                </div>
                <div style="color: var(--text-secondary); line-height: 1.5;">
                    ${message}
                </div>
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="confirm-cancel" style="
                    padding: 10px 20px;
                    background: transparent;
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.9375rem;
                    transition: all 0.2s;
                ">Cancel</button>
                <button id="confirm-ok" style="
                    padding: 10px 20px;
                    background: var(--accent-color);
                    border: none;
                    border-radius: 6px;
                    color: white;
                    cursor: pointer;
                    font-size: 0.9375rem;
                    font-weight: 600;
                    transition: all 0.2s;
                ">Apply & Refresh</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        // Add hover effects
        const cancelBtn = dialog.querySelector('#confirm-cancel');
        const okBtn = dialog.querySelector('#confirm-ok');
        
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = 'var(--hover-bg)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'transparent';
        });
        
        okBtn.addEventListener('mouseenter', () => {
            okBtn.style.background = 'var(--primary-hover)';
        });
        okBtn.addEventListener('mouseleave', () => {
            okBtn.style.background = 'var(--accent-color)';
        });
        
        // Handle buttons
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });
        
        okBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
        
        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', handleEscape);
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Apply all filter changes at once
 */
async function applyAllFilters(region) {
    const applyBtn = document.getElementById(`filters-apply-${region}`);
    if (!applyBtn) return;
    
    const applyToCustomRangeCheckbox = document.getElementById(`apply-to-custom-range-${region}`);
    const shouldApplyToCustomRange = applyToCustomRangeCheckbox ? applyToCustomRangeCheckbox.checked : false;
    
    // Show custom confirmation dialog
    const confirmMessage = 'Apply all filter changes and refresh 6M aggregated magento data?';
    const confirmed = await showConfirmDialog(confirmMessage);
    if (!confirmed) {
        return;
    }
    
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
    
    let hasErrors = false;
    const errors = [];
    
    try {
        // 1. Save customer exclusions (add and remove)
        for (const customer of pendingCustomerAdds) {
            try {
                const response = await post(`${API}/filters/customers/${customer.region}?email=${encodeURIComponent(customer.email)}&full_name=${encodeURIComponent(customer.fullName || '')}`);
                if (response.status !== 'success' && response.status !== 'info') {
                    errors.push(`Failed to add ${customer.email}`);
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
                
                if (response && response.status !== 'success') {
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
                
                if (response && response.status !== 'success') {
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
                if (response.status !== 'success') {
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
                    
                    // Close the modal
                    document.querySelector('.filters-modal-overlay')?.remove();
                    
                    // Reload the page data if on aggregated view
                    const reloadEvent = new CustomEvent('aggregated-data-refreshed', { detail: { region } });
                    document.dispatchEvent(reloadEvent);

                    // Apply to custom range if requested and active
                    if (shouldApplyToCustomRange && window.customRangeActive && window.customRangeActive.region === region) {
                        showToast('🔄 Refreshing Custom Range data...', 'info');
                        try {
                            const { rangeType, rangeValue } = window.customRangeActive;
                            // Force useExclusions=true since we just applied filters
                            const response = await getCustomRangeAggregatedData(region, rangeType, rangeValue, true, 1000, 0, '');
                            
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
        }
        
    } catch (error) {
        console.error('Error applying filters:', error);
        showToast('❌ Failed to apply filters', 'error');
    } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply & Refresh 6M Data';
    }
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
    
    if (customers.length === 0) {
        resultsContainer.innerHTML = '<div class="customer-search-no-results">No customers found</div>';
        resultsContainer.classList.add('visible');
        return;
    }
    
    resultsContainer.innerHTML = customers.map(customer => `
        <div class="customer-search-result-item" data-email="${escapeHtml(customer.email)}" data-name="${escapeHtml(customer.full_name || '')}">
            <div class="customer-result-email">${escapeHtml(customer.email)}</div>
            ${customer.full_name ? `<div class="customer-result-name">${escapeHtml(customer.full_name)}</div>` : ''}
        </div>
    `).join('');
    
    resultsContainer.classList.add('visible');
    
    // Add click handlers
    resultsContainer.querySelectorAll('.customer-search-result-item').forEach(item => {
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
 * Display excluded customers list
 */
function displayExcludedCustomers() {
    const listContainer = document.getElementById(`excluded-list-${currentRegion}`);
    const countElement = document.getElementById(`excluded-count-${currentRegion}`);
    
    if (!listContainer) return;
    
    // Combine current + pending adds - pending removes
    const displayCustomers = [
        ...excludedCustomers.filter(c => !pendingCustomerRemoves.includes(c.id)),
        ...pendingCustomerAdds.map((c, idx) => ({ id: `pending-${idx}`, email: c.email, full_name: c.fullName, isPending: true }))
    ];
    
    // Update count
    if (countElement) {
        const count = displayCustomers.length;
        const pendingCount = pendingCustomerAdds.length + pendingCustomerRemoves.length;
        const pendingText = pendingCount > 0 ? ` (${pendingCount} pending)` : '';
        countElement.textContent = count === 0 ? 'No customers excluded' : 
                                   count === 1 ? `1 customer excluded${pendingText}` : 
                                   `${count} customers excluded${pendingText}`;
    }
    
    if (displayCustomers.length === 0) {
        listContainer.innerHTML = '<div class="excluded-customers-empty">No customers excluded yet</div>';
        return;
    }
    
    listContainer.innerHTML = displayCustomers.map(customer => {
        const isPendingRemove = pendingCustomerRemoves.includes(customer.id);
        const itemClass = customer.isPending ? 'excluded-customer-item pending-add' : 
                         isPendingRemove ? 'excluded-customer-item pending-remove' : 
                         'excluded-customer-item';
        const statusBadge = customer.isPending ? '<span class="pending-badge">NEW</span>' :
                           isPendingRemove ? '<span class="pending-badge remove">REMOVE</span>' : '';
        
        return `
            <div class="${itemClass}">
                <div class="excluded-customer-info">
                    <div class="excluded-customer-email">${escapeHtml(customer.email)} ${statusBadge}</div>
                    ${customer.full_name ? `<div class="excluded-customer-name">${escapeHtml(customer.full_name)}</div>` : ''}
                </div>
                <button class="excluded-customer-remove" data-id="${customer.id}">
                    ${isPendingRemove ? 'Undo' : 'Remove'}
                </button>
            </div>
        `;
    }).join('');
    
    // Add remove handlers
    listContainer.querySelectorAll('.excluded-customer-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const customerId = btn.dataset.id;
            if (customerId.startsWith('pending-')) {
                // Remove from pending adds
                const idx = parseInt(customerId.split('-')[1]);
                const removed = pendingCustomerAdds.splice(idx, 1)[0];
                showToast(`📝 Cancelled adding ${removed.email}`, 'info');
                displayExcludedCustomers();
            } else {
                const id = parseInt(customerId);
                if (pendingCustomerRemoves.includes(id)) {
                    // Undo the pending remove
                    const idx = pendingCustomerRemoves.indexOf(id);
                    pendingCustomerRemoves.splice(idx, 1);
                    const customer = excludedCustomers.find(c => c.id === id);
                    showToast(`📝 Cancelled removing ${customer?.email || 'customer'}`, 'info');
                    displayExcludedCustomers();
                } else {
                    // Stage for removal
                    removeExcludedCustomer(id);
                }
            }
        });
    });
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
    
    // Add to pending adds
    pendingCustomerAdds.push({ email, fullName, region });
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
        
        if (response.status === 'success') {
            availableCustomerGroups = response.customer_groups || [];
            displayCustomerGroupsDropdown();
        }
    } catch (error) {
        console.error('Error loading customer groups:', error);
    }
}

/**
 * Display customer groups in dropdown
 */
function displayCustomerGroupsDropdown() {
    const select = document.getElementById(`customer-group-select-${currentRegion}`);
    if (!select) return;
    
    // Clear existing options except the first one
    select.innerHTML = '<option value="">Select a customer group to exclude...</option>';
    
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
    
    if (displayGroups.length === 0) {
        listContainer.innerHTML = '<div class="excluded-groups-empty">No customer groups excluded yet</div>';
        return;
    }
    
    // Display list of excluded groups
    listContainer.innerHTML = displayGroups.map(group => {
        const isPendingRemove = group.id && pendingGroupRemoves.includes(group.id);
        const itemClass = group.isPending ? 'excluded-group-item pending-add' : 
                         isPendingRemove ? 'excluded-group-item pending-remove' : 
                         'excluded-group-item';
        
        const groupId = group.isPending ? `pending-${pendingGroupAdds.indexOf(group.customer_group)}` : group.id;
        
        return `
            <div class="${itemClass}">
                <div class="excluded-group-info">
                    <div class="excluded-group-name">${group.customer_group}</div>
                    ${group.isPending ? 
                        '<span class="badge badge-pending">Pending</span>' : 
                        isPendingRemove ? 
                        '<span class="badge badge-removing">Removing...</span>' : ''}
                </div>
                <button class="excluded-group-remove-btn" data-id="${groupId}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
    
    // Add click handlers for remove buttons
    listContainer.querySelectorAll('.excluded-group-remove-btn').forEach(btn => {
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
        rulesListContainer.innerHTML = '<div class="smart-rules-empty">No rules configured. Add a rule below.</div>';
    } else {
        let html = '<div class="smart-rules-items">';
        
        currentSmartQtyRules.forEach((rule, index) => {
            const actionText = {
                'divide': `÷ ${rule.divisor}`,
                'multiply': `× ${rule.divisor}`,
                'subtract': `− ${rule.divisor}`,
                'set_to': `→ ${rule.divisor}`
            }[rule.action];
            
            html += `
                <div class="smart-rule-item" data-rule-id="${rule.id}">
                    <div class="smart-rule-number">#${index + 1}</div>
                    <div class="smart-rule-content">
                        <div class="smart-rule-text">If qty ≥ <strong>${rule.threshold}</strong>, ${actionText}</div>
                    </div>
                    <button class="smart-rule-delete-btn" data-rule-id="${rule.id}" title="Delete this rule">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        rulesListContainer.innerHTML = html;
        
        // Attach delete handlers
        document.querySelectorAll('.smart-rule-delete-btn').forEach(btn => {
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
    const actionSelect = document.getElementById(`smart-qty-action-${currentRegion}`);
    const divisorInput = document.getElementById(`smart-qty-divisor-${currentRegion}`);
    const previewText = document.getElementById(`smart-filter-preview-text-${currentRegion}`);
    
    if (!thresholdInput || !actionSelect || !divisorInput || !previewText) return;
    
    const threshold = parseInt(thresholdInput.value);
    const action = actionSelect.value;
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
    const actionSelect = document.getElementById(`smart-qty-action-${currentRegion}`);
    const divisorInput = document.getElementById(`smart-qty-divisor-${currentRegion}`);
    
    if (!thresholdInput || !actionSelect || !divisorInput) return;
    
    const threshold = parseInt(thresholdInput.value);
    const action = actionSelect.value;
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
    
    // Show loading toast
    const { showToast } = await import('../../ui/toast.js');
    showToast(`Loading custom range data...`, 'info');
    
    try {
        // Call the custom range API
        const response = await getCustomRangeAggregatedData(region, rangeType, rangeValue, useExclusions, 1000, 0, '');
        
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
                rangeLabel,
                data: response.data,
                totalCount: response.total_count
            };
            
            // Dispatch event to notify the page to switch to custom range view
            window.dispatchEvent(new CustomEvent('customRangeApplied', {
                detail: {
                    region,
                    rangeLabel
                }
            }));
            
            showToast(`Custom range applied: ${rangeLabel}`, 'success');
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
    const existingModal = document.querySelector('.filters-modal-overlay');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = createCustomRangeModal(region);
    document.body.appendChild(modal);
}

function createCustomRangeModal(region) {
    const overlay = document.createElement('div');
    overlay.className = 'filters-modal-overlay';
    
    overlay.innerHTML = `
        <div class="filters-modal" onclick="event.stopPropagation()" style="max-width: 500px;">
            <div class="filters-modal-header">
                <h2><i class="fas fa-calendar-day"></i> Custom Range Analysis - ${region.toUpperCase()}</h2>
                <button class="filters-modal-close" onclick="this.closest('.filters-modal-overlay').remove()">
                    ✕
                </button>
            </div>
            
            <div class="filters-modal-body">
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">📅</span>
                        <h3 class="filter-section-title">Select Time Range</h3>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
                        <!-- Last X Days -->
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="radio" name="rangeType" value="days" checked onchange="updateRangeInputs(this)">
                            <span style="color: var(--text-primary);">Last</span>
                            <input type="number" id="rangeDays" value="30" min="1" style="width: 80px; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-primary);">
                            <span style="color: var(--text-primary);">Days</span>
                        </label>
                        
                        <!-- Last X Months -->
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="radio" name="rangeType" value="months" onchange="updateRangeInputs(this)">
                            <span style="color: var(--text-primary);">Last</span>
                            <input type="number" id="rangeMonths" value="6" min="1" disabled style="width: 80px; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-primary); opacity: 0.5;">
                            <span style="color: var(--text-primary);">Months</span>
                        </label>
                        
                        <!-- Since Date -->
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="radio" name="rangeType" value="since" onchange="updateRangeInputs(this)">
                            <span style="color: var(--text-primary);">Since</span>
                            <input type="date" id="rangeSince" disabled style="padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--text-primary); opacity: 0.5;">
                        </label>
                    </div>
                </div>
                
                <div class="filter-section" style="margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 24px;">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">🛡️</span>
                        <h3 class="filter-section-title">Exclusions</h3>
                    </div>
                    
                    <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin-top: 12px;">
                        <input type="checkbox" id="useExclusions" checked style="width: 18px; height: 18px;">
                        <span style="color: var(--text-primary);">Apply configured customer & group exclusions</span>
                    </label>
                    <p class="filter-section-description" style="margin-top: 8px; margin-left: 30px;">
                        If checked, customers and groups in the exclusion list will be filtered out.
                    </p>
                </div>
            </div>
            
            <div class="filters-modal-footer">
                <button class="filters-cancel-btn" onclick="this.closest('.filters-modal-overlay').remove()">Cancel</button>
                <button class="filters-apply-btn" onclick="runCustomAnalysis('${region}')">
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
    overlay.className = 'filters-modal-overlay';
    
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
        <div class="filters-modal" onclick="event.stopPropagation()" style="max-width: 900px; max-height: 80vh;">
            <div class="filters-modal-header">
                <h2><i class="fas fa-chart-line"></i> Custom Range Analysis Results - ${region.toUpperCase()}</h2>
                <button class="filters-modal-close" onclick="this.closest('.filters-modal-overlay').remove()">
                    ✕
                </button>
            </div>
            
            <div class="filters-modal-body" style="max-height: 60vh; overflow-y: auto;">
                <div style="margin-bottom: 20px; padding: 16px; background: var(--input-bg); border-radius: 8px; border: 1px solid var(--border-color);">
                    <h3 style="margin: 0 0 8px 0; color: var(--text-primary);">
                        <i class="fas fa-info-circle"></i> Analysis Details
                    </h3>
                    <p style="margin: 4px 0; color: var(--text-secondary);">
                        <strong>Range:</strong> ${rangeLabel}<br>
                        <strong>Total SKUs:</strong> ${totalCount}<br>
                        <strong>Showing:</strong> Top ${data.length} results
                    </p>
                </div>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; color: var(--text-primary);">
                        <thead>
                            <tr style="background: var(--input-bg); border-bottom: 2px solid var(--border-color);">
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
            
            <div class="filters-modal-footer">
                <button class="filters-cancel-btn" onclick="this.closest('.filters-modal-overlay').remove()">Close</button>
            </div>
        </div>
    `;
    
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
}




/**
 * Load available order statuses
 */
async function loadAvailableStatuses(region) {
    const select = document.getElementById(`status-select-${region}`);
    if (!select) return;
    
    try {
        select.innerHTML = '<option value="">Loading statuses...</option>';
        const response = await get(`${API}/filters/status/available/${region}`);
        
        if (response && response.status === 'success') {
            availableStatuses = response.statuses || [];
            
            select.innerHTML = '<option value="">Select a status to exclude...</option>';
            availableStatuses.forEach(status => {
                const option = document.createElement('option');
                option.value = status;
                option.textContent = status;
                select.appendChild(option);
            });
        } else {
            select.innerHTML = '<option value="">Failed to load statuses</option>';
        }
    } catch (error) {
        console.error('Error loading statuses:', error);
        select.innerHTML = '<option value="">Error loading statuses</option>';
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
    
    if (displayStatuses.length === 0) {
        listContainer.innerHTML = '<div class="excluded-groups-empty">No statuses excluded yet</div>';
        return;
    }
    
    // Display list of excluded statuses
    listContainer.innerHTML = displayStatuses.map(status => {
        const isPendingRemove = status.id && pendingStatusRemoves.includes(status.id);
        const itemClass = status.isPending ? 'excluded-group-item pending-add' : 
                         isPendingRemove ? 'excluded-group-item pending-remove' : 
                         'excluded-group-item';
        
        const statusId = status.isPending ? `pending-${pendingStatusAdds.indexOf(status.status)}` : status.id;
        
        return `
            <div class="${itemClass}">
                <div class="excluded-group-info">
                    <div class="excluded-group-name">${status.status}</div>
                    ${status.isPending ? 
                        '<span class="badge badge-pending">Pending</span>' : 
                        isPendingRemove ? 
                        '<span class="badge badge-removing">Removing...</span>' : ''}
                </div>
                <button class="excluded-status-remove-btn" data-id="${statusId}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
    
    // Add click handlers for remove buttons
    listContainer.querySelectorAll('.excluded-status-remove-btn').forEach(btn => {
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
}
