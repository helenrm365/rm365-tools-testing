// ui/datePicker.js — Shared nui-calendar date picker
// Usage: import { initDatePicker } from '../../ui/datePicker.js';
//        initDatePicker('#myDateInput');
//   or:  initDatePicker('#myDateInput', { onSelect(dateStr) { ... } });

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CHEVRON_LEFT  = '<svg viewBox="0 0 24 24" fill="none"><path d="M15 6L9 12L15 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Track all active pickers for click-outside
const activePickers = new Set();
let globalListenerAttached = false;

function attachGlobalListener() {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  document.addEventListener('click', () => {
    activePickers.forEach(p => p.close());
  });
}

/**
 * Initialize a date picker on a text input.
 * Wraps the input, injects the popup calendar, and wires up all events.
 * @param {string} selector - CSS selector for the input element
 * @param {object} [opts] - Options
 * @param {function} [opts.onSelect] - Called with date string (YYYY-MM-DD) when a day is picked
 * @returns {{ destroy: Function, refresh: Function }} controls
 */
const isMobile = window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches;

export function initDatePicker(selector, opts = {}) {
  const input = document.querySelector(selector);
  if (!input) return null;

  // On mobile, use the native date picker
  if (isMobile) {
    input.type = 'date';
    input.readOnly = false;
    const noop = () => {};
    return { open: noop, close: noop, refresh: noop, destroy: noop };
  }

  // Ensure input is text + readonly so no native picker fires
  input.type = 'text';
  input.readOnly = true;
  if (!input.placeholder) input.placeholder = 'YYYY-MM-DD';

  // Wrap input in a positioned container
  const field = input.closest('.nui-field') || input.parentElement;
  field.classList.add('nui-calendar-field');

  // Create popup container
  const popup = document.createElement('div');
  popup.className = 'nui-calendar nui-calendar-popup';
  field.appendChild(popup);

  // State for this picker
  const state = { year: 0, month: 0 };

  function syncFromInput() {
    const val = input.value;
    if (val) {
      const [y, m] = val.split('-').map(Number);
      state.year = y;
      state.month = m - 1;
    } else {
      const now = new Date();
      state.year = now.getFullYear();
      state.month = now.getMonth();
    }
  }

  function render() {
    const selectedStr = input.value || '';

    const firstDay = new Date(state.year, state.month, 1).getDay();
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const daysInPrev = new Date(state.year, state.month, 0).getDate();

    let gridHtml = '';

    // Leading days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      gridHtml += `<button class="nui-calendar-day" disabled>${daysInPrev - i}</button>`;
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${state.year}-${String(state.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cls = dateStr === selectedStr ? 'nui-calendar-day is-selected' : 'nui-calendar-day';
      gridHtml += `<button class="${cls}" data-date="${dateStr}">${d}</button>`;
    }

    // Trailing days
    const totalCells = firstDay + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      gridHtml += `<button class="nui-calendar-day" disabled>${i}</button>`;
    }

    popup.innerHTML = `
      <div class="nui-calendar-header">
        <button aria-label="Previous month" data-dir="-1">${CHEVRON_LEFT}</button>
        <span class="nui-calendar-title">${MONTH_NAMES[state.month]} ${state.year}</span>
        <button aria-label="Next month" data-dir="1">${CHEVRON_RIGHT}</button>
      </div>
      <div class="nui-calendar-weekdays">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
      </div>
      <div class="nui-calendar-grid">${gridHtml}</div>
    `;

    // Nav arrows
    popup.querySelectorAll('.nui-calendar-header button[data-dir]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.month += parseInt(btn.dataset.dir);
        if (state.month > 11) { state.month = 0; state.year++; }
        if (state.month < 0)  { state.month = 11; state.year--; }
        render();
      });
    });

    // Day clicks
    popup.querySelectorAll('.nui-calendar-day[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.date;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        picker.close();
        render();
        if (opts.onSelect) opts.onSelect(btn.dataset.date);
      });
    });
  }

  function open() {
    // Close all other pickers first
    activePickers.forEach(p => { if (p !== picker) p.close(); });
    syncFromInput();
    render();
    popup.classList.add('is-open');
  }

  function close() {
    popup.classList.remove('is-open');
  }

  function toggle() {
    if (popup.classList.contains('is-open')) close();
    else open();
  }

  const picker = { close, open, refresh() { syncFromInput(); render(); }, destroy };

  // Events
  input.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  popup.addEventListener('click', (e) => e.stopPropagation());

  activePickers.add(picker);
  attachGlobalListener();

  // Initial render (hidden)
  syncFromInput();
  render();

  function destroy() {
    activePickers.delete(picker);
    popup.remove();
    field.classList.remove('nui-calendar-field');
  }

  return picker;
}
