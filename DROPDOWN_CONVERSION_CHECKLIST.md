# Dropdown Conversion Checklist

## ✅ Completed
- [x] **Order Fulfillment** - Fully converted to c-select
  - Session Type dropdown
  - Shelf Field dropdown

## 📋 Files Requiring Conversion

### Orders Module
- [ ] **order-approval.html** + **order-approval.js**
  - `sortOrders` dropdown

### Attendance System Module
- [ ] **attendance-system/logs.html** + **logs.js**
  - `location-dropdown`
  - `action-dropdown`
  - `sort-dropdown`

- [ ] **attendance-system/dashboard.html** + **dashboard.js**
  - `globalLocationDropdown`

- [ ] **attendance-system/overview.html** + **overview.js** (if exists)
  - `location-dropdown`

- [ ] **attendance-system/employees.html** + **employees.js**
  - `status-dropdown` (filter)
  - `country-dropdown` (filter)
  - `location-dropdown` (filter)
  - `citycode-dropdown` (filter)
  - `create-location-dropdown` (modal)
  - `create-status-dropdown` (modal)
  - `edit-location-dropdown` (modal)
  - `edit-status-dropdown` (modal)

### Inventory Module
- [ ] **inventory/management.html** + **management.js**
  - `columnDropdown`
  - `statusDropdown`

- [ ] **inventory/sourcing.html** + **sourcing.js**
  - `analysisMarginDropdown`

### Magento Data Module
- [ ] **magentodata/history.html** + **history.js**
  - `region-dropdown`
  - `status-dropdown`

### User Management Module
- [ ] **usermanagement/management.html** + **management.js**
  - `role-dropdown`

### Labels Module
- [ ] **labels/generator.html** + **generator.js**
  - `overwrite-preset-dropdown`

- [ ] **labels/history.html** + **history.js** (if exists)
  - `limit-dropdown`

## Conversion Pattern

For each dropdown:

### HTML: Convert from custom-dropdown to native select
**Before:**
```html
<div class="custom-dropdown" id="myDropdown">
  <div class="dropdown-selected" onclick="toggleDropdown('myDropdown')">Text</div>
  <div class="dropdown-options">
    <div class="dropdown-option" onclick="selectOption(this, 'myDropdown', 'value', 'Text')">Option</div>
  </div>
</div>
```

**After:**
```html
<select id="myDropdown" data-enhance="c-select">
  <option value="value">Option</option>
</select>
```

### JavaScript: Remove custom functions and use change events
**Remove:**
- `toggleDropdown()` function
- `selectOption()` function
- `window.toggleDropdown` assignment
- `window.selectOption` assignment
- Manual click handlers
- Manual open/close logic

**Add:**
```javascript
const dropdown = document.getElementById('myDropdown');
dropdown.addEventListener('change', (e) => {
  const value = e.target.value;
  const text = e.target.selectedOptions[0]?.text;
  // Handle change
});
```

## Benefits After Conversion

- ✅ Consistent styling across all dropdowns
- ✅ Automatic accessibility (ARIA)
- ✅ Native form integration
- ✅ Less code to maintain
- ✅ Dark mode support
- ✅ Multi-select capability (if needed)
- ✅ Dynamic population support
- ✅ Better keyboard navigation

## Files Already Cleaned
- ✅ Deleted `/frontend/js/utils/dropdown-system.js` (unused)
- ✅ Removed custom-dropdown CSS from `/frontend/css/components/forms.css`
- ✅ Converted `/frontend/html/orders/order-fulfillment.html`
- ✅ Converted `/frontend/js/modules/orders/order-fulfillment.js`

## Total Conversion Stats
- **Completed:** 1 page (2 dropdowns)
- **Remaining:** 10 pages (~22+ dropdowns)
- **Estimated time per page:** 5-10 minutes
