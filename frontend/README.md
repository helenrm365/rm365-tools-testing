# RM365 Toolbox - Frontend

Modern vanilla JavaScript frontend for RM365 Toolbox with SPA routing, real-time collaboration, and responsive design.

## Features

- **Framework-free**: Pure vanilla JavaScript ES6+
- **SPA Routing**: Client-side navigation with hash routing
- **Real-time Updates**: WebSocket integration via Socket.IO
- **Responsive Design**: Mobile-first approach
- **Dark Mode**: System preference detection with manual toggle
- **PWA Ready**: Service worker and manifest included
- **Modular Architecture**: Feature-based organization
- **API Integration**: Centralized HTTP client with error handling

## Tech Stack

- **JavaScript**: ES6+ modules
- **HTML5**: Semantic markup
- **CSS3**: Custom properties, Grid, Flexbox
- **Socket.IO Client**: Real-time WebSocket communication
- **Deployment**: Served by backend (self-hosted)

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
│   services/websocket.js (Real-time Connection)  │
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

## Project Structure

```
frontend/
├── index.html                  # Main app shell
├── manifest.webmanifest        # PWA manifest
│
├── components/                 # Reusable UI components
│   ├── universal-sidebar.html  # Animated sidebar
│   └── universal-footer.html   # Footer component
│
├── css/                        # Stylesheets
│   ├── app-shell.css          # Layout & sidebar
│   ├── modern-ui.css          # Component styles
│   ├── connection-status.css  # Online/offline indicator
│   ├── module-home-pages.css  # Module home page styles
│   └── [feature]/             # Feature-specific styles
│
├── html/                       # Page templates
│   ├── login.html             # Login page
│   ├── home.html              # Dashboard
│   ├── reports.html           # Reports
│   └── [feature]/             # Feature pages
│
└── js/                         # JavaScript
    ├── index.js               # Application entry point
    ├── router.js              # SPA router
    ├── config.js              # Configuration
    ├── shell-ui.js            # UI shell (sidebar, etc)
    │
    ├── modules/               # Feature modules
    │   ├── attendance/        # Attendance management
    │   ├── enrollment/        # Student enrollment
    │   ├── inventory/         # Inventory management
    │   ├── labels/            # Label generation
    │   ├── salesdata/         # Sales analytics
    │   └── users/             # User management
    │
    ├── services/              # Shared services
    │   ├── api/              # API client
    │   │   ├── http.js       # HTTP wrapper
    │   │   ├── attendance.js # Attendance API
    │   │   ├── inventory.js  # Inventory API
    │   │   └── labels.js     # Labels API
    │   ├── websocket.js      # WebSocket client
    │   └── hardware.js       # Hardware bridge
    │
    ├── ui/                    # UI utilities
    │   ├── modals.js         # Modal dialogs
    │   └── notifications.js  # Toast notifications
    │
    └── utils/                 # Utilities
        ├── date.js           # Date formatting
        ├── dropdown-system.js # Dropdown components
        ├── tabs.js           # Tab system
        └── validation.js     # Form validation
```

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Python 3.x installed
- Backend API running (see backend README)

### Quick Start

The frontend is served directly by the backend server. Use the platform-specific startup scripts:

**Windows:**
```bash
cd start-windows
start.bat
```

**macOS:**
```bash
cd start-macos
chmod +x start.command  # First time only
./start.command
```

**What happens:**
- Backend starts on port 8000
- Frontend is served from `/frontend` directory
- Both frontend and API available at `http://localhost:8000`
- API endpoints at `http://localhost:8000/api/*`
- Auto-restart on code changes

**Access the Application:**
```
http://localhost:8000
```

**Login:**
- Default credentials in backend README
- Or use your created user account

### Alternative: Standalone Frontend (Development Only)

For frontend-only development:

```bash
cd frontend

# Option 1: Python HTTP Server
python -m http.server 3000

# Option 2: Node.js serve
npx serve . -p 3000
```

Then the frontend will automatically point to `http://127.0.0.1:8000` for API calls.

**Note**: The `frontend/js/config.js` file auto-detects the API URL. No manual configuration needed.

## Development

### Adding a New Page

1. **Create HTML Template** (`html/mymodule/mypage.html`)
   ```html
   <div class="module-container">
     <h1>My Page</h1>
     <div id="content"></div>
   </div>
   ```

2. **Create Module** (`js/modules/mymodule/mypage.js`)
   ```javascript
   export function init() {
     console.log('My page initialized');
     loadData();
   }

   async function loadData() {
     const data = await get('/api/v1/myendpoint');
     render(data);
   }

   function render(data) {
     const container = document.getElementById('content');
     container.innerHTML = `<p>${data.message}</p>`;
   }
   ```

3. **Add Route** (`js/router.js`)
   ```javascript
   {
     path: '/mymodule/mypage',
     html: 'html/mymodule/mypage.html',
     js: 'js/modules/mymodule/mypage.js',
     title: 'My Page'
   }
   ```

4. **Add Navigation** (update sidebar or menu)
   ```html
   <a href="#/mymodule/mypage">My Page</a>
   ```

5. **Test**
   - Save all files
   - Refresh browser
   - Navigate to page via sidebar or URL

### API Integration

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
- Error handling with status codes
- JSON serialization
- Base URL configuration

**Handling Responses:**
```javascript
try {
  const response = await get('/api/v1/data');
  console.log(response);  // Automatically parsed JSON
} catch (error) {
  console.error(`${error.status}: ${error.message}`);
  
  if (error.status === 401) {
    window.navigate('/login');  // Unauthorized
  } else if (error.status === 403) {
    showError('Permission denied');
  } else {
    showError('Something went wrong');
  }
}
```

### Real-time Collaboration

WebSocket integration for live updates:

```javascript
import { socket, emit } from './services/websocket.js';

// Listen for events
socket.on('inventory:item_updated', (data) => {
  console.log('Item updated:', data);
  refreshTable();
});

// Emit events
emit('inventory:editing', { 
  item_id: 123, 
  user: currentUser 
});
```

**Available Events:**
- `inventory:item_updated` - Item changed
- `inventory:item_created` - New item added
- `inventory:item_deleted` - Item removed
- `inventory:editing` - User editing item
- `inventory:stopped_editing` - User stopped editing

### Hardware Integration

Connect to local hardware bridge:

```javascript
import { getFingerprint, readRFID } from './services/hardware.js';

// Read fingerprint
try {
  const fingerprint = await getFingerprint();
  console.log('Fingerprint captured:', fingerprint);
} catch (error) {
  showError('Fingerprint reader not connected');
}

// Read RFID card
const cardNumber = await readRFID();
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
  --primary-color: #4F46E5;
  --secondary-color: #10B981;
  --background: #F9FAFB;
  --text-color: #111827;
  --border-color: #E5E7EB;
}

.dark-mode {
  --background: #1F2937;
  --text-color: #F9FAFB;
  --border-color: #374151;
}
```

### Responsive Design

Mobile-first approach:

```css
/* Mobile styles (default) */
.container {
  padding: 1rem;
}

/* Tablet and up */
@media (min-width: 768px) {
  .container {
    padding: 2rem;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .container {
    padding: 3rem;
    max-width: 1200px;
  }
}
```

## UI Components

### Modals

```javascript
import { showModal, closeModal } from '../ui/modals.js';

showModal({
  title: 'Confirm Delete',
  content: 'Are you sure you want to delete this item?',
  buttons: [
    { text: 'Cancel', class: 'btn-secondary' },
    { text: 'Delete', class: 'btn-danger', onClick: handleDelete }
  ]
});
```

### Notifications

```javascript
import { showSuccess, showError, showInfo } from '../ui/notifications.js';

showSuccess('Item saved successfully');
showError('Failed to save item');
showInfo('Processing your request...');
```

### Dropdowns

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

## Common Tasks

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
      body: formData
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

## Testing

### Debug Mode

Enable debug mode for detailed logging:

```
http://localhost:3000/?debug=true
```

Shows:
- API requests/responses
- Router navigation
- Authentication flow
- Module initialization
- Error stack traces

### Browser Console Testing

```javascript
// Test functions directly
window.navigate('/attendance/overview');

// Check authentication state
console.log(localStorage.getItem('authToken'));
console.log(localStorage.getItem('user'));

// Test API calls
import { get } from '/js/services/api/http.js';
get('/api/v1/users').then(console.log);
```

### Using DevTools

**Console Tab:**
- View logs and errors
- Test functions interactively
- Check variables

**Network Tab:**
- See all API requests
- Check request/response
- Verify status codes

**Elements Tab:**
- Inspect HTML structure
- View computed CSS
- Test CSS changes live

**Application Tab:**
- View LocalStorage
- Check session storage
- Inspect cookies

## Deployment

### Self-Hosted with Backend

The frontend is served directly by the FastAPI backend:

**How it works:**
- Backend serves frontend files from `/frontend` directory
- FastAPI's `StaticFiles` mounts frontend at root `/`
- API endpoints are at `/api/*`
- Single server for both frontend and backend
- Runs on port 8000
- Exposed via Cloudflare Tunnel to custom domain

**Platform-Specific Startup:**

**Windows:**
```bash
cd start-windows
start.bat
```

**macOS:**
```bash
cd start-macos
chmod +x start.command  # First time only
./start.command
```

**Deployment Workflow:**

1. **Make Changes**
   - Edit files in `frontend/` directory
   - Test locally at `http://localhost:8000`

2. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Update frontend feature"
   git push origin main
   ```

3. **Automatic Deployment**
   - Platform-specific startup script monitors GitHub (every 5 seconds)
   - Detects changes in frontend files
   - Pulls updates automatically
   - Restarts server (~5-10 seconds)

4. **Access Application**
   - Frontend served at your custom domain (via Cloudflare Tunnel)
   - Or locally at `http://localhost:8000` during development
   - Changes apply immediately after restart
   - No separate CDN or frontend hosting needed

**No Build Process:**
- Pure vanilla JavaScript (no compilation)
- Static files served directly
- Hot reload during development (when using auto-restart)
- Shared virtual environment (`.venv`) at repository root

## Troubleshooting

### Changes Not Showing

1. **Hard Refresh**
   - Windows: `Ctrl + F5`
   - Mac: `Cmd + Shift + R`

2. **Check Server Restart**
   - Look at startup script console (`start.bat` on Windows, `start.command` on macOS)
   - Verify "CHANGES PULLED SUCCESSFULLY"
   - Confirm "RESTARTING SERVER WITH NEW CHANGES"

3. **Clear Browser Cache**
   - Or use incognito/private mode

4. **Check File Saved**
   - Verify file was committed to GitHub
   - Check git status: `git status`
   - Push if needed: `git push origin main`

5. **Verify Startup Script Running**
   - **Windows**: Check if `start-windows/start.bat` is running
   - **macOS**: Check if `start-macos/start.command` is running
   - Look for GitHub fetch activity every 5 seconds

### API Errors

1. **Check Backend URL**
   - Frontend uses same domain as backend
   - API is at `/api/*` endpoints
   - Check in console: `console.log(window.API)`

2. **Server Not Running**
   - Ensure platform-specific startup script is running:
     - **Windows**: `start-windows/start.bat`
     - **macOS**: `start-macos/start.command`
   - Check for errors in console
   - Verify backend started successfully on port 8000

3. **Authentication Errors**
   - Check if token is valid
   - Try logging out and logging in again
   - Check token expiration

### Page Not Loading

1. **Check Browser Console**
   - Press `F12` to open DevTools
   - Look for JavaScript errors
   - Check Network tab for failed requests

2. **Verify Route**
   - Check route is defined in `router.js`
   - Verify HTML file exists
   - Check module exports `init()` function

3. **Check File Paths**
   - Verify all imports use correct paths
   - Check for typos in file names
   - Ensure case matches (case-sensitive on Linux)

### Styles Not Applying

1. **Check CSS File**
   - Verify CSS file is linked in HTML
   - Check for syntax errors in CSS
   - Use DevTools to inspect computed styles

2. **Verify Class Names**
   - Check class names match between HTML and CSS
   - Look for typos
   - Ensure specificity is correct

3. **Check Dark Mode**
   - Dark mode may override styles
   - Check both light and dark mode versions

## Best Practices

### Code Style

- Use `const` by default, `let` when needed, never `var`
- Use async/await instead of raw promises
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
- Use event delegation for dynamic content
- Lazy load modules when needed
- Debounce input handlers
- Cache API responses when appropriate

### Security

- Always validate user input
- Sanitize content before rendering
- Don't store sensitive data in localStorage
- Use HTTPS in production
- Implement CSRF protection for forms

## Resources

- **API Docs**: http://localhost:8000/api/docs
- **Backend README**: ../backend/README.md
- **Main README**: ../README.md
- **Startup Guide**: ../START-README.md
- **Hardware Bridge**: ../local-hardware-bridge/ directory

---

**Backend API**: http://localhost:8000

**Frontend**: http://localhost:8000 (served by backend)

**Startup Scripts**:
- Windows: `start-windows/start.bat`
- macOS: `start-macos/start.command`
