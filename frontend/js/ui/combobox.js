// ui/combobox.js — nui-styled searchable dropdown (combobox)
//
// Turns a plain text <input> into a searchable picker whose results render in a
// floating menu that reuses the nui-dropdown look + open/close animation
// (see css/components/dropdown-nextui.css). The input stays a normal text field,
// so free typing is preserved — the menu is just an assist.
//
// The results menu is portaled to <body> and positioned `fixed` from the input's
// bounding rect, so it is never clipped by scrolling/overflow ancestors (e.g. the
// scrollable tables in the PDF import modals) and always sits above modals.
//
// Usage:
//   import { initCombobox } from '../../ui/combobox.js';
//   initCombobox(inputEl, {
//     items: [...],                      // source array (or () => array)
//     getLabel: (item) => string,        // text for the input + list row
//     getValue: (item) => string,        // value written to input (default: getLabel)
//     onSelect: (item, inputEl) => void, // default: set value + dispatch 'change'
//     filter:   (item, query) => bool,   // default: getLabel contains query (ci)
//     renderItem: (item) => htmlString,  // optional custom row markup
//     max: 50,                           // max rows rendered
//     minChars: 0,                       // min query length before opening
//   });

const INSTANCES = new Set();
let globalsAttached = false;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachGlobals() {
  if (globalsAttached) return;
  globalsAttached = true;

  // Close on outside pointer-down; prune any instances whose input was removed.
  document.addEventListener('mousedown', (e) => {
    INSTANCES.forEach((inst) => {
      if (!inst.input.isConnected) { inst.destroy(); return; }
      if (!inst.isOpen) return;
      if (e.target === inst.input || inst.menu.contains(e.target)) return;
      inst.close();
    });
  }, true);

  // Reposition open menus when the page or any scroll container moves.
  const onMove = () => {
    INSTANCES.forEach((inst) => {
      if (!inst.input.isConnected) { inst.destroy(); return; }
      if (inst.isOpen) inst.reposition();
    });
  };
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
}

/**
 * Enhance a text <input> with a nui-styled searchable results menu.
 * @param {HTMLInputElement} input
 * @param {object} opts
 * @returns {{open, close, destroy} | null}
 */
export function initCombobox(input, opts = {}) {
  if (!input || input.tagName !== 'INPUT') return null;
  // Drop any stale instances first (rows re-render and detach old inputs).
  INSTANCES.forEach((inst) => { if (!inst.input.isConnected) inst.destroy(); });
  if (input.dataset.comboboxEnhanced === '1') return null;
  input.dataset.comboboxEnhanced = '1';

  const getItems  = typeof opts.items === 'function' ? opts.items : () => (opts.items || []);
  const getLabel  = opts.getLabel || ((x) => String(x));
  const getValue  = opts.getValue || getLabel;
  const filterFn  = opts.filter   || ((item, q) => getLabel(item).toLowerCase().includes(q));
  const renderRow = opts.renderItem || ((item) => esc(getLabel(item)));
  const max       = opts.max ?? 50;
  const minChars  = opts.minChars ?? 0;

  // A native datalist popup would compete with our styled menu — disable it.
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');

  const menu = document.createElement('div');
  menu.className = 'nui-dropdown-menu nui-combobox-menu';
  document.body.appendChild(menu);

  let filtered = [];
  let activeIndex = -1;

  const inst = { input, menu, isOpen: false, open, close, reposition, destroy };

  function reposition() {
    const r = input.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    // Keep the menu within the viewport horizontally.
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    menu.style.position = 'fixed';
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';
    menu.style.width = `${width}px`;
  }

  function render() {
    if (!filtered.length) {
      menu.innerHTML = '<div class="nui-combobox-empty">No matches</div>';
      return;
    }
    menu.innerHTML = filtered
      .map((item, i) =>
        `<button type="button" class="nui-dropdown-item${i === activeIndex ? ' is-active' : ''}" data-i="${i}">${renderRow(item)}</button>`)
      .join('');
  }

  function compute() {
    const q = input.value.trim().toLowerCase();
    const all = getItems();
    filtered = (q ? all.filter((item) => filterFn(item, q)) : all.slice()).slice(0, max);
    activeIndex = -1;
  }

  function open() {
    if (input.value.trim().length < minChars) return close();
    compute();
    render();
    reposition();
    if (!inst.isOpen) {
      inst.isOpen = true;
      // Reflow so the transition runs from the hidden base state.
      void menu.offsetWidth;
      menu.classList.add('is-open');
    }
  }

  function close() {
    if (!inst.isOpen) return;
    inst.isOpen = false;
    menu.classList.remove('is-open');
  }

  function setActive(i) {
    const items = menu.querySelectorAll('.nui-dropdown-item');
    if (!items.length) return;
    activeIndex = (i + items.length) % items.length;
    items.forEach((el, idx) => el.classList.toggle('is-active', idx === activeIndex));
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function choose(item) {
    if (opts.onSelect) {
      opts.onSelect(item, input);
    } else {
      input.value = getValue(item);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  }

  // ---- Events ----
  const onFocus = () => open();
  const onInput = () => open();
  const onKeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!inst.isOpen) return open(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!inst.isOpen) return open(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') {
      if (inst.isOpen && activeIndex >= 0 && filtered[activeIndex]) { e.preventDefault(); choose(filtered[activeIndex]); }
    } else if (e.key === 'Escape') {
      if (inst.isOpen) { e.stopPropagation(); close(); }
    }
  };
  // mousedown (not click) so selection beats the input's blur.
  const onMenuMousedown = (e) => {
    const btn = e.target.closest('.nui-dropdown-item');
    if (!btn) return;
    e.preventDefault();
    const item = filtered[+btn.dataset.i];
    if (item) choose(item);
  };
  const onBlur = () => { setTimeout(close, 120); };

  input.addEventListener('focus', onFocus);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', onBlur);
  menu.addEventListener('mousedown', onMenuMousedown);

  function destroy() {
    INSTANCES.delete(inst);
    input.removeEventListener('focus', onFocus);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeydown);
    input.removeEventListener('blur', onBlur);
    menu.removeEventListener('mousedown', onMenuMousedown);
    menu.remove();
    delete input.dataset.comboboxEnhanced;
  }

  INSTANCES.add(inst);
  attachGlobals();
  return inst;
}

/** Destroy combobox instances whose input is no longer in the DOM. */
export function pruneDetachedComboboxes() {
  INSTANCES.forEach((inst) => { if (!inst.input.isConnected) inst.destroy(); });
}
