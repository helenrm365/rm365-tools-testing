// Universal Modern Dropdown System
// Replaces all <select> elements with animated dropdown components

class ModernDropdownSystem {
  constructor() {
    this.activeDropdown = null;
    this.backdrop = null;
    this.init();
  }

  init() {
    this.createBackdrop();
    
    // Auto-convert all select elements on page load
    document.addEventListener('DOMContentLoaded', () => {
      this.convertAllSelects();
    });

    // Global click handler to close dropdowns
    document.addEventListener('click', (e) => this.handleGlobalClick(e));
    
    // Keyboard support
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
  }

  createBackdrop() {
    if (document.getElementById('universalDropdownBackdrop')) return;
    
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'universalDropdownBackdrop';
    this.backdrop.className = 'dropdown-backdrop';
    document.body.appendChild(this.backdrop);
    
    this.backdrop.addEventListener('click', () => this.closeAllDropdowns());
  }

  convertAllSelects() {
    document.querySelectorAll('select:not([data-dropdown-converted])').forEach(select => {
      this.convertSelectToDropdown(select);
    });
  }

  convertSelectToDropdown(selectElement) {
    // Skip if already converted
    if (selectElement.hasAttribute('data-dropdown-converted')) return;
    
    const options = Array.from(selectElement.options).map(option => ({
      value: option.value,
      text: option.textContent.trim(),
      selected: option.selected
    }));

    const selectedOption = options.find(opt => opt.selected) || options[0] || { text: 'Select...', value: '' };
    
    const container = document.createElement('div');
    container.className = 'dropdown-container modern-dropdown-converted';
    container.style.width = selectElement.style.width || '100%';
    
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dropdown-toggle';
    toggle.innerHTML = `${selectedOption.text} <span class="arrow">▼</span>`;
    
    const content = document.createElement('div');
    content.className = 'dropdown-content';
    
    options.forEach(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-item';
      item.textContent = option.text;
      item.setAttribute('data-value', option.value);
      
      if (option.selected) {
        item.classList.add('selected');
      }
      
      content.appendChild(item);
    });

    container.appendChild(toggle);
    container.appendChild(content);

    // Store reference to original select
    container._originalSelect = selectElement;
    selectElement.setAttribute('data-dropdown-converted', 'true');
    selectElement.style.display = 'none';

    // Insert after original select
    selectElement.parentNode.insertBefore(container, selectElement.nextSibling);

    // Bind events
    this.bindDropdownEvents(container);

    return container;
  }

  bindDropdownEvents(container) {
    const toggle = container.querySelector('.dropdown-toggle');
    const content = container.querySelector('.dropdown-content');
    const originalSelect = container._originalSelect;

    // Toggle dropdown
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      
      if (container.classList.contains('open')) {
        this.closeDropdown(container);
      } else {
        this.closeAllDropdowns();
        this.openDropdown(container);
      }
    });

    // Item selection
    content.addEventListener('click', (e) => {
      if (e.target.classList.contains('dropdown-item')) {
        e.stopPropagation();
        
        const value = e.target.getAttribute('data-value');
        const text = e.target.textContent;
        
        const arrow = toggle.querySelector('.arrow');
        toggle.innerHTML = `${text} <span class="arrow">▼</span>`;
        
        if (originalSelect) {
          originalSelect.value = value;
          
          // Trigger change event
          const changeEvent = new Event('change', { bubbles: true });
          originalSelect.dispatchEvent(changeEvent);
        }
        
        content.querySelectorAll('.dropdown-item').forEach(item => {
          item.classList.remove('selected');
        });
        e.target.classList.add('selected');
        
        this.closeDropdown(container);
      }
    });
  }

  openDropdown(container) {
    this.closeAllDropdowns();
    
    container.classList.add('open');
    this.activeDropdown = container;
    
    // No backdrop - dropdowns should not darken the background
    
    const toggle = container.querySelector('.dropdown-toggle');
    if (toggle) {
      toggle.classList.add('open');
    }

    // Trigger custom event
    container.dispatchEvent(new CustomEvent('dropdown:opened', { bubbles: true }));
  }

  closeDropdown(container) {
    if (!container) return;
    
    container.classList.remove('open');
    
    const toggle = container.querySelector('.dropdown-toggle');
    if (toggle) {
      toggle.classList.remove('open');
    }
    
    if (this.activeDropdown === container) {
      this.activeDropdown = null;
    }
    
    // No backdrop to hide - dropdowns don't darken background

    // Trigger custom event
    container.dispatchEvent(new CustomEvent('dropdown:closed', { bubbles: true }));
  }

  closeAllDropdowns() {
    document.querySelectorAll('.dropdown-container.open').forEach(container => {
      this.closeDropdown(container);
    });
    
    this.activeDropdown = null;
    
    // No backdrop to hide - dropdowns don't darken background
  }

  handleGlobalClick(e) {
    // Close dropdowns when clicking outside
    if (!e.target.closest('.dropdown-container')) {
      this.closeAllDropdowns();
    }
  }

  handleKeyboard(e) {
    if (!this.activeDropdown) return;
    
    const content = this.activeDropdown.querySelector('.dropdown-content');
    const items = content.querySelectorAll('.dropdown-item');
    const selectedItem = content.querySelector('.dropdown-item.selected');
    
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.closeAllDropdowns();
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        const currentIndex = Array.from(items).indexOf(selectedItem);
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[nextIndex]?.click();
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        const currentIndexUp = Array.from(items).indexOf(selectedItem);
        const prevIndex = currentIndexUp > 0 ? currentIndexUp - 1 : items.length - 1;
        items[prevIndex]?.click();
        break;
        
      case 'Enter':
        e.preventDefault();
        selectedItem?.click();
        break;
    }
  }

  // Public API methods
  updateOptions(selectElement, newOptions) {
    const container = selectElement.nextSibling;
    if (!container || !container.classList.contains('modern-dropdown-converted')) return;
    
    const content = container.querySelector('.dropdown-content');
    const toggle = container.querySelector('.dropdown-toggle');
    
    // Clear existing options
    content.innerHTML = '';
    
    // Add new options
    newOptions.forEach(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-item';
      item.textContent = option.text;
      item.setAttribute('data-value', option.value);
      
      if (option.selected) {
        item.classList.add('selected');
        toggle.innerHTML = `${option.text} <span class="arrow">▼</span>`;
      }
      
      content.appendChild(item);
    });
    
    selectElement.innerHTML = '';
    newOptions.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.text;
      optionEl.selected = option.selected || false;
      selectElement.appendChild(optionEl);
    });
    
    // Rebind events for new items
    this.bindDropdownEvents(container);
  }

  getValue(selectElement) {
    return selectElement.value;
  }

  setValue(selectElement, value) {
    const container = selectElement.nextSibling;
    if (!container || !container.classList.contains('modern-dropdown-converted')) {
      selectElement.value = value;
      return;
    }
    
    const content = container.querySelector('.dropdown-content');
    const toggle = container.querySelector('.dropdown-toggle');
    const targetItem = content.querySelector(`[data-value="${value}"]`);
    
    if (targetItem) {
      targetItem.click();
    }
  }
}

const modernDropdownSystem = new ModernDropdownSystem();

// Export for manual use
window.ModernDropdownSystem = modernDropdownSystem;

export default modernDropdownSystem;
