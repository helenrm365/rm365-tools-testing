# RM365 Toolbox - Frontend# RM365 Toolbox - Frontend



Modern, vanilla JavaScript single-page application (SPA) for the RM365 Toolbox platform.Modern, vanilla JavaScript single-page application (SPA) for the RM365 Toolbox platform. This guide will help you understand, develop, and maintain the frontend application.



## 📋 Table of Contents## 📋 Table of Contents



- [Overview](#overview)- [Overview](#overview)

- [Architecture](#architecture)- [Architecture](#architecture)

- [Project Structure](#project-structure)- [Getting Started](#getting-started)

- [Development Workflow](#development-workflow)- [Project Structure](#project-structure)

- [Configuration](#configuration)- [Core Concepts](#core-concepts)

- [Routing System](#routing-system)- [Development Guide](#development-guide)

- [UI Components](#ui-components)- [UI Components](#ui-components)

- [API Integration](#api-integration)- [API Integration](#api-integration)

- [Styling](#styling)

## Overview- [Common Tasks](#common-tasks)

- [Deployment](#deployment)

The frontend is a **vanilla JavaScript** application with no framework dependencies. It's fast, lightweight, and easy to understand.

## Overview

### Key Features

- 🎯 **Pure JavaScript**: No React, Vue, or Angular - just modern ES6+The frontend is a **vanilla JavaScript** application with no framework dependencies. It's fast, lightweight, and easy to understand.

- 🎨 **Modern UI**: Clean design with dark mode support

- 📱 **Responsive**: Mobile-first, works on all devices### Key Features

- 🔐 **Secure**: JWT authentication with role-based access- 🎯 **Pure JavaScript**: No React, Vue, or Angular - just modern ES6+

- ⚡ **Fast**: Minimal dependencies, optimized loading- 🎨 **Modern UI**: Clean design with dark mode support

- 🌐 **SPA**: Single-page app with client-side routing- 📱 **Responsive**: Mobile-first, works on all devices

- 🎭 **PWA**: Progressive Web App capabilities- 🔐 **Secure**: JWT authentication with role-based access

- ⚡ **Fast**: Minimal dependencies, optimized loading

### Technology Stack- 🌐 **SPA**: Single-page app with client-side routing

- **HTML5**: Semantic markup- 🎭 **PWA**: Progressive Web App capabilities

- **CSS3**: Modern styling with Grid, Flexbox, and CSS Variables

- **JavaScript ES6+**: Modules, async/await, classes### Technology Stack

- **LocalStorage**: Client-side data persistence- **HTML5**: Semantic markup

- **Fetch API**: HTTP requests to backend- **CSS3**: Modern styling with Grid, Flexbox, and CSS Variables

- **Service Workers**: Offline support (PWA)- **JavaScript ES6+**: Modules, async/await, classes

- **LocalStorage**: Client-side data persistence

## Architecture- **Fetch API**: HTTP requests to backend

- **Service Workers**: Offline support (PWA)

### Application Flow

## Architecture

```

┌─────────────────────────────────────────────────┐### Application Flow

│            index.html (App Shell)               │

├─────────────────────────────────────────────────┤```

│          js/router.js (SPA Routing)             │┌─────────────────────────────────────────────────┐

├─────────────────────────────────────────────────┤│            index.html (App Shell)               │

│   ┌─────────────────┐   ┌──────────────────┐   │├─────────────────────────────────────────────────┤

│   │  UI Components  │   │  Page Modules    │   ││          js/router.js (SPA Routing)             │

│   │  (Sidebar, etc) │   │  (Feature logic) │   │├─────────────────────────────────────────────────┤

│   └─────────────────┘   └──────────────────┘   ││   ┌─────────────────┐   ┌──────────────────┐   │

├─────────────────────────────────────────────────┤│   │  UI Components  │   │  Page Modules    │   │

│        services/api/* (Backend API)             ││   │  (Sidebar, etc) │   │  (Feature logic) │   │

├─────────────────────────────────────────────────┤│   └─────────────────┘   └──────────────────┘   │

│          Backend REST API (FastAPI)             │├─────────────────────────────────────────────────┤

└─────────────────────────────────────────────────┘│        services/api/* (Backend API)             │

```├─────────────────────────────────────────────────┤

│          Backend REST API (FastAPI)             │

### Module Pattern└─────────────────────────────────────────────────┘

```

Each feature follows this structure:

```### Module Pattern

modules/feature-name/

├── index.js       # Entry point, exports init()Each feature follows this structure:

├── feature.js     # Main feature logic```

└── utils.js       # Helper functions (optional)modules/feature-name/

```├── index.js       # Entry point, exports init()

├── feature.js     # Main feature logic

## Project Structure└── utils.js       # Helper functions (optional)

```

```

frontend/## Getting Started

├── index.html                  # Main app shell

├── manifest.webmanifest        # PWA manifest### Prerequisites

│

├── components/                 # Reusable UI components- Modern web browser (Chrome, Firefox, Safari, Edge)

│   └── universal-sidebar.html  # Animated sidebar- HTTP server (for local development)

│- Backend API running (see backend README)

├── css/                        # Stylesheets

│   ├── app-shell.css          # Layout & sidebar### Quick Start

│   ├── modern-ui.css          # Component styles

│   ├── connection-status.css  # Online/offline indicator1. **Navigate to Frontend Directory**

│   ├── enrollment.css         # Enrollment-specific   ```bash

│   ├── inventory-table.css    # Inventory tables   cd frontend

│   └── usermanagement.css     # User management   ```

│

├── html/                       # Page templates2. **Serve the Application**

│   ├── login.html             # Login page

│   ├── reports.html           # Reports dashboard   **Option 1: Python HTTP Server**

│   │   ```bash

│   ├── attendance/            # Attendance module pages   python -m http.server 3000

│   │   ├── automatic.html   ```

│   │   ├── home.html

│   │   ├── logs.html   **Option 2: Node.js serve**

│   │   ├── manual.html   ```bash

│   │   └── overview.html   npx serve . -p 3000

│   │   ```

│   ├── enrollment/            # Enrollment module

│   │   ├── card.html   **Option 3: Live Server (VS Code)**

│   │   ├── fingerprint.html   - Install "Live Server" extension

│   │   ├── home.html   - Right-click `index.html` → "Open with Live Server"

│   │   └── management.html

│   │3. **Configure Backend URL**

│   ├── inventory/             # Inventory module   

│   │   ├── adjustments.html   Edit `js/config.js`:

│   │   ├── home.html   ```javascript

│   │   └── management.html   export const config = {

│   │     API: 'http://localhost:8000',  // Your backend URL

│   ├── labels/                # Labels module     DEBUG: true,                   // Enable debug logging

│   │   ├── generator.html   };

│   │   ├── history.html   ```

│   │   └── home.html

│   │4. **Open in Browser**

│   ├── sales-imports/         # Sales import module   ```

│   │   ├── history.html   http://localhost:3000

│   │   ├── home.html   ```

│   │   ├── uk-sales.html

│   │   └── upload.html5. **Login**

│   │   - Default credentials should be provided by your team lead

│   └── usermanagement/        # User management   - Or create a user through the backend API

│       └── home.html

│## Project Structure

└── js/                         # JavaScript modules

    ├── config.js              # Configuration```

    ├── index.js               # App initializationfrontend/

    ├── router.js              # SPA routing├── index.html                  # Main app shell

    ├── shell-ui.js            # App shell initialization├── manifest.webmanifest        # PWA manifest

    ├── debug.js               # Debug utilities│

    │├── components/                 # Reusable UI components

    ├── modules/               # Feature modules│   └── universal-sidebar.html  # Animated sidebar

    │   ├── attendance/│

    │   │   ├── index.js├── css/                        # Stylesheets

    │   │   ├── automaticClocking.js│   ├── app-shell.css          # Layout & sidebar

    │   │   ├── automaticReader.js│   ├── modern-ui.css          # Component styles

    │   │   ├── logs.js│   ├── connection-status.css  # Online/offline indicator

    │   │   ├── manualClocking.js│   ├── enrollment.css         # Enrollment-specific

    │   │   └── overview.js│   ├── inventory-table.css    # Inventory tables

    │   ││   └── usermanagement.css     # User management

    │   ├── auth/│

    │   │   ├── index.js├── html/                       # Page templates

    │   │   └── login.js│   ├── login.html             # Login page

    │   ││   ├── reports.html           # Reports dashboard

    │   ├── enrollment/│   │

    │   │   ├── index.js│   ├── attendance/            # Attendance module pages

    │   │   ├── card.js│   │   ├── automaticClocking.html

    │   │   ├── fingerprint.js│   │   ├── automaticReader.html

    │   │   └── management.js│   │   ├── logs.html

    │   ││   │   └── overview.html

    │   ├── inventory/│   │

    │   │   ├── index.js│   ├── enrollment/            # Enrollment module

    │   │   ├── adjustments.js│   │   ├── cardEnrollment.html

    │   │   └── management.js│   │   └── fingerprintEnrollment.html

    │   ││   │

    │   ├── labels/│   ├── inventory/             # Inventory module

    │   │   ├── index.js│   │   ├── adjustments.html

    │   │   ├── generator.js│   │   └── management.html

    │   │   ├── labelManagement.js│   │

    │   │   └── printHistory.js│   ├── labels/                # Labels module

    │   ││   │   ├── generator.html

    │   ├── sales-imports/│   │   └── printHistory.html

    │   │   ├── index.js│   │

    │   │   ├── history.js│   ├── sales-imports/         # Sales import module

    │   │   ├── ukSalesData.js│   │   ├── history.html

    │   │   └── upload.js│   │   └── upload.html

    │   ││   │

    │   └── usermanagement/│   └── usermanagement/        # User management

    │       ├── index.js│       ├── management.html

    │       └── management.js│       └── roles.html

    ││

    ├── services/              # Backend integration└── js/                         # JavaScript modules

    │   ├── api/              # API clients    ├── config.js              # Configuration

    │   │   ├── http.js      # HTTP client    ├── router.js              # SPA routing

    │   │   ├── authApi.js    ├── shell-ui.js            # App shell initialization

    │   │   ├── attendanceApi.js    ├── debug.js               # Debug utilities

    │   │   ├── enrollmentApi.js    │

    │   │   ├── labelsApi.js    ├── modules/               # Feature modules

    │   │   ├── rolesApi.js    │   ├── attendance/

    │   │   ├── salesImportsApi.js    │   │   ├── index.js

    │   │   └── usersApi.js    │   │   ├── automaticClocking.js

    │   │    │   │   ├── automaticReader.js

    │   └── state/            # State management    │   │   ├── logs.js

    │       ├── sessionStore.js    │   │   └── overview.js

    │       └── userStore.js    │   │

    │    │   ├── auth/

    ├── ui/                   # UI utilities    │   │   ├── index.js

    │   ├── components.js    # Reusable components    │   │   └── login.js

    │   ├── confirmationModal.js    │   │

    │   ├── dom.js          # DOM helpers    │   ├── enrollment/

    │   ├── modal.js        # Modal dialogs    │   │   ├── index.js

    │   └── toast.js        # Toast notifications    │   │   ├── cardEnrollment.js

    │    │   │   └── fingerprintEnrollment.js

    └── utils/               # Utilities    │   │

        ├── dropdown-system.js    │   ├── inventory/

        ├── formatters.js    │   │   ├── index.js

        ├── sidebar-fallback.js    │   │   ├── adjustments.js

        ├── tabs.js    │   │   └── management.js

        ├── universal-sidebar.js    │   │

        └── validators.js    │   ├── labels/

```    │   │   ├── index.js

    │   │   ├── generator.js

## Development Workflow    │   │   └── printHistory.js

    │   │

### Making Changes    │   ├── sales-imports/

    │   │   ├── index.js

1. **Edit Your Code**    │   │   ├── history.js

   - Make changes to HTML, CSS, or JavaScript files in the `frontend/` directory    │   │   └── upload.js

   - Test your changes for syntax errors    │   │

    │   └── usermanagement/

2. **Commit Your Changes**    │       ├── index.js

   ```bash    │       └── management.js

   git add .    │

   git commit -m "Description of your changes"    ├── services/              # Backend API services

   ```    │   └── api/

    │       ├── http.js        # HTTP client

3. **Push to GitHub**    │       ├── attendanceApi.js

   ```bash    │       ├── rolesApi.js

   git push origin main    │       └── usersApi.js

   ```    │

    ├── ui/                    # UI utilities

4. **Cloudflare Pages Auto-Deploys**    │   ├── components.js      # Reusable components

   - Cloudflare Pages detects the push to `main` branch    │   └── confirmationModal.js

   - Automatically deploys the `frontend/` directory    │

   - Deployment takes approximately 1-2 minutes    └── utils/                 # Shared utilities

        ├── universal-sidebar.js

5. **View Your Changes**        ├── dropdown-system.js

   - Frontend URL: `https://rm365-tools-testing.pages.dev`        ├── tabs.js

   - Changes are live immediately after deployment completes        └── sidebar-fallback.js

   - Hard refresh (`Ctrl+F5` or `Cmd+Shift+R`) to see updates```



### Monitoring Deployment## Core Concepts



**Cloudflare Pages Dashboard:**### 1. SPA Routing

1. Go to [Cloudflare Pages Dashboard](https://dash.cloudflare.com/)

2. Select your `rm365-tools-testing` projectThe router (`js/router.js`) handles navigation without page reloads:

3. View deployment status and logs

4. Check for successful deployment or errors```javascript

// Navigate to a page

**Deployment Status:**window.navigate('/attendance/overview');

- ✅ **Success**: Your changes are live

- ❌ **Failed**: Check logs for errors, fix code, and push again// Router automatically:

- 🔄 **Building**: Wait for deployment to complete (usually < 2 minutes)// 1. Loads HTML from /html/attendance/overview.html

// 2. Injects into #app container

### Testing Your Changes// 3. Initializes the module

// 4. Updates browser history

1. **After Deployment Completes**```

   - Open `https://rm365-tools-testing.pages.dev`

   - Hard refresh to bypass cache: `Ctrl+F5` (Windows) or `Cmd+Shift+R` (Mac)**How it works:**

- Links with `data-nav` attribute are intercepted

2. **Check Browser Console**- URL changes trigger router

   - Press `F12` to open Developer Tools- Module's `init()` function is called

   - Look for JavaScript errors in the Console tab- Old content is cleaned up

   - Check Network tab for failed API requests

### 2. Module Initialization

3. **Test Functionality**

   - Navigate through the appEach page module exports an `init()` function:

   - Test the features you changed

   - Verify API integration works correctly```javascript

// modules/myfeature/index.js

## Configurationexport function init() {

  console.log('MyFeature initialized');

### Backend API URL  

  // Set up event listeners

The backend API URL is configured in `index.html` and `js/config.js`:  document.getElementById('myButton').addEventListener('click', handleClick);

  

**Default Configuration** (in `index.html`):  // Fetch data

```javascript  loadData();

window.API = 'https://rm365-tools-testing-production.up.railway.app';}

```

function handleClick() {

This is automatically set to the Railway backend URL. No changes needed unless using a different backend.  // Handle button click

}

**Environment Variable Override**:

async function loadData() {

In Cloudflare Pages dashboard, you can set:  // Fetch from API

```}

API=https://rm365-tools-testing-production.up.railway.app```

```

### 3. Authentication

This overrides the default and allows different backends for different environments.

Authentication is handled via JWT tokens:

### Debug Mode

```javascript

Enable debug logging by adding `?debug=true` to any URL:// Login

```const response = await post('/api/v1/auth/login', { username, password });

https://rm365-tools-testing.pages.dev/?debug=truelocalStorage.setItem('authToken', response.token);

```localStorage.setItem('user', JSON.stringify(response.user));



This shows:// Make authenticated requests (automatic in http.js)

- API request/response detailsimport { get } from './services/api/http.js';

- Authentication flowconst data = await get('/api/v1/users');  // Token auto-attached

- Router navigation```

- State changes

### 4. State Management

## Routing System

State is managed with:

### Client-Side Routing- **LocalStorage**: Persistent data (auth token, user info, preferences)

- **Module-level variables**: Page-specific state

The app uses a custom router (`js/router.js`) for SPA navigation:- **DOM as state**: UI reflects current state



```javascript```javascript

// Route definition// Save preference

const routes = {localStorage.setItem('darkMode', 'true');

  '/attendance/overview': {

    html: 'html/attendance/overview.html',// Get preference

    js: 'js/modules/attendance/overview.js',const isDark = localStorage.getItem('darkMode') === 'true';

    title: 'Attendance Overview'```

  }

};### 5. Event Handling

```

Use event delegation for dynamic content:

### Navigation

```javascript

**Programmatic Navigation**:// Good: Event delegation

```javascriptdocument.addEventListener('click', (e) => {

import { router } from './router.js';  if (e.target.matches('.delete-btn')) {

    handleDelete(e.target.dataset.id);

router.navigate('/attendance/overview');  }

```});



**HTML Links**:// Avoid: Direct binding on dynamic elements

```htmldocument.querySelectorAll('.delete-btn').forEach(btn => {

<a href="#/attendance/overview">Attendance Overview</a>  btn.addEventListener('click', handleDelete);  // Won't work for new buttons

```});

```

### Adding New Routes

## Development Guide

1. **Create HTML Template**

   - Add file to `html/module-name/page.html`### Adding a New Page



2. **Create JavaScript Module**1. **Create HTML Template**

   - Add file to `js/modules/module-name/page.js`   ```bash

   - Export `init()` function   # Create file: html/myfeature/mypage.html

   ```

3. **Register Route** in `js/router.js`   ```html

   ```javascript   <div class="page-content">

   '/module/page': {     <h1>My Page</h1>

     html: 'html/module/page.html',     <div id="content"></div>

     js: 'js/modules/module/page.js',   </div>

     title: 'Page Title'   ```

   }

   ```2. **Create Module**

   ```bash

4. **Commit and Push**   # Create directory and files

   ```bash   mkdir -p js/modules/myfeature

   git add .   touch js/modules/myfeature/index.js

   git commit -m "Add new page route"   ```

   git push origin main

   ```   ```javascript

   // js/modules/myfeature/index.js

## UI Components   export function init() {

     console.log('MyFeature page loaded');

### Toast Notifications     loadContent();

   }

```javascript

import { showToast } from './ui/toast.js';   async function loadContent() {

     const container = document.getElementById('content');

showToast('Operation successful!', 'success');     container.innerHTML = '<p>Hello World!</p>';

showToast('An error occurred', 'error');   }

showToast('Warning message', 'warning');   ```

```

3. **Add to Router**

### Modal Dialogs   

   Edit `js/router.js` and add your route:

```javascript   ```javascript

import { showModal, hideModal } from './ui/modal.js';   const routes = {

     '/myfeature': {

showModal('modal-id', {       html: '/html/myfeature/mypage.html',

  title: 'Confirm Action',       module: 'myfeature',

  content: 'Are you sure?',       title: 'My Feature'

  onConfirm: () => {     }

    // Handle confirmation   };

    hideModal('modal-id');   ```

  }

});4. **Add to Sidebar**

```   

   Edit `components/universal-sidebar.html`:

### Confirmation Dialogs   ```html

   <li>

```javascript     <a href="/myfeature" class="sidebar-link" data-nav>

import { showConfirmation } from './ui/confirmationModal.js';       <span class="icon">🚀</span>

       <span class="label">My Feature</span>

const confirmed = await showConfirmation({     </a>

  title: 'Delete Item',   </li>

  message: 'Are you sure you want to delete this item?',   ```

  confirmText: 'Delete',

  cancelText: 'Cancel'5. **Test**

});   - Open browser

   - Click sidebar link

if (confirmed) {   - Verify page loads

  // Proceed with deletion

}### Making API Calls

```

Create API service file:

### Loading Indicators

```javascript

```javascript// js/services/api/myFeatureApi.js

// Show loading stateimport { get, post, patch, del } from './http.js';

document.getElementById('btn').disabled = true;

document.getElementById('btn').textContent = 'Loading...';const API = '/api/v1/myfeature';



// After operationexport const getItems = () => get(API);

document.getElementById('btn').disabled = false;

document.getElementById('btn').textContent = 'Submit';export const createItem = (data) => post(API, data);

```

export const updateItem = (id, data) => patch(`${API}/${id}`, data);

## API Integration

export const deleteItem = (id) => del(`${API}/${id}`);

### HTTP Client```



All API calls go through `services/api/http.js`:Use in module:



```javascript```javascript

import { apiClient } from './services/api/http.js';// js/modules/myfeature/index.js

import { getItems, createItem } from '../../services/api/myFeatureApi.js';

// GET request

const users = await apiClient.get('/users');export function init() {

  loadItems();

// POST request  setupEventListeners();

const newUser = await apiClient.post('/users', {}

  username: 'john',

  email: 'john@example.com'async function loadItems() {

});  try {

    const items = await getItems();

// PATCH request    renderItems(items);

await apiClient.patch('/users/1', { email: 'newemail@example.com' });  } catch (error) {

    console.error('Failed to load items:', error);

// DELETE request    showError('Failed to load data');

await apiClient.delete('/users/1');  }

```}



### API Service Modulesfunction setupEventListeners() {

  document.getElementById('createBtn').addEventListener('click', async () => {

Use dedicated API service modules for better organization:    const name = document.getElementById('nameInput').value;

    await createItem({ name });

```javascript    loadItems();  // Reload

// services/api/usersApi.js  });

import { apiClient } from './http.js';}

```

export const usersApi = {

  getAll: () => apiClient.get('/users'),### Error Handling

  getById: (id) => apiClient.get(`/users/${id}`),

  create: (data) => apiClient.post('/users', data),Always handle errors gracefully:

  update: (id, data) => apiClient.patch(`/users/${id}`, data),

  delete: (id) => apiClient.delete(`/users/${id}`)```javascript

};async function fetchData() {

```  try {

    const data = await get('/api/v1/data');

### Authentication    return data;

  } catch (error) {

**Login**:    console.error('Error fetching data:', error);

```javascript    

import { authApi } from './services/api/authApi.js';    // Show user-friendly message

import { sessionStore } from './services/state/sessionStore.js';    showNotification('Failed to load data. Please try again.', 'error');

    

const response = await authApi.login(username, password);    // Return fallback

sessionStore.setToken(response.access_token);    return [];

sessionStore.setUser(response.user);  }

```}

```

**Protected Requests**:

### Loading States

The HTTP client automatically includes the JWT token in requests:

```javascriptShow loading indicators:

// Token is automatically added to Authorization header

const data = await apiClient.get('/protected-endpoint');```javascript

```async function loadData() {

  const container = document.getElementById('content');

**Logout**:  

```javascript  // Show loading

import { sessionStore } from './services/state/sessionStore.js';  container.innerHTML = '<div class="loading">Loading...</div>';

  

sessionStore.clearSession();  try {

router.navigate('/login');    const data = await fetchData();

```    container.innerHTML = renderData(data);

  } catch (error) {

## Creating New Features    container.innerHTML = '<div class="error">Failed to load</div>';

  }

### Adding a New Module}

```

1. **Create HTML Template** (`html/mymodule/mypage.html`)

   ```html## UI Components

   <div class="page-container">

     <h1>My Page</h1>### Sidebar

     <div id="content"></div>

   </div>The universal sidebar is automatically loaded on all pages (except login).

   ```

**Features:**

2. **Create JavaScript Module** (`js/modules/mymodule/mypage.js`)- Animated expansion on hover

   ```javascript- Dark mode toggle

   import { apiClient } from '../../services/api/http.js';- Search functionality

   import { showToast } from '../../ui/toast.js';- Role-based visibility



   export async function init() {**Customization:**

     console.log('My page initialized');Edit `components/universal-sidebar.html` to add/remove navigation items.

     await loadData();

   }### Confirmation Modal



   async function loadData() {Use for destructive actions:

     try {

       const data = await apiClient.get('/myendpoint');```javascript

       renderData(data);import { showConfirmation } from '../ui/confirmationModal.js';

     } catch (error) {

       showToast('Failed to load data', 'error');async function handleDelete(id) {

     }  const confirmed = await showConfirmation({

   }    title: 'Delete Item',

    message: 'Are you sure you want to delete this item?',

   function renderData(data) {    confirmText: 'Delete',

     const content = document.getElementById('content');    type: 'danger'

     content.innerHTML = data.map(item =>   });

       `<div>${item.name}</div>`  

     ).join('');  if (confirmed) {

   }    await deleteItem(id);

   ```    reloadList();

  }

3. **Add Route** in `js/router.js`}

   ```javascript```

   '/mymodule/mypage': {

     html: 'html/mymodule/mypage.html',### Custom Dropdowns

     js: 'js/modules/mymodule/mypage.js',

     title: 'My Page'Enhanced select elements:

   }

   ``````javascript

import { initializeDropdowns } from '../utils/dropdown-system.js';

4. **Add Navigation** (update sidebar or menu)

   ```html// Initialize after DOM is ready

   <a href="#/mymodule/mypage">My Page</a>initializeDropdowns();

   ``````



5. **Commit and Push**```html

   ```bash<select class="c-select">

   git add .  <option value="1">Option 1</option>

   git commit -m "Add my new feature"  <option value="2">Option 2</option>

   git push origin main</select>

   ``````



6. **Wait for Deployment**### Tabs

   - Cloudflare Pages will deploy automatically

   - Check deployment status in Cloudflare dashboardDynamic tab system:

   - View your changes at `https://rm365-tools-testing.pages.dev`

```javascript

## Stylingimport { setupTabs } from '../utils/tabs.js';



### CSS OrganizationsetupTabs();

```

- **app-shell.css**: Layout, sidebar, navigation

- **modern-ui.css**: Buttons, forms, cards, general components```html

- **module-specific.css**: Styles specific to a module<div class="tabs">

  <button class="tab-btn active" data-tab="tab1">Tab 1</button>

### CSS Variables  <button class="tab-btn" data-tab="tab2">Tab 2</button>

</div>

Use CSS variables for theming:

```css<div class="tab-content active" id="tab1">Content 1</div>

:root {<div class="tab-content" id="tab2">Content 2</div>

  --primary-color: #4F46E5;```

  --secondary-color: #10B981;

  --background: #F9FAFB;## API Integration

  --text-color: #111827;

}### HTTP Client

```

The HTTP client (`services/api/http.js`) handles all requests:

### Responsive Design

```javascript

Mobile-first approach:import { get, post, patch, del } from './services/api/http.js';

```css

/* Mobile styles (default) */// GET request

.container {const users = await get('/api/v1/users');

  padding: 1rem;

}// POST request

const newUser = await post('/api/v1/users', {

/* Tablet and up */  username: 'john',

@media (min-width: 768px) {  password: 'secret'

  .container {});

    padding: 2rem;

  }// PATCH request

}await patch('/api/v1/users', {

  username: 'john',

/* Desktop */  new_password: 'newsecret'

@media (min-width: 1024px) {});

  .container {

    padding: 3rem;// DELETE request

  }await del('/api/v1/users?username=john');

}```

```

**Features:**

## Troubleshooting- Automatic token attachment

- Error handling

### Deployment Failed- JSON serialization

- Base URL configuration

1. **Check Cloudflare Logs**

   - View build logs in Cloudflare Pages dashboard### Handling Responses

   - Look for error messages

```javascript

2. **Common Issues**try {

   - Syntax errors in JavaScript  const response = await get('/api/v1/data');

   - Missing files or broken paths  

   - Invalid HTML/CSS  // Response is automatically parsed JSON

  console.log(response);

3. **Fix and Redeploy**  

   - Fix the issue in your code} catch (error) {

   - Commit and push again  // Errors include status code and message

   - Cloudflare will automatically retry  console.error(`${error.status}: ${error.message}`);

  

### Changes Not Showing  if (error.status === 401) {

    // Unauthorized - redirect to login

1. **Hard Refresh**    window.navigate('/login');

   - Windows: `Ctrl + F5`  } else if (error.status === 403) {

   - Mac: `Cmd + Shift + R`    // Forbidden

   - Or clear browser cache    showError('You don\'t have permission');

  } else {

2. **Check Deployment Status**    // Other errors

   - Verify deployment completed in Cloudflare dashboard    showError('Something went wrong');

   - Wait for deployment to finish (usually < 2 minutes)  }

}

3. **Browser Console Errors**```

   - Press `F12` to open Developer Tools

   - Check Console tab for JavaScript errors## Styling

   - Check Network tab for failed requests

### CSS Architecture

### API Errors

1. **app-shell.css**: Layout, sidebar, navigation

1. **Check Backend URL**2. **modern-ui.css**: Buttons, forms, tables, cards

   - Verify `window.API` points to correct backend3. **Feature-specific CSS**: Module-specific styles

   - Check in browser console: `console.log(window.API)`

### CSS Variables

2. **CORS Issues**

   - Ensure backend has Cloudflare Pages domain in CORS settingsUse CSS variables for theming:

   - Check browser console for CORS errors

```css

3. **Authentication Errors**:root {

   - Check if token is valid  --primary-color: #007bff;

   - Try logging out and logging in again  --secondary-color: #6c757d;

   - Check token expiration  --bg-color: #ffffff;

  --text-color: #333333;

## Best Practices}



### Code Quality.dark-mode {

- Use meaningful variable and function names  --bg-color: #1a1a1a;

- Add comments for complex logic  --text-color: #ffffff;

- Keep functions small and focused}

- Use ES6+ features (async/await, arrow functions, etc.)```



### Git Workflow### Dark Mode

- Write clear commit messages

- Test changes before pushingDark mode is handled automatically by the sidebar. To add dark mode support to your styles:

- Keep commits focused on one feature/fix

- Push to `main` branch for deployment```css

/* Light mode (default) */

### Performance.my-component {

- Minimize DOM manipulations  background: var(--bg-color);

- Use event delegation for dynamic content  color: var(--text-color);

- Lazy load modules when needed}

- Optimize images and assets

/* Dark mode (automatically applied when .dark-mode on <html>) */

### Security.dark-mode .my-component {

- Never commit API keys or sensitive data  /* Override if needed */

- Validate user input on client and server}

- Use HTTPS for all requests```

- Store JWT tokens securely

### Responsive Design

## Getting Help

Use mobile-first approach:

- **Live Site**: https://rm365-tools-testing.pages.dev

- **API Docs**: https://rm365-tools-testing-production.up.railway.app/api/docs```css

- **Cloudflare Dashboard**: Check deployment logs and status/* Mobile first (default) */

- **Team Lead**: Contact for access or configuration issues.container {

  padding: 10px;

---}



**Frontend URL**: https://rm365-tools-testing.pages.dev/* Tablet and up */

@media (min-width: 768px) {

**Backend API**: https://rm365-tools-testing-production.up.railway.app  .container {

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
   API=https://rm365-tools-testing-production.up.railway.app
   ```

3. **Build Settings**
   - Build command: (none)
   - Build output directory: `frontend`
   - Root directory: `/`

4. **Deploy**
   - Push to `main` branch
   - Cloudflare auto-deploys
   - Live at `https://rm365-tools-testing.pages.dev`

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
