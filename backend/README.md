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
- **Attendance tracking** (clock in/out, reports, analytics)
- **Inventory management** (stock tracking, adjustments, Zoho sync)
- **Label generation** (PDF labels with barcodes)
- **Sales data import** (CSV processing)
- **User and role management** (RBAC system)
- **Enrollment** (student/employee registration)

### Key Technologies
- **FastAPI**: Modern, fast web framework
- **SQLAlchemy**: ORM for database operations
- **Pydantic**: Data validation and serialization
- **PostgreSQL**: Multiple database instances (hosted on Railway)
- **JWT**: Secure authentication
- **Uvicorn**: ASGI server

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
   - `db.py`: Database connections
   - `errors.py`: Error handling
   - `middleware.py`: Request/response middleware
   - `security.py`: Security utilities

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
├── start_server.py             # Production server starter
├── serve_frontend.py           # Frontend serving utility
├── Dockerfile                  # Container configuration
├── requirements.txt            # Python dependencies
│
├── core/                       # Core functionality
│   ├── auth.py                # JWT authentication
│   ├── config.py              # Settings management
│   ├── db.py                  # Database connections
│   ├── errors.py              # Error handlers
│   ├── middleware.py          # Custom middleware
│   ├── pagination.py          # Pagination helpers
│   └── security.py            # Security utilities
│
├── common/                    # Shared utilities
│   ├── deps.py               # Dependency injection
│   ├── dto.py                # Data transfer objects
│   └── utils.py              # Helper functions
│
└── modules/                   # Feature modules
    ├── _integrations/        # External services
    │   └── zoho/            # Zoho Creator client
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
    │   ├── adjustments/   # Stock adjustments
    │   └── management/    # Item CRUD
    │
    ├── labels/            # Label generation
    │   ├── api.py
    │   ├── generator.py   # PDF generation
    │   ├── repo.py
    │   ├── schemas.py
    │   └── service.py
    │
    ├── roles/             # Role management
    ├── sales_imports/     # Data import
    └── users/             # User management
```

## Database Configuration

### Multiple Database Architecture

The application uses **three separate PostgreSQL databases** hosted on Railway:

1. **Attendance Database**: Employee attendance records
2. **Labels Database**: Inventory items and label history
3. **Inventory Logs Database**: Stock adjustments and sync logs

### Environment Variables

All database credentials and configuration are set in Railway's environment variables dashboard:

```bash
# Authentication
AUTH_SECRET_KEY=your-secret-key
AUTH_ALGORITHM=HS256

# Database - Attendance
ATTENDANCE_DB_HOST=railway-host.railway.internal
ATTENDANCE_DB_PORT=5432
ATTENDANCE_DB_NAME=railway
ATTENDANCE_DB_USER=postgres
ATTENDANCE_DB_PASSWORD=***

# Database - Labels
LABELS_DB_URI=postgresql+psycopg2://postgres:***@host:5432/labels

# Database - Inventory Logs
INVENTORY_LOGS_HOST=railway-host.railway.internal
INVENTORY_LOGS_PORT=5432
INVENTORY_LOGS_NAME=inventory
INVENTORY_LOGS_USER=postgres
INVENTORY_LOGS_PASSWORD=***

# Zoho Integration
ZC_CLIENT_ID=***
ZC_CLIENT_SECRET=***
ZC_REFRESH_TOKEN=***
ZC_ORG_ID=***

# CORS (for Cloudflare Pages)
ALLOW_ORIGINS=["https://rm365-tools-testing.pages.dev"]
ALLOW_ORIGIN_REGEX=^https:\/\/([a-z0-9-]+\.)?rm365-tools-testing\.pages\.dev
```

## Development Workflow

### Making Changes

1. **Edit Your Code**
   - Make changes to files in the `backend/` directory
   - Test your logic and syntax

2. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

3. **Push to GitHub**
   ```bash
   git push origin main
   ```

4. **Railway Auto-Deploys**
   - Railway detects the push to `main` branch
   - Automatically builds and deploys your changes
   - Deployment takes approximately 2-5 minutes

5. **View Your Changes**
   - Backend URL: `https://rm365-tools-testing-production.up.railway.app`
   - API Documentation: `https://rm365-tools-testing-production.up.railway.app/api/docs`
   - Check Railway dashboard for deployment logs and status

### Monitoring Deployment

**Railway Dashboard:**
1. Go to [Railway Dashboard](https://railway.app)
2. Select the `rm365-tools-testing` project
3. View deployment logs in real-time
4. Check for errors or successful deployment

**Deployment Status:**
- ✅ **Success**: Your changes are live
- ❌ **Failed**: Check logs for errors, fix code, and push again
- 🔄 **Building**: Wait for deployment to complete

## API Documentation

### Interactive Documentation

Once deployed, access the interactive API documentation:

- **Swagger UI**: `https://rm365-tools-testing-production.up.railway.app/api/docs`
  - Test endpoints directly
  - View request/response schemas
  - Try API calls with authentication

- **ReDoc**: `https://rm365-tools-testing-production.up.railway.app/api/redoc`
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
- **Sales Imports**: `/api/v1/sales-imports/*`

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

7. **View in Production**
   - Wait for Railway to deploy
   - Check `/api/docs` for your new endpoint

## Troubleshooting

### Deployment Failed

1. **Check Railway Logs**
   - View deployment logs in Railway dashboard
   - Look for error messages

2. **Common Issues**
   - Syntax errors in Python code
   - Missing dependencies in `requirements.txt`
   - Database connection issues
   - Environment variable misconfiguration

3. **Fix and Redeploy**
   - Fix the issue in your code
   - Commit and push again
   - Railway will automatically retry deployment

### API Errors

1. **Check Logs in Railway Dashboard**
   - Runtime errors appear in application logs
   - Database errors show connection issues

2. **Test in Swagger UI**
   - Use `/api/docs` to test endpoints
   - Check request/response format

3. **Verify Environment Variables**
   - Ensure all required variables are set in Railway
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

- **API Documentation**: Check `/api/docs` for endpoint details
- **Railway Logs**: View deployment and runtime logs
- **Team Lead**: Contact for database credentials or access issues

---

**Deployment URL**: https://rm365-tools-testing-production.up.railway.app

**API Docs**: https://rm365-tools-testing-production.up.railway.app/api/docs
