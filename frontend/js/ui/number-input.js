// ui/number-input.js — Clickable up/down chevrons for input[type="number"].nui-input
// Desktop: stacked chevrons on the right.  Mobile: − [value] + stepper layout.
// Usage: import { initNumberInput } from '../../ui/number-input.js';
//        initNumberInput('.my-number-input');

const CHEVRON_UP = '<svg viewBox="0 0 10 6" fill="none"><path d="M1 5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function isMobile() {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function initNumberInput(selectorOrEl) {
  const input = typeof selectorOrEl === 'string'
    ? document.querySelector(selectorOrEl)
    : selectorOrEl;
  if (!input || input.type !== 'number') return null;
  if (input.dataset.nuiNumberEnhanced === '1') return null;
  input.dataset.nuiNumberEnhanced = '1';

  const mobile = isMobile();

  // Wrap
  const wrap = document.createElement('div');
  wrap.className = 'nui-number-wrap' + (mobile ? ' nui-number-mobile' : '');
  input.parentNode.insertBefore(wrap, input);

  // Step logic
  function step(direction) {
    if (input.disabled) return;
    const s = parseFloat(input.step) || 1;
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
    let val = parseFloat(input.value) || 0;
    val = direction === 'up' ? val + s : val - s;
    val = Math.min(Math.max(val, min), max);
    const decimals = (input.step && input.step.includes('.'))
      ? input.step.split('.')[1].length : 0;
    input.value = val.toFixed(decimals);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (mobile) {
    // Mobile: [ − ]  input  [ + ]
    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'nui-number-stepper nui-number-minus';
    btnMinus.tabIndex = -1;
    btnMinus.textContent = '−';

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'nui-number-stepper nui-number-plus';
    btnPlus.tabIndex = -1;
    btnPlus.textContent = '+';

    wrap.appendChild(btnMinus);
    wrap.appendChild(input);
    wrap.appendChild(btnPlus);

    btnMinus.addEventListener('click', (e) => { e.preventDefault(); step('down'); });
    btnPlus.addEventListener('click', (e) => { e.preventDefault(); step('up'); });
  } else {
    // Desktop: input + stacked chevron column on the right
    wrap.appendChild(input);

    const spinner = document.createElement('div');
    spinner.className = 'nui-number-spinner';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'nui-number-btn';
    btnUp.tabIndex = -1;
    btnUp.innerHTML = CHEVRON_UP;

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'nui-number-btn';
    btnDown.tabIndex = -1;
    btnDown.innerHTML = CHEVRON_DOWN;

    spinner.appendChild(btnUp);
    spinner.appendChild(btnDown);
    wrap.appendChild(spinner);

    btnUp.addEventListener('click', (e) => { e.preventDefault(); step('up'); });
    btnDown.addEventListener('click', (e) => { e.preventDefault(); step('down'); });
  }

  return {
    wrap,
    destroy() {
      wrap.parentNode?.insertBefore(input, wrap);
      wrap.remove();
      delete input.dataset.nuiNumberEnhanced;
    }
  };
}

// Batch helper: enhance all matching number inputs
export function initAllNumberInputs(container = document) {
  container.querySelectorAll('input[type="number"].nui-input').forEach(el => initNumberInput(el));
}
