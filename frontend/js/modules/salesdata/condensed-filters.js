// frontend/js/modules/salesdata/condensed-filters.js
import { fetchAPI } from '../../services/api.js';
import { showToast } from '../../ui/toast.js';

let currentRegion = null;
let searchDebounceTimer = null;
let excludedCustomers = [];
let currentThreshold = null;

/**
 * Show the filters modal for a specific region
 */
export function showFiltersModal(region) {
    currentRegion = region;
    
    const modal = createFiltersModal(region);
    document.body.appendChild(modal);
    
    // Load initial data
    loadExcludedCustomers();
    loadThreshold();
    
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
                <h2>📊 6M Condensed Sales Filters - ${region.toUpperCase()}</h2>
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
                        Orders from these customers will not be included in the 6-month condensed sales data.
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
                    
                    <div class="excluded-customers-list" id="excluded-list-${region}">
                        <div class="excluded-customers-empty">No customers excluded yet</div>
                    </div>
                </div>
                
                <!-- Grand Total Threshold -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <span class="filter-section-icon">💰</span>
                        <h3 class="filter-section-title">Grand Total Threshold</h3>
                    </div>
                    <p class="filter-section-description">
                        Orders with a grand total above this amount will be excluded from 6-month condensed sales.
                    </p>
                    
                    <div class="threshold-input-container">
                        <div class="threshold-input-wrapper">
                            <span class="threshold-currency-symbol">£</span>
                            <input 
                                type="number" 
                                class="threshold-input" 
                                placeholder="Enter threshold (e.g., 10000)"
                                step="0.01"
                                min="0"
                                id="threshold-input-${region}"
                            />
                        </div>
                        <button class="threshold-save-btn" id="threshold-save-${region}">
                            Save Threshold
                        </button>
                    </div>
                    
                    <div class="threshold-current" id="threshold-current-${region}">
                        Current: <strong>Not set</strong> (all orders included)
                    </div>
                </div>
                
                <div class="filter-info-box">
                    <strong>ℹ️ Important:</strong> After changing filters, click "Refresh" on the 6M condensed sales table to apply the changes.
                </div>
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
    
    // Threshold save button
    const saveBtn = document.getElementById(`threshold-save-${region}`);
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveThreshold(region));
    }
    
    // Allow Enter key to save threshold
    const thresholdInput = document.getElementById(`threshold-input-${region}`);
    if (thresholdInput) {
        thresholdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveThreshold(region);
            }
        });
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
        const response = await fetchAPI(`/api/salesdata/filters/customers/search/${region}?q=${encodeURIComponent(query)}`);
        
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
        const response = await fetchAPI(`/api/salesdata/filters/customers/${currentRegion}`);
        
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
    if (!listContainer) return;
    
    if (excludedCustomers.length === 0) {
        listContainer.innerHTML = '<div class="excluded-customers-empty">No customers excluded yet</div>';
        return;
    }
    
    listContainer.innerHTML = excludedCustomers.map(customer => `
        <div class="excluded-customer-item">
            <div class="excluded-customer-info">
                <div class="excluded-customer-email">${escapeHtml(customer.email)}</div>
                ${customer.full_name ? `<div class="excluded-customer-name">${escapeHtml(customer.full_name)}</div>` : ''}
            </div>
            <button class="excluded-customer-remove" data-id="${customer.id}">Remove</button>
        </div>
    `).join('');
    
    // Add remove handlers
    listContainer.querySelectorAll('.excluded-customer-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const customerId = parseInt(btn.dataset.id);
            removeExcludedCustomer(customerId);
        });
    });
}

/**
 * Add customer to exclusion list
 */
async function addExcludedCustomer(region, email, fullName) {
    try {
        const response = await fetchAPI(`/api/salesdata/filters/customers/${region}?email=${encodeURIComponent(email)}&full_name=${encodeURIComponent(fullName || '')}`, {
            method: 'POST'
        });
        
        if (response.status === 'success') {
            showToast(`✅ ${email} added to exclusion list`, 'success');
            loadExcludedCustomers();
        } else if (response.status === 'info') {
            showToast(`ℹ️ ${response.message}`, 'info');
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error adding excluded customer:', error);
        showToast('❌ Failed to add customer to exclusion list', 'error');
    }
}

/**
 * Remove customer from exclusion list
 */
async function removeExcludedCustomer(customerId) {
    try {
        const response = await fetchAPI(`/api/salesdata/filters/customers/${customerId}`, {
            method: 'DELETE'
        });
        
        if (response.status === 'success') {
            showToast('✅ Customer removed from exclusion list', 'success');
            loadExcludedCustomers();
        } else {
            showToast(`❌ ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Error removing excluded customer:', error);
        showToast('❌ Failed to remove customer', 'error');
    }
}

/**
 * Load current threshold
 */
async function loadThreshold() {
    if (!currentRegion) return;
    
    try {
        const response = await fetchAPI(`/api/salesdata/filters/threshold/${currentRegion}`);
        
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
    
    if (thresholdInput && currentThreshold !== null) {
        thresholdInput.value = currentThreshold;
    }
    
    if (currentDisplay) {
        if (currentThreshold !== null) {
            currentDisplay.innerHTML = `Current: <strong>£${parseFloat(currentThreshold).toFixed(2)}</strong> (orders above this are excluded)`;
        } else {
            currentDisplay.innerHTML = 'Current: <strong>Not set</strong> (all orders included)';
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
        const response = await fetchAPI(`/api/salesdata/filters/threshold/${region}?threshold=${threshold}`, {
            method: 'POST'
        });
        
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
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
