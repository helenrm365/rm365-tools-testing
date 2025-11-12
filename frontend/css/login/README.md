# Login Page CSS

Self-contained CSS for the login page, following the modern, clean aesthetic of the application.

## File Structure

- **base.css** - CSS variables and theme definitions
- **layout.css** - Container, card, header, and footer layouts
- **form.css** - Form elements, inputs, buttons, and status messages
- **animations.css** - Animation keyframes and motion preferences

## Design Principles

- **Green Gradient Theme**: Primary color #76a12b with gradient to #5e8122
- **Card-Based Design**: Clean card with backdrop blur and subtle shadows
- **SVG Icons**: Inline icons for labels and buttons
- **Smooth Animations**: Fade-in and slide-up animations with cubic-bezier easing
- **Dark Mode First**: Optimized for dark mode with light mode support
- **Accessibility**: Reduced motion support, proper focus states, semantic HTML

## Usage

Load these files in order in `index.html`:

```html
<link rel="stylesheet" href="/css/login/base.css">
<link rel="stylesheet" href="/css/login/layout.css">
<link rel="stylesheet" href="/css/login/form.css">
<link rel="stylesheet" href="/css/login/animations.css">
```

## Color Palette

- Primary: #76a12b (Green)
- Primary Dark: #5e8122
- Text: #ffffff (Dark mode) / #1a1a1a (Light mode)
- Card Background: rgba(255, 255, 255, 0.03) with backdrop blur
- Inputs: rgba(255, 255, 255, 0.05) background

## Key Features

- Responsive design (mobile-first)
- Focus state with green glow
- Hover effects on button with shadow and transform
- Animated arrow icon on button hover
- Status message variants (error, success, info)
- Logo with green drop shadow
- Clean typography using Sora font family
