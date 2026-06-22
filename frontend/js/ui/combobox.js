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
// Closing mirrors the proven nui-dropdown pattern (ui/dropdown.js): the input and
// menu stopPropagation on pointer-down, and a single document-level pointer-down
// closes whichever combobox is open.
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
let openInst = null;        // only one combobox open at a time
let globalsAttached = false;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeOpen() {
  if (openInst) openInst.close();
}

function attachGlobals() {
  if (globalsAttached) return;
  globalsAttached = true;

  // Any pointer-down that wasn't on an open combobox's input/menu closes it.
  // (The input and menu call stopPropagation, so those clicks never reach here.)
  document.addEventListener('mousedown', closeOpen);
  document.addEventListener('touchstart', closeOpen);

  // Keep the open menu glued to its input while the page/containers move.
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
  let raf = 0;

  const inst = { input, menu, isOpen: false, open, close, reposition, destroy };

  function reposition() {
    const r = input.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    // Keep the menu within the viewport horizontally.
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = 'auto';
    menu.style.width = `${Math.round(width)}px`;
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
    if (openInst && openInst !== inst) openInst.close();
    openInst = inst;
    compute();
    render();
    reposition();
    if (!inst.isOpen) {
      inst.isOpen = true;
      // The menu base state (opacity 0) is now committed via render/reposition;
      // flip to the open state on the next frame so the transition actually runs.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (inst.isOpen) menu.classList.add('is-open');
      });
    }
  }

  function close() {
    if (openInst === inst) openInst = null;
    if (!inst.isOpen) return;
    inst.isOpen = false;
    cancelAnimationFrame(raf);
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
  // stopPropagation so the document close-handler ignores clicks on our control.
  const onInputDown = (e) => { e.stopPropagation(); };
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
  // mousedown (not click) so selection runs before the input blurs; preventDefault
  // keeps focus on the input; stopPropagation keeps the document handler from firing.
  const onMenuDown = (e) => {
    e.stopPropagation();
    const btn = e.target.closest('.nui-dropdown-item');
    if (!btn) return;
    e.preventDefault();
    const item = filtered[+btn.dataset.i];
    if (item) choose(item);
  };
  const onBlur = () => { setTimeout(() => { if (document.activeElement !== input) close(); }, 120); };

  input.addEventListener('mousedown', onInputDown);
  input.addEventListener('touchstart', onInputDown);
  input.addEventListener('focus', onFocus);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', onBlur);
  menu.addEventListener('mousedown', onMenuDown);
  menu.addEventListener('touchstart', onMenuDown);

  function destroy() {
    if (openInst === inst) openInst = null;
    cancelAnimationFrame(raf);
    INSTANCES.delete(inst);
    input.removeEventListener('mousedown', onInputDown);
    input.removeEventListener('touchstart', onInputDown);
    input.removeEventListener('focus', onFocus);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeydown);
    input.removeEventListener('blur', onBlur);
    menu.removeEventListener('mousedown', onMenuDown);
    menu.removeEventListener('touchstart', onMenuDown);
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

/** Close the currently open combobox menu, if any. */
export function closeActiveCombobox() {
  if (openInst) openInst.close();
}

