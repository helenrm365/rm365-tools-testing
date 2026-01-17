# Shadow System Design Specification

This document defines the standardized shadow system for all UI components. All shadows are defined in `core/standard-colors.css` and must be used consistently across the application.

## Shadow Variables

| Variable | Usage | Visual Weight |
|----------|-------|---------------|
| `--shadow-s` | Minimal depth, decorative elements | Subtle |
| `--shadow-m` | Medium depth, nested elements | Moderate |
| `--shadow-l` | Maximum depth, primary interactive elements | Strong |

## Text Shadow Variables

| Variable | Usage |
|----------|-------|
| `--text-shadow-s` | Subtle text depth |
| `--text-shadow-m` | Standard button/heading text depth |
| `--text-shadow-l` | Strong emphasis text depth |

---

## Shadow Assignment Rules

### `--shadow-l` (Large) - Primary Interactive & Prominent Elements

Use for elements that are the main focus or primary interaction points:

- **Main Container Cards** (`.action-block`, `.content-card`, `.panel`)
- **Buttons** (all button types: `.btn`, `.action-btn`, `.primary-btn`, etc.)
- **Form Inputs** (`.input`, `.form-input`, search bars, dropdowns)
- **Modals** (`.modal`, `.modal-content`)
- **Page Title** (via `filter: drop-shadow()` for gradient text)
- **Floating Elements** (popovers, tooltips, dropdown menus)
- **Help Button** (`.help-button`)

### `--shadow-m` (Medium) - Nested & Secondary Elements

Use for elements that sit within primary containers:

- **Nested Cards** (`.entity-card`, `.employee-card` - cards within cards)
- **Table Containers** (`.table-container`)
- **Chart Containers** (`.chart-container`)
- **Tabs Container** (`.tabs`)
- **Hover States** (when non-shadowed element gains shadow on hover)

### `--shadow-s` (Small) - Decorative & Tertiary Elements

Use for small decorative elements or very subtle depth:

- **Icon Containers** (`.block-icon`)
- **Avatars** (when shadowed)
- **Badges** (optional, most are flat)
- **Subtle UI Elements**

### No Shadow - Flat Elements

Elements that should remain flat:

- **Badges** (`.badge`, `.status-badge`)
- **Tags** (`.tag`)
- **Inline Labels**
- **Ghost Buttons** (`.btn-ghost`)
- **Disabled Elements**

---

## Text Shadow Rules

### `--text-shadow-m` - Standard

Use for text on gradient/colored backgrounds:

- **Gradient Buttons** (`.primary-btn`, `.danger-btn`, `.info-btn`, `.success-btn`, `.warning-btn`)
- **Action Buttons** (`.action-btn`)
- **Help Button** (`.help-button`)
- **Page Subtitles** (`.page-subtitle`)

### `filter: drop-shadow()` - For Gradient Text

When text uses `-webkit-text-fill-color: transparent` (gradient text), use:
```css
filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
```

This applies to:
- **Page Titles** (`.page-title`)

---

## Hover State Behavior

### Elements WITH base shadow
- Elevate shadow on hover: `shadow-s → shadow-m`, `shadow-m → shadow-l`
- Add subtle lift: `transform: translateY(-2px)` or `translateY(-3px)`

### Elements WITHOUT base shadow
- May gain `shadow-m` or `shadow-l` on hover
- Example: flat cards that lift on hover

---

## Implementation Checklist

### ✅ Components Using Correct Shadows

| Component | File | Shadow Level |
|-----------|------|--------------|
| `.action-block` | cards.css | `--shadow-l` |
| `.entity-card` | cards.css | `--shadow-m` (nested) |
| `.btn` | buttons.css | `--shadow-l` |
| `.action-btn` | buttons.css | `--shadow-l` |
| Gradient buttons | buttons.css | colored shadow + text-shadow |
| `.modal` | modals.css | `--shadow-l` |
| Inputs | forms.css | `--shadow-l` |
| `.help-button` | header.css | `--shadow-l` |
| `.page-title` | header.css | drop-shadow filter |
| `.page-subtitle` | header.css | `--text-shadow-s` |

---

## Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│  PAGE                                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  MAIN CARD (shadow-l)                                 │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐     │  │
│  │  │ NESTED CARD         │  │ NESTED CARD         │     │  │
│  │  │ (shadow-m)          │  │ (shadow-m)          │     │  │
│  │  │ ┌───────┐           │  │                     │     │  │
│  │  │ │ ICON  │ shadow-s  │  │                     │     │  │
│  │  │ └───────┘           │  │                     │     │  │
│  │  └─────────────────────┘  └─────────────────────┘     │  │
│  │                                                       │  │
│  │  [BUTTON shadow-l]  [INPUT shadow-l]                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Modified for Shadow System

1. `core/standard-colors.css` - Shadow and text-shadow variable definitions
2. `components/buttons.css` - Button shadows
3. `components/cards.css` - Card hierarchy shadows
4. `components/forms.css` - Input/select shadows
5. `components/modals.css` - Modal shadows
6. `layout/header.css` - Page title and help button
