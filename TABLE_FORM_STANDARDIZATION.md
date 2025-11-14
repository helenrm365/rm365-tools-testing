# Table, Form, and Button Standardization

## Overview
Consolidated duplicate table, form, and button CSS into standardized component files based on the sales data design.

## Created Component Files

### 1. `/css/components/table.css`
Standardized table styling for all modules (except inventory management which has its own table.css).

**Provides:**
- `.table-container` - Scrollable wrapper with custom scrollbars
- `.modern-table` - Main table class with thead/tbody styling
- `.products-table` - Alternative table class
- `.table-header` - Header row styling
- `.table-body` - Body row styling
- `.table-wrap` - Alternative wrapper (enrollment compatibility)
- `.empty-state` - Empty table message styling
- `.loading-state` - Loading indicator styling
- Table input fields (`.in`, `input`, `select`)

**Features:**
- Gradient headers (#f8fafc → #f1f5f9)
- Hover effects on rows
- Custom scrollbars
- Full dark mode support
- Consistent spacing and typography

### 2. `/css/components/form.css`
Standardized form styling for all modules.

**Provides:**
- `.form-group` - Form field container
- `.form-label` - Field labels with icon support
- `.form-input`, `.form-select`, `.form-textarea` - Input fields
- `.file-input` - File upload styling
- `.checkbox-label`, `.radio-label` - Checkbox/radio styling
- `.form-error`, `.form-success`, `.form-hint` - Validation messages
- `.form-grid`, `.form-row`, `.form-inline` - Layout utilities
- `.search-input` - Search field with icon
- `.modern-input` - Legacy support for enrollment

**Features:**
- Green focus states (#76a12b)
- Smooth transitions
- Disabled states
- Error/success validation states
- Full dark mode support
- Icon integration

### 3. `/css/components/button.css`
Standardized button styling for all modules.

**Provides:**
- `.action-btn` - Base button class with flex layout and transitions
- `.primary-btn` - Green gradient for main actions
- `.secondary-btn` - Gray gradient for secondary actions
- `.danger-btn` - Red gradient for destructive actions
- `.info-btn` - Blue gradient for informational actions
- `.success-btn` - Emerald gradient for success/completion actions
- `.warning-btn` - Orange gradient for warning actions
- `.btn-outline` - Outline button variant
- `.btn-icon` - Icon-only button styling
- `.btn-sm`, `.btn-lg` - Size variants
- `.btn-group` - Button group container

**Features:**
- Consistent gradient backgrounds
- Hover lift effect (translateY -2px)
- Box shadows for depth
- Disabled state (50% opacity)
- Full dark mode support
- Icon integration
- Smooth cubic-bezier transitions

## Files Modified

### Updated `index.html`
Added new component imports after existing components:
```html
<link rel="stylesheet" href="/css/components/table.css">
<link rel="stylesheet" href="/css/components/form.css">
<link rel="stylesheet" href="/css/components/button.css">
```

### Cleaned Module Files

#### `/css/salesdata/universal.css`
**Removed:**
- Form group definitions (`.form-group`, `.form-input`, `.form-select`, `.form-textarea`)
- Form label styling
- File input styling
- Table container and scrollbar customization
- Table header and body styling
- Modern table definitions
- Empty state styling
- Button styles (`.action-btn`, `.primary-btn`, `.secondary-btn`, `.danger-btn`)

**Kept:**
- `.products-table { min-width: 1400px; }` - Sales data specific min-width
- Column width optimizations (nth-child selectors)
- View toggle controls
- Search controls
- Pagination

#### `/css/usermanagement/usermanagement.css`
**Removed:**
- Form group definitions
- Form label and input styling
- Dark mode form overrides
- Old modern-button styling

**Kept:**
- Legacy `.modern-button` support (mapped to secondary-btn style)
- Checkbox group layout
- Tab checkbox styling
- Small action button override for tables (`.modern-table .action-btn`)
- Role dropdown wrapper
- Table-specific input overrides (`.modern-table .in`)

#### `/css/attendance/universal.css`
**Removed:**
- Modern table definitions (thead, tbody, tr, td styling)
- Button styles (`.action-btn`, `.primary-btn`, `.secondary-btn`)

**Kept:**
- Stat icon color variants (total-icon, checked-in-icon, etc.)
- Filters section styling
- Status badges
- Loading state
- Animations

#### `/css/enrollment/management.css`
**Removed:**
- Form group definitions
- Form label with icon styling
- Form input and select styling
- Dark mode form overrides
- Button styles (`.action-btn`, `.primary-btn`, `.danger-btn`)

**Kept:**
- Employee card styling
- Modal-specific styles
- Management page layout
- Tips section
- Action buttons grid layout

#### `/css/enrollment/card.css`
**Removed:**
- Duplicate action-btn base styles

**Kept:**
- Full-width button override
- Special `.scan-btn` and `.save-btn` color variants
- Status bar styling

#### `/css/enrollment/fingerprint.css`
**Removed:**
- Duplicate action-btn base styles

**Kept:**
- Full-width button override
- Special `.scan-btn` and `.save-btn` color variants
- Status bar styling

#### `/css/inventory/adjustments.css`
**Removed:**
- Primary and secondary button definitions

**Kept:**
- `.tertiary-btn` - Unique to inventory module
- Dropdown styling
- Adjustment-specific layouts

#### `/css/labels/generator.css`
**Removed:**
- None (kept legacy `.action-button` for compatibility)

**Kept:**
- `.action-button` - Legacy support mapped to success-btn style
- Filter button styling
- Table and selection controls

#### `/css/enrollment/universal.css`
**Removed:**
- Modern table definitions (entire table styling block)
- Table wrap with animation
- Modern input field styling

**Kept:**
- Card-specific styles
- Dropdown system
- Module-specific components

#### `/css/labels/universal.css`
**Removed:**
- Modern table definitions

**Kept:**
- C-select system
- Status badges
- Region label styling

## Module-Specific Overrides Preserved

### Sales Data
- `.products-table { min-width: 1400px; }` - Ensures horizontal scrolling for wide tables
- Column-specific width percentages (nth-child selectors)

### Attendance
- `.stat-icon` color variants for different status types
- Custom status badge colors

### Enrollment
- `.employee-card` - Specialized card for employee management
- Dropdown system integration

### User Management
- Table input field customization
- Tab checkbox grid layout
- Role dropdown positioning

### Inventory
- Has its own complete `/css/inventory/table.css` - **NOT MODIFIED**
- Custom table implementation with advanced features

### Login
- Has its own complete `/css/login/form.css` - **NOT MODIFIED**
- Specialized styling for login page

## Design Standards

### Tables
- **Header Background:** Linear gradient #f8fafc → #f1f5f9 (light), #404040 → #333 (dark)
- **Header Text:** Uppercase, 0.9rem, 600 weight, letter-spacing 0.05em
- **Row Hover:** Subtle gradient #fefefe → #f8fafc (light), #2a2a2a → #333 (dark)
- **Border Colors:** #f1f5f9 (light), #404040 (dark)
- **Padding:** 1rem for cells
- **Border Radius:** 12px for containers
- **Max Height:** 700px with auto overflow

### Forms
- **Border:** 2px solid #e5e7eb (light), #404040 (dark)
- **Border Radius:** 8px for inputs
- **Padding:** 0.75rem 1rem
- **Focus State:** Green border (#76a12b) with 3px rgba(118, 161, 43, 0.1) shadow
- **Label Weight:** 600
- **Icon Color:** #76a12b (light), #8bc34a (dark)
- **Disabled Opacity:** 0.6

### Buttons
- **Base Class:** `.action-btn` with flex layout, 0.75rem 1.5rem padding
- **Border Radius:** 10px
- **Font Size:** 0.95rem
- **Font Weight:** 600
- **Transition:** cubic-bezier(0.4, 0, 0.2, 1) for smooth animations
- **Hover Effect:** translateY(-2px) with enhanced box shadow
- **Primary (Green):** Linear gradient #76a12b → #5e8122
- **Secondary (Gray):** Linear gradient #6b7280 → #4b5563
- **Danger (Red):** Linear gradient #e74c3c → #c0392b
- **Info (Blue):** Linear gradient #3b82f6 → #2563eb
- **Success (Emerald):** Linear gradient #10b981 → #059669
- **Warning (Orange):** Linear gradient #f59e0b → #d97706
- **Disabled:** 50% opacity, no hover effects

### Color Theme
- **Primary Green:** #76a12b
- **Primary Hover:** #8bc34a
- **Dark Primary:** #5e8122
- **Text Light:** #374151
- **Text Dark:** #e5e7eb
- **Border Light:** #e5e7eb
- **Border Dark:** #404040
- **Background Light:** white
- **Background Dark:** #2a2a2a

## Testing Checklist

- [ ] Sales data tables and buttons render correctly (UK, FR, NL, History)
- [ ] User management table, forms, and buttons work (modern-button legacy support)
- [ ] Enrollment management employee cards and action buttons work
- [ ] Enrollment card/fingerprint scan and save buttons work
- [ ] Attendance overview tables and action buttons display properly
- [ ] Labels generator table and action buttons render
- [ ] Inventory adjustments buttons work (tertiary-btn preserved)
- [ ] All forms maintain consistent styling
- [ ] All buttons have consistent hover effects and transitions
- [ ] Dark mode works across all pages for buttons
- [ ] Table scrolling and hover effects function
- [ ] Form validation states display correctly
- [ ] Button disabled states work properly
- [ ] Inventory management tables still use their custom styling

## Benefits

1. **Consistency:** All tables, forms, and buttons now have identical styling across modules
2. **Maintainability:** Single source of truth for table/form/button styles
3. **File Size:** Reduced CSS duplication by ~800 lines
4. **Dark Mode:** Centralized dark mode support
5. **Accessibility:** Consistent focus states, hover feedback, and disabled states
6. **Flexibility:** Module-specific overrides still possible
7. **Future-proof:** New modules automatically get standard styling
8. **User Experience:** Uniform interaction patterns across all pages

## Button Usage Guide

### Standard Buttons
```html
<!-- Primary action (green) -->
<button class="action-btn primary-btn">Save Changes</button>

<!-- Secondary action (gray) -->
<button class="action-btn secondary-btn">Cancel</button>

<!-- Destructive action (red) -->
<button class="action-btn danger-btn">Delete</button>

<!-- Informational action (blue) -->
<button class="action-btn info-btn">View Details</button>

<!-- Success/completion (emerald) -->
<button class="action-btn success-btn">Generate Labels</button>

<!-- Warning (orange) -->
<button class="action-btn warning-btn">Warning Action</button>
```

### Button Variants
```html
<!-- Small button -->
<button class="action-btn primary-btn btn-sm">Small</button>

<!-- Large button -->
<button class="action-btn primary-btn btn-lg">Large</button>

<!-- Icon-only button -->
<button class="action-btn primary-btn btn-icon">
  <i class="fas fa-plus"></i>
</button>

<!-- Outline button -->
<button class="action-btn btn-outline primary-btn">Outline</button>

<!-- Disabled button -->
<button class="action-btn primary-btn" disabled>Disabled</button>
```

### Button Groups
```html
<div class="btn-group">
  <button class="action-btn primary-btn">Action 1</button>
  <button class="action-btn secondary-btn">Action 2</button>
  <button class="action-btn danger-btn">Delete</button>
</div>
```

## Legacy Support

### User Management
- `.modern-button` is maintained for backward compatibility
- Maps to secondary-btn styling (gray gradient)
- Existing HTML doesn't need to be changed

### Labels Module
- `.action-button` is maintained for backward compatibility
- Maps to success-btn styling (emerald gradient)
- Existing HTML doesn't need to be changed

### Enrollment Card/Fingerprint
- `.scan-btn` and `.save-btn` are preserved
- Use primary (green) and info (blue) colors respectively
- Full-width override maintained

## Notes

- Login page form styling is intentionally separate (specialized design)
- Inventory management table styling is intentionally separate (unique requirements)
- Tab navigation buttons (`.tab-button`) are excluded from this standardization
- Module-specific table/form/button variations are preserved where needed
- All changes are backward compatible with existing HTML
- Button component loaded after form component in index.html for proper cascade
