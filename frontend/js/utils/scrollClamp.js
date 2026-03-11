// frontend/js/utils/scrollClamp.js
// Prevents elastic/rubber-band overscroll on iOS Safari for scrollable containers.
// Uses a delegated touchmove listener to clamp scroll at boundaries.

const SELECTORS = [
  '.table-container',
  '.table-responsive',
  '.items-table-wrapper',
  '.scans-table-wrapper',
  '.logs-table-wrapper',
  '.preview-items-table',
];

const SELECTOR = SELECTORS.join(',');

let startY = 0;
let startX = 0;

function handleTouchStart(e) {
  const touch = e.touches[0];
  startY = touch.clientY;
  startX = touch.clientX;
}

function handleTouchMove(e) {
  const container = e.target.closest(SELECTOR);
  if (!container) return;

  const touch = e.touches[0];
  const deltaY = touch.clientY - startY;
  const deltaX = touch.clientX - startX;

  const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = container;

  const atTop = scrollTop <= 0 && deltaY > 0;
  const atBottom = scrollTop + clientHeight >= scrollHeight && deltaY < 0;
  const atLeft = scrollLeft <= 0 && deltaX > 0;
  const atRight = scrollLeft + clientWidth >= scrollWidth && deltaX < 0;

  // If scrolling vertically and at a vertical boundary, prevent bounce
  if (Math.abs(deltaY) > Math.abs(deltaX)) {
    if (atTop || atBottom) {
      e.preventDefault();
    }
  }
  // If scrolling horizontally and at a horizontal boundary, prevent bounce
  else if (atLeft || atRight) {
    e.preventDefault();
  }
}

export function initScrollClamp() {
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
}
