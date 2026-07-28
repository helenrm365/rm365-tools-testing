// frontend/js/modules/magentodata/full-data-filters.js
// Advanced filters for the Full Data view: date range + order status.
// Shared by the All / UK / FR / NL sales data pages.
import { getAvailableStatuses, getShippingMethods } from '../../services/api/magentoDataApi.js?v=9';
import { initDatePicker } from '../../ui/datePicker.js';
import { showToast } from '../../ui/toast.js';

const DATE_PRESETS = [
  { value: 'all', label: 'All time', icon: 'fa-infinity' },
  { value: '30d', label: 'Last 30 days', months: 1, days: 30, icon: 'fa-calendar-day' },
  { value: '3m', label: 'Last 3 months', months: 3, icon: 'fa-calendar-alt' },
  { value: '6m', label: 'Last 6 months', months: 6, icon: 'fa-calendar-alt' },
  { value: '12m', label: 'Last 12 months', months: 12, icon: 'fa-calendar-alt' },
  { value: 'custom', label: 'Custom range', icon: 'fa-calendar-week' }
];

/**
 * The shape used across the sales pages.
 * `statuses` is the list to include - empty means every status.
 * `availableStatuses` is the full set offered by the region, kept so the chip
 * bar can show whichever side (included / excluded) is shorter.
 * @returns {{preset: string, dateFrom: string, dateTo: string, statuses: string[], availableStatuses: string[]}}
 */
export function emptyFullDataFilters() {
  return {
    preset: 'all',
    dateFrom: '',
    dateTo: '',
    statuses: [],
    availableStatuses: [],
    shippingMethods: [],
    availableShippingMethods: [],
    uniqueCustomers: false
  };
}

/**
 * True when the filters would narrow the result set.
 */
export function hasActiveFullDataFilters(filters) {
  if (!filters) return false;
  return Boolean(
    filters.dateFrom ||
    filters.dateTo ||
    (filters.statuses && filters.statuses.length > 0) ||
    (filters.shippingMethods && filters.shippingMethods.length > 0) ||
    filters.uniqueCustomers
  );
}

/**
 * How many kinds of filter are active - date, status, shipping and the
 * per-customer option each count once, however many values they hold.
 * Used for a short confirmation toast; the chip bar carries the detail.
 */
export function countActiveFullDataFilters(filters) {
  if (!filters) return 0;
  let count = 0;
  if (filters.dateFrom || filters.dateTo) count++;
  if (filters.statuses && filters.statuses.length > 0) count++;
  if (filters.shippingMethods && filters.shippingMethods.length > 0) count++;
  if (filters.uniqueCustomers) count++;
  return count;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}

/**
 * Label for the date portion of the filters, e.g. "Last 6 months".
 */
function dateChipLabel(filters) {
  const preset = DATE_PRESETS.find(p => p.value === filters.preset);
  if (filters.preset && filters.preset !== 'all' && filters.preset !== 'custom' && preset) {
    return preset.label;
  }
  if (filters.dateFrom && filters.dateTo) return `${filters.dateFrom} → ${filters.dateTo}`;
  if (filters.dateFrom) return `From ${filters.dateFrom}`;
  if (filters.dateTo) return `Until ${filters.dateTo}`;
  return '';
}

/**
 * Build the removable chips describing what is narrowing the table.
 *
 * The search box is part of the query the same as the filters are, so it gets
 * a chip too - matching the staff directory.
 *
 * Statuses render as whichever side is shorter: picking 2 of 12 shows two
 * "Status" chips, dropping 1 of 12 shows a single "Excluding" chip. Either way
 * removing a chip does the obvious thing.
 * @returns {Array<{key: string, kind: string, label: string}>}
 */
export function getFullDataFilterChips(filters, search = '') {
  const chips = [];

  const term = (search || '').trim();
  if (term) chips.push({ key: 'search', kind: 'Search', label: `"${term}"` });

  if (!hasActiveFullDataFilters(filters)) return chips;

  const dateLabel = dateChipLabel(filters);
  if (dateLabel) chips.push({ key: 'date', kind: 'Date', label: dateLabel });

  pushSelectionChips(chips, filters.statuses, filters.availableStatuses, 'status', 'Status');
  pushSelectionChips(chips, filters.shippingMethods, filters.availableShippingMethods, 'shipping', 'Shipping');

  if (filters.uniqueCustomers) {
    chips.push({ key: 'uniqueCustomers', kind: 'Showing', label: 'One order per customer & product' });
  }

  return chips;
}

/**
 * Add chips for a multi-select filter, rendering whichever side is shorter:
 * the picked values, or the dropped ones as "Excluding" chips.
 */
function pushSelectionChips(chips, selectedValues, availableValues, keyPrefix, kind) {
  const selected = selectedValues || [];
  if (selected.length === 0) return;

  const available = availableValues || [];
  const selectedSet = new Set(selected.map(v => v.toLowerCase()));
  const excluded = available.filter(v => !selectedSet.has(String(v).toLowerCase()));

  if (excluded.length > 0 && excluded.length < selected.length) {
    excluded.forEach(v => chips.push({ key: `${keyPrefix}-exclude:${v}`, kind: 'Excluding', label: v }));
  } else {
    selected.forEach(v => chips.push({ key: `${keyPrefix}:${v}`, kind, label: v }));
  }
}

/**
 * Remove one chip, returning the resulting filter state.
 */
export function removeFullDataFilter(filters, key) {
  const next = {
    ...emptyFullDataFilters(),
    ...filters,
    statuses: [...(filters.statuses || [])],
    shippingMethods: [...(filters.shippingMethods || [])]
  };

  if (key === 'date') {
    next.preset = 'all';
    next.dateFrom = '';
    next.dateTo = '';
    return next;
  }

  if (key === 'uniqueCustomers') {
    next.uniqueCustomers = false;
    return next;
  }

  const drop = (list, value) => list.filter(v => v.toLowerCase() !== value.toLowerCase());
  // Adding a value back; once everything is back it stops being a filter at all
  const restore = (list, value, available) => {
    const merged = [...list, value];
    return merged.length >= (available || []).length ? [] : merged;
  };

  if (key.startsWith('status:')) {
    next.statuses = drop(next.statuses, key.slice('status:'.length));
  } else if (key.startsWith('status-exclude:')) {
    next.statuses = restore(next.statuses, key.slice('status-exclude:'.length), next.availableStatuses);
  } else if (key.startsWith('shipping:')) {
    next.shippingMethods = drop(next.shippingMethods, key.slice('shipping:'.length));
  } else if (key.startsWith('shipping-exclude:')) {
    next.shippingMethods = restore(next.shippingMethods, key.slice('shipping-exclude:'.length), next.availableShippingMethods);
  }

  return next;
}

/**
 * Hide any labelled control group whose buttons are all hidden for the current
 * view, and mark the leading visible group so it doesn't render a divider.
 */
export function syncControlGroups() {
  const groups = document.querySelectorAll('.magentodata-page .control-group');
  let isFirstVisible = true;

  groups.forEach(group => {
    const buttons = Array.from(group.querySelectorAll('.btn'));
    const anyVisible = buttons.length === 0 || buttons.some(btn => btn.style.display !== 'none');

    group.style.display = anyVisible ? '' : 'none';
    group.classList.toggle('is-first', anyVisible && isFirstVisible);
    if (anyVisible) isFirstVisible = false;
  });
}

/**
 * Render the active filter chip bar. Expects the markup used by the sales
 * pages (#activeFilters > .reveal-clip > .active-filters-bar).
 * @param {object|null} filters - pass null to collapse the bar
 * @param {object} handlers
 * @param {string} [handlers.search] - current search term, shown as its own chip
 * @param {function} [handlers.onChange] - called with the new filter state
 * @param {function} [handlers.onClearSearch] - called when the search chip is removed
 * @param {function} [handlers.onClearAll] - called by "Clear all" (search + filters)
 */
export function renderFullDataFilterBar(filters, { search = '', onChange, onClearSearch, onClearAll } = {}) {
  const bar = document.getElementById('activeFilters');
  const chipsEl = document.getElementById('filterChips');
  const clearBtn = document.getElementById('clearAllFiltersBtn');
  if (!bar || !chipsEl) return;

  // filters may be null outside Full Data view - search still applies there,
  // so the bar keeps showing the search chip on its own
  const chips = getFullDataFilterChips(filters, search);

  if (chips.length === 0) {
    // Leave the old chips in the DOM so they stay visible while the bar
    // animates closed (it is visibility:hidden once collapsed anyway).
    bar.classList.remove('visible');
    return;
  }

  chipsEl.innerHTML = chips.map(c => `
    <span class="filter-chip">
      <span class="chip-kind">${esc(c.kind)}:</span>
      <span>${esc(c.label)}</span>
      <button type="button" class="chip-remove" data-filter-key="${esc(c.key)}"
              title="Remove this filter" aria-label="Remove ${esc(c.kind)} filter ${esc(c.label)}">
        <i class="fas fa-times"></i>
      </button>
    </span>
  `).join('');

  chipsEl.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.filterKey;
      if (key === 'search') {
        if (onClearSearch) onClearSearch();
      } else if (onChange) {
        onChange(removeFullDataFilter(filters, key));
      }
    });
  });

  if (clearBtn) {
    // Replace the node to drop listeners from the previous render
    const fresh = clearBtn.cloneNode(true);
    clearBtn.parentNode.replaceChild(fresh, clearBtn);
    // One handler clears search and filters together so the table reloads once
    fresh.addEventListener('click', () => {
      if (onClearAll) onClearAll();
      else if (onChange) onChange(emptyFullDataFilters());
    });
  }

  bar.classList.add('visible');
}

/**
 * Short slug used in export filenames.
 */
export function filtersFilenameSlug(filters) {
  if (!hasActiveFullDataFilters(filters)) return '';
  const bits = [];
  if (filters.preset && filters.preset !== 'all' && filters.preset !== 'custom') {
    bits.push(filters.preset);
  } else {
    if (filters.dateFrom) bits.push(`from-${filters.dateFrom}`);
    if (filters.dateTo) bits.push(`to-${filters.dateTo}`);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    bits.push(filters.statuses.join('-'));
  }
  if (filters.shippingMethods && filters.shippingMethods.length > 0) {
    bits.push(filters.shippingMethods.join('-'));
  }
  if (filters.uniqueCustomers) bits.push('unique-customers');
  return bits.join('_').replace(/[^a-zA-Z0-9\-_]/g, '-').substring(0, 60);
}

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Turn a preset into concrete YYYY-MM-DD bounds (relative to today).
 */
function resolvePreset(preset) {
  if (!preset || preset === 'all' || preset === 'custom') return { dateFrom: '', dateTo: '' };

  const def = DATE_PRESETS.find(p => p.value === preset);
  if (!def) return { dateFrom: '', dateTo: '' };

  const from = new Date();
  if (def.days) {
    from.setDate(from.getDate() - def.days);
  } else if (def.months) {
    from.setMonth(from.getMonth() - def.months);
  }
  return { dateFrom: toDateString(from), dateTo: '' };
}

/**
 * Wire up one of the modal's tick-list filters (order status, shipping method).
 *
 * Everything is ticked by default; a single button flips between "Unselect all"
 * and "Select all" to match whatever is currently ticked.
 *
 * @returns {{selection: function}} selection() gives
 *   { values, available, none } - values is [] when everything is ticked, since
 *   "all of them" is the same as no filter at all.
 */
function createMultiSelect({ overlay, listId, toggleId, checkboxClass, stored, load, emptyText, errorText }) {
  const listEl = overlay.querySelector(`#${listId}`);
  const toggleBtn = overlay.querySelector(`#${toggleId}`);
  let available = [];

  const boxes = () => Array.from(overlay.querySelectorAll(`.${checkboxClass}`));

  const syncToggleLabel = () => {
    const all = boxes();
    const allChecked = all.length > 0 && all.every(cb => cb.checked);
    toggleBtn.textContent = allChecked ? 'Unselect all' : 'Select all';
    toggleBtn.disabled = all.length === 0;
  };

  const showNotice = (text, colour) => {
    listEl.innerHTML = `<span style="color: ${colour}; font-size: 0.9rem;">${esc(text)}</span>`;
  };

  (async () => {
    try {
      available = await load();

      if (available.length === 0) {
        showNotice(emptyText, 'var(--text-secondary)');
        syncToggleLabel();
        return;
      }

      // No stored selection means "everything" - tick the lot
      const storedValues = stored || [];
      const selected = new Set(storedValues.map(v => v.toLowerCase()));
      const selectAll = storedValues.length === 0;

      listEl.innerHTML = available.map(value => `
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" class="${checkboxClass}" value="${esc(value)}"
                 ${selectAll || selected.has(String(value).toLowerCase()) ? 'checked' : ''}
                 style="width: 16px; height: 16px; flex-shrink: 0;">
          <span>${esc(value)}</span>
        </label>
      `).join('');
      syncToggleLabel();
    } catch (error) {
      console.error(`[Full Data Filters] Could not load ${listId}:`, error);
      showNotice(errorText, 'var(--danger, #d33)');
      syncToggleLabel();
    }
  })();

  toggleBtn.addEventListener('click', () => {
    const all = boxes();
    const allChecked = all.length > 0 && all.every(cb => cb.checked);
    all.forEach(cb => { cb.checked = !allChecked; });
    syncToggleLabel();
  });

  listEl.addEventListener('change', (e) => {
    if (e.target.classList.contains(checkboxClass)) syncToggleLabel();
  });

  return {
    selection() {
      const values = boxes().filter(cb => cb.checked).map(cb => cb.value);
      return {
        values: values.length === available.length ? [] : values,
        available,
        none: available.length > 0 && values.length === 0
      };
    }
  };
}

/**
 * Show the Full Data filter modal.
 * @param {string} region - 'all' | 'uk' | 'fr' | 'nl'
 * @param {object} currentFilters - existing filter state (see emptyFullDataFilters)
 * @param {function} onApply - called with the new filter state
 */
export function showFullDataFilterModal(region, currentFilters, onApply) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const filters = { ...emptyFullDataFilters(), ...(currentFilters || {}) };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width: 560px;">
      <div class="modal-header">
        <div class="modal-header-icon"><i class="fas fa-sliders-h"></i></div>
        <h2 class="modal-title">Filter Full Data - ${region.toUpperCase()}</h2>
        <button class="modal-close" id="fdFilterCloseBtn"><i class="fas fa-times"></i></button>
      </div>

      <div class="modal-body">
        <div class="nui-field">
          <div class="nui-label"><span>Date Range (order created)</span></div>
          <!-- auto-fit keeps this 3-across on desktop and 2 (or 1) on a phone -->
          <div id="fdPresetGroup" data-selected="${filters.preset}"
               style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 12px;">
            ${DATE_PRESETS.map(p => `
              <button type="button" class="btn ${filters.preset === p.value ? 'btn-solid' : 'btn-faded'} btn-success rounded-lg fd-preset-btn"
                      data-preset="${p.value}">
                <i class="fas ${p.icon}"></i>
                <span>${p.label}</span>
              </button>
            `).join('')}
          </div>
          <div id="fdCustomDates" style="display: ${filters.preset === 'custom' ? 'flex' : 'none'}; flex-wrap: wrap; gap: 12px; margin-top: 12px;">
            <!-- each date input needs its own .nui-field so the date picker anchors correctly -->
            <div class="nui-field" style="flex: 1 1 150px; min-width: 0;">
              <div class="nui-label" style="font-size: 0.85rem;"><span>From</span></div>
              <input type="text" id="fdDateFrom" class="nui-input nui-input-default" style="width: 100%;"
                     placeholder="YYYY-MM-DD" value="${filters.preset === 'custom' ? (filters.dateFrom || '') : ''}"
                     autocomplete="off" data-lpignore="true">
            </div>
            <div class="nui-field" style="flex: 1 1 150px; min-width: 0;">
              <div class="nui-label" style="font-size: 0.85rem;"><span>To</span></div>
              <input type="text" id="fdDateTo" class="nui-input nui-input-default" style="width: 100%;"
                     placeholder="YYYY-MM-DD" value="${filters.preset === 'custom' ? (filters.dateTo || '') : ''}"
                     autocomplete="off" data-lpignore="true">
            </div>
          </div>
        </div>

        <div class="nui-field" style="margin-top: 24px; border-top: 1px solid var(--bg-light); padding-top: 24px;">
          <div class="nui-label" style="display: flex; align-items: center; justify-content: space-between;">
            <span>Order Status</span>
            <button type="button" class="btn btn-ghost btn-default" id="fdToggleStatuses" style="padding: 2px 10px; font-size: 0.8rem;">Unselect all</button>
          </div>
          <div id="fdStatusList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-top: 12px; max-height: 220px; overflow-y: auto;">
            <span style="color: var(--text-secondary); font-size: 0.9rem;">Loading statuses...</span>
          </div>
          <p class="filter-description" style="margin-top: 8px;">
            All statuses are included by default. Untick the ones you don't want (e.g. canceled).
          </p>
        </div>

        <div class="nui-field" style="margin-top: 24px; border-top: 1px solid var(--bg-light); padding-top: 24px;">
          <div class="nui-label" style="display: flex; align-items: center; justify-content: space-between;">
            <span>Shipping Method</span>
            <button type="button" class="btn btn-ghost btn-default" id="fdToggleShipping" style="padding: 2px 10px; font-size: 0.8rem;">Unselect all</button>
          </div>
          <div id="fdShippingList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-top: 12px; max-height: 220px; overflow-y: auto;">
            <span style="color: var(--text-secondary); font-size: 0.9rem;">Loading shipping methods...</span>
          </div>
          <p class="filter-description" style="margin-top: 8px;">
            All methods are included by default. Untick to narrow by how the order was shipped or collected.
          </p>
        </div>

        <div class="nui-field" style="margin-top: 24px; border-top: 1px solid var(--bg-light); padding-top: 24px;">
          <div class="nui-label"><span>Repeat Orders</span></div>
          <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin-top: 12px;">
            <input type="checkbox" id="fdUniqueCustomers" ${filters.uniqueCustomers ? 'checked' : ''}
                   style="width: 18px; height: 18px; margin-top: 2px; flex-shrink: 0;">
            <span>Show each customer only once per product</span>
          </label>
          <p class="filter-description" style="margin-top: 8px; margin-left: 30px;">
            Keeps only the <strong>most recent</strong> order per customer per product, so one customer
            can't appear twice for the same item. A customer is matched on name <em>and</em> email.
            <br><br>
            Example: search "Juvederm" - a customer who bought Juvederm 2 twice and Juvederm 3 once
            appears twice: their latest Juvederm 2 order and their Juvederm 3 order. Different products
            are still listed separately.
            <br><br>
            Row counts and the CSV export both reflect this, so it's the setting to use when building a
            mailing list.
          </p>
        </div>
      </div>

      <div class="modal-footer" style="display: flex; justify-content: space-between; gap: 8px; padding: 16px;">
        <button class="btn btn-ghost btn-default" id="fdResetBtn">
          <i class="fas fa-undo"></i> Reset
        </button>
        <span style="display: flex; gap: 8px;">
          <button class="btn btn-solid btn-default rounded-lg" id="fdCancelBtn">Cancel</button>
          <button class="btn btn-solid btn-success" id="fdApplyBtn">
            <i class="fas fa-check"></i> Apply Filters
          </button>
        </span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#fdFilterCloseBtn').addEventListener('click', close);
  overlay.querySelector('#fdCancelBtn').addEventListener('click', close);

  // Selected preset is the solid button; the rest stay faded
  const customDates = overlay.querySelector('#fdCustomDates');
  const presetGroup = overlay.querySelector('#fdPresetGroup');
  presetGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.fd-preset-btn');
    if (!btn) return;

    presetGroup.dataset.selected = btn.dataset.preset;
    presetGroup.querySelectorAll('.fd-preset-btn').forEach(b => {
      const isSelected = b === btn;
      b.classList.toggle('btn-solid', isSelected);
      b.classList.toggle('btn-faded', !isSelected);
    });
    customDates.style.display = btn.dataset.preset === 'custom' ? 'flex' : 'none';
  });

  initDatePicker('#fdDateFrom');
  initDatePicker('#fdDateTo');

  // Both multi-selects behave identically: everything ticked by default, one
  // button that flips between "Unselect all" and "Select all".
  const statusPicker = createMultiSelect({
    overlay,
    listId: 'fdStatusList',
    toggleId: 'fdToggleStatuses',
    checkboxClass: 'fd-status-checkbox',
    stored: filters.statuses,
    load: () => getAvailableStatuses(region).then(r => (r && r.statuses) || []),
    emptyText: 'No statuses found in the cached orders.',
    errorText: 'Failed to load statuses.'
  });

  const shippingPicker = createMultiSelect({
    overlay,
    listId: 'fdShippingList',
    toggleId: 'fdToggleShipping',
    checkboxClass: 'fd-shipping-checkbox',
    stored: filters.shippingMethods,
    load: () => getShippingMethods(region).then(r => (r && r.shipping_methods) || []),
    emptyText: 'No shipping methods found in the cached orders.',
    errorText: 'Failed to load shipping methods.'
  });

  overlay.querySelector('#fdResetBtn').addEventListener('click', () => {
    close();
    if (onApply) onApply(emptyFullDataFilters());
  });

  overlay.querySelector('#fdApplyBtn').addEventListener('click', () => {
    const preset = presetGroup.dataset.selected || 'all';
    let dateFrom = '';
    let dateTo = '';

    if (preset === 'custom') {
      dateFrom = overlay.querySelector('#fdDateFrom').value.trim();
      dateTo = overlay.querySelector('#fdDateTo').value.trim();

      const isValid = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
      if (!isValid(dateFrom) || !isValid(dateTo)) {
        showToast('Dates must be in YYYY-MM-DD format', 'warning');
        return;
      }
      if (dateFrom && dateTo && dateFrom > dateTo) {
        showToast('"From" date must be before "To" date', 'warning');
        return;
      }
    } else {
      ({ dateFrom, dateTo } = resolvePreset(preset));
    }

    const statusSelection = statusPicker.selection();
    if (statusSelection.none) {
      showToast('Select at least one order status', 'warning');
      return;
    }

    const shippingSelection = shippingPicker.selection();
    if (shippingSelection.none) {
      showToast('Select at least one shipping method', 'warning');
      return;
    }

    close();
    if (onApply) {
      onApply({
        preset,
        dateFrom,
        dateTo,
        statuses: statusSelection.values,
        availableStatuses: statusSelection.available,
        shippingMethods: shippingSelection.values,
        availableShippingMethods: shippingSelection.available,
        uniqueCustomers: overlay.querySelector('#fdUniqueCustomers').checked
      });
    }
  });
}
