# C-Select Component Documentation

## Overview
The C-Select component is a fully-styled, accessible custom dropdown system that enhances native `<select>` elements with modern UI, animations, and multi-select support with checkboxes.

## Features
✅ Automatic enhancement of native `<select>` elements  
✅ Single-select mode (standard dropdown)  
✅ Multi-select mode with checkboxes  
✅ Dynamic population support  
✅ Accessible (ARIA attributes, keyboard navigation)  
✅ Dark mode support  
✅ Smooth animations and transitions  
✅ Mobile-friendly  
✅ Custom scrollbar styling  

---

## Usage

### Single Select (Standard Dropdown)

```html
<label for="mySelect">Choose an option:</label>
<select id="mySelect" data-enhance="c-select">
  <option value="">Select...</option>
  <option value="1">Option 1</option>
  <option value="2">Option 2</option>
  <option value="3">Option 3</option>
</select>
```

**Features:**
- Closes on selection
- Single value selection
- Clean, simple interface

---

### Multi-Select with Checkboxes

```html
<label for="myMultiSelect">Choose multiple:</label>
<select id="myMultiSelect" multiple data-enhance="c-select">
  <option value="js">JavaScript</option>
  <option value="py">Python</option>
  <option value="java">Java</option>
  <option value="go">Go</option>
</select>
```

**Features:**
- Checkboxes for each option
- Multiple selections allowed
- "Clear All" button to deselect all
- "Done" button to close dropdown
- Count badge showing number of selections (e.g., "JavaScript +2")
- Stays open while selecting (closes via "Done" button or outside click)

---

### Dynamic Population

The c-select system automatically detects changes to the native `<select>` options and updates the UI.

```javascript
// Get the native select element
const select = document.querySelector('#mySelect select') || document.querySelector('#mySelect');

// Add new options dynamically
const newOption = document.createElement('option');
newOption.value = 'new-value';
newOption.textContent = 'New Option';
select.appendChild(newOption);

// The UI will automatically update via MutationObserver
```

**Or manually trigger re-enhancement:**
```javascript
window.initCSelects();
```

---

## Styling

### CSS Classes

#### Main Container
- `.c-select` - Main wrapper container
- `.c-select--multiple` - Added for multi-select mode

#### Button
- `.c-select__button` - The clickable trigger button
- `.c-select__label` - Text label inside button
- `.c-select__caret` - Dropdown arrow indicator
- `.c-select__count` - Badge showing selection count (multi-select only)

#### Dropdown List
- `.c-select__list` - Dropdown container
- `.c-select__item` - Each option in the dropdown
- `.c-select__item--with-checkbox` - Item with checkbox (multi-select)
- `.c-select__checkbox` - Checkbox input
- `.c-select__item-text` - Text label for option

#### Footer (Multi-select only)
- `.c-select__footer` - Footer container
- `.c-select__footer-btn` - Button in footer
- `.c-select__footer-btn--clear` - Clear all button
- `.c-select__footer-btn--done` - Done button

#### States
- `[aria-expanded='true']` - When dropdown is open
- `[aria-selected='true']` - When option is selected
- `[aria-disabled='true']` - When option is disabled

---

## Customization

### Changing Colors

```css
/* Custom accent color */
.c-select__button:hover {
  border-color: rgba(255, 100, 100, 0.3); /* Red accent */
}

.c-select[aria-expanded='true'] .c-select__button {
  outline-color: #ff6464; /* Red accent */
}

.c-select__item[aria-selected='true'] {
  background: rgba(255, 100, 100, 0.15); /* Red selection */
  color: #ff6464;
}

.c-select__count {
  background: #ff6464; /* Red badge */
}
```

### Custom Height

```css
.c-select__list {
  max-height: 400px; /* Taller dropdown */
}
```

### Custom Styling

```css
/* Rounded corners */
.c-select__button {
  border-radius: 20px;
}

/* Larger text */
.c-select__button {
  font-size: 1.1rem;
}

/* Custom shadow */
.c-select__list {
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}
```

---

## JavaScript API

### Initialization

The c-select system auto-initializes on page load. For dynamic content:

```javascript
// Re-enhance all selects
window.initCSelects();

// Re-enhance selects within a specific container
const container = document.querySelector('#myContainer');
window.initCSelects(container);
```

### Programmatic Control

```javascript
// Get the native select
const select = document.querySelector('#mySelect select') || document.querySelector('#mySelect');

// Set value programmatically
select.value = 'option-2';

// Trigger change event to update UI
select.dispatchEvent(new Event('change', { bubbles: true }));

// For multi-select
const options = select.options;
options[0].selected = true;
options[2].selected = true;
select.dispatchEvent(new Event('change', { bubbles: true }));
```

### Event Listening

```javascript
const select = document.querySelector('#mySelect');

select.addEventListener('change', (e) => {
  console.log('Selected value:', e.target.value);
  console.log('Selected text:', e.target.selectedOptions[0]?.text);
});

// Multi-select
const multiSelect = document.querySelector('#myMultiSelect');

multiSelect.addEventListener('change', (e) => {
  const selected = Array.from(e.target.selectedOptions);
  console.log('Selected values:', selected.map(opt => opt.value));
  console.log('Selected texts:', selected.map(opt => opt.text));
  console.log('Count:', selected.length);
});
```

---

## Accessibility

### ARIA Attributes
- `role="combobox"` on main container
- `role="listbox"` on dropdown list
- `role="option"` on each item
- `aria-expanded` toggles with dropdown state
- `aria-selected` marks selected options
- `aria-disabled` for disabled options
- `aria-hidden` and `inert` when dropdown closed

### Keyboard Support
- **Escape**: Close dropdown
- **Click outside**: Close dropdown
- Tab navigation works with native select (hidden but functional)

### Screen Reader Support
- Proper labeling with associated `<label>` elements
- Native `<select>` remains in DOM for screen readers
- ARIA attributes provide context

---

## Dark Mode

Dark mode is automatically supported. Toggle with:

```javascript
document.documentElement.classList.toggle('dark-mode');
```

Or add class in HTML:
```html
<html class="dark-mode">
```

---

## Best Practices

1. **Always use a label**: Associate labels with selects using `for` and `id`
2. **Provide default option**: Include a "Select..." or empty option
3. **Disable when needed**: Use `disabled` attribute on options
4. **Validate selections**: Check if user selected valid options before form submission
5. **Test with keyboard**: Ensure keyboard users can navigate
6. **Test in dark mode**: Verify contrast and visibility

---

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Full support

---

## Troubleshooting

### Dropdown not appearing
- Check if `window.initCSelects()` was called
- Verify `data-enhance="c-select"` attribute exists
- Check browser console for errors

### Styles not applying
- Ensure `forms.css` is loaded
- Check CSS specificity conflicts
- Verify CSS custom properties are defined

### Dynamic updates not working
- Native `<select>` must be modified, not the enhanced wrapper
- Use `window.initCSelects()` to manually refresh if needed

### Multi-select not showing checkboxes
- Verify `multiple` attribute is on `<select>`
- Check if component re-initialized after adding attribute

---

## Testing

A test page is available at: `/frontend/html/test-c-select.html`

This page demonstrates:
- Single select
- Multi-select with checkboxes
- Dynamic population
- Theme toggling
- Event handling

---

## Migration from Custom-Dropdown

If migrating from the old `custom-dropdown` system:

**Old:**
```html
<div class="custom-dropdown" id="myDropdown">
  <div class="dropdown-selected" onclick="toggleDropdown('myDropdown')">Text</div>
  <div class="dropdown-options">
    <div class="dropdown-option" onclick="selectOption(...)">Option</div>
  </div>
</div>
```

**New:**
```html
<select id="myDropdown" data-enhance="c-select">
  <option value="1">Option 1</option>
  <option value="2">Option 2</option>
</select>
```

Benefits:
- Native form integration
- Better accessibility
- Less JavaScript required
- Automatic validation support
- Simpler maintenance
