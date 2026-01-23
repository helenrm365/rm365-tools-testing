# Global Table Sorting - Usage Guide

## Overview

The global table sorting utility provides client-side sorting functionality for all tables in the application. It automatically detects data types (numbers, dates, text) and sorts accordingly.

## Quick Start

### Method 1: Automatic Initialization (Recommended)

Add `data-auto-sort="true"` to your table and make headers sortable:

```html
<table data-auto-sort="true">
  <thead>
    <tr>
      <th class="sortable">Name</th>
      <th class="sortable">Price</th>
      <th class="sortable">Date</th>
      <th>Actions</th> <!-- Not sortable -->
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Product A</td>
      <td>£29.99</td>
      <td>2024-01-15</td>
      <td><button>Edit</button></td>
    </tr>
    <!-- More rows -->
  </tbody>
</table>
```

That's it! Sorting will be automatically enabled when the page loads.

### Method 2: Manual Initialization

For dynamically generated tables, call `initializeTableSorting()` after rendering:

```javascript
// After your table is populated
renderMyTable(data);

// Enable sorting
initializeTableSorting('#myTable');
// or
initializeTableSorting(document.querySelector('.my-table'));
```

## Features

### 1. **Smart Type Detection**

The sorter automatically detects and handles:

- **Numbers**: `123`, `1,234.56`, `£29.99`, `$100`
- **Dates**: `2024-01-15`, `15/01/2024`, `15 January 2024`
- **Text**: Case-insensitive alphabetical sorting

### 2. **Currency Support**

Automatically strips currency symbols and thousand separators:
- `£1,234.56` → `1234.56`
- `$99.99` → `99.99`
- `€50,00` → `50.00`

### 3. **Visual Feedback**

- Sort icons appear next to sortable headers
- Icons change to indicate sort direction:
  - `↕` (unsorted)
  - `↑` (ascending)
  - `↓` (descending)
- Hover effects on sortable headers

### 4. **Empty Cell Handling**

Empty cells automatically sort to the bottom, regardless of sort direction.

## Advanced Usage

### Custom Sort Values

Override the visible text with a custom sort value using `data-sort-value`:

```html
<td data-sort-value="1">High Priority</td>
<td data-sort-value="2">Medium Priority</td>
<td data-sort-value="3">Low Priority</td>
```

This is useful for:
- Status badges with custom ordering
- Formatted numbers that might not parse correctly
- Custom priority/importance ordering

### Disable Sorting on Specific Columns

Simply don't add the `sortable` class:

```html
<th class="sortable">Name</th>
<th class="sortable">Price</th>
<th>Actions</th> <!-- Not sortable -->
```

### Programmatically Disable Sorting

```javascript
// Disable sorting on a table
disableTableSorting('#myTable');

// Re-enable later
initializeTableSorting('#myTable');
```

## Integration Examples

### Labels Generator

```html
<table data-auto-sort="true" class="products-table">
  <thead>
    <tr>
      <th class="checkbox-col">
        <i class="fas fa-check-square"></i>
      </th>
      <th class="sortable">
        <i class="fas fa-barcode"></i>
        SKU
      </th>
      <th class="sortable">
        <i class="fas fa-box"></i>
        Product Name
      </th>
      <th class="sortable price-col">
        <i class="fas fa-money-bill-wave"></i>
        Price
      </th>
      <th class="sortable">
        <i class="fas fa-shopping-bag"></i>
        UK 6M
      </th>
    </tr>
  </thead>
  <tbody>
    <!-- Rows populated dynamically -->
  </tbody>
</table>
```

### Inventory Management

```javascript
function renderInventoryTable(products) {
  const tbody = document.querySelector('#inventoryTable tbody');
  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.sku}</td>
      <td>${p.name}</td>
      <td>${p.stock}</td>
      <td>£${p.price}</td>
    </tr>
  `).join('');
  
  // Re-initialize sorting after updating table
  initializeTableSorting('#inventoryTable');
}
```

### Magento Data Tables

```javascript
// After fetching and rendering Magento data
async function loadMagentoData() {
  const data = await fetchMagentoProducts();
  renderMagentoTable(data);
  
  // Sorting automatically enabled if table has data-auto-sort="true"
  // Or manually enable:
  initializeTableSorting('#magentoTable');
}
```

## Best Practices

1. **Add `sortable` class only to headers that should be sortable**
   - Skip action columns, checkbox columns, etc.

2. **Use `data-auto-sort="true"` for static tables**
   - Tables that don't change frequently

3. **Call `initializeTableSorting()` for dynamic tables**
   - After AJAX updates
   - After filtering operations
   - After search results render

4. **Use `data-sort-value` for complex cells**
   - Status badges
   - Multi-value cells
   - Formatted numbers

5. **Keep sort state during updates**
   - The utility remembers sort direction per column
   - Re-initializing won't reset the sort state

## Styling Customization

The default styles are in `css/components/tables.css`:

```css
/* Sortable header styling */
th.sortable {
  cursor: pointer;
  user-select: none;
  transition: background-color var(--transition);
}

th.sortable:hover {
  background: var(--bg-dark);
}

/* Sort icon styling */
.sort-icon {
  margin-left: var(--space-xs);
  font-size: 0.75rem;
  opacity: 0.5;
  transition: opacity var(--transition);
}

th.sortable:hover .sort-icon {
  opacity: 0.8;
}
```

## Troubleshooting

### Sorting not working?

1. **Check if the `sortable` class is on `<th>` elements**
   ```html
   <th class="sortable">Column Name</th>
   ```

2. **Verify the table has data-auto-sort or call initializeTableSorting()**
   ```html
   <table data-auto-sort="true">
   ```
   or
   ```javascript
   initializeTableSorting('#myTable');
   ```

3. **Check console for errors**
   - Table might not exist when initialization runs
   - Table might not have a `<tbody>` element

### Numbers not sorting correctly?

1. **Use `data-sort-value` for complex numbers**
   ```html
   <td data-sort-value="1234.56">£1,234.56 (Special Price)</td>
   ```

2. **Ensure currency symbols are supported**
   - Supported: £, $, €, ¥, ₹
   - Others may need custom handling

### Dates not sorting correctly?

1. **Use standard date formats**
   - `YYYY-MM-DD` (recommended)
   - `DD/MM/YYYY`
   - `D Month YYYY`

2. **Or use timestamps as `data-sort-value`**
   ```html
   <td data-sort-value="1705276800">15 Jan 2024</td>
   ```

## Performance Notes

- Sorting is performed client-side (no server requests)
- Suitable for tables up to ~10,000 rows
- For larger datasets, consider server-side sorting with pagination
- The utility caches sort state to avoid unnecessary work

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- IE11: ❌ Not supported (uses ES6+ features)
