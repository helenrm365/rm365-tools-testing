# RM365 Toolbox - Backend

FastAPI backend service providing REST APIs for the RM365 Toolbox application.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Database Configuration](#database-configuration)
- [Development Workflow](#development-workflow)
- [API Documentation](#api-documentation)
- [Authentication](#authentication)

## Overview

The backend is built with FastAPI and provides RESTful APIs for:
- **User authentication and authorization** (JWT-based)
- **Attendance tracking** (clock in/out, reports, analytics, hardware integration)
- **Inventory management** (stock tracking, adjustments, real-time collaboration)
- **Label generation** (PDF labels with barcodes)
- **Sales data import** (CSV processing, multi-country support)
- **User and role management** (RBAC system)
- **Enrollment** (student/employee registration, biometric/card enrollment)
- **Magento integration** (invoice-based order fulfillment, pick & pack)
- **Real-time collaboration** (WebSocket-powered live presence and updates)

### Key Technologies
- **FastAPI**: Modern, fast web framework
- **SQLAlchemy**: ORM for database operations with connection pooling
- **Pydantic**: Data validation and serialization
- **PostgreSQL**: Multiple database instances (self-hosted)
- **JWT**: Secure authentication
- **Uvicorn**: ASGI server for production
- **Socket.IO**: WebSocket server for real-time features
- **Requests**: HTTP client for Magento API integration
- **psycopg2**: PostgreSQL adapter with connection pooling

## Architecture

### Layered Architecture

```
┌─────────────────────────────────────┐
│         API Layer (api.py)          │  ← FastAPI routes
├─────────────────────────────────────┤
│      Service Layer (service.py)     │  ← Business logic
├─────────────────────────────────────┤
│    Repository Layer (repo.py)       │  ← Database operations
├─────────────────────────────────────┤
│      Data Layer (models.py)         │  ← SQLAlchemy models
└─────────────────────────────────────┘
```

### Core Components

1. **`app.py`**: Main application entry point
   - Router registration
   - Middleware setup
   - CORS configuration
   - Static file serving

2. **`core/`**: Foundation services
   - `auth.py`: JWT authentication
   - `config.py`: Environment configuration
   - `db.py`: Database connections with connection pooling
   - `errors.py`: Error handling
   - `middleware.py`: Request/response middleware (includes GZip compression)
   - `security.py`: Security utilities
   - `websocket.py`: WebSocket server for real-time collaboration

3. **`modules/`**: Feature modules
   - Each module follows the same pattern (api → service → repo)
   - Self-contained business logic
   - Independent database schemas

4. **`common/`**: Shared utilities
   - `deps.py`: Dependency injection
   - `dto.py`: Data transfer objects
   - `utils.py`: Helper functions

## Project Structure

```
backend/
├── app.py                      # Main application
├── apply-indexes.ps1           # Database index setup script
├── requirements.txt            # Python dependencies
│
├── core/                       # Core functionality
│   ├── auth.py                # JWT authentication
│   ├── config.py              # Settings management
│   ├── db.py                  # Database connections
│   ├── errors.py              # Error handlers
│   ├── middleware.py          # Custom middleware
│   ├── pagination.py          # Pagination helpers
│   ├── security.py            # Security utilities
│   └── websocket.py           # WebSocket server (Socket.IO)
│
├── common/                    # Shared utilities
│   ├── deps.py               # Dependency injection
│   ├── dto.py                # Data transfer objects
│   └── utils.py              # Helper functions
│
└── modules/                   # Feature modules
    ├── _integrations/        # External services (reserved)
    │
    ├── attendance/          # Attendance tracking
    │   ├── api.py          # REST endpoints
    │   ├── models.py       # Database models
    │   ├── repo.py         # Data access layer
    │   ├── schemas.py      # Pydantic schemas
    │   └── service.py      # Business logic
    │
    ├── enrollment/         # User enrollment
    │   ├── api.py
    │   ├── repo.py
    │   ├── schemas.py
    │   ├── service.py
    │   └── hardware/       # Device integrations
    │
    ├── inventory/          # Stock management
    │   ├── collaboration.py  # Real-time features
    │   ├── adjustments/   # Stock adjustments
    │   ├── management/    # Item CRUD
    │   └── order_fulfillment/  # Magento integration
    │       ├── api.py
    │       ├── client.py      # Magento REST API
    │       ├── models.py
    │       ├── repo.py
    │       ├── schemas.py
    │       ├── service.py
    │       └── data/          # Session storage
    │
    ├── labels/            # Label generation
    │   ├── api.py
    │   ├── generator.py   # PDF generation
    │   ├── jobs.py        # Background jobs
    │   ├── repo.py
    │   ├── schemas.py
    │   └── service.py
    │
    ├── roles/             # Role management
    ├── salesdata/         # Sales data import
    └── users/             # User management
```

## Database Configuration

### Multiple Database Architecture

The application uses **four separate PostgreSQL databases**:

1. **Attendance Database**: Employee attendance records
2. **Labels Database**: Inventory items and label history
3. **Inventory Logs Database**: Stock adjustments and sync logs
4. **Products Database**: Sales data and analytics

### Environment Variables

All database credentials and configuration are set in your `.env` file:

```bash
# Authentication
AUTH_SECRET_KEY=your-secret-key
AUTH_ALGORITHM=HS256

# Database - Attendance
ATTENDANCE_DB_HOST=localhost
ATTENDANCE_DB_PORT=5432
ATTENDANCE_DB_NAME=rm365
ATTENDANCE_DB_USER=postgres
ATTENDANCE_DB_PASSWORD=***

# Database - Labels
LABELS_DB_URI=postgresql+psycopg2://postgres:***@localhost:5432/labels

# Database - Inventory Logs
INVENTORY_LOGS_HOST=localhost
INVENTORY_LOGS_PORT=5432
INVENTORY_LOGS_NAME=inventory
INVENTORY_LOGS_USER=postgres
INVENTORY_LOGS_PASSWORD=***

# Database - Products/Sales Data
PRODUCTS_DB_HOST=localhost
PRODUCTS_DB_PORT=5432
PRODUCTS_DB_NAME=products
PRODUCTS_DB_USER=postgres
PRODUCTS_DB_PASSWORD=***

# Zoho Creator Integration (Optional)
ZC_CLIENT_ID=***
ZC_CLIENT_SECRET=***
ZC_REFRESH_TOKEN=***
ZC_ORG_ID=***

# Magento Integration
MAGENTO_BASE_URL=https://your-magento-store.com
MAGENTO_ACCESS_TOKEN=your_magento_api_token

# CORS (for your frontend domain)
ALLOW_ORIGINS=["http://localhost:3000"]
```

## Development Workflow

### Starting the Server

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
- ✅ Detect and verify Python installation
- ✅ Create/activate shared virtual environment (`.venv` in repository root)
- ✅ Install/update dependencies from `backend/requirements.txt`
- ✅ Start FastAPI server (backend + frontend on port 8000)
- ✅ Monitor GitHub for updates every 5 seconds
- ✅ Auto-restart on new commits

**Shared Virtual Environment:**
- Located at repository root: `.venv/`
- Shared between backend and hardware bridge
- Platform-specific scripts (Windows/macOS) use the same environment
- No duplicate installations

### Making Changes

1. **Edit Your Code**
   - Make changes to files in the `backend/` directory
   - Test your logic and syntax locally

2. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

3. **Push to GitHub**
   ```bash
   git push origin main
   ```

4. **Auto-Restart**
   - Platform-specific startup script detects changes (~5 seconds)
   - Pulls new code from GitHub
   - Restarts server automatically
   - Updates dependencies if `requirements.txt` changed

5. **View Your Changes**
   - Backend URL: `http://localhost:8000`
   - API Documentation: `http://localhost:8000/api/docs`
   - Check server console for logs

### Monitoring Server

**Server Console:**
- View output from startup script window (`start.bat` on Windows, `start.command` on macOS)
- Real-time logs with emoji formatting (✅❌⚠️)
- GitHub fetch activity every 5 seconds
- File change detection and restart notifications

**Server Status:**
- ✅ **Running**: Server is live and accepting requests
- ❌ **Error**: Check console for stack traces
- 🔄 **Restarting**: Auto-restart triggered by code changes
- 📦 **Dependencies Updated**: requirements.txt changed

## API Documentation

### Interactive Documentation

Once the server is running, access the interactive API documentation:

- **Swagger UI**: `http://localhost:8000/api/docs`
  - Test endpoints directly
  - View request/response schemas
  - Try API calls with authentication

- **ReDoc**: `http://localhost:8000/api/redoc`
  - Alternative documentation view
  - Better for reading and understanding APIs

### API Endpoints

All endpoints are prefixed with `/api/v1`:

- **Authentication**: `/api/v1/auth/*`
- **Users**: `/api/v1/users/*`
- **Roles**: `/api/v1/roles/*`
- **Attendance**: `/api/v1/attendance/*`
- **Enrollment**: `/api/v1/enrollment/*`
- **Inventory**: `/api/v1/inventory/*`
- **Labels**: `/api/v1/labels/*`
- **Sales Data**: `/api/v1/salesdata/*`
- **Magento**: `/api/v1/magento/*` (Order fulfillment)

### Testing Endpoints

Use Swagger UI to test endpoints:
1. Navigate to `/api/docs`
2. Find your endpoint
3. Click "Try it out"
4. Fill in parameters
5. Click "Execute"
6. View response

## Authentication

### JWT Token Flow

1. **Login** (`POST /api/v1/auth/login`)
   - Send username/password
   - Receive JWT access token

2. **Protected Routes**
   - Include token in `Authorization: Bearer <token>` header
   - Token is validated on each request

3. **Token Validation**
   ```python
   from common.deps import get_current_user
   from fastapi import Depends

   @router.get("/protected")
   async def protected_route(user=Depends(get_current_user)):
       return {"message": f"Hello {user['username']}"}
   ```

### Role-Based Access Control

Users have:
- **Username**: Unique identifier
- **Role**: User role (e.g., "admin", "manager", "user")
- **Allowed Tabs**: List of permitted modules

Check permissions in routes:
```python
def check_permission(user: dict, required_tab: str):
    if required_tab not in user.get('allowed_tabs', []):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
```

## Creating New Features

### Adding a New API Endpoint

1. **Define Schema** in `modules/feature/schemas.py`
   ```python
   from pydantic import BaseModel

   class ItemCreate(BaseModel):
       name: str
       description: str
   ```

2. **Add Repository Method** in `modules/feature/repo.py`
   ```python
   def create_item(self, name: str, description: str):
       cursor = self.conn.cursor()
       cursor.execute(
           "INSERT INTO items (name, description) VALUES (%s, %s) RETURNING id",
           (name, description)
       )
       self.conn.commit()
       return cursor.fetchone()[0]
   ```

3. **Add Service Method** in `modules/feature/service.py`
   ```python
   def create_item(self, item: ItemCreate):
       item_id = self.repo.create_item(item.name, item.description)
       return {"id": item_id, **item.dict()}
   ```

4. **Add Route** in `modules/feature/api.py`
   ```python
   @router.post("/items")
   async def create_item(item: ItemCreate, user=Depends(get_current_user)):
       return service.create_item(item)
   ```

5. **Register in app.py**
   ```python
   ('modules.feature.api', 'router', f'{API}/feature', ['feature']),
   ```

6. **Commit and Push**
   ```bash
   git add .
   git commit -m "Add new feature endpoint"
   git push origin main
   ```

7. **Automatic Restart**
   - Platform-specific startup script detects changes (~5 seconds)
   - Pulls new code from GitHub
   - Restarts server automatically
   - Check `http://localhost:8000/api/docs` for your new endpoint

## Troubleshooting

### Server Issues

1. **Check Server Console**
   - View output from startup script (`start.bat` on Windows, `start.command` on macOS)
   - Look for error messages and stack traces

2. **Common Issues**
   - Syntax errors in Python code
   - Missing dependencies in `requirements.txt`
   - Database connection issues (check PostgreSQL is running)
   - Environment variable misconfiguration in `.env`
   - Port 8000 already in use
   - Python version mismatch (requires 3.x)

3. **Fix and Restart**
   - Fix the issue in your code
   - Push to GitHub (auto-restarts)
   - Or manually restart the startup script:
     - **Windows**: Stop with Ctrl+C, run `start-windows\start.bat`
     - **macOS**: Stop with Ctrl+C, run `start-macos/start.command`

4. **Virtual Environment Issues**
   - If dependencies fail, delete `.venv` folder from repository root
   - Restart the appropriate startup script (it will recreate the environment)
   - Shared `.venv` is used by both backend and hardware bridge

### API Errors

1. **Check Server Console**
   - Runtime errors appear in console output
   - Database errors show connection issues

2. **Test in Swagger UI**
   - Use `http://localhost:8000/api/docs` to test endpoints
   - Check request/response format

3. **Verify Environment Variables**
   - Ensure all required variables are set in `.env`
   - Check database credentials are correct

## Best Practices

### Code Quality
- Follow PEP 8 style guidelines
- Use type hints for better IDE support
- Add docstrings to functions
- Keep functions small and focused

### Security
- Never commit sensitive credentials
- Use environment variables for all secrets
- Validate all input with Pydantic schemas
- Use parameterized queries to prevent SQL injection

### Git Workflow
- Write clear commit messages
- Test changes before pushing
- Keep commits focused and atomic
- Use descriptive branch names for features (if using branches)

### Database
- Always use transactions for data modifications
- Close database connections properly
- Use indexes for frequently queried fields
- Implement pagination for large datasets

## Getting Help

- **API Documentation**: Check `http://localhost:8000/api/docs` for endpoint details
- **Server Console**: View real-time logs with emoji formatting
- **Main README**: See [../README.md](../README.md) for overall project documentation
- **Startup Guide**: See [../START-README.md](../START-README.md) for platform-specific startup details
- **Hardware Bridge**: See `local-hardware-bridge/` directory for hardware integration setup
- **Team Lead**: Contact for database credentials or access issues

---

**Local Server**: http://localhost:8000

**API Docs**: http://localhost:8000/api/docs

**Startup Scripts**:
- Windows: `start-windows/start.bat`
- macOS: `start-macos/start.command`
