# Sidebar CSS Module

This directory contains modular CSS files for the universal sidebar component used throughout the RM365 application.

## File Structure

```
sidebar/
├── base.css         - Core sidebar container and layout
├── header.css       - Profile section, logo, and search bar
├── navigation.css   - Navigation menu items and icons
├── footer.css       - Logout button and dark mode toggle
├── responsive.css   - Mobile responsiveness and media queries
└── README.md        - This file
```

## Files Overview

### `base.css`
- Main sidebar container styles
- Sidebar width transitions (collapsed: 80px, expanded: 280px)
- Background gradients and shadows
- Sidebar divider styling
- Dark mode variations

### `header.css`
- Profile section with logo container
- Logo animation on hover
- Profile name and role display
- Search container with icon
- Search input animations
- All header-related dark mode styles

### `navigation.css`
- Navigation menu list styling
- Navigation item layout and states
- Icon centering and sizing
  - **Collapsed**: Icons are 32px × 32px, centered with no labels
  - **Expanded**: Icons are 28px × 28px, aligned left with labels
- Active state indicators
- Hover effects and transitions
- Label show/hide animations
- Scrollbar customization

### `footer.css`
- Footer section layout
- Logout button styling
- Dark mode toggle component
- Toggle switch mechanism
- Icon and label animations for footer items
- Dark mode color variations

### `responsive.css`
- Layout adjustments for content margin
- Mobile sidebar behavior (off-canvas)
- Mobile toggle button
- Breakpoint-specific styles
- Reduced motion support
- Media queries for different screen sizes

## Key Features

### Icon Centering Fix
The navigation icons are properly centered when the sidebar is collapsed:
- **Collapsed state**: Icons use `justify-content: center` with no gap
- **Expanded state**: Icons align left with `gap: 1rem` for spacing
- Labels have `width: 0` when hidden to prevent layout shifts

### Smooth Transitions
- Width transitions use `cubic-bezier(0.4, 0, 0.2, 1)` for smooth expansion
- Opacity and transform animations for labels and icons
- Delayed transitions for staggered reveal effect

### Dark Mode Support
All files include comprehensive dark mode styles using `html.dark-mode` selector.

## Usage

These files are imported in the main `app-shell.css` file:

```css
@import url('sidebar/base.css');
@import url('sidebar/header.css');
@import url('sidebar/navigation.css');
@import url('sidebar/footer.css');
@import url('sidebar/responsive.css');
```

**Important**: `@import` statements must be at the top of the CSS file, before any other CSS rules.

## Customization

To modify sidebar behavior:
- **Width**: Edit `.sidebar` width values in `base.css`
- **Colors**: Update color values in respective files
- **Transitions**: Adjust timing functions and durations
- **Breakpoints**: Modify media queries in `responsive.css`

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- CSS Grid and Flexbox
- CSS Custom Properties (variables)
- `@import` statements
- CSS transitions and transforms

## Related Files

- `/frontend/components/universal-sidebar.html` - Sidebar HTML structure
- `/frontend/css/app-shell.css` - Main app styles (imports these modules)
