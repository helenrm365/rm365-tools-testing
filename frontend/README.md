# RM365 Toolbox - Frontend

Modern, vanilla JavaScript single-page application (SPA) for the RM365 Toolbox platform. This guide will help you understand, develop, and maintain the frontend application.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [Development Guide](#development-guide)
- [UI Components](#ui-components)
- [API Integration](#api-integration)
- [Styling](#styling)
- [Common Tasks](#common-tasks)
- [Deployment](#deployment)

## Overview

The frontend is a **vanilla JavaScript** application with no framework dependencies. It's fast, lightweight, and easy to understand.

### Key Features
- 🎯 **Pure JavaScript**: No React, Vue, or Angular - just modern ES6+
- 🎨 **Modern UI**: Clean design with dark mode support
- 📱 **Responsive**: Mobile-first, works on all devices
- 🔐 **Secure**: JWT authentication with role-based access
- ⚡ **Fast**: Minimal dependencies, optimized loading
- 🌐 **SPA**: Single-page app with client-side routing
- 🎭 **PWA**: Progressive Web App capabilities

### Technology Stack
- **HTML5**: Semantic markup
- **CSS3**: Modern styling with Grid, Flexbox, and CSS Variables
- **JavaScript ES6+**: Modules, async/await, classes
- **LocalStorage**: Client-side data persistence
- **Fetch API**: HTTP requests to backend
- **Service Workers**: Offline support (PWA)

## Architecture

### Application Flow

```
┌─────────────────────────────────────────────────┐
│            index.html (App Shell)               │
├─────────────────────────────────────────────────┤
│          js/router.js (SPA Routing)             │
├─────────────────────────────────────────────────┤
│   ┌─────────────────┐   ┌──────────────────┐   │
│   │  UI Components  │   │  Page Modules    │   │
│   │  (Sidebar, etc) │   │  (Feature logic) │   │
│   └─────────────────┘   └──────────────────┘   │
├─────────────────────────────────────────────────┤
│        services/api/* (Backend API)             │
├─────────────────────────────────────────────────┤
│          Backend REST API (FastAPI)             │
└─────────────────────────────────────────────────┘
```

### Module Pattern

Each feature follows this structure:
```
modules/feature-name/
├── index.js       # Entry point, exports init()
├── feature.js     # Main feature logic
└── utils.js       # Helper functions (optional)
```

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- HTTP server (for local development)
- Backend API running (see backend README)

### Quick Start

1. **Navigate to Frontend Directory**
   ```bash
   cd frontend
   ```

2. **Serve the Application**

   **Option 1: Python HTTP Server**
   ```bash
   python -m http.server 3000
   ```

   **Option 2: Node.js serve**
   ```bash
   npx serve . -p 3000
   ```

   **Option 3: Live Server (VS Code)**
   - Install "Live Server" extension
   - Right-click `index.html` → "Open with Live Server"

3. **Configure Backend URL**
   
   Edit `js/config.js`:
   ```javascript
   export const config = {
     API: 'http://localhost:8000',  // Your backend URL
     DEBUG: true,                   // Enable debug logging
   };
   ```

4. **Open in Browser**
   ```
   http://localhost:3000
   ```

5. **Login**
   - Default credentials should be provided by your team lead
   - Or create a user through the backend API

## Project Structure

```
frontend/
├── index.html                  # Main app shell
├── manifest.webmanifest        # PWA manifest
│
├── components/                 # Reusable UI components
│   └── universal-sidebar.html  # Animated sidebar
│
├── css/                        # Stylesheets
│   ├── app-shell.css          # Layout & sidebar
│   ├── modern-ui.css          # Component styles
│   ├── connection-status.css  # Online/offline indicator
│   ├── enrollment.css         # Enrollment-specific
│   ├── inventory-table.css    # Inventory tables
│   └── usermanagement.css     # User management
│
├── html/                       # Page templates
│   ├── login.html             # Login page
│   ├── reports.html           # Reports dashboard
│   │
│   ├── attendance/            # Attendance module pages
│   │   ├── automaticClocking.html
│   │   ├── automaticReader.html
│   │   ├── logs.html
│   │   └── overview.html
│   │
│   ├── enrollment/            # Enrollment module
│   │   ├── cardEnrollment.html
│   │   └── fingerprintEnrollment.html
│   │
│   ├── inventory/             # Inventory module
│   │   ├── adjustments.html
│   │   └── management.html
│   │
│   ├── labels/                # Labels module
│   │   ├── generator.html
│   │   └── printHistory.html
│   │
│   ├── sales-imports/         # Sales import module
│   │   ├── history.html
│   │   └── upload.html
│   │
│   └── usermanagement/        # User management
│       ├── management.html
│       └── roles.html
│
└── js/                         # JavaScript modules
    ├── config.js              # Configuration
    ├── router.js              # SPA routing
    ├── shell-ui.js            # App shell initialization
    ├── debug.js               # Debug utilities
    │
    ├── modules/               # Feature modules
    │   ├── attendance/
    │   │   ├── index.js
    │   │   ├── automaticClocking.js
    │   │   ├── automaticReader.js
    │   │   ├── logs.js
    │   │   └── overview.js
    │   │
    │   ├── auth/
    │   │   ├── index.js
    │   │   └── login.js
    │   │
    │   ├── enrollment/
    │   │   ├── index.js
    │   │   ├── cardEnrollment.js
    │   │   └── fingerprintEnrollment.js
    │   │
    │   ├── inventory/
    │   │   ├── index.js
    │   │   ├── adjustments.js
    │   │   └── management.js
    │   │
    │   ├── labels/
    │   │   ├── index.js
    │   │   ├── generator.js
    │   │   └── printHistory.js
    │   │
    │   ├── sales-imports/
    │   │   ├── index.js
    │   │   ├── history.js
    │   │   └── upload.js
    │   │
    │   └── usermanagement/
    │       ├── index.js
    │       └── management.js
    │
    ├── services/              # Backend API services
    │   └── api/
    │       ├── http.js        # HTTP client
    │       ├── attendanceApi.js
    │       ├── rolesApi.js
    │       └── usersApi.js
    │
    ├── ui/                    # UI utilities
    │   ├── components.js      # Reusable components
    │   └── confirmationModal.js
    │
    └── utils/                 # Shared utilities
        ├── universal-sidebar.js
        ├── dropdown-system.js
        ├── tabs.js
        └── sidebar-fallback.js
```

## Core Concepts

### 1. SPA Routing

The router (`js/router.js`) handles navigation without page reloads:

```javascript
// Navigate to a page
window.navigate('/attendance/overview');

// Router automatically:
// 1. Loads HTML from /html/attendance/overview.html
// 2. Injects into #app container
// 3. Initializes the module
// 4. Updates browser history
```

**How it works:**
- Links with `data-nav` attribute are intercepted
- URL changes trigger router
- Module's `init()` function is called
- Old content is cleaned up

### 2. Module Initialization

Each page module exports an `init()` function:

```javascript
// modules/myfeature/index.js
export function init() {
  console.log('MyFeature initialized');
  
  // Set up event listeners
  document.getElementById('myButton').addEventListener('click', handleClick);
  
  // Fetch data
  loadData();
}

function handleClick() {
  // Handle button click
}

async function loadData() {
  // Fetch from API
}
```

### 3. Authentication

Authentication is handled via JWT tokens:

```javascript
// Login
const response = await post('/api/v1/auth/login', { username, password });
localStorage.setItem('authToken', response.token);
localStorage.setItem('user', JSON.stringify(response.user));

// Make authenticated requests (automatic in http.js)
import { get } from './services/api/http.js';
const data = await get('/api/v1/users');  // Token auto-attached
```

### 4. State Management

State is managed with:
- **LocalStorage**: Persistent data (auth token, user info, preferences)
- **Module-level variables**: Page-specific state
- **DOM as state**: UI reflects current state

```javascript
// Save preference
localStorage.setItem('darkMode', 'true');

// Get preference
const isDark = localStorage.getItem('darkMode') === 'true';
```

### 5. Event Handling

Use event delegation for dynamic content:

```javascript
// Good: Event delegation
document.addEventListener('click', (e) => {
  if (e.target.matches('.delete-btn')) {
    handleDelete(e.target.dataset.id);
  }
});

// Avoid: Direct binding on dynamic elements
document.querySelectorAll('.delete-btn').forEach(btn => {
  btn.addEventListener('click', handleDelete);  // Won't work for new buttons
});
```

## Development Guide

### Adding a New Page

1. **Create HTML Template**
   ```bash
   # Create file: html/myfeature/mypage.html
   ```
   ```html
   <div class="page-content">
     <h1>My Page</h1>
     <div id="content"></div>
   </div>
   ```

2. **Create Module**
   ```bash
   # Create directory and files
   mkdir -p js/modules/myfeature
   touch js/modules/myfeature/index.js
   ```

   ```javascript
   // js/modules/myfeature/index.js
   export function init() {
     console.log('MyFeature page loaded');
     loadContent();
   }

   async function loadContent() {
     const container = document.getElementById('content');
     container.innerHTML = '<p>Hello World!</p>';
   }
   ```

3. **Add to Router**
   
   Edit `js/router.js` and add your route:
   ```javascript
   const routes = {
     '/myfeature': {
       html: '/html/myfeature/mypage.html',
       module: 'myfeature',
       title: 'My Feature'
     }
   };
   ```

4. **Add to Sidebar**
   
   Edit `components/universal-sidebar.html`:
   ```html
   <li>
     <a href="/myfeature" class="sidebar-link" data-nav>
       <span class="icon">🚀</span>
       <span class="label">My Feature</span>
     </a>
   </li>
   ```

5. **Test**
   - Open browser
   - Click sidebar link
   - Verify page loads

### Making API Calls

Create API service file:

```javascript
// js/services/api/myFeatureApi.js
import { get, post, patch, del } from './http.js';

const API = '/api/v1/myfeature';

export const getItems = () => get(API);

export const createItem = (data) => post(API, data);

export const updateItem = (id, data) => patch(`${API}/${id}`, data);

export const deleteItem = (id) => del(`${API}/${id}`);
```

Use in module:

```javascript
// js/modules/myfeature/index.js
import { getItems, createItem } from '../../services/api/myFeatureApi.js';

export function init() {
  loadItems();
  setupEventListeners();
}

async function loadItems() {
  try {
    const items = await getItems();
    renderItems(items);
  } catch (error) {
    console.error('Failed to load items:', error);
    showError('Failed to load data');
  }
}

function setupEventListeners() {
  document.getElementById('createBtn').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value;
    await createItem({ name });
    loadItems();  // Reload
  });
}
```

### Error Handling

Always handle errors gracefully:

```javascript
async function fetchData() {
  try {
    const data = await get('/api/v1/data');
    return data;
  } catch (error) {
    console.error('Error fetching data:', error);
    
    // Show user-friendly message
    showNotification('Failed to load data. Please try again.', 'error');
    
    // Return fallback
    return [];
  }
}
```

### Loading States

Show loading indicators:

```javascript
async function loadData() {
  const container = document.getElementById('content');
  
  // Show loading
  container.innerHTML = '<div class="loading">Loading...</div>';
  
  try {
    const data = await fetchData();
    container.innerHTML = renderData(data);
  } catch (error) {
    container.innerHTML = '<div class="error">Failed to load</div>';
  }
}
```

## UI Components

### Sidebar

The universal sidebar is automatically loaded on all pages (except login).

**Features:**
- Animated expansion on hover
- Dark mode toggle
- Search functionality
- Role-based visibility

**Customization:**
Edit `components/universal-sidebar.html` to add/remove navigation items.

### Confirmation Modal

Use for destructive actions:

```javascript
import { showConfirmation } from '../ui/confirmationModal.js';

async function handleDelete(id) {
  const confirmed = await showConfirmation({
    title: 'Delete Item',
    message: 'Are you sure you want to delete this item?',
    confirmText: 'Delete',
    type: 'danger'
  });
  
  if (confirmed) {
    await deleteItem(id);
    reloadList();
  }
}
```

### Custom Dropdowns

Enhanced select elements:

```javascript
import { initializeDropdowns } from '../utils/dropdown-system.js';

// Initialize after DOM is ready
initializeDropdowns();
```

```html
<select class="c-select">
  <option value="1">Option 1</option>
  <option value="2">Option 2</option>
</select>
```

### Tabs

Dynamic tab system:

```javascript
import { setupTabs } from '../utils/tabs.js';

setupTabs();
```

```html
<div class="tabs">
  <button class="tab-btn active" data-tab="tab1">Tab 1</button>
  <button class="tab-btn" data-tab="tab2">Tab 2</button>
</div>

<div class="tab-content active" id="tab1">Content 1</div>
<div class="tab-content" id="tab2">Content 2</div>
```

## API Integration

### HTTP Client

The HTTP client (`services/api/http.js`) handles all requests:

```javascript
import { get, post, patch, del } from './services/api/http.js';

// GET request
const users = await get('/api/v1/users');

// POST request
const newUser = await post('/api/v1/users', {
  username: 'john',
  password: 'secret'
});

// PATCH request
await patch('/api/v1/users', {
  username: 'john',
  new_password: 'newsecret'
});

// DELETE request
await del('/api/v1/users?username=john');
```

**Features:**
- Automatic token attachment
- Error handling
- JSON serialization
- Base URL configuration

### Handling Responses

```javascript
try {
  const response = await get('/api/v1/data');
  
  // Response is automatically parsed JSON
  console.log(response);
  
} catch (error) {
  // Errors include status code and message
  console.error(`${error.status}: ${error.message}`);
  
  if (error.status === 401) {
    // Unauthorized - redirect to login
    window.navigate('/login');
  } else if (error.status === 403) {
    // Forbidden
    showError('You don\'t have permission');
  } else {
    // Other errors
    showError('Something went wrong');
  }
}
```

## Styling

### CSS Architecture

1. **app-shell.css**: Layout, sidebar, navigation
2. **modern-ui.css**: Buttons, forms, tables, cards
3. **Feature-specific CSS**: Module-specific styles

### CSS Variables

Use CSS variables for theming:

```css
:root {
  --primary-color: #007bff;
  --secondary-color: #6c757d;
  --bg-color: #ffffff;
  --text-color: #333333;
}

.dark-mode {
  --bg-color: #1a1a1a;
  --text-color: #ffffff;
}
```

### Dark Mode

Dark mode is handled automatically by the sidebar. To add dark mode support to your styles:

```css
/* Light mode (default) */
.my-component {
  background: var(--bg-color);
  color: var(--text-color);
}

/* Dark mode (automatically applied when .dark-mode on <html>) */
.dark-mode .my-component {
  /* Override if needed */
}
```

### Responsive Design

Use mobile-first approach:

```css
/* Mobile first (default) */
.container {
  padding: 10px;
}

/* Tablet and up */
@media (min-width: 768px) {
  .container {
    padding: 20px;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .container {
    padding: 30px;
    max-width: 1200px;
  }
}
```

## Common Tasks

### Testing Your Changes in VS Code

#### 1. Running the Frontend

**Method 1: Live Server Extension (Recommended)**

1. **Install Extension**
   - Open Extensions (Ctrl+Shift+X)
   - Search "Live Server"
   - Install by Ritwick Dey

2. **Start Server**
   - Right-click `index.html`
   - Select "Open with Live Server"
   - Or click "Go Live" in status bar
   - Opens at `http://127.0.0.1:5500`

3. **Auto-Reload**
   - Save any file (Ctrl+S)
   - Browser automatically refreshes
   - See changes immediately

**Method 2: Python HTTP Server**

```bash
# In VS Code terminal (Ctrl+`)
cd frontend
python -m http.server 3000

# Open manually: http://localhost:3000
```

**Method 3: Node.js Serve**

```bash
# In VS Code terminal
cd frontend
npx serve . -p 3000

# Or install globally
npm install -g serve
serve . -p 3000
```

**Method 4: VS Code Task**

Create `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Serve Frontend",
      "type": "shell",
      "command": "python",
      "args": ["-m", "http.server", "3000"],
      "options": {
        "cwd": "${workspaceFolder}/frontend"
      },
      "problemMatcher": [],
      "isBackground": true
    }
  ]
}
```

Run: Terminal → Run Task → "Serve Frontend"

#### 2. Testing Workflow

**Quick Test Cycle:**

1. **Make Changes** in VS Code
   ```javascript
   // Edit js/modules/myfeature/index.js
   export function init() {
     console.log('Testing new feature!');
   }
   ```

2. **Save File** (Ctrl+S)
   - Live Server auto-refreshes browser
   - Or manually refresh (F5)

3. **Check Browser Console** (F12)
   - See console.log output
   - Check for errors (red text)
   - View network requests

4. **Verify Changes**
   - Test functionality
   - Check UI updates
   - Verify API calls work

#### 3. Using Browser DevTools

**Open DevTools:** Press `F12` or Right-click → Inspect

**Console Tab:**
```javascript
// View logs
console.log('Debug info:', data);

// Test functions directly
window.navigate('/attendance/overview');

// Check state
console.log(localStorage.getItem('authToken'));
console.log(localStorage.getItem('user'));

// Test API calls
import { get } from '/js/services/api/http.js';
get('/api/v1/users').then(console.log);
```

**Network Tab:**
- See all API requests
- Check request/response
- Verify status codes
- View headers and payload

**Elements Tab:**
- Inspect HTML structure
- View computed CSS
- Test CSS changes live
- Check element properties

**Application Tab:**
- View LocalStorage
- Check session storage
- Inspect cookies
- View service workers

#### 4. Debugging JavaScript in VS Code

**Method 1: Browser Debugger**

1. Add `debugger;` in your code:
```javascript
export function init() {
  debugger;  // Execution will pause here
  loadData();
}
```

2. Run with Live Server
3. Open browser DevTools (F12)
4. Execution pauses at `debugger` line
5. Step through code

**Method 2: VS Code Debugger for Chrome**

1. **Install Extension**
   - "Debugger for Chrome" or "JavaScript Debugger"

2. **Create Launch Config** (`.vscode/launch.json`):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Launch Chrome",
      "url": "http://localhost:3000",
      "webRoot": "${workspaceFolder}/frontend",
      "sourceMaps": true
    }
  ]
}
```

3. **Set Breakpoints**
   - Click left of line number (red dot)

4. **Start Debugging** (F5)
   - Chrome opens automatically
   - Breakpoints hit in VS Code
   - Inspect variables in VS Code

#### 5. Testing Specific Features

**Test API Integration:**

1. Open browser console (F12)
2. Test API calls:
```javascript
// Import and test
const { get } = await import('/js/services/api/http.js');
const users = await get('/api/v1/users');
console.log(users);
```

**Test Module Loading:**

1. Add console.log to module:
```javascript
export function init() {
  console.log('MyModule initialized');
  console.log('Current user:', localStorage.getItem('user'));
}
```

2. Navigate to page
3. Check console for output

**Test Event Handlers:**

```javascript
// Add logging to handler
document.getElementById('myButton').addEventListener('click', () => {
  console.log('Button clicked!');
  console.log('Current state:', state);
  handleClick();
});
```

**Test Routing:**

```javascript
// In console
window.navigate('/attendance/overview');

// Check if module loaded
console.log('Current path:', window.location.pathname);
```

#### 6. Live Editing and Hot Reload

**CSS Changes:**
1. Edit CSS file
2. Save (Ctrl+S)
3. Live Server refreshes
4. See styles update immediately

**HTML Changes:**
1. Edit HTML template
2. Save
3. Reload page
4. See structure changes

**JavaScript Changes:**
1. Edit JS file
2. Save
3. Refresh browser (F5)
4. Test new functionality

#### 7. Testing with Different Screen Sizes

**In Chrome DevTools:**
1. Press `Ctrl+Shift+M` (Toggle Device Toolbar)
2. Select device (iPhone, iPad, etc.)
3. Or set custom dimensions
4. Test responsive design

**In VS Code:**
- No built-in preview, use browser DevTools

#### 8. Testing with Debug Mode

**Enable Debug Logging:**

Add to URL: `?debug=true`
```
http://localhost:3000/?debug=true
```

**What it shows:**
- All API requests/responses
- Router navigation events
- Module initialization
- Authentication flow
- Detailed error messages

**Example output:**
```
[Router] Navigating to /attendance/overview
[API] GET /api/v1/attendance/employees
[API] Response: {data: [...]}
[Module] Attendance overview initialized
```

#### 9. Common Testing Scenarios

**Test Login Flow:**
```javascript
// 1. Open login page
window.navigate('/login');

// 2. Fill form (in console or UI)
document.getElementById('username').value = 'admin';
document.getElementById('password').value = 'password';

// 3. Submit
document.querySelector('form').submit();

// 4. Check token saved
console.log(localStorage.getItem('authToken'));
```

**Test CRUD Operations:**
```javascript
// Create
const newItem = await post('/api/v1/items', { name: 'Test Item' });
console.log('Created:', newItem);

// Read
const items = await get('/api/v1/items');
console.log('All items:', items);

// Update
const updated = await patch('/api/v1/items/1', { name: 'Updated' });
console.log('Updated:', updated);

// Delete
await del('/api/v1/items/1');
console.log('Deleted');
```

**Test Error Handling:**
```javascript
// Trigger error
try {
  await get('/api/v1/nonexistent');
} catch (error) {
  console.log('Error caught:', error);
  console.log('Status:', error.status);
  console.log('Message:', error.message);
}
```

#### 10. Testing Checklist

Before committing changes:

- [ ] Changes visible in browser
- [ ] No console errors (F12)
- [ ] No network errors in Network tab
- [ ] UI looks correct on mobile (Ctrl+Shift+M)
- [ ] Dark mode works (toggle in sidebar)
- [ ] Navigation works (test sidebar links)
- [ ] Forms submit correctly
- [ ] Data loads from API
- [ ] Error messages display properly
- [ ] Loading states show
- [ ] Authentication still works

#### 11. VS Code Extensions for Frontend Testing

**Recommended Extensions:**

1. **Live Server** (Ritwick Dey)
   - Auto-refresh on save
   - Local development server

2. **ESLint**
   - JavaScript linting
   - Catch errors as you type

3. **Prettier**
   - Code formatting
   - Consistent style

4. **JavaScript Debugger**
   - Debug in VS Code
   - Set breakpoints

5. **Path Intellisense**
   - Autocomplete file paths
   - Avoid typos in imports

6. **Auto Rename Tag**
   - Rename HTML tags together
   - Prevents mismatched tags

7. **Color Highlight**
   - Preview colors in CSS
   - Helpful for theming

8. **REST Client**
   - Test backend APIs
   - Without leaving VS Code

#### 12. Quick Debug Tips

**Console Shortcuts:**
```javascript
// Quick inspect
console.table(arrayOfObjects);  // Nice table view
console.dir(element);            // Detailed object view
console.trace();                 // Show call stack

// Timing
console.time('operation');
// ... code to measure
console.timeEnd('operation');    // Shows duration

// Conditional logging
console.assert(condition, 'Error message if false');
```

**Network Tab Filters:**
```
Filter by type: XHR (API calls only)
Filter by status: status-code:404
Filter by URL: /api/v1/users
```

**Quick DOM Inspection:**
```javascript
// Find elements
$('selector')        // Same as document.querySelector
$$('selector')       // Same as querySelectorAll
$0                   // Last selected element in Elements tab

// Get element info
$0.className
$0.addEventListener
console.dir($0)
```

#### 13. Performance Testing

**Check Load Time:**
1. Open DevTools Network tab
2. Refresh page (Ctrl+R)
3. Check "Load" time at bottom
4. Goal: < 2 seconds

**Check Bundle Size:**
```bash
# In terminal
cd frontend
du -sh js/
du -sh css/
```

**Lighthouse Audit:**
1. Open DevTools
2. Go to "Lighthouse" tab
3. Click "Generate report"
4. Review performance score

### Common Testing Patterns

**Test a new page:**
```javascript
// 1. Create HTML file
// 2. Create JS module with init()
// 3. Add route to router.js
// 4. Test:
window.navigate('/mypage');
// Check console for init() log
```

**Test API integration:**
```javascript
// In browser console
const { get } = await import('/js/services/api/http.js');
const data = await get('/api/v1/endpoint');
console.table(data);
```

**Test form submission:**
```javascript
// Add logging
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  console.log('Form data:', new FormData(e.target));
  // ... rest of handler
});
```

---

### Adding a Form

```javascript
export function init() {
  const form = document.getElementById('myForm');
  form.addEventListener('submit', handleSubmit);
}

async function handleSubmit(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData);
  
  try {
    await post('/api/v1/resource', data);
    showSuccess('Saved successfully');
    e.target.reset();
  } catch (error) {
    showError('Failed to save');
  }
}
```

### Rendering a Table

```javascript
function renderTable(items) {
  const html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => `
          <tr>
            <td>${item.name}</td>
            <td>${item.email}</td>
            <td>
              <button class="btn-edit" data-id="${item.id}">Edit</button>
              <button class="btn-delete" data-id="${item.id}">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  document.getElementById('tableContainer').innerHTML = html;
}
```

### File Upload

```javascript
async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`${config.API}/api/v1/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: formData  // Don't set Content-Type, browser does it
    });
    
    if (!response.ok) throw new Error('Upload failed');
    
    const result = await response.json();
    showSuccess('File uploaded successfully');
  } catch (error) {
    showError('Failed to upload file');
  }
}
```

### Debouncing Search

```javascript
let searchTimeout;

function setupSearch() {
  const searchInput = document.getElementById('search');
  
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(e.target.value);
    }, 300);  // Wait 300ms after typing stops
  });
}

async function performSearch(query) {
  const results = await get(`/api/v1/search?q=${encodeURIComponent(query)}`);
  renderResults(results);
}
```

## Deployment

### Cloudflare Pages

The frontend is deployed to Cloudflare Pages:

1. **Connect Repository**
   - Link GitHub repo to Cloudflare Pages
   - Set build directory to `frontend`

2. **Environment Variables**
   ```
   API=https://your-backend.up.railway.app
   ```

3. **Build Settings**
   - Build command: (none)
   - Build output directory: `frontend`
   - Root directory: `/`

4. **Deploy**
   - Push to `main` branch
   - Cloudflare auto-deploys
   - Live at `https://your-app.pages.dev`

### Testing Production Build

Before deploying, test production configuration:

1. Update `js/config.js` with production API URL
2. Test all features
3. Check browser console for errors
4. Test on mobile devices
5. Verify CORS is configured on backend

## Debug Mode

Enable debug mode for detailed logging:

```
http://localhost:3000/?debug=true
```

This shows:
- API requests/responses
- Router navigation
- Authentication flow
- Module initialization
- Error stack traces

## Best Practices

### Code Style
- Use `const` by default, `let` when needed, never `var`
- Use async/await instead of promises
- Use template literals for strings
- Prefer arrow functions
- Use destructuring

### Organization
- One file per feature/component
- Export functions, don't pollute global scope
- Group related files in directories
- Keep files small and focused

### Performance
- Minimize DOM operations
- Use event delegation
- Lazy load modules
- Debounce input handlers
- Cache API responses when appropriate

### Security
- Always validate input
- Sanitize user content before rendering
- Don't store sensitive data in localStorage
- Use HTTPS in production
- Implement CSRF protection for forms

## Troubleshooting

**Page doesn't load**
- Check browser console for errors
- Verify HTML file exists in `/html/` directory
- Check route is defined in router

**API calls fail**
- Verify backend is running
- Check `config.js` has correct API URL
- Check browser Network tab for request details
- Verify CORS is configured on backend

**Authentication issues**
- Check token exists in localStorage
- Verify token hasn't expired
- Try logging out and back in

**Styles not applying**
- Check CSS file is linked in HTML
- Verify class names match
- Check browser DevTools for CSS conflicts
- Clear browser cache

---

**Welcome to the team! 🚀**

The frontend is designed to be intuitive and easy to work with. Don't hesitate to explore the code and ask questions. Happy coding!
