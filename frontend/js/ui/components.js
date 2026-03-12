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

  // Expose to other modules
  window.bindDropdownContainer = bindDropdownContainer;
  window.closeAllDropdowns = closeAllDropdowns;

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

  // Universal scroll close - close ALL dropdowns (nui-dropdown & dropdown-container) on scroll OUTSIDE dropdowns
  if (!window.__dropdownScrollListenersBound) {
    // Check if scroll/touch event originated from inside a dropdown
    const isInsideDropdown = (target) => {
      if (!target || !(target instanceof Element)) return false;
      return target.closest('.nui-dropdown-menu, .search-dropdown, .search-dropdown-content, .dropdown-content');
    };

    const closeAllUniversal = (e) => {
      // Don't close if scrolling inside a dropdown
      if (isInsideDropdown(e?.target)) return;

      // Close nui-dropdown dropdowns
      document.querySelectorAll('.nui-dropdown.is-open').forEach(w => {
        w.classList.remove('is-open');
      });
      // Close dropdown-container dropdowns
      closeAllDropdowns();
      // Close search dropdowns
      document.querySelectorAll('.search-dropdown.active').forEach(d => {
        d.classList.remove('active');
      });
    };

    // Window scroll (page-level scrolling)
    window.addEventListener('scroll', closeAllUniversal, { passive: true });
    // Document scroll in capture phase (for scrollable containers)
    document.addEventListener('scroll', closeAllUniversal, { passive: true, capture: true });
    // Touchmove for mobile scrolling outside dropdowns
    document.addEventListener('touchmove', closeAllUniversal, { passive: true });
    
    window.__dropdownScrollListenersBound = true;
  }

})();
