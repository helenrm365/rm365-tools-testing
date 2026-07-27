// ui/progressNotification.js — Bottom-right progress card for long-running jobs
// Mirrors the Task Automation notification, reusable from any module.
//
// Usage:
//   const job = showProgressNotification({ title: 'Exporting CSV' });
//   job.update({ percent: 40, message: 'Fetched 4,000 of 10,000 rows' });
//   job.succeed({ message: 'Downloaded 10,000 rows' });   // auto-dismisses
//   job.fail({ message: err.message });                   // stays until closed

let activeCard = null;

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}

function removeCard(card) {
  if (!card || !card.isConnected) return;
  card.classList.add('is-dismissing');
  card.addEventListener('animationend', () => card.remove(), { once: true });
  // Belt and braces in case the animation never fires (reduced motion, hidden tab)
  setTimeout(() => card.remove(), 600);
}

/**
 * Show a progress card in the bottom-right corner.
 * Only one is shown at a time - starting a new job replaces the previous card.
 *
 * @param {object} options
 * @param {string} options.title - short job name, e.g. "Exporting CSV"
 * @param {string} [options.message] - status line under the title
 * @param {string} [options.icon] - Font Awesome classes for the header icon
 * @returns {{update: Function, succeed: Function, fail: Function, dismiss: Function}}
 */
export function showProgressNotification({ title, message = '', icon = 'fa-solid fa-circle-notch fa-spin' } = {}) {
  if (activeCard) removeCard(activeCard);

  const card = document.createElement('div');
  card.className = 'progress-notif';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <div class="pn-header">
      <i class="${esc(icon)}" style="color:#3b82f6"></i>
      <span class="pn-title">${esc(title || 'Working')}</span>
      <button class="pn-close" type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="pn-message"></div>
    <div class="pn-bar-wrapper"><div class="pn-bar indeterminate"></div></div>
    <div class="pn-footer">
      <span class="pn-percent"></span>
      <span class="pn-detail"></span>
    </div>
  `;

  document.body.appendChild(card);
  activeCard = card;

  const iconEl = card.querySelector('.pn-header i');
  const messageEl = card.querySelector('.pn-message');
  const barEl = card.querySelector('.pn-bar');
  const percentEl = card.querySelector('.pn-percent');
  const detailEl = card.querySelector('.pn-detail');
  let dismissTimer = null;

  const clearDismissTimer = () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  };

  const dismiss = () => {
    clearDismissTimer();
    if (activeCard === card) activeCard = null;
    removeCard(card);
  };

  card.querySelector('.pn-close').addEventListener('click', dismiss);
  if (message) messageEl.textContent = message;

  /**
   * @param {object} state
   * @param {number} [state.percent] - 0-100; omit to keep the indeterminate sweep
   * @param {string} [state.message] - status line
   * @param {string} [state.detail] - small right-aligned note in the footer
   */
  const update = ({ percent, message: msg, detail } = {}) => {
    if (!card.isConnected) return;
    if (typeof msg === 'string') messageEl.textContent = msg;
    if (typeof detail === 'string') detailEl.textContent = detail;

    if (typeof percent === 'number' && Number.isFinite(percent)) {
      const clamped = Math.max(0, Math.min(100, Math.round(percent)));
      barEl.classList.remove('indeterminate');
      barEl.style.width = `${clamped}%`;
      percentEl.textContent = `${clamped}%`;
    }
  };

  const finish = (statusClass, iconClass, iconColour, msg, label, autoDismissMs) => {
    if (!card.isConnected) return;
    barEl.classList.remove('indeterminate');
    barEl.classList.add(statusClass);
    barEl.style.width = '100%';
    iconEl.className = iconClass;
    iconEl.style.color = iconColour;
    percentEl.textContent = label;
    if (typeof msg === 'string') messageEl.textContent = msg;

    clearDismissTimer();
    if (autoDismissMs) dismissTimer = setTimeout(dismiss, autoDismissMs);
  };

  return {
    update,
    /** Mark done; auto-dismisses so a finished export doesn't linger. */
    succeed: ({ message: msg, autoDismiss = 4000 } = {}) =>
      finish('complete', 'fa-solid fa-circle-check', '#10b981', msg, 'Done', autoDismiss),
    /** Mark failed; stays on screen so the reason can be read. */
    fail: ({ message: msg } = {}) =>
      finish('error', 'fa-solid fa-circle-xmark', '#ef4444', msg, 'Failed', 0),
    dismiss
  };
}
