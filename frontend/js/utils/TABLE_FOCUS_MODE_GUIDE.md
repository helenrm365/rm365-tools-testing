# Table Focus Mode - Usage Guide

A global utility that enables distraction-free, full-screen viewing of tables. Press **F** to enter focus mode on any page with a focusable table.

## Quick Start

Tables are automatically detected and made focusable when they have:
- A `.table-container` parent wrapper
- A `data-auto-sort="true"` attribute
- A `data-focusable="true"` attribute

```html
<!-- Automatically detected -->
<div class="table-container">
  <table>...</table>
</div>

<!-- Also automatically detected -->
<table data-auto-sort="true">...</table>

<!-- Explicitly mark as focusable -->
<table data-focusable="true">...</table>
```

## How to Use

### Entering Focus Mode

1. **Keyboard**: Press `F` key (when not typing in an input field)
2. **Mouse**: Click the hint button in the bottom-right corner

### Exiting Focus Mode

1. **Keyboard**: Press `ESC` key or `F` key again
2. **Mouse**: Click the "Exit Focus Mode" button in the top-right corner

## Features

### Visual Indicator

When a page has focusable tables, a subtle hint appears in the bottom-right corner:

```
┌─────────────────────────────┐
│  ⤢  Press [F] for Focus Mode │
└─────────────────────────────┘
```

### Multiple Tables

If a page has multiple focusable tables, tabs appear at the top of the focus view allowing you to switch between them:

```
┌──────────────────────────────────────────┐
│  [ Table 1 ]  [ Table 2 ]  [ Table 3 ]   │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │          Table Content             │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### What Gets Hidden

In focus mode, the following elements are hidden:
- Sidebar navigation
- Mobile hamburger menu
- Page header and title
- Navigation tabs
- Filter panels and controls
- Stats/summary grids
- Universal footer
- Other non-table content blocks

### Accessibility

- Focus mode announcements are made for screen readers
- `ESC` key always exits focus mode
- Keyboard navigation remains functional within the table

## CSS Classes

### Body/HTML Classes

```css
/* Applied when focus mode is active */
html.table-focus-mode
body.table-focus-mode
```

### Component Classes

| Class | Description |
|-------|-------------|
| `.table-focus-hint` | The hint button in bottom-right |
| `.table-focus-overlay` | Dark backdrop overlay |
| `.table-focus-container` | Main focus mode container |
| `.table-focus-exit` | Exit button |
| `.table-focus-tabs` | Tab container for multiple tables |
| `.table-focus-tab` | Individual table tab |
| `.table-focus-wrapper` | Wrapper around the focused table |
| `.focused-table` | Class added to the cloned table |

## Customization

### Disable Focus Mode on a Table

Add `data-focusable="false"` to exclude a table from focus mode:

```html
<div class="table-container" data-focusable="false">
  <table>...</table>
</div>
```

### Custom Table Labels

Tables in focus mode get labels from:
1. Parent element's `.block-title`, `.panel-title`, `h2`, `h3`, or `h4`
2. The table's `id` attribute (converted to readable text)
3. Generic "Table N" fallback

### Styling Overrides

Override default styles in your page CSS:

```css
/* Custom hint position */
.table-focus-hint {
  bottom: 80px; /* Adjust for fixed footers */
}

/* Custom overlay opacity */
.table-focus-overlay.visible {
  background: rgba(0, 0, 0, 0.95);
}

/* Custom exit button */
.table-focus-exit {
  background: var(--accent);
  color: white;
}
```

## JavaScript API

The focus mode instance is available globally:

```javascript
// Check if focus mode is active
if (window.tableFocusMode.isActive) {
  console.log('Focus mode is on');
}

// Programmatically enter focus mode
const tables = window.tableFocusMode.getFocusableTables();
if (tables.length > 0) {
  window.tableFocusMode.enterFocusMode(tables[0]);
}

// Programmatically exit focus mode
window.tableFocusMode.exitFocusMode();
```

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires CSS custom properties (variables)
- Uses `backdrop-filter` for blur effect (graceful degradation)

## Files

| File | Description |
|------|-------------|
| `/js/utils/tableFocusMode.js` | JavaScript functionality |
| `/css/components/table-focus-mode.css` | Styling |

## Integration

The focus mode is automatically loaded via:
- `index.html` includes the script
- `app.css` imports the styles

No additional setup is required for new pages - just ensure your tables use `.table-container` or `data-auto-sort="true"`.
