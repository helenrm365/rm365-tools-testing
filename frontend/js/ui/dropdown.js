// ui/dropdown.js — Shared nui-dropdown for native <select> elements
// Usage: import { initDropdown } from '../../ui/dropdown.js';
//        initDropdown('#mySelect');
//   or:  initDropdown('#mySelect', { color: 'primary' });

const CHEVRON_SVG = '<svg class="nui-dropdown-chevron" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const activeDropdowns = new Set();
let globalListenerAttached = false;

function attachGlobalListener() {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  document.addEventListener('click', () => {
    activeDropdowns.forEach(d => d.close());
  });
}

/**
 * Wrap a native <select> with nui-dropdown styling.
 * Keeps the native select hidden but synced — all existing .value / .innerHTML
 * JS code continues to work. A MutationObserver re-syncs when options change.
 *
 * @param {string} selector - CSS selector for the <select> element
 * @param {object} [opts]
 * @param {string} [opts.color='default'] - Color variant (default|primary|secondary|success|warning|danger)
 * @param {string} [opts.size]  - Size variant (sm|lg, omit for md)
 * @returns {{ open, close, refresh, destroy } | null}
 */
export function initDropdown(selectorOrEl, opts = {}) {
  let native = typeof selectorOrEl === 'string'
    ? document.querySelector(selectorOrEl)
    : selectorOrEl;
  if (!native || native.tagName !== 'SELECT') return null;

  // Prevent double-init
  if (native.dataset.nuiEnhanced === '1') return null;
  native.dataset.nuiEnhanced = '1';

  // Tear down any existing c-select wrapper
  const cSelectWrap = native.closest('.c-select');
  if (cSelectWrap) {
    const parent = cSelectWrap.parentNode;
    parent.insertBefore(native, cSelectWrap);
    cSelectWrap.remove();
    native.classList.remove('select-hidden');
    native.style.display = '';
    delete native.dataset.enhanced;
  }

  // Prevent c-select from also enhancing this element
  native.removeAttribute('data-enhance');
  native.classList.remove('modern-select');
  native.dataset.enhanced = 'nui';

  const color = opts.color || 'default';
  const size = opts.size || '';

  // Build wrapper
  const wrap = document.createElement('div');
  let cls = `nui-dropdown nui-dropdown-${color}`;
  if (size) cls += ` nui-dropdown-${size}`;
  wrap.className = cls;

  // Trigger button
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'nui-dropdown-trigger';

  const valueSpan = document.createElement('span');
  valueSpan.className = 'nui-dropdown-value';
  trigger.appendChild(valueSpan);
  trigger.insertAdjacentHTML('beforeend', CHEVRON_SVG);

  // Menu
  const menu = document.createElement('div');
  menu.className = 'nui-dropdown-menu';

  // Insert into DOM
  const parent = native.parentNode;
  parent.insertBefore(wrap, native);
  native.classList.add('select-hidden');
  native.style.display = 'none';
  wrap.appendChild(native);
  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  // ---- Sync helpers ----

  function buildItems() {
    menu.innerHTML = '';
    Array.from(native.options).forEach((opt) => {
      // Skip placeholder options (disabled with empty value)
      if (opt.disabled && opt.value === '') return;

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'nui-dropdown-item';
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;

      if (opt.value === native.value) {
        item.classList.add('is-selected');
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        native.value = opt.value;
        native.dispatchEvent(new Event('change', { bubbles: true }));
        updateLabel();
        highlightSelected();
        dropdown.close();
      });

      menu.appendChild(item);
    });
  }

  function updateLabel() {
    const sel = native.selectedOptions?.[0] || native.options?.[native.selectedIndex];
    if (sel && sel.value !== '' && !sel.disabled) {
      valueSpan.textContent = sel.textContent;
      trigger.classList.add('has-value');
    } else {
      // Show placeholder
      const placeholder = native.querySelector('option[disabled]') || native.options[0];
      valueSpan.textContent = placeholder ? placeholder.textContent : 'Select…';
      trigger.classList.remove('has-value');
    }
  }

  function highlightSelected() {
    menu.querySelectorAll('.nui-dropdown-item').forEach(item => {
      item.classList.toggle('is-selected', item.dataset.value === native.value);
    });
  }

  // ---- Disabled sync ----

  function syncDisabled() {
    wrap.classList.toggle('is-disabled', native.disabled);
  }
  syncDisabled(); // initial state

  // ---- Open / Close ----

  function open() {
    if (native.disabled) return;
    activeDropdowns.forEach(d => { if (d !== dropdown) d.close(); });
    buildItems();
    updateLabel();
    wrap.classList.add('is-open');
  }

  function close() {
    wrap.classList.remove('is-open');
  }

  function toggle() {
    wrap.classList.contains('is-open') ? close() : open();
  }

  // ---- API object ----

  const dropdown = {
    open,
    close,
    refresh() { buildItems(); updateLabel(); },
    syncDisabled,
    destroy() {
      observer.disconnect();
      activeDropdowns.delete(dropdown);
      native.removeEventListener('change', onNativeChange);
      // Restore native .value and .disabled properties
      delete native.value;
      delete native.disabled;
      // Unwrap: move native select back
      const p = wrap.parentNode;
      if (p) {
        p.insertBefore(native, wrap);
        wrap.remove();
      }
      native.style.display = '';
      native.classList.remove('select-hidden');
      delete native.dataset.nuiEnhanced;
    }
  };

  // ---- Events ----

  trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  menu.addEventListener('click', (e) => e.stopPropagation());

  function onNativeChange() {
    updateLabel();
    highlightSelected();
  }
  native.addEventListener('change', onNativeChange);

  // Intercept programmatic .value = ... changes on the native select
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(native, 'value', {
    get() { return valueDesc.get.call(this); },
    set(v) {
      valueDesc.set.call(this, v);
      updateLabel();
      highlightSelected();
    },
    configurable: true
  });

  // Intercept programmatic .disabled = ... changes on the native select
  const disabledDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled');
  Object.defineProperty(native, 'disabled', {
    get() { return disabledDesc.get.call(this); },
    set(v) {
      disabledDesc.set.call(this, v);
      syncDisabled();
    },
    configurable: true
  });

  // Re-sync when native options are added/removed (dynamic population)
  const observer = new MutationObserver(() => {
    buildItems();
    updateLabel();
  });
  observer.observe(native, { childList: true });

  activeDropdowns.add(dropdown);
  attachGlobalListener();

  // Initial render
  buildItems();
  updateLabel();

  return dropdown;
}
