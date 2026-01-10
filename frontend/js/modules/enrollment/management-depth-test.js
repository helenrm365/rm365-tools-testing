// js/modules/enrollment/management-depth-test.js
// Wires up the management depth test page which is injected via the SPA router.

let cleanupFns = [];

export function init() {
  // Clear any previous handlers before wiring again (in case of re-entry).
  cleanup();
  wireGuideModal();
  exposeDropdownHelpers();
}

export function cleanup() {
  cleanupFns.forEach((fn) => {
    try { fn(); } catch (e) { console.warn('[ManagementDepthTest] cleanup error', e); }
  });
  cleanupFns = [];
}

function wireGuideModal() {
  const guideModal = document.getElementById('guideModal');
  const openGuideBtn = document.getElementById('openGuideBtn');
  const closeGuideBtn = document.getElementById('closeGuideBtn');
  const modalOverlay = guideModal?.querySelector('.guide-modal-overlay');

  if (!guideModal || !openGuideBtn || !closeGuideBtn || !modalOverlay) {
    return;
  }

  const openModal = () => {
    guideModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    guideModal.classList.remove('active');
    document.body.style.overflow = '';
  };

  const handleEscape = (e) => {
    if (e.key === 'Escape' && guideModal.classList.contains('active')) {
      closeModal();
    }
  };

  openGuideBtn.addEventListener('click', openModal);
  closeGuideBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', closeModal);
  document.addEventListener('keydown', handleEscape);

  cleanupFns.push(() => {
    openGuideBtn.removeEventListener('click', openModal);
    closeGuideBtn.removeEventListener('click', closeModal);
    modalOverlay.removeEventListener('click', closeModal);
    document.removeEventListener('keydown', handleEscape);
  });
}

function exposeDropdownHelpers() {
  const outsideClickHandler = (e) => {
    if (!e.target.closest('.custom-dropdown')) {
      document.querySelectorAll('.custom-dropdown').forEach((d) => d.classList.remove('open'));
    }
  };

  window.toggleDropdown = (id) => {
    const dropdown = document.getElementById(id);
    if (!dropdown) return;

    document.querySelectorAll('.custom-dropdown').forEach((d) => {
      if (d.id !== id) d.classList.remove('open');
    });

    dropdown.classList.toggle('open');
  };

  window.selectOption = (element, dropdownId, value, text) => {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const selectedDisplay = dropdown.querySelector('.dropdown-selected');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');

    if (selectedDisplay) selectedDisplay.textContent = text;
    if (hiddenInput) hiddenInput.value = value;

    dropdown.querySelectorAll('.dropdown-option').forEach((opt) => opt.classList.remove('selected'));
    element?.classList.add('selected');

    dropdown.classList.remove('open');
  };

  document.addEventListener('click', outsideClickHandler);

  cleanupFns.push(() => {
    document.removeEventListener('click', outsideClickHandler);
    delete window.toggleDropdown;
    delete window.selectOption;
  });
}
