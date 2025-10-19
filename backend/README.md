# RM365 Toolbox - Backend

FastAPI backend service providing REST APIs for the RM365 Toolbox application. This guide will help you understand, develop, and maintain the backend services.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Database Setup](#database-setup)
- [API Development](#api-development)
- [Authentication](#authentication)
- [Testing](#testing)
- [Deployment](#deployment)
- [Common Tasks](#common-tasks)

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
- **PostgreSQL**: Multiple database instances
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

## Getting Started

### Prerequisites

- Python 3.11 or higher
- PostgreSQL 14+ (for local development)
- Git

### Initial Setup

1. **Clone and Navigate**
   ```bash
   cd backend
   ```

2. **Create Virtual Environment**
   ```bash
   # Windows
   python -m venv venv
   venv\Scripts\activate

   # macOS/Linux
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment**
   Create a `.env` file in the `backend/` directory:
   ```bash
   # Authentication
   AUTH_SECRET_KEY=your-secret-key-here-change-in-production
   AUTH_ALGORITHM=HS256
   ACCESS_TOKEN_EXPIRE_MINUTES=30

   # Database - Attendance
   ATTENDANCE_DB_HOST=localhost
   ATTENDANCE_DB_PORT=5432
   ATTENDANCE_DB_NAME=attendance_db
   ATTENDANCE_DB_USER=postgres
   ATTENDANCE_DB_PASSWORD=your_password

   # Database - Labels
   LABELS_DB_URI=postgresql+psycopg2://postgres:your_password@localhost:5432/labels_db

   # Database - Inventory Logs
   INVENTORY_LOGS_HOST=localhost
   INVENTORY_LOGS_PORT=5432
   INVENTORY_LOGS_DB=inventory_db
   INVENTORY_LOGS_USER=postgres
   INVENTORY_LOGS_PASSWORD=your_password

   # Zoho Integration (get from team lead)
   ZC_CLIENT_ID=your_zoho_client_id
   ZC_CLIENT_SECRET=your_zoho_client_secret
   ZC_REFRESH_TOKEN=your_zoho_refresh_token
   ZC_ORG_ID=your_zoho_org_id

   # CORS (for local development)
   ALLOW_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
   ```

5. **Start the Server**
   ```bash
   uvicorn app:app --reload --host 0.0.0.0 --port 8000
   ```

6. **Verify Setup**
   - Open browser to `http://localhost:8000/api/docs`
   - You should see the interactive API documentation
   - Try the health check endpoint: `http://localhost:8000/api/health`

## Project Structure

```
backend/
├── app.py                      # Main application
├── start_server.py             # Production server starter
├── serve_frontend.py           # Frontend serving utility
├── Dockerfile                  # Container configuration
├── requirements.txt            # Python dependencies
├── .env                        # Environment variables (don't commit!)
│
├── core/                       # Core functionality
│   ├── __init__.py
│   ├── auth.py                # JWT authentication
│   ├── config.py              # Settings management
│   ├── db.py                  # Database connections
│   ├── errors.py              # Error handlers
│   ├── middleware.py          # Custom middleware
│   ├── pagination.py          # Pagination helpers
│   └── security.py            # Security utilities
│
├── common/                    # Shared utilities
│   ├── __init__.py
│   ├── deps.py               # Dependency injection
│   ├── dto.py                # Data transfer objects
│   └── utils.py              # Helper functions
│
└── modules/                   # Feature modules
    ├── _integrations/        # External services
    │   └── zoho/            # Zoho Creator client
    │       ├── __init__.py
    │       └── client.py    # API client
    │
    ├── attendance/          # Attendance tracking
    │   ├── __init__.py
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
    │       ├── __init__.py
    │       ├── card_reader.py
    │       └── fingerprint_reader.py
    │
    ├── inventory/          # Stock management
    │   ├── __init__.py
    │   ├── adjustments/   # Stock adjustments
    │   │   ├── api.py
    │   │   ├── repo.py
    │   │   ├── schemas.py
    │   │   └── service.py
    │   └── management/    # Item CRUD
    │       ├── api.py
    │       ├── repo.py
    │       ├── schemas.py
    │       └── service.py
    │
    ├── labels/            # Label generation
    │   ├── api.py
    │   ├── generator.py   # PDF generation
    │   ├── repo.py
    │   ├── schemas.py
    │   └── service.py
    │
    ├── roles/             # Role management
    │   ├── api.py
    │   ├── models.py
    │   ├── repo.py
    │   ├── schemas.py
    │   └── service.py
    │
    ├── sales_imports/     # Data import
    │   ├── api.py
    │   ├── import_uk_sales.py
    │   ├── repo.py
    │   ├── schemas.py
    │   └── service.py
    │
    └── users/             # User management
        ├── api.py
        ├── repo.py
        ├── schemas.py
        └── service.py
```

## Database Setup

### Multiple Database Architecture

The application uses **three separate PostgreSQL databases**:

1. **Attendance Database**: Employee attendance records
2. **Labels Database**: Inventory items and label history
3. **Inventory Logs Database**: Stock adjustments and sync logs

### Production vs Local Development

⚠️ **IMPORTANT**: The databases are hosted on Railway (production). For local development, you have **two options**:

#### Option 1: Connect to Production Databases (Recommended for Testing)

**Advantages:**
- ✅ No local database setup needed
- ✅ Work with real data
- ✅ Test against actual production schema
- ✅ Changes you make in code work immediately

**Configuration:**
1. Get production database credentials from team lead
2. Add to your `.env` file:
```bash
# Production databases (hosted on Railway)
ATTENDANCE_DB_HOST=your-railway-host.railway.internal
ATTENDANCE_DB_PORT=5432
ATTENDANCE_DB_NAME=railway
ATTENDANCE_DB_USER=postgres
ATTENDANCE_DB_PASSWORD=production-password-from-team-lead

LABELS_DB_URI=postgresql+psycopg2://postgres:password@railway-host:5432/labels

INVENTORY_LOGS_HOST=another-railway-host.railway.internal
INVENTORY_LOGS_PORT=5432
INVENTORY_LOGS_DB=inventory
INVENTORY_LOGS_USER=postgres
INVENTORY_LOGS_PASSWORD=production-password-from-team-lead
```

3. **Start local backend server**:
```bash
uvicorn app:app --reload
```

4. **Test your changes**:
   - Your code changes run locally
   - But data comes from/goes to Railway databases
   - **No need to deploy to test!**

**How it works:**
```
Your Local Machine                    Railway (Cloud)
┌─────────────────┐                  ┌──────────────┐
│  VS Code        │    Connect to    │              │
│  ↓              │  ───────────────→│  PostgreSQL  │
│  Python Backend │                  │  Databases   │
│  (localhost)    │  ←───────────────│              │
└─────────────────┘   Query/Update   └──────────────┘
```

**⚠️ Be Careful:**
- You're working with real production data
- Database changes affect everyone
- Always test queries carefully
- Use transactions when testing updates

#### Option 2: Local PostgreSQL (For Isolated Development)

**Advantages:**
- ✅ Complete isolation from production
- ✅ Safe to experiment
- ✅ Can delete/recreate tables freely
- ✅ No internet required

**Disadvantages:**
- ❌ Requires PostgreSQL installation
- ❌ Need to set up schemas
- ❌ Data won't match production

**Setup:**
1. Install PostgreSQL locally
2. Create local databases:
```sql
CREATE DATABASE attendance_local;
CREATE DATABASE labels_local;
CREATE DATABASE inventory_local;
```

3. Configure `.env` for local:
```bash
ATTENDANCE_DB_HOST=localhost
ATTENDANCE_DB_PORT=5432
ATTENDANCE_DB_NAME=attendance_local
ATTENDANCE_DB_USER=postgres
ATTENDANCE_DB_PASSWORD=your-local-password
```

4. Tables will auto-create on first use

### Do You Need to Deploy to Railway/Cloudflare to Test?

**Short Answer: NO! ✅**

**For Backend Code Changes:**
- ✅ Code runs locally on your machine
- ✅ Connects to Railway databases remotely
- ✅ Test changes immediately without deploying
- ❌ Only deploy when ready to push to production

**For Frontend Code Changes:**
- ✅ Serve frontend locally (Live Server)
- ✅ Configure to point to local backend
- ✅ Test full stack locally
- ❌ Only deploy to Cloudflare when ready

**Example Local Development Workflow:**

```bash
# 1. Start backend locally (connects to Railway DBs)
cd backend
uvicorn app:app --reload
# Runs at: http://localhost:8000

# 2. Start frontend locally
cd frontend
python -m http.server 3000
# Runs at: http://localhost:3000

# 3. Configure frontend to use local backend
# Edit frontend/js/config.js:
export const config = {
  API: 'http://localhost:8000'  // Your local backend
};

# 4. Make changes and test immediately!
# No deployment needed until you're ready
```

**When to Deploy:**

Deploy to Railway/Cloudflare ONLY when:
1. ✅ You've tested changes locally
2. ✅ Everything works correctly
3. ✅ You're ready for changes to go live
4. ✅ Code is committed to Git

**Deployment Process:**
```bash
# 1. Test locally first
# 2. Commit changes
git add .
git commit -m "Add new feature"

# 3. Push to GitHub
git push origin main

# 4. Railway auto-deploys backend
# 5. Cloudflare auto-deploys frontend
# 6. Changes go live in ~2-5 minutes
```

### Database Schema Changes

**If you modify database tables:**

1. **Local Testing** (Option 1 - Production DBs):
   - Schema changes affect production immediately
   - Coordinate with team before modifying schemas
   - Use migrations or discuss with team lead

2. **Local Testing** (Option 2 - Local DBs):
   - Safe to experiment
   - Changes only affect your local DB
   - Must replicate to production later

**Best Practice for Schema Changes:**
```python
# In repo.py, use safe schema updates
def _ensure_tables(self):
    """Create tables if they don't exist."""
    cursor = self.conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS my_table (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL
        )
    """)
    
    # Add new column safely (doesn't fail if exists)
    cursor.execute("""
        ALTER TABLE my_table 
        ADD COLUMN IF NOT EXISTS new_column VARCHAR(50)
    """)
    self.conn.commit()
```

### Connecting to Railway Databases

**Getting Database Credentials:**

1. Ask team lead for Railway access
2. Or get credentials from Railway dashboard:
   - Go to Railway project
   - Click on PostgreSQL service
   - Copy connection details
   - Add to your `.env` file

**Testing Connection:**
```python
# Quick test
python -c "from core.db import get_attendance_connection; print('✅ Connected!')"
```

**If Connection Fails:**
- Check VPN/firewall settings
- Verify credentials are correct
- Ensure Railway allows external connections
- Check your IP isn't blocked

### Why Multiple Databases?

- **Separation of concerns**: Each domain has its own schema
- **Independent scaling**: Can scale databases separately
- **Different hosting**: Some may be external (e.g., Railway, Supabase)
- **Access control**: Different credentials per database

### Setting Up Local Databases (Optional)

```sql
-- Connect to PostgreSQL
psql -U postgres

-- Create databases
CREATE DATABASE attendance_db;
CREATE DATABASE labels_db;
CREATE DATABASE inventory_db;

-- Verify
\l
```

### Database Connections

Connections are managed in `core/db.py`:

```python
# Example: Get attendance database connection
from core.db import get_attendance_connection

conn = get_attendance_connection()
cursor = conn.cursor()
cursor.execute("SELECT * FROM employees")
```

### Schema Management

- **Auto-creation**: Tables are created automatically on first use
- **Migrations**: Schema changes are in the `repo.py` files
- **Initialization**: `_ensure_tables()` methods create tables if missing

## API Development

### Creating a New API Module

1. **Create Module Directory**
   ```bash
   mkdir -p modules/new_feature
   cd modules/new_feature
   ```

2. **Create Module Files**
   ```bash
   touch __init__.py api.py models.py repo.py schemas.py service.py
   ```

3. **Define Models** (`models.py`)
   ```python
   from sqlalchemy import Column, Integer, String, DateTime
   from sqlalchemy.ext.declarative import declarative_base

   Base = declarative_base()

   class MyModel(Base):
       __tablename__ = 'my_table'
       
       id = Column(Integer, primary_key=True)
       name = Column(String(100), nullable=False)
       created_at = Column(DateTime, nullable=False)
   ```

4. **Define Schemas** (`schemas.py`)
   ```python
   from pydantic import BaseModel
   from datetime import datetime

   class MyItemCreate(BaseModel):
       name: str

   class MyItemResponse(BaseModel):
       id: int
       name: str
       created_at: datetime

       class Config:
           from_attributes = True
   ```

5. **Create Repository** (`repo.py`)
   ```python
   from core.db import get_my_connection

   class MyRepository:
       def __init__(self):
           self.conn = get_my_connection()
       
       def get_all(self):
           cursor = self.conn.cursor()
           cursor.execute("SELECT * FROM my_table")
           return cursor.fetchall()
       
       def create(self, name: str):
           cursor = self.conn.cursor()
           cursor.execute(
               "INSERT INTO my_table (name) VALUES (%s) RETURNING id",
               (name,)
           )
           self.conn.commit()
           return cursor.fetchone()[0]
   ```

6. **Create Service** (`service.py`)
   ```python
   from .repo import MyRepository
   from .schemas import MyItemCreate, MyItemResponse

   class MyService:
       def __init__(self):
           self.repo = MyRepository()
       
       def get_items(self) -> list[MyItemResponse]:
           items = self.repo.get_all()
           return [MyItemResponse(**item) for item in items]
       
       def create_item(self, item: MyItemCreate) -> MyItemResponse:
           item_id = self.repo.create(item.name)
           return self.get_item(item_id)
   ```

7. **Create API Routes** (`api.py`)
   ```python
   from fastapi import APIRouter, Depends
   from .service import MyService
   from .schemas import MyItemCreate, MyItemResponse
   from common.deps import get_current_user

   router = APIRouter()
   service = MyService()

   @router.get("/items", response_model=list[MyItemResponse])
   async def get_items(user=Depends(get_current_user)):
       return service.get_items()

   @router.post("/items", response_model=MyItemResponse)
   async def create_item(
       item: MyItemCreate,
       user=Depends(get_current_user)
   ):
       return service.create_item(item)
   ```

8. **Register in app.py**
   ```python
   # Add to working_modules list
   ('modules.new_feature.api', 'router', f'{API}/new-feature', ['new-feature']),
   ```

### API Design Guidelines

- **Use proper HTTP methods**: GET, POST, PATCH, DELETE
- **RESTful naming**: `/api/v1/resources` not `/api/v1/getResources`
- **Response models**: Always define Pydantic response schemas
- **Authentication**: Use `Depends(get_current_user)` for protected routes
- **Error handling**: Raise `HTTPException` with appropriate status codes
- **Pagination**: Use pagination helpers from `core/pagination.py`

## Authentication

### JWT Token Flow

1. **Login** (`POST /api/v1/auth/login`)
   - User sends username/password
   - Backend validates credentials
   - Returns JWT access token

2. **Protected Routes**
   - Client sends token in `Authorization: Bearer <token>` header
   - Backend validates token
   - Extracts user info from token
   - Proceeds with request

3. **Token Validation**
   ```python
   from common.deps import get_current_user
   from fastapi import Depends

   @router.get("/protected")
   async def protected_route(user=Depends(get_current_user)):
       # user contains: username, role, allowed_tabs
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

### Password Security

- Passwords are hashed using bcrypt
- Never store plain text passwords
- Use `core.security.hash_password()` and `verify_password()`

## Testing

### Local Testing in VS Code

#### 1. Running the Backend Server

**Method 1: Integrated Terminal**
```bash
# Open VS Code terminal (Ctrl + `)
cd backend
source venv/bin/activate  # Windows: venv\Scripts\activate
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

**Method 2: VS Code Run Configuration**

Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: FastAPI",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": [
        "app:app",
        "--reload",
        "--host",
        "0.0.0.0",
        "--port",
        "8000"
      ],
      "jinja": true,
      "justMyCode": true,
      "cwd": "${workspaceFolder}/backend"
    }
  ]
}
```

Then press `F5` or click "Run and Debug" → "Python: FastAPI"

**Method 3: VS Code Task**

Create `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Run Backend",
      "type": "shell",
      "command": "uvicorn",
      "args": ["app:app", "--reload"],
      "options": {
        "cwd": "${workspaceFolder}/backend"
      },
      "problemMatcher": [],
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

Run with `Ctrl+Shift+B`

#### 2. Testing Your Changes

**Quick Test Workflow:**

1. **Make Code Changes** in VS Code
   - Edit files in `backend/modules/`
   - Save file (Ctrl+S)

2. **Server Auto-Reloads** (if using `--reload` flag)
   - Watch terminal for reload message
   - Any errors will show in terminal

3. **Test Immediately**
   - Open Swagger UI: `http://localhost:8000/api/docs`
   - Test your endpoint
   - Check terminal for logs

**Example Test Session:**

```bash
# Terminal output shows:
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.

# You edit a file and save...
INFO:     Shutting down
INFO:     Waiting for application shutdown.
INFO:     Application shutdown complete.
INFO:     Finished server process [12345]
INFO:     Waiting for file changes before restarting...
INFO:     Detected file change in 'modules/users/api.py'. Reloading...
INFO:     Started reloader process [12346]
INFO:     Started server process [12347]
INFO:     Application startup complete.

# ✅ Server restarted with your changes!
```

#### 3. Using VS Code Debugger

**Set Breakpoints:**
1. Click left of line number to add breakpoint (red dot)
2. Start debugger (F5)
3. Make API request
4. Execution pauses at breakpoint
5. Inspect variables, step through code

**Debug Example:**
```python
# modules/users/service.py
def get_users(self):
    users = self.repo.get_all()  # ← Set breakpoint here
    return [UserResponse(**user) for user in users]
```

When you hit the breakpoint:
- **Variables panel**: See `users` value
- **Debug console**: Type `users[0]` to inspect
- **Step Over (F10)**: Execute next line
- **Step Into (F11)**: Go into function
- **Continue (F5)**: Resume execution

#### 4. Watching Logs in Real-Time

**Terminal Output:**
```python
# Add logging to your code
import logging
logger = logging.getLogger(__name__)

logger.info(f"Processing user: {username}")
logger.debug(f"Query params: {params}")
logger.error(f"Failed to process: {error}")
```

View in terminal as requests happen.

#### 5. Testing Database Changes

**Quick Database Test:**
```bash
# In VS Code terminal
cd backend
python

# Then in Python REPL:
>>> from core.db import get_attendance_connection
>>> conn = get_attendance_connection()
>>> cursor = conn.cursor()
>>> cursor.execute("SELECT * FROM users LIMIT 5")
>>> print(cursor.fetchall())
>>> conn.close()
```

**Or create a test script:**
```python
# test_my_feature.py
from modules.users.repo import UserRepository

repo = UserRepository()
users = repo.get_all()
print(f"Found {len(users)} users")
for user in users[:5]:
    print(f"  - {user['username']} ({user['role']})")
```

Run with: `python test_my_feature.py`

### Interactive API Testing

1. **Swagger UI**: `http://localhost:8000/api/docs`
   - Interactive documentation
   - Test endpoints directly
   - See request/response schemas
   - **Try it out** button to test immediately

2. **ReDoc**: `http://localhost:8000/api/redoc`
   - Alternative documentation view
   - Better for reading

**Swagger Testing Steps:**
1. Open `http://localhost:8000/api/docs`
2. Find your endpoint
3. Click "Try it out"
4. Fill in parameters
5. Click "Execute"
6. See response immediately

### Testing with VS Code REST Client Extension

**Install Extension:**
- Install "REST Client" by Huachao Mao

**Create Test File:**
```http
# tests/api-tests.http

### Variables
@baseUrl = http://localhost:8000/api/v1
@token = your-jwt-token-here

### Login
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "password"
}

### Get Users (requires auth)
GET {{baseUrl}}/users
Authorization: Bearer {{token}}

### Create User
POST {{baseUrl}}/users
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "username": "newuser",
  "password": "password123",
  "role": "user"
}
```

Click "Send Request" above each test to execute.

### Manual Testing with cURL

```bash
# Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# Use token
TOKEN="your_jwt_token_here"
curl -X GET http://localhost:8000/api/v1/users \
  -H "Authorization: Bearer $TOKEN"
```

### Testing Database Connections

```python
# Test all connections
python -c "from core.db import get_attendance_connection; print(get_attendance_connection())"
```

### VS Code Extensions for Testing

**Recommended Extensions:**
1. **Python** (Microsoft) - Python support
2. **Pylance** (Microsoft) - IntelliSense
3. **REST Client** - Test APIs without leaving VS Code
4. **Thunder Client** - Alternative API testing
5. **Database Client** - View/query databases
6. **Error Lens** - Inline error messages

### Quick Testing Checklist

Before committing changes:

- [ ] Code saved and server reloaded without errors
- [ ] Tested endpoint in Swagger UI
- [ ] Checked terminal logs for errors
- [ ] Tested with frontend (if applicable)
- [ ] Database changes verified
- [ ] No console errors
- [ ] Authorization working correctly

## Deployment

### Railway Deployment

The backend is deployed to Railway with automatic deployments:

1. **Environment Variables**
   - Set all required env vars in Railway dashboard
   - Use Railway's PostgreSQL addon for databases
   - Configure CORS for your frontend domain

2. **Automatic Deployment**
   - Push to `main` branch triggers deployment
   - Railway builds and deploys automatically
   - Check logs in Railway dashboard

3. **Health Checks**
   - Railway pings `/api/health` to verify service
   - Returns uptime and status

### Docker Deployment

```bash
# Build image
docker build -t rm365-backend .

# Run container
docker run -d \
  -p 8000:8000 \
  --env-file .env \
  rm365-backend
```

## Common Tasks

### Adding a New Endpoint

1. Define schema in `schemas.py`
2. Add repository method in `repo.py`
3. Add service method in `service.py`
4. Add route in `api.py`
5. Test in Swagger UI

### Debugging Database Issues

```python
# Enable SQL logging
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
```

### Adding a New Database

1. Add connection details to `.env`
2. Create connection function in `core/db.py`
3. Use in your repository

### Updating Dependencies

```bash
# Update requirements.txt
pip freeze > requirements.txt

# Or manually add package
pip install package-name
pip freeze | grep package-name >> requirements.txt
```

### Viewing Logs

```bash
# Local development (console output)
uvicorn app:app --reload

# Production (Railway)
# Check Railway dashboard logs tab
```

## Troubleshooting

### Common Issues

**Database Connection Error**
```
Solution: Check .env file, verify PostgreSQL is running, check credentials
```

**Import Errors**
```
Solution: Activate virtual environment, reinstall requirements
```

**CORS Errors**
```
Solution: Add frontend URL to ALLOW_ORIGINS in .env
```

**Authentication Fails**
```
Solution: Check AUTH_SECRET_KEY is set, verify token format
```

### Getting Help

1. Check the Swagger docs: `http://localhost:8000/api/docs`
2. Review logs in console
3. Check Railway logs if deployed
4. Ask team lead for Zoho credentials or database access

## Best Practices

### Code Style
- Follow PEP 8
- Use type hints
- Add docstrings to functions
- Keep functions small and focused

### Security
- Never commit `.env` files
- Use environment variables for secrets
- Validate all input with Pydantic
- Use parameterized queries (prevent SQL injection)

### Performance
- Use database indexes for frequent queries
- Implement pagination for large datasets
- Cache external API calls when appropriate
- Close database connections properly

### Documentation
- Update API docs when adding endpoints
- Comment complex business logic
- Keep README updated with new features

---

**Welcome to the team! 🎉**

For questions or help, reach out to your team lead. Happy coding!
