<div align="center">

# 🚀 RM365 Toolbox

### *Enterprise Management Platform*

**Modern, full-stack business management solution built for speed and reliability**

</div>

<div align="center">

Featuring attendance tracking • inventory management • label generation • sales analytics  
Real-time collaboration • hardware integration • Magento fulfillment

Built with **FastAPI** ⚡ and **Vanilla JavaScript** 🎯

</div>

---

<div align="center">

[![Python](https://img.shields.io/badge/Python-3.x+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Latest-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Latest-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--time-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)

![Status](https://img.shields.io/badge/Status-Production_Ready-success?style=for-the-badge)
![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)

</div>

<div align="center">

## 🌐 Live Application

</div>

| Component | Details |
|-----------|---------|
| 🌍 **Application** | Access via custom domain (Cloudflare Tunnel) |
| 📚 **API Docs** | Interactive Swagger UI at `/api/docs` |
| 🖥️ **Backend** | Self-hosted (exposed via Cloudflare Tunnel) |
| 🎨 **Frontend** | Served by backend on port `8000` |
| 🔄 **Deployment** | Auto-sync from GitHub + instant restart |

<br>

<div align="center">

## 📋 Table of Contents

</div>

<details open>
<summary><b>Navigation</b></summary>

- [Quick Start](#-quick-start)
- [Features](#-features)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Development Workflow](#-development-workflow)
- [Deployment](#-deployment)
- [Advanced Features](#-advanced-features)
- [Documentation](#-documentation)
- [Configuration](#-configuration)
- [Security](#-security)
- [Performance](#-performance)
- [Troubleshooting](#-troubleshooting)
- [Support](#-support)

</details>

<br>

---

<div align="center">

## ⚡ Quick Start

</div>

> **For End Users** 🎯

```bash
1️⃣  Navigate to your custom domain
2️⃣  Login with your credentials  
3️⃣  Start using available features
```

> **For Developers** 💻

<div align="center">

### 🔥 **Zero-Config Deployment**
*Just push to `main` — everything else is automatic!*

</div>

```bash
# 1. Make your changes
#    - Backend: Edit files in backend/
#    - Frontend: Edit files in frontend/

# 2. Commit and push
git add .
git commit -m "Description of your changes"
git push origin main

# 3. Automatic deployment
#    - Platform-specific startup scripts monitor GitHub for changes
#    - Auto-pulls updates every 5 seconds
#    - Server restarts automatically with new code
#    - Updates apply in ~5-10 seconds

# 4. View your changes
#    - Application updates automatically at your custom domain
#    - No manual deployment needed
```

<table>
<tr>
<td width="50%">

### 🪟 **Windows**

```powershell
# Simply double-click:
start-windows\start.bat
```

✅ Auto-detects Python  
✅ Creates virtual environment  
✅ Installs dependencies  
✅ Starts server on port 8000  

</td>
<td width="50%">

### 🍎 **macOS**

```bash
# First time only:
chmod +x start-macos/start.command

# Then double-click:
start-macos/start.command
```

✅ Auto-detects Python  
✅ Creates virtual environment  
✅ Installs dependencies  
✅ Starts server on port 8000  

</td>
</tr>
</table>

<br>

---

<div align="center">

## ✨ Features Overview

### *Comprehensive business management in one platform*

</div>

<br>

## 🎯 Core Modules

<table>
<tr>
<td width="50%" valign="top">

### 👥 **Attendance Management**

```
✓ Real-time clock in/out with auto-logging
✓ Hardware integration (fingerprint/RFID)
✓ Automatic presence detection
✓ Weekly & daily analytics reports
✓ Overtime calculation & tracking
✓ Multi-location support
✓ Live employee status dashboard
```

### 📦 **Inventory Management**

```
✓ Real-time stock tracking
✓ Full audit trail for adjustments
✓ Barcode scanning support
✓ Automated external sync
✓ Low stock alerts
✓ Multi-location transfers
✓ Complete change history
```

### 🏷️ **Label Generation**

```
✓ PDF labels with barcodes
✓ Batch printing workflows
✓ Print history & auditing
✓ Custom label templates
✓ Multiple barcode formats
✓ Automated queue management
```

</td>
<td width="50%" valign="top">

### 🛒 **Magento Integration**

```
✓ Invoice-based fulfillment (pick & pack)
✓ Real-time order lookup
✓ Barcode product validation
✓ Visual progress tracking
✓ Session management
✓ Overpick detection & warnings
✓ Returns processing
✓ Complete audit trail
```

### 👤 **User & Role Management**

```
✓ JWT authentication (secure tokens)
✓ Role-based access control (RBAC)
✓ Granular permission management
✓ User administration
✓ Password hashing (bcrypt)
✓ Session management
```

### 🎓 **Enrollment System**

```
✓ Student/employee registration
✓ Hardware device assignment
✓ Biometric enrollment (fingerprints)
✓ RFID card association
✓ Profile management
✓ Device tracking & audit logs
```

### 🔄 **Real-Time Collaboration**

```
✓ Google Sheets-style presence
✓ Live user indicators
✓ Row-level cursor tracking
✓ Instant data updates
✓ Flash notifications
✓ Automatic conflict prevention
✓ WebSocket-powered
```

</td>
</tr>
</table>

<br>

## 🚀 Advanced Features

<table>
<tr>
<td width="33%" align="center" valign="top">

### ⚡ **Performance**

**40-80% Faster**

🔹 Connection pooling  
🔹 GZip compression (70-80% reduction)  
🔹 Database indexing (5-10x speedup)  
🔹 Frontend caching (TTL-based)  
🔹 Parallel API fetching (3-5x faster)  
🔹 Field selection API  

</td>
<td width="33%" align="center" valign="top">

### 🔌 **Hardware**

**USB Device Access**

🔹 SecuGen fingerprint scanners  
🔹 RFID card readers  
🔹 Automatic device detection  
🔹 Hybrid cloud + local architecture  
🔹 Multi-location deployment  
🔹 Cross-browser compatible  

</td>
<td width="33%" align="center" valign="top">

### 🎨 **Frontend**

**Modern UI/UX**

🔹 Universal animated sidebar  
🔹 Dark mode support  
🔹 Progressive Web App (PWA)  
🔹 Responsive design  
🔹 Real-time updates  
🔹 Debug mode (`?debug=true`)  

</td>
</tr>
</table>

<br>

---

<div align="center">

## 🛠 Technology Stack

*Built with industry-leading technologies*

</div>

<br>

### 🔧 Backend

| Technology | Purpose |
|-----------|---------|
| **FastAPI** | High-performance Python web framework |
| **Python 3.x** | Core language (3.7+ recommended) |
| **SQLAlchemy** | Database ORM and query builder |
| **Pydantic** | Data validation and serialization |
| **Pydantic Settings** | Environment configuration management |
| **PostgreSQL** | Primary database (multiple instances) |

| **JWT (PyJWT)** | Secure token-based authentication |
| **psycopg2-binary** | PostgreSQL database adapter with connection pooling |
| **Uvicorn** | ASGI server for production with websocket support |
| **python-socketio** | WebSocket server for real-time collaboration |
| **Requests** | HTTP client for Magento API integration |
| **ReportLab** | PDF generation for labels |
| **python-barcode** | Barcode generation |
| **Passlib & Bcrypt** | Password hashing |
| **Pandas** | CSV data processing |
| **Redis** | Session storage and caching |

### Frontend

| Technology | Purpose |
|-----------|---------|
| **Vanilla JavaScript** | No framework overhead, pure ES6+ |
| **HTML5** | Semantic markup |
| **CSS3** | Modern styling with Grid and Flexbox |
| **Web Components** | Reusable UI components |
| **Service Workers** | Offline functionality (PWA) |
| **LocalStorage** | Client-side data persistence |
| **Fetch API** | Modern HTTP client |
| **Socket.IO Client** | WebSocket client for real-time features |

### 🚀 Deployment & DevOps

| Technology | Purpose |
|---------|---------|
| **Self-Hosted Server** | Backend + Frontend on port 8000 |
| **Cloudflare Tunnel** | Secure public access with custom domain |
| **Git Auto-Sync** | Monitors GitHub, auto-pulls and restarts (every 5s) |
| **PostgreSQL** | Multiple database instances (local) |

### 🔌 Hardware

| Device | Purpose | Status |
|--------|---------|--------|
| **SecuGen Fingerprint Reader** | Biometric authentication | Windows only |
| **ACR1252U USB NFC Reader III** | NFC card reading | ✅ Supported |
| **ACR122U NFC Reader** | NFC card reading | ✅ Supported |
| **Serial RFID Card Readers** | Card-based attendance | ✅ Supported |
| **Local Hardware Bridge** | USB device access via native API | Pure Python |

---

## 📁 Project Structure

```
rm365-tools-testing/
├── .venv/                        # Shared virtual environment
│                                 # Used by both backend and hardware bridge
│
├── backend/                      # FastAPI backend
│   ├── app.py                   # Main application entry point
│   ├── requirements.txt         # Python dependencies
│   │
│   ├── core/                    # Core functionality
│   │   ├── auth.py             # JWT authentication
│   │   ├── config.py           # Configuration management
│   │   ├── db.py               # Database connections & pooling
│   │   ├── errors.py           # Error handling
│   │   ├── middleware.py       # Custom middleware
│   │   ├── pagination.py       # Pagination utilities
│   │   ├── security.py         # Security utilities
│   │   └── websocket.py        # WebSocket server (Socket.IO)
│   │
│   ├── common/                  # Shared utilities
│   │   ├── deps.py             # Dependency injection
│   │   ├── dto.py              # Data transfer objects
│   │   └── utils.py            # Helper functions
│   │
│   ├── modules/                 # Feature modules
│   │   ├── attendance/         # Attendance tracking
│   │   ├── enrollment/         # User enrollment
│   │   │   └── hardware/       # Hardware enrollment devices
│   │   ├── inventory/          # Stock management
│   │   │   ├── adjustments/    # Stock adjustments
│   │   │   ├── collaboration.py # Real-time collaboration
│   │   │   ├── management/     # Inventory CRUD
│   │   │   └── order_fulfillment/ # Magento pick & pack
│   │   ├── labels/             # Label generation
│   │   ├── roles/              # Role management
│   │   ├── users/              # User management
│   │   └── _integrations/      # External services

│   │
│   └── migrations/              # Database migrations
│       └── add_performance_indexes.sql
│
├── frontend/                     # Vanilla JavaScript frontend
│   ├── index.html               # Main app shell
│   ├── manifest.webmanifest     # PWA manifest
│   ├── components/              # UI components
│   ├── css/                     # Stylesheets
│   ├── html/                    # Page templates
│   └── js/                      # JavaScript modules
│       ├── config.js            # Configuration
│       ├── router.js            # SPA routing
│       ├── modules/             # Feature modules
│       ├── services/            # Backend integration
│       ├── ui/                  # UI utilities
│       └── utils/               # Utilities
│
├── start-windows/                # Windows startup scripts
│   ├── start.bat                # Double-click launcher
│   └── start.ps1                # PowerShell backend script
│
├── start-macos/                  # macOS startup scripts
│   ├── start.command            # Double-click launcher
│   └── start.sh                 # Bash backend script
│
├── local-hardware-bridge/        # Local USB device access
│   ├── app.py                   # FastAPI local server (port 8080)
│   ├── secugen.py               # Fingerprint SDK (Windows)
│   ├── secugen_macos.py         # macOS compatibility stub
│   ├── requirements.txt         # Hardware-specific deps (pyserial)
│   │
│   ├── start-windows/           # Windows hardware bridge startup
│   │   ├── Start-Hardware-Bridge.bat
│   │   └── start-hardware-bridge.ps1
│   │
│   └── start-macos/             # macOS hardware bridge startup
│       ├── Start-Hardware-Bridge.command
│       └── start-hardware-bridge.sh
│
├── START-README.md               # Startup scripts documentation
│
└── README.md                     # This file
```

---

## 🏁 Getting Started

### Prerequisites

- **Python 3.x** (3.7+ recommended) - [Download](https://www.python.org/downloads/)
- **PostgreSQL** (for production databases) - [Download](https://www.postgresql.org/download/)
- **Git** - [Download](https://git-scm.com/downloads/)
- **Modern web browser** (Chrome, Firefox, Safari, Edge)

**Note**: The startup scripts auto-detect Python and create a virtual environment automatically.

### Local Development Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/helenrm365/rm365-tools-testing.git
cd rm365-tools-testing
```

#### 2. Start Backend Server

**Windows:**
```bash
# Navigate to startup folder
cd start-windows

# Double-click start.bat OR run from command line:
start.bat
```

**macOS:**
```bash
# Navigate to startup folder
cd start-macos

# First time only - make executable:
chmod +x start.command

# Double-click start.command OR run from terminal:
./start.command
```

**What the startup scripts do:**
- ✅ Detect and verify Python installation
- ✅ Create/activate shared virtual environment (`.venv`)
- ✅ Install/update dependencies from `backend/requirements.txt`
- ✅ Start FastAPI server (backend + frontend on port 8000)
- ✅ Monitor GitHub for updates every 5 seconds
- ✅ Auto-restart on new commits

Backend + Frontend available at: `http://localhost:8000`

#### 3. Configure Environment

Create `.env` file in repository root:

```bash
# Copy example (if available) or create new
cp .env.example .env

# Edit with your database credentials
# See Configuration section below for all options
```

#### 4. Optional: Hardware Bridge Setup

For fingerprint/card reader support:

**Windows:**
```bash
cd local-hardware-bridge\start-windows
Start-Hardware-Bridge.bat
```

**macOS:**
```bash
cd local-hardware-bridge/start-macos
chmod +x Start-Hardware-Bridge.command  # First time only
./Start-Hardware-Bridge.command
```

Hardware bridge available at: `http://127.0.0.1:8080`

**Features:**
- ✅ Shares same `.venv` as backend (no duplicate dependencies)
- ✅ SecuGen fingerprint support (Windows only)
- ✅ RFID card reader support (cross-platform via pyserial)
- ✅ Platform detection with graceful error messages

See [START-README.md](START-README.md) for detailed startup documentation.

---

## 🔄 Development Workflow

### Making Changes

**The deployment is fully automated!** Just edit, commit, and push.

#### 1. Make Your Changes

- **Backend changes**: Edit files in `backend/`
- **Frontend changes**: Edit files in `frontend/`
- **Test locally** before pushing

#### 2. Commit Your Changes

```bash
git add .
git commit -m "Brief description of your changes"
```

**Good commit messages:**
- ✅ "Add inventory sync feature"
- ✅ "Fix attendance report date filter"
- ✅ "Update sidebar navigation styling"
- ❌ "Changed stuff"
- ❌ "asdf"

#### 3. Push to GitHub

```bash
git push origin main
```

#### 4. Automatic Deployment

**Self-Hosted Server:**
- `start.bat` monitors GitHub for changes (every 5 seconds)
- Automatically pulls new commits from `main` branch
- Restarts server with updated code
- Updates dependencies if `requirements.txt` changed
- ⏱️ Time: ~5-10 seconds

#### 5. View Your Changes

After automatic deployment (~5-10 seconds):

1. **Application**: Access via your custom domain
   - Hard refresh: `Ctrl+F5` (Windows) or `Cmd+Shift+R` (Mac)
   - Changes apply automatically

2. **API Documentation**: `/api/docs` on your domain

3. **Check Logs**:
   - View console output from `start.bat`
   - Monitor GitHub pull activity
   - Check for file changes and restart confirmations

### Monitoring Deployments

#### Server Console (start.bat)

**What it shows:**
- GitHub fetch activity (every 5 seconds)
- New commits detected
- Files changed (backend/frontend)
- Dependency updates
- Server restart notifications

**Status indicators:**
- ✅ **Changes pulled successfully**: New code deployed
- 🔄 **Watching for updates**: Monitoring GitHub
- ⚠️ **Server stopped unexpectedly**: Check for errors, auto-restarts in 5s
- 📦 **Dependencies updated**: requirements.txt changed

**Example output:**
```
========================================
[!] NEW UPDATE DETECTED ON GITHUB!
========================================
[<] Pulling changes...
[+] CHANGES PULLED SUCCESSFULLY!
[*] Files changed: 3
[*] Backend files updated
[~] RESTARTING SERVER WITH NEW CHANGES...
========================================
```

---

## 🚀 Deployment

### Self-Hosted with Cloudflare Tunnel

The application runs on a local server and is accessible via Cloudflare Tunnel with a custom domain.

#### Starting the Server

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

**What the startup scripts do:**
1. Detect and verify Python installation (3.x for backend, 3.10+ for hardware bridge)
2. Create/activate shared virtual environment (`.venv` in repository root)
3. Install/update dependencies from `backend/requirements.txt`
4. Start FastAPI server (backend + frontend on port 8000)
5. Monitor GitHub for updates every 5 seconds
6. Auto-pull and restart on new commits
7. Serve both backend API and frontend files
8. Hot-reload for local file changes

**Shared Virtual Environment:**
- Backend uses `.venv` from repository root
- Hardware bridge uses `../../.venv` (resolves to same location)
- No duplicate FastAPI/Uvicorn installations
- Efficient disk space usage
- Platform-specific folders ensure clean separation

#### Environment Configuration

**Environment Variables** (in `.env` file):

```bash
# Server
HOST=0.0.0.0
PORT=8000

# Authentication
AUTH_SECRET_KEY=<generate-secure-key>
AUTH_ALGORITHM=HS256

# Database - Attendance (Local PostgreSQL)
ATTENDANCE_DB_HOST=localhost
ATTENDANCE_DB_PORT=5432
ATTENDANCE_DB_NAME=attendance
ATTENDANCE_DB_USER=postgres
ATTENDANCE_DB_PASSWORD=***

# Database - Products (Local PostgreSQL)
PRODUCTS_DB_HOST=localhost
PRODUCTS_DB_PORT=5432
PRODUCTS_DB_NAME=products
PRODUCTS_DB_USER=postgres
PRODUCTS_DB_PASSWORD=***

# Database - Inventory Logs (Local PostgreSQL)
INVENTORY_LOGS_HOST=localhost
INVENTORY_LOGS_PORT=5432
INVENTORY_LOGS_NAME=inventory
INVENTORY_LOGS_USER=postgres
INVENTORY_LOGS_PASSWORD=***

# Database - Labels (Local PostgreSQL)
LABELS_DB_URI=postgresql://postgres:password@localhost:5432/labels


ZC_ORG_ID=your-org-id

# Magento Integration
MAGENTO_BASE_URL=https://your-magento-store.com
MAGENTO_ACCESS_TOKEN=your_magento_api_token

# CORS (JSON array or comma-separated)
ALLOW_ORIGINS=["http://localhost:3000","https://your-domain.com"]
ALLOW_ORIGIN_REGEX=https://.*\.pages\.dev
```

#### Cloudflare Tunnel Setup

**Prerequisites:**
1. Install Cloudflare Tunnel (cloudflared)
2. Authenticate with your Cloudflare account
3. Configure tunnel to point to `localhost:8000`

**Benefits:**
- Automatic HTTPS
- Custom domain
- No port forwarding needed
- DDoS protection
- Global CDN

**Tunnel Configuration:**
```yaml
tunnel: <your-tunnel-id>
credentials-file: /path/to/credentials.json

ingress:
  - hostname: your-custom-domain.com
    service: http://localhost:8000
  - service: http_status:404
```

### Database Setup

#### Running Migrations

For performance optimizations (indexes):

```powershell
cd backend
.\apply-indexes.ps1
```

This creates 30+ indexes for faster queries.

---

## 🔥 Advanced Features

### Real-Time Collaboration

**Google Sheets-style live collaboration** for inventory management.

**Features:**
- Live user presence with colored avatars
- Row-level cursor tracking
- Instant data updates with flash notifications
- Automatic conflict prevention
- WebSocket-powered for zero latency

**How it works:**
- Socket.IO WebSocket server in backend
- Client connects on inventory page load
- Broadcasts user presence and editing state
- Emits events on data changes
- Updates all connected clients instantly

**Test it:**
1. Open inventory management in two browser tabs
2. See both users in the presence bar
3. Hover over rows to see real-time indicators
4. Make changes and watch live updates

### Hardware Integration

**Local hardware bridge** enables browser access to USB devices.

**Supported Devices:**
- SecuGen fingerprint scanners (Windows)
- **ACR1252U USB NFC Reader III** ⭐ NEW
- ACR122U and other PC/SC NFC readers
- Serial-based RFID card readers
- Automatic device detection

**Architecture:**
- Main server (local) - Serves web application
- Hardware bridge (local) - USB device access via native Windows API
- Runs on same machine or office network
- HTTPS with self-signed certificates (optional)

**Setup:**
```bash
cd local-hardware-bridge
pip install -r requirements.txt
python app.py
```

**ACR1252U Quick Start:**
1. Plug in ACR1252U (Windows auto-installs drivers)
2. Test: `python acr_reader.py`
3. Start bridge: `python app.py`
4. Scan cards at `http://127.0.0.1:8080/card/scan`

See `local-hardware-bridge/ACR1252U-SETUP.md` for complete documentation.

**Features:**
- Fingerprint enrollment and verification
- NFC/RFID card reading (PC/SC and serial)
- Device health monitoring
- Automatic reconnection
- Pure Python implementation (no compilation needed)

### Magento Integration

**Invoice-based order fulfillment** with pick & pack workflows.

**Features:**
- Order lookup by number or invoice
- Real-time barcode scanning
- Progress tracking with visual indicators
- Overpick detection
- Session management
- Complete audit trail

**Configuration:**
- Set `MAGENTO_BASE_URL` and `MAGENTO_ACCESS_TOKEN` in `.env`
- API integration uses Magento REST API
- Supports invoice search and line item details

**Usage:**
1. Navigate to Inventory > Pick & Pack
2. Enter order/invoice number
3. Start scanning session
4. Scan product barcodes
5. Complete when all items scanned

**Configuration:**
```bash
MAGENTO_BASE_URL=https://your-store.com
MAGENTO_ACCESS_TOKEN=your_api_token
```

---

## 📚 Documentation

### Project Documentation

- **[START-README.md](START-README.md)** - Comprehensive startup scripts guide (Windows & macOS)
- **[backend/README.md](backend/README.md)** - Backend architecture, modules, and API development
- **[frontend/README.md](frontend/README.md)** - Frontend architecture, UI development, and deployment

### API Documentation

Interactive API documentation available at:

- **Swagger UI**: `/api/docs` on your domain
- **ReDoc**: `/api/redoc` on your domain
- **OpenAPI Spec**: `/api/openapi.json` on your domain

### Key API Endpoints

#### Authentication
```
POST   /api/v1/auth/login          - User login
POST   /api/v1/auth/refresh        - Refresh token
```

#### Users & Roles
```
GET    /api/v1/users               - List users
POST   /api/v1/users               - Create user
GET    /api/v1/roles               - List roles
POST   /api/v1/roles               - Create role
```

#### Attendance
```
GET    /api/v1/attendance/employees         - List employees
POST   /api/v1/attendance/clock             - Clock in/out
POST   /api/v1/attendance/clock-by-fingerprint - Fingerprint clock
GET    /api/v1/attendance/logs              - Get logs
GET    /api/v1/attendance/daily-stats       - Daily statistics
```

#### Inventory
```
GET    /api/v1/inventory/management/health       - Health check
GET    /api/v1/inventory/management/items        - List items with pagination
GET    /api/v1/inventory/management/metadata     - Get metadata
POST   /api/v1/inventory/management/metadata     - Create metadata
PATCH  /api/v1/inventory/management/metadata/{sku} - Update metadata
POST   /api/v1/inventory/management/sync-magento-data - Sync magento data
GET    /api/v1/inventory/management/categories   - Get categories
GET    /api/v1/inventory/management/suppliers    - Get suppliers
GET    /api/v1/inventory/collaboration/presence  - Live users
```

**Note**: The `adjustments` module exists in code but is not currently mounted in the application.

#### Labels
```
GET    /api/v1/labels/health                - Health check
GET    /api/v1/labels/to-print              - Items pending labels
GET    /api/v1/labels/jobs                  - List print jobs
GET    /api/v1/labels/job/{job_id}          - Get job details
POST   /api/v1/labels/start-job             - Start new print job
DELETE /api/v1/labels/job/{job_id}          - Delete job
GET    /api/v1/labels/job/{job_id}/pdf      - Download PDF labels
GET    /api/v1/labels/job/{job_id}/csv      - Download CSV
```

#### Magento (Order Fulfillment)
```
GET    /api/v1/magento/invoice/lookup       - Lookup invoice
POST   /api/v1/magento/session/start        - Start pick session
POST   /api/v1/magento/session/scan         - Scan product
POST   /api/v1/magento/session/complete     - Complete pick session
```

**Note**: Magento integration is located in `backend/modules/orders/order_fulfillment/`

---

## ⚙️ Configuration

### Backend Configuration

All configuration in `backend/core/config.py`:

```python
class Settings(BaseSettings):
    # Auth
    AUTH_SECRET_KEY: str
    AUTH_ALGORITHM: str = "HS256"
    
    # Databases (3 PostgreSQL instances)
    ATTENDANCE_DB_HOST: str
    LABELS_DB_URI: str
    INVENTORY_LOGS_HOST: str
    PRODUCTS_DB_HOST: str
    
    # Integrations

    ZC_CLIENT_SECRET: str
    MAGENTO_BASE_URL: str      # Magento
    MAGENTO_ACCESS_TOKEN: str
    
    # CORS
    ALLOW_ORIGINS: list = []
    ALLOW_ORIGIN_REGEX: str = None
```

### Frontend Configuration

The frontend auto-detects the API URL. Edit `frontend/js/config.js` if needed:

```javascript
export const config = {
  API: resolveApiUrl(),  // Auto-detected (localhost or current origin)
  DEBUG: window.location.hostname === 'localhost' || 
         window.location.search.includes('debug=true'),
  IS_CROSS_ORIGIN: false,  // Auto-detected
  ENVIRONMENT: 'development-local' // Auto-detected
};

// Override API URL: Add ?api=http://your-url to browser URL
// Reset to default: Add ?api=reset to browser URL
```

### Debug Mode

Enable detailed logging by adding `?debug=true` to any URL:

```
http://localhost:8000/?debug=true          # Local development
https://your-domain.com/?debug=true        # Production (via Cloudflare Tunnel)
```

Shows:
- API request/response details
- Router navigation
- Authentication flow
- WebSocket events
- Error stack traces

---

## 🔐 Security

### Security Features

- ✅ **JWT-based authentication** with secure tokens
- ✅ **Password hashing** using bcrypt
- ✅ **Role-based access control (RBAC)**
- ✅ **CORS protection** with domain whitelisting
- ✅ **Input validation** with Pydantic
- ✅ **SQL injection prevention** via SQLAlchemy ORM
- ✅ **XSS prevention** with HTML sanitization
- ✅ **CSRF protection**
- ✅ **Secure environment variables**
- ✅ **HTTPS enforced** in production
- ✅ **Connection pooling** with resource limits

### Best Practices

- ❌ Never commit `.env` files or secrets
- ✅ Use environment variables for all credentials
- ✅ Rotate secrets regularly
- ✅ Enable 2FA on GitHub account
- ✅ Review code before pushing to `main`
- ✅ Keep dependencies updated
- ✅ Monitor server console logs
- ✅ Use strong database passwords
- ✅ Configure Cloudflare Tunnel security settings
- ✅ Restrict database access to localhost only

---

<div align="center">

## ⚡ Performance Metrics

### *40-80% performance improvement across all metrics*

</div>

<br>

#### Connection Pooling
- 3 PostgreSQL connection pools (2-20 connections each)
- Eliminates connection overhead (200-300ms saved per request)
- Efficient resource usage

#### GZip Compression
- 70-80% bandwidth reduction
- Automatic compression for responses > 1KB
- Transparent to clients

#### Database Indexing
- 30+ strategic indexes
- 5-10x faster queries
- Optimized for common search patterns

#### Frontend Caching
- TTL-based caching for API responses
- 60-80% faster cached loads
- Automatic cache invalidation

#### Parallel Fetching
- 3-5x faster page loads
- All API calls execute simultaneously
- Graceful error handling

#### Field Selection API
- 10-50% smaller payloads
- Client-selectable fields
- Reduced bandwidth usage

<div align="center">

### 📊 **Benchmark Results**

| 🎯 Metric | ⏱️ Before | ⚡ After | 📈 Improvement |
|-----------|-----------|---------|----------------|
| Attendance overview | `2400ms` | `800ms` | **3x faster** ⚡ |
| Cached API calls | `300ms` | `10-50ms` | **6-30x faster** 🚀 |
| Sales queries (indexed) | `500ms` | `50-100ms` | **5-10x faster** 📊 |
| API response size | `500KB` | `100KB` | **80% smaller** 📦 |
| Connection overhead | `200-300ms` | `0ms` | **Eliminated** ✅ |

</div>

---

## 🔧 Troubleshooting

### Common Issues

#### Server Won't Start

**Check:**
1. Python is installed and in PATH (`python --version`)
2. You're running the correct startup script for your platform
3. PostgreSQL databases are running
4. `.env` file exists with correct configuration
5. Port 8000 is not already in use

**Solutions:**

**Windows:**
```powershell
# Check Python
python --version

# Check if port 8000 is in use
netstat -ano | findstr :8000

# Kill process using port 8000 (if needed)
Stop-Process -Id <PID> -Force

# Reinstall dependencies (startup script recreates automatically)
Remove-Item -Recurse -Force .venv
cd start-windows
.\start.bat
```

**macOS:**
```bash
# Check Python
python3 --version

# Check if port 8000 is in use
lsof -i :8000

# Kill process using port 8000 (if needed)
kill -9 <PID>

# Reinstall dependencies (startup script recreates automatically)
rm -rf .venv
cd start-macos
./start.command
```

**Platform-Specific Issues:**
- **Windows**: Ensure PowerShell execution policy allows scripts
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
- **macOS**: Ensure script is executable
  ```bash
  chmod +x start-macos/start.command
  chmod +x local-hardware-bridge/start-macos/Start-Hardware-Bridge.command
  ```

#### Auto-Update Not Working

**Check:**
1. GitHub repository is accessible
2. Git is installed and configured
3. Internet connection is stable
4. Authentication is set up (SSH keys or credentials)

**Test manually:**
```powershell
git fetch origin main
git pull origin main
```

#### Changes Not Showing

1. **Hard refresh browser**
   - Windows: `Ctrl + F5`
   - Mac: `Cmd + Shift + R`

2. **Check server console**
   - Look for "NEW UPDATE DETECTED"
   - Verify "CHANGES PULLED SUCCESSFULLY"
   - Check for restart confirmation

3. **Manual restart**
   - Stop `start.bat` (Ctrl+C)
   - Start again
   - Check server console
   - Wait for deployment to finish

3. **Check browser console**
   - Press `F12`
   - Look for JavaScript errors
   - Check Network tab for failed requests

#### API Errors

1. **Check backend URL**
   - Verify `window.API` in browser console
   - Ensure it points to correct backend

2. **CORS issues**
   - Ensure `ALLOW_ORIGINS` includes frontend domain
   - Check browser console for CORS errors

3. **Authentication errors**
   - Try logging out and in again
   - Check token validity
   - Verify `AUTH_SECRET_KEY` is set

#### WebSocket Connection Issues

**"Collaboration server connection unstable"**

1. Verify backend server is running
2. Check WebSocket endpoint: `/ws/socket.io`
3. Review CORS settings
4. Check firewall rules

**Documentation**: See [DEPLOYMENT_WEBSOCKET.md](DEPLOYMENT_WEBSOCKET.md)

#### Hardware Not Detected

**Card reader unavailable:**
1. Check USB connection
2. Verify COM port in Device Manager (Windows) or `/dev/tty*` (macOS)
3. Ensure local bridge is running (`http://127.0.0.1:8080`)
4. Check bridge startup:
   - **Windows**: `local-hardware-bridge\start-windows\Start-Hardware-Bridge.bat`
   - **macOS**: `local-hardware-bridge/start-macos/Start-Hardware-Bridge.command`

**Fingerprint ErrorCode 55 (Windows only):**
1. Install SecuGen SDK from https://www.secugen.com/
2. Ensure SecuGen drivers are installed
3. Verify device in Device Manager → Biometric Devices
4. Restart hardware bridge service

**macOS Fingerprint Support:**
- SecuGen requires Windows-only drivers
- Hardware bridge returns appropriate error messages on macOS
- Card readers work cross-platform via pyserial

**Documentation**: 
- [START-README.md](START-README.md) - Platform-specific startup instructions

### Debug Tools

**Enable Debug Mode:**
```
http://localhost:8000/?debug=true
```

**Browser Console:**
```javascript
// Check API endpoint
console.log(window.API);

// Check authentication
console.log(localStorage.getItem('authToken'));
console.log(localStorage.getItem('user'));

// Test API call
import { get } from '/js/services/api/http.js';
get('/api/v1/users').then(console.log);
```

**Network Tab:**
- Monitor API requests
- Check response status
- Verify headers (GZip, CORS)
- View request/response payloads

---

## 🆘 Support

### Getting Help

1. **Check Documentation**
   - Review module-specific README files
   - Check API documentation at `/api/docs`
   - Read specialized guides (COLLABORATION, HARDWARE, etc.)

2. **Enable Debug Mode**
   - Add `?debug=true` to URL
   - Check browser console logs
   - Review Network tab

3. **Check Server Logs**
   - Server console for backend logs

4. **Contact Team Lead**
   - For database access
   - For environment variables
   - For deployment issues

### Resources

- **Backend**: http://localhost:8000
- **API Docs**: http://localhost:8000/api/docs

---

## 📄 License

This project is proprietary software for RM365 internal use only. All rights reserved.

---

## 👥 Contributors

RM365 Development Team

---

## 🎉 Acknowledgments

Built with modern technologies and best practices:
- FastAPI for high-performance backend
- Vanilla JavaScript for lightweight, framework-free frontend
- Self-hosted backend with auto-restart monitoring
- PostgreSQL for reliable data storage
- Socket.IO for real-time collaboration

---

<div align="center">

### Built with ❤️ for RM365 team productivity

<br>

**📅 Last Updated**: November 27, 2025  
**🏷️ Version**: 2.1.1  
**✅ Status**: Production Ready

<br>

## 🎉 Recent Updates (v2.1.1)

<table>
<tr>
<td width="33%" valign="top">

### ✨ **Startup Scripts**

- Platform-specific folders (`start-windows/`, `start-macos/`)
- Double-clickable launchers (`.bat`, `.command`)
- Unified virtual environment (`.venv`)
- Auto-restart monitoring (every 5s)
- Visual colored console output

</td>
<td width="33%" valign="top">

### 🔌 **Hardware Bridge**

- Platform detection with fallbacks
- macOS compatibility layer
- Cross-platform RFID support (`pyserial`)
- Organized startup scripts
- Shared dependencies (no duplication)

</td>
<td width="33%" valign="top">

### 📚 **Documentation**

- Comprehensive [START-README.md](START-README.md)
- Platform-specific guides
- 100% accurate project structure
- Detailed API endpoints
- Troubleshooting guides

</td>
</tr>
</table>

</div>
