// js/ui-components.js
// Universal 'modern box' with auto height + dropdown-friendly resizing.

// ui-components.js
function getTargetHeight(body){
  const cs = getComputedStyle(body);
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  // scrollHeight includes padding; height (content-box) doesn't.
  // With border-box it's fine, but subtracting pad is safe for both.
  return Math.max(0, body.scrollHeight - pad);
}

function setBoxHeight(box, open){
  const body = box.querySelector('.box-body');
  if (!body) return;
  const target = open ? getTargetHeight(body) : 0;
  body.style.height = target + 'px';
  clearTimeout(box._boxTimer);
  box._boxTimer = setTimeout(() => {
    if (box.classList.contains('open')) body.style.height = 'auto';
  }, 300);
}

function toggleBox(box, force){
  const willOpen = typeof force === 'boolean' ? force : !box.classList.contains('open');
  const body = box.querySelector('.box-body');
  if (!body) return;

  if (willOpen){
    body.style.height = '0px';
    box.classList.add('open');
    requestAnimationFrame(() => setBoxHeight(box, true));
    box.querySelector('.box-toggle')?.setAttribute('aria-expanded','true');
  } else {
    // lock current height before closing so it animates smoothly
    const current = getTargetHeight(body);
    body.style.height = current + 'px';
    requestAnimationFrame(() => {
      box.classList.remove('open');
      setBoxHeight(box, false);
    });
    box.querySelector('.box-toggle')?.setAttribute('aria-expanded','false');
  }
}

function bumpParentBox(el){
  const box = el.closest('.modern-box.expandable.open');
  if (!box) return;
  const body = box.querySelector('.box-body');
  if (body && body.style.height !== 'auto') {
    setBoxHeight(box, true);
  }
}

function initModernBoxes(root=document){
  // 1) Auto-upgrade older markup: .collapsible-heading + .collapsible-content
  const legacyHeads = [...root.querySelectorAll('.collapsible-heading[data-target]')];
  legacyHeads.forEach(head => {
    const id = head.getAttribute('data-target');
    const content = id ? root.querySelector('#' + id) : null;
    if (!content) return;
    if (head._upgraded) return;
    head._upgraded = true;

    const openByDefault = content.classList.contains('open') || content.style.display !== 'none';

    const box = document.createElement('div');
    box.className = 'modern-box expandable';
    if (openByDefault) box.classList.add('open');

    const button = document.createElement('button');
    button.className = 'box-toggle';
    button.setAttribute('aria-expanded', openByDefault ? 'true' : 'false');

    const text = head.textContent.replace(/^\s*[▾▼]\s*/,'').trim();
    button.innerHTML = `<span>${text}</span><span class="chev">▾</span>`;

    const body = document.createElement('div');
    body.className = 'box-body';

    content.style.display = '';
    body.append(...[...content.childNodes]);

    content.replaceWith(box);
    head.remove();

    box.append(button, body);

    if (openByDefault){
      body.style.height = 'auto';
    }else{
      body.style.height = '0px';
    }
  });

  // 2) Wire up all boxes
  const boxes = root.querySelectorAll('.modern-box.expandable');
  boxes.forEach(box => {
    if (box._wired) return;
    box._wired = true;

    const toggle = box.querySelector('.box-toggle');
    const body = box.querySelector('.box-body');

    if (box.classList.contains('open')) {
      body.style.height = 'auto';
      toggle?.setAttribute('aria-expanded','true');
    } else {
      body.style.height = body.style.height || '0px';
      toggle?.setAttribute('aria-expanded','false');
    }

    toggle?.addEventListener('click', () => toggleBox(box));

    if (body) {
      const ro = new ResizeObserver(() => {
        if (box.classList.contains('open') && body.style.height !== 'auto') {
          setBoxHeight(box, true);
        }
      });
      ro.observe(body);
    }
  });

  // 3) MutationObserver to notice dropdown open/close
  const mo = new MutationObserver(muts => {
    for (const m of muts){
      if (m.type === 'attributes' && m.target instanceof Element) {
        if (m.target.classList.contains('dropdown-container')) {
          bumpParentBox(m.target);

          // 🔑 NEW: keep adjusting height while the dropdown is mid-animation
          const box = m.target.closest('.modern-box.expandable.open');
          if (box) {
            const body = box.querySelector('.box-body');
            if (!body) continue;
            let start = performance.now();
            function tick(now){
              // run for ~300ms, match CSS transition
              if (now - start < 320 && box.classList.contains('open')) {
                setBoxHeight(box, true);
                requestAnimationFrame(tick);
              }
            }
            requestAnimationFrame(tick);
          }
        }
      }
    }
  });
  root.querySelectorAll('.dropdown-container').forEach(dc => {
    mo.observe(dc, { attributes: true, attributeFilter: ['class', 'style'] });
  });

  // 4) Global fallback for custom dropdown events
  document.addEventListener('dropdown:open', e => {
    if (e.target instanceof Element) bumpParentBox(e.target);
  }, true);
  document.addEventListener('dropdown:close', e => {
    if (e.target instanceof Element) bumpParentBox(e.target);
  }, true);
}

document.addEventListener('DOMContentLoaded', () => {
  initModernBoxes(document);
});

window.initModernUI = initModernBoxes;

// === Custom Select Enhancer (safe + reusable) ===============================
// Upgrades native <select> elements that have [data-enhance="c-select"] or .modern-select
(function () {
  const SEL = '[data-enhance="c-select"], .modern-select';

  function getBackdrop() {
    return (
      document.getElementById('globalDropdownBackdrop') ||
      document.getElementById('dropdownBackdrop') ||
      null
    );
  }

  function closeAll() {
    // Close all c-select dropdowns
    document.querySelectorAll('.c-select[aria-expanded="true"]').forEach(w => {
      w.setAttribute('aria-expanded', 'false');
      w.classList.remove('open');
      w.querySelector('.c-select__list')?.setAttribute('aria-hidden', 'true');
      
      // Reset any forced overflow styles on attendance pages
      const isAttendancePage = document.querySelector('.attendance-overview, .attendance-manual');
      if (isAttendancePage) {
        const modernBox = w.closest('.modern-box');
        if (modernBox && modernBox.style.overflow) {
          modernBox.style.overflow = '';
          modernBox.style.zIndex = '';
        }
      }
    });
    
    // Also close any dropdown-container dropdowns (compatibility)
    document.querySelectorAll('.dropdown-container.open').forEach(container => {
      container.classList.remove('open');
      const toggle = container.querySelector('.dropdown-toggle');
      if (toggle) toggle.classList.remove('active', 'open');
    });
    
    const bd = getBackdrop();
    if (bd) bd.classList.remove('show');
  }

  function buildCSelect(native) {
    if (!native || native.dataset.enhanced === '1') return;
    native.dataset.enhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'c-select';
    wrap.setAttribute('role', 'combobox');
    wrap.setAttribute('aria-haspopup', 'listbox');
    wrap.setAttribute('aria-expanded', 'false');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'c-select__button';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'c-select__label';

    const caret = document.createElement('span');
    caret.className = 'c-select__caret';
    caret.textContent = '▾';

    const list = document.createElement('div');
    list.className = 'c-select__list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-hidden', 'true');
    list.tabIndex = -1;

    btn.append(labelSpan, caret);

    // Insert wrapper in DOM where the native select lives,
    // then move the native select *into* the wrapper.
    const parent = native.parentNode;
    const next = native.nextSibling;
    parent.insertBefore(wrap, next);
    native.classList.add('select-hidden');
    wrap.append(native, btn, list);

    // Build items from <option>s
    function syncFromNative() {
      list.innerHTML = '';
      const opts = Array.from(native.options).map((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'c-select__item';
        item.setAttribute('role', 'option');
        item.dataset.value = opt.value;
        item.textContent = opt.textContent;
        if (opt.disabled) item.setAttribute('aria-disabled', 'true');
        if (opt.selected) item.setAttribute('aria-selected', 'true');
        
        // Add click handler with animation feedback
        item.addEventListener('click', (e) => {
          if (opt.disabled) return;
          e.preventDefault();
          e.stopPropagation();
          
          // Visual feedback
          item.style.transform = 'translateX(4px) scale(0.95)';
          setTimeout(() => {
            item.style.transform = '';
          }, 150);
          
          native.selectedIndex = idx;
          native.dispatchEvent(new Event('change', { bubbles: true }));
          updateLabel();
          closeAll();
        });
        
        list.appendChild(item);
        return item;
      });

      // label
      const sel =
        native.selectedOptions?.[0] ||
        native.options?.[native.selectedIndex] ||
        native.options?.[0];
      labelSpan.textContent = sel ? sel.textContent : 'Select';

      // manage aria-selected
      const val = native.value;
      opts.forEach(o =>
        o.toggleAttribute('aria-selected', o.dataset.value === val)
      );
    }

    function open() {
      if (wrap.getAttribute('aria-expanded') === 'true') return;
      closeAll();
      wrap.setAttribute('aria-expanded', 'true');
      wrap.classList.add('open');
      list.setAttribute('aria-hidden', 'false');
      
      // Force overflow visible on parent containers for attendance pages
      const isAttendancePage = document.querySelector('.attendance-overview, .attendance-manual');
      if (isAttendancePage) {
        const modernBox = wrap.closest('.modern-box');
        if (modernBox) {
          modernBox.style.overflow = 'visible';
          modernBox.style.zIndex = '9990';
          console.log('📍 Applied overflow fix for attendance dropdown container');
        }
      }
      
      const bd = getBackdrop();
      if (bd) {
        bd.classList.add('show');
        if (!bd.dataset.bound) {
          bd.addEventListener('click', closeAll);
          bd.dataset.bound = '1';
        }
      } else {
        // graceful fallback without a backdrop
        const once = ev => {
          if (!wrap.contains(ev.target)) {
            document.removeEventListener('click', once, true);
            closeAll();
          }
        };
        setTimeout(() => document.addEventListener('click', once, true), 0);
      }
    }

    function updateLabel() {
      const sel =
        native.selectedOptions?.[0] ||
        native.options?.[native.selectedIndex] ||
        native.options?.[0];
      labelSpan.textContent = sel ? sel.textContent : 'Select';
      // keep aria-selected in sync
      list
        .querySelectorAll('.c-select__item')
        .forEach(el =>
          el.toggleAttribute('aria-selected', el.dataset.value === native.value)
        );
    }

    // Events
    btn.addEventListener('click', e => {
      e.stopPropagation();
      wrap.getAttribute('aria-expanded') === 'true' ? closeAll() : open();
    });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAll();
    });
    native.addEventListener('change', updateLabel);

    // First render
    syncFromNative();
  }

  function enhance(root = document) {
    root.querySelectorAll(SEL).forEach(buildCSelect);
  }

  // Global click handler to close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    const isClickInsideDropdown = e.target.closest('.c-select');
    if (!isClickInsideDropdown) {
      closeAll();
    }
  });

  // Run after DOM is ready
  const ready = fn =>
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', fn, { once: true })
      : fn();
  ready(() => enhance(document));

  // Expose for dynamic content
  window.initCSelects = enhance;

    // Automatically refresh if a <select>’s children/options change
  const observer = new MutationObserver(muts => {
    muts.forEach(m => {
      if (m.type === 'childList' && m.target.tagName === 'SELECT') {
        const select = m.target;
        if (select.dataset.enhanced === '1') {
          const wrap = select.closest('.c-select');
          if (wrap) wrap.replaceWith(select);
          delete select.dataset.enhanced;
          buildCSelect(select);
        }
      }
    });
  });
  observer.observe(document.body, { subtree: true, childList: true });

})();

// === Universal dropdown helpers ============================================
(function () {
  function getDropdownBackdrop() {
    let el =
      document.getElementById('globalDropdownBackdrop') ||
      document.getElementById('dropdownBackdrop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalDropdownBackdrop';
      el.className = 'dropdown-backdrop';
      el.style.display = 'none'; // Start hidden
      document.body.appendChild(el);
    }
    if (!el.dataset.bound) {
      el.addEventListener('click', closeAllDropdowns);
      el.dataset.bound = '1';
    }
    return el;
  }

  function raiseBox(container, raise) {
    const box = container.closest('.modern-box');
    if (!box) return;
    if (raise) {
      box.classList.add('z-raise');
    } else if (!box.querySelector('.dropdown-container.open')) {
      box.classList.remove('z-raise');
    }
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-container.open').forEach(c => {
      c.classList.remove('open');
      c.querySelector('.dropdown-toggle')?.classList.remove('open');
      raiseBox(c, false);
    });
    const backdrop = getDropdownBackdrop();
    backdrop.classList.remove('show');
    backdrop.style.display = 'none'; // Force hide
    document.dispatchEvent(new Event('dropdown:close', { bubbles: true }));
  }

  function bindDropdownContainer(container, onSelect) {
    if (!container || container.dataset.bound === '1') return;

    const toggle = container.querySelector('.dropdown-toggle');
    const menu   = container.querySelector('.dropdown-content');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !container.classList.contains('open');

      // close everything first
      closeAllDropdowns();

      if (willOpen) {
        container.classList.add('open');
        toggle.classList.add('open');
        getDropdownBackdrop().classList.add('show');
        raiseBox(container, true);
        document.dispatchEvent(new Event('dropdown:open', { bubbles: true }));
      }
    });

    // keep clicks inside the menu from bubbling/closing
    menu.addEventListener('click', e => e.stopPropagation());

    // item click -> callback then close
    menu.querySelectorAll('.dropdown-item').forEach(btn => {
      btn.addEventListener('click', () => {
        onSelect?.(btn);
        closeAllDropdowns();
      });
    });

    container.dataset.bound = '1';
  }

  // Add this at the very end of your ui-components.js file, after the existing IIFE:

  // Expose the bindDropdownContainer function globally
  window.bindDropdownContainer = function(container, onSelect) {
    if (!container || container.dataset.bound === '1') return;

    const toggle = container.querySelector('.dropdown-toggle');
    const menu = container.querySelector('.dropdown-content');
    if (!toggle || !menu) return;

    function getDropdownBackdrop() {
      let el =
        document.getElementById('globalDropdownBackdrop') ||
        document.getElementById('dropdownBackdrop');
      if (!el) {
        el = document.createElement('div');
        el.id = 'globalDropdownBackdrop';
        el.className = 'dropdown-backdrop';
        document.body.appendChild(el);
      }
      if (!el.dataset.bound) {
        el.addEventListener('click', closeAllDropdowns);
        el.dataset.bound = '1';
      }
      return el;
    }

    function raiseBox(container, raise) {
      const box = container.closest('.modern-box');
      if (!box) return;
      if (raise) {
        box.classList.add('z-raise');
      } else if (!box.querySelector('.dropdown-container.open')) {
        box.classList.remove('z-raise');
      }
    }

    function closeAllDropdowns() {
      document.querySelectorAll('.dropdown-container.open').forEach(c => {
        c.classList.remove('open');
        c.querySelector('.dropdown-toggle')?.classList.remove('open');
        raiseBox(c, false);
      });
      getDropdownBackdrop().classList.remove('show');
      document.dispatchEvent(new Event('dropdown:close', { bubbles: true }));
    }

    // Also expose closeAllDropdowns globally since other modules use it
    window.closeAllDropdowns = closeAllDropdowns;

    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !container.classList.contains('open');

      // close everything first
      closeAllDropdowns();

      if (willOpen) {
        container.classList.add('open');
        toggle.classList.add('open');
        getDropdownBackdrop().classList.add('show');
        raiseBox(container, true);
        document.dispatchEvent(new Event('dropdown:open', { bubbles: true }));
      }
    });

    // keep clicks inside the menu from bubbling/closing
    menu.addEventListener('click', e => e.stopPropagation());

    // item click -> callback then close
    menu.querySelectorAll('.dropdown-item').forEach(btn => {
      btn.addEventListener('click', () => {
        onSelect?.(btn);
        closeAllDropdowns();
      });
    });

    container.dataset.bound = '1';
  };

  // Also ensure closeAllDropdowns is available globally
  if (!window.closeAllDropdowns) {
    window.closeAllDropdowns = function() {
      document.querySelectorAll('.dropdown-container.open').forEach(c => {
        c.classList.remove('open');
        c.querySelector('.dropdown-toggle')?.classList.remove('open');
        // Remove z-raise if no other dropdowns are open in the box
        const box = c.closest('.modern-box');
        if (box && !box.querySelector('.dropdown-container.open')) {
          box.classList.remove('z-raise');
        }
      });
      const backdrop = document.getElementById('globalDropdownBackdrop') || 
                      document.getElementById('dropdownBackdrop');
      if (backdrop) backdrop.classList.remove('show');
      document.dispatchEvent(new Event('dropdown:close', { bubbles: true }));
    };
  }

  // global outside/escape closers (bind once)
  if (!window.__dropdownDocListenersBound) {
    document.addEventListener('click', e => {
      if (!e.target.closest('.dropdown-container')) closeAllDropdowns();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllDropdowns();
    });
    // ensure backdrop exists and is wired
    getDropdownBackdrop();
    window.__dropdownDocListenersBound = true;
  }

})();
