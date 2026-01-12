# Filter Control Panel Component

A reusable collapsible filter panel component with dynamic height calculation and smooth animations.

## Features

- **Dynamic Height**: Automatically calculates and adjusts to content size
- **Smooth Animations**: Uses CSS transitions with cubic-bezier easing
- **No Content Clash**: Prevents overflow during animations
- **Responsive**: Adapts to window resize
- **API Control**: Programmatic expand/collapse/toggle methods

## Files

- **CSS**: `/frontend/css-new/components/filter-control-panel.css`
- **JavaScript**: `/frontend/js/ui/filterControlPanel.js`

## Installation

### 1. Include CSS
```html
<link rel="stylesheet" href="/css-new/components/filter-control-panel.css">
```

### 2. Include JavaScript
```html
<script src="/js/ui/filterControlPanel.js"></script>
```

## HTML Structure

```html
<div class="unified-filter-panel">
  <!-- Header -->
  <div class="filter-panel-header">
    <div class="filter-panel-title">
      <i class="fas fa-sliders-h"></i>
      <h2>Filter & Selection Control Panel</h2>
    </div>
    <div class="filter-panel-header-actions">
      <button class="btn btn-white">
        <i class="fas fa-check"></i>
        <span>Apply</span>
      </button>
      <button class="btn-ghost filter-panel-collapse collapsed" id="filterPanelCollapseBtn">
        <i class="fas fa-chevron-up"></i>
      </button>
    </div>
  </div>

  <!-- Body -->
  <div class="filter-panel-body collapsed" id="filterPanelBody">
    <div class="filter-panel-grid">
      <!-- Left Card -->
      <div class="filter-control-group">
        <div class="control-header">
          <div class="control-header-left">
            <i class="fas fa-filter"></i>
            <span class="control-title">Your Filters</span>
          </div>
        </div>
        <!-- Filter content -->
      </div>

      <!-- Right Card -->
      <div class="filter-control-group">
        <div class="control-header">
          <div class="control-header-left">
            <i class="fas fa-th-list"></i>
            <span class="control-title">Display Controls</span>
          </div>
        </div>
        <!-- Display controls content -->
      </div>
    </div>
  </div>
</div>
```

## JavaScript Initialization

### Basic Usage
```javascript
// Initialize the component
const filterPanel = FilterControlPanel.init('filterPanelCollapseBtn', 'filterPanelBody');
```

### With Options
```javascript
const filterPanel = FilterControlPanel.init(
  'filterPanelCollapseBtn', 
  'filterPanelBody',
  {
    animationDuration: 450  // Animation duration in milliseconds
  }
);
```

## API Methods

Once initialized, the component returns an API object with the following methods:

```javascript
// Expand the panel
filterPanel.expand();

// Collapse the panel
filterPanel.collapse();

// Toggle the panel state
filterPanel.toggle();

// Check if panel is expanded
const isOpen = filterPanel.isExpanded(); // Returns true/false

// Manually update height (useful after dynamic content changes)
filterPanel.updateHeight();
```

## CSS Classes

### Required Classes
- `.unified-filter-panel` - Main container
- `.filter-panel-header` - Header section
- `.filter-panel-body` - Collapsible body
- `.filter-panel-grid` - Content grid
- `.filter-control-group` - Individual filter cards

### State Classes
- `.collapsed` - Applied when panel is collapsed
- `.expanded` - Applied after expansion animation completes

### Utility Classes
- `.btn-white` - White button style for header actions
- `.btn-ghost` - Transparent button style
- `.filter-panel-collapse` - Collapse button
- `.control-header` - Card header
- `.control-title` - Card title
- `.filter-count-badge` - Badge showing filter count

## Grid Layout

The `.filter-panel-grid` uses CSS Grid with a 1.5:1 ratio (left:right):

```css
.filter-panel-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 1rem;
}
```

On screens smaller than 1024px, it switches to a single column.

## Example Usage (Inventory Management)

```javascript
// In your page initialization
function bindGlobalHandlers() {
  // Initialize Filter Control Panel component
  window.inventoryFilterPanel = FilterControlPanel.init('filterPanelCollapseBtn', 'filterPanelBody');
  
  // Use the API if needed
  // inventoryFilterPanel.expand();
}
```

## Browser Support

- Modern browsers with ES6 support
- CSS Grid support required
- `getBoundingClientRect()` API support

## Notes

- The component starts collapsed by default (add `collapsed` class to `.filter-panel-body`)
- Content overflow is hidden during animation to prevent visual clashes
- Height is automatically recalculated on window resize
- Uses `requestAnimationFrame` for smooth animations
