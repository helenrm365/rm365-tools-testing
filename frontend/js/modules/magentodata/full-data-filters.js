// frontend/js/modules/magentodata/full-data-filters.js
// Advanced filters for the Full Data view: date range + order status.
// Shared by the All / UK / FR / NL sales data pages.
import { getAvailableStatuses } from '../../services/api/magentoDataApi.js?v=9';
import { initDatePicker } from '../../ui/datePicker.js';
import { showToast } from '../../ui/toast.js';

const DATE_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days', months: 1, days: 30 },
  { value: '3m', label: 'Last 3 months', months: 3 },
  { value: '6m', label: 'Last 6 months', months: 6 },
  { value: '12m', label: 'Last 12 months', months: 12 },
  { value: 'custom', label: 'Custom range' }
];

/**
 * The shape used across the sales pages.
 * `statuses` is the list to include - empty means every status.
 * `availableStatuses` is the full set offered by the region, kept so the chip
 * bar can show whichever side (included / excluded) is shorter.
 * @returns {{preset: string, dateFrom: string, dateTo: string, statuses: string[], availableStatuses: string[]}}
 */
export function emptyFullDataFilters() {
  return { preset: 'all', dateFrom: '', dateTo: '', statuses: [], availableStatuses: [] };
}

/**
 * True when the filters would narrow the result set.
 */
export function hasActiveFullDataFilters(filters) {
  if (!filters) return false;
  return Boolean(filters.dateFrom || filters.dateTo || (filters.statuses && filters.statuses.length > 0));
}

/**
 * Human readable summary, e.g. "Last 6 months · complete, processing".
 */
export function describeFullDataFilters(filters) {
  if (!hasActiveFullDataFilters(filters)) return '';

  const parts = [];
  const preset = DATE_PRESETS.find(p => p.value === filters.preset);
  if (filters.preset && filters.preset !== 'all' && filters.preset !== 'custom' && preset) {
    parts.push(preset.label);
  } else if (filters.dateFrom && filters.dateTo) {
    parts.push(`${filters.dateFrom} to ${filters.dateTo}`);
  } else if (filters.dateFrom) {
    parts.push(`From ${filters.dateFrom}`);
  } else if (filters.dateTo) {
    parts.push(`Until ${filters.dateTo}`);
  }

  if (filters.statuses && filters.statuses.length > 0) {
    parts.push(filters.statuses.join(', '));
  }

  return parts.join(' · ');
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
 * Build the removable chips describing the active filters.
 *
 * Statuses render as whichever side is shorter: picking 2 of 12 shows two
 * "Status" chips, dropping 1 of 12 shows a single "Excluding" chip. Either way
 * removing a chip does the obvious thing.
 * @returns {Array<{key: string, kind: string, label: string}>}
 */
export function getFullDataFilterChips(filters) {
  if (!hasActiveFullDataFilters(filters)) return [];

  const chips = [];
  const dateLabel = dateChipLabel(filters);
  if (dateLabel) chips.push({ key: 'date', kind: 'Date', label: dateLabel });

  const statuses = filters.statuses || [];
  if (statuses.length > 0) {
    const available = filters.availableStatuses || [];
    const selected = new Set(statuses.map(s => s.toLowerCase()));
    const excluded = available.filter(s => !selected.has(String(s).toLowerCase()));

    if (excluded.length > 0 && excluded.length < statuses.length) {
      excluded.forEach(s => chips.push({ key: `exclude:${s}`, kind: 'Excluding', label: s }));
    } else {
      statuses.forEach(s => chips.push({ key: `status:${s}`, kind: 'Status', label: s }));
    }
  }

  return chips;
}

/**
 * Remove one chip, returning the resulting filter state.
 */
export function removeFullDataFilter(filters, key) {
  const next = { ...emptyFullDataFilters(), ...filters, statuses: [...(filters.statuses || [])] };

  if (key === 'date') {
    next.preset = 'all';
    next.dateFrom = '';
    next.dateTo = '';
    return next;
  }

  if (key.startsWith('status:')) {
    const value = key.slice('status:'.length).toLowerCase();
    next.statuses = next.statuses.filter(s => s.toLowerCase() !== value);
    return next;
  }

  if (key.startsWith('exclude:')) {
    // Putting an excluded status back; once everything is back it's no filter
    const value = key.slice('exclude:'.length);
    next.statuses.push(value);
    if (next.statuses.length >= (next.availableStatuses || []).length) {
      next.statuses = [];
    }
    return next;
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
 * @param {{onChange: function}} handlers - called with the new filter state
 */
export function renderFullDataFilterBar(filters, { onChange } = {}) {
  const bar = document.getElementById('activeFilters');
  const chipsEl = document.getElementById('filterChips');
  const clearBtn = document.getElementById('clearAllFiltersBtn');
  if (!bar || !chipsEl) return;

  const chips = filters ? getFullDataFilterChips(filters) : [];

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
      if (onChange) onChange(removeFullDataFilter(filters, btn.dataset.filterKey));
    });
  });

  if (clearBtn && onChange) {
    // Replace the node to drop listeners from the previous render
    const fresh = clearBtn.cloneNode(true);
    clearBtn.parentNode.replaceChild(fresh, clearBtn);
    fresh.addEventListener('click', () => onChange(emptyFullDataFilters()));
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
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 12px;">
            ${DATE_PRESETS.map(p => `
              <label class="radio-option">
                <input type="radio" name="fdDatePreset" value="${p.value}" ${filters.preset === p.value ? 'checked' : ''}>
                <span>${p.label}</span>
              </label>
            `).join('')}
          </div>
          <div id="fdCustomDates" style="display: ${filters.preset === 'custom' ? 'flex' : 'none'}; gap: 12px; margin-top: 12px; margin-left: 28px;">
            <!-- each date input needs its own .nui-field so the date picker anchors correctly -->
            <div class="nui-field" style="flex: 1;">
              <div class="nui-label" style="font-size: 0.85rem;"><span>From</span></div>
              <input type="text" id="fdDateFrom" class="nui-input nui-input-default" style="width: 100%;"
                     placeholder="YYYY-MM-DD" value="${filters.preset === 'custom' ? (filters.dateFrom || '') : ''}"
                     autocomplete="off" data-lpignore="true">
            </div>
            <div class="nui-field" style="flex: 1;">
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

  // Toggle the custom date inputs with the preset radios
  const customDates = overlay.querySelector('#fdCustomDates');
  overlay.querySelectorAll('input[name="fdDatePreset"]').forEach(radio => {
    radio.addEventListener('change', () => {
      customDates.style.display = radio.value === 'custom' ? 'flex' : 'none';
    });
  });

  initDatePicker('#fdDateFrom');
  initDatePicker('#fdDateTo');

  // Load the statuses actually present in the cached orders
  const statusList = overlay.querySelector('#fdStatusList');
  const toggleBtn = overlay.querySelector('#fdToggleStatuses');
  let availableStatuses = [];

  const statusCheckboxes = () => Array.from(overlay.querySelectorAll('.fd-status-checkbox'));

  // The button toggles: "Unselect all" while everything is ticked, "Select all" otherwise
  const syncToggleLabel = () => {
    const boxes = statusCheckboxes();
    const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
    toggleBtn.textContent = allChecked ? 'Unselect all' : 'Select all';
    toggleBtn.disabled = boxes.length === 0;
  };

  (async () => {
    try {
      const result = await getAvailableStatuses(region);
      availableStatuses = (result && result.statuses) || [];

      if (availableStatuses.length === 0) {
        statusList.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.9rem;">No statuses found in the cached orders.</span>';
        syncToggleLabel();
        return;
      }

      // No stored selection means "all statuses" - tick everything
      const stored = filters.statuses || [];
      const selected = new Set(stored.map(s => s.toLowerCase()));
      const selectAll = stored.length === 0;

      statusList.innerHTML = availableStatuses.map(status => `
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" class="fd-status-checkbox" value="${status}"
                 ${selectAll || selected.has(String(status).toLowerCase()) ? 'checked' : ''}
                 style="width: 16px; height: 16px;">
          <span>${status}</span>
        </label>
      `).join('');
      syncToggleLabel();
    } catch (error) {
      console.error('[Full Data Filters] Could not load statuses:', error);
      statusList.innerHTML = '<span style="color: var(--danger-color, #d33); font-size: 0.9rem;">Failed to load statuses.</span>';
      syncToggleLabel();
    }
  })();

  toggleBtn.addEventListener('click', () => {
    const boxes = statusCheckboxes();
    const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
    boxes.forEach(cb => { cb.checked = !allChecked; });
    syncToggleLabel();
  });

  statusList.addEventListener('change', (e) => {
    if (e.target.classList.contains('fd-status-checkbox')) syncToggleLabel();
  });

  overlay.querySelector('#fdResetBtn').addEventListener('click', () => {
    close();
    if (onApply) onApply(emptyFullDataFilters());
  });

  overlay.querySelector('#fdApplyBtn').addEventListener('click', () => {
    const preset = overlay.querySelector('input[name="fdDatePreset"]:checked')?.value || 'all';
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

    let statuses = statusCheckboxes().filter(cb => cb.checked).map(cb => cb.value);

    if (availableStatuses.length > 0 && statuses.length === 0) {
      showToast('Select at least one order status', 'warning');
      return;
    }

    // Everything ticked is the same as no status filter - keep the query and
    // the summary bar clean rather than listing every status
    if (statuses.length === availableStatuses.length) {
      statuses = [];
    }

    close();
    if (onApply) onApply({ preset, dateFrom, dateTo, statuses, availableStatuses });
  });
}
