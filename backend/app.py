import os
import time
import base64
import json
from pathlib import Path
from typing import Optional

# Load environment variables from .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("🔧 Environment variables loaded from .env file")
except ImportError:
    print("⚠️  python-dotenv not installed, using system environment variables")

from fastapi import FastAPI, HTTPException, Response, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from core.config import settings
from core.middleware import install_middleware
from core.errors import install_handlers

NULL_SENTINELS = {"null", "none", "undefined", "false", "0"}

def _normalize_origin(origin: str) -> Optional[str]:
    sanitized = origin.strip().rstrip('/')
    if not sanitized:
        return None
    if sanitized.lower() in NULL_SENTINELS:
        return None
    return sanitized

BOOT_T0 = time.time()
app = FastAPI(
    title='VK API',
    version='1.0.0',
    docs_url='/api/docs',
    openapi_url='/api/openapi.json',
)

# --- WebSocket Integration - Deferred until after middleware ----------------
# We need to add Socket.IO AFTER all middleware is configured
# This is done at the bottom of this file


# --- Database Initialization -------------------------------------------------
try:
    from core.db import initialize_database
    initialize_database()
except Exception as e:
    print(f"❌ Database initialization failed: {e}")
    print("⚠️  Application will continue but may not function properly")


# --- CORS (From working Label Printer #7 configuration) ---------------------
def _parse_origins_env():
    """
    Accepts:
      - JSON array: '["https://a.com","https://b.com"]'
      - Comma-separated string: 'https://a.com,https://b.com'
      - Empty / missing -> []
    Never raises; always returns a list[str].
    """
    raw = os.getenv('ALLOW_ORIGINS', '').strip()
    if not raw:
        return []

    # Debug logging
    print(f"🔍 Raw ALLOW_ORIGINS: {raw}")
    
    # First check if it looks like JSON (starts with '[')
    if raw.startswith('['):
        try:
            # Handle JSON array format
            val = json.loads(raw)
            if isinstance(val, list):
                origins = [_normalize_origin(str(x)) for x in val]
                origins = [o for o in origins if o]
                print(f"✅ Parsed JSON origins: {origins}")
                return origins
            # If someone set ALLOW_ORIGINS='null' or object, fall back
        except json.JSONDecodeError as e:
            print(f"⚠️  JSON parse error: {e}, falling back to comma-separated")
        except Exception as e:
            print(f"⚠️  Unexpected error parsing origins: {e}")
    else:
        print(f"ℹ️  ALLOW_ORIGINS is not JSON array, using comma-separated format")

    # Fallback: comma-separated
    fallback = [_normalize_origin(p) for p in raw.split(',')]
    fallback = [p for p in fallback if p]
    print(f"📋 Fallback comma-separated origins: {fallback}")
    return fallback

def _parse_regex_env():
    """
    Returns a string pattern or None. Empty strings are treated as None.
    Cleans up common regex mistakes for CORS origin matching.
    """
    patt = os.getenv('ALLOW_ORIGIN_REGEX', '').strip()
    if not patt:
        return None
    
    print(f"🔍 Raw ALLOW_ORIGIN_REGEX: {patt}")
    
    # Remove quotes if present
    patt = patt.strip('"').strip("'")

    if not patt:
        return None

    if patt.lower() in NULL_SENTINELS:
        print("⚠️  Regex env set to null-like value; falling back to defaults")
        return None
    
    # Remove anchors and path patterns - CORS only matches origin (protocol + domain)
    # Common mistakes: ^https://... or .../.*)?$ or (/.*)?$
    patt = patt.lstrip('^')
    if '(/.*' in patt:
        # Remove path matching patterns like (/.*)?$
        patt = patt.split('(/.*')[0]
    patt = patt.rstrip('$')
    
    print(f"✅ Cleaned ALLOW_ORIGIN_REGEX: {patt}")
    return patt or None

def _resolve_allow_origins():
    """Return allowed origins preferring env, else config settings."""
    env_list = _parse_origins_env()
    if env_list:
        print(f"✅ Using {len(env_list)} origin(s) from environment")
        return env_list
    
    # Fallback to settings
    if settings.ALLOW_ORIGINS:
        print(f"⚠️  No env origins found, using settings")
        if isinstance(settings.ALLOW_ORIGINS, str):
            return [o.strip() for o in settings.ALLOW_ORIGINS.split(',') if o.strip()]
        return list(settings.ALLOW_ORIGINS)
    
    return []

def _resolve_allow_origin_regex():
    """Return regex pattern preferring env, else config settings."""
    env_val = _parse_regex_env()
    if env_val:
        return env_val
    return settings.ALLOW_ORIGIN_REGEX

allow_origins = _resolve_allow_origins()
allow_origin_regex = _resolve_allow_origin_regex()

DEFAULT_PAGES_ORIGIN = "https://rm365-tools-testing.pages.dev"

if allow_origins and allow_origins != ['*']:
    if DEFAULT_PAGES_ORIGIN not in allow_origins:
        allow_origins.append(DEFAULT_PAGES_ORIGIN)

if not allow_origins and allow_origin_regex:
    # If someone set regex to something else, still include the production Pages origin explicitly.
    allow_origins = [DEFAULT_PAGES_ORIGIN]

# Add common development and Cloudflare origins if not specified
if not allow_origins and not allow_origin_regex:
    allow_origins = [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5000",
        "https://rm365-toolbox.com",  # Custom domain
        "http://rm365-toolbox.com",   # Custom domain (HTTP)
    ]
    print("🔧 Using default CORS origins for development")

# Ensure the regex for Cloudflare is always present if not otherwise specified
if not allow_origin_regex:
    allow_origin_regex = r"https://.*\.pages\.dev"
    print("🔧 Applying default Cloudflare Pages CORS regex")

print(f"🌍 CORS Configuration:")
if allow_origins:
    print(f"   📝 Origins list has {len(allow_origins)} entries")
if allow_origin_regex:
    print(f"   📝 Using regex pattern for dynamic matching")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GZip Compression (for faster data transfer) -----------------------------
# Compress responses larger than 1KB to reduce bandwidth and improve load times
app.add_middleware(
    GZipMiddleware,
    minimum_size=1000,  # Only compress responses >= 1KB
    compresslevel=6     # Balance between speed and compression (1-9, default is 5)
)
print("✅ GZip compression enabled (minimum size: 1KB)")

# --- Middleware & error handlers ---------------------------------------------
install_middleware(app)   # request logging, request-id, etc.
install_handlers(app)     # AppError → JSON

# --- Health ------------------------------------------------------------------
@app.get('/api/health')
def health():
    return {'status': 'ok', 'uptime': round(time.time() - BOOT_T0, 2)}

@app.get('/robots.txt', include_in_schema=False)
async def serve_robots():
    """Serve robots.txt file for search engine crawlers"""
    robots_path = Path(__file__).resolve().parent.parent / 'robots.txt'
    if robots_path.is_file():
        return FileResponse(
            robots_path,
            media_type='text/plain',
            headers={
                'Cache-Control': 'public, max-age=86400',  # Cache for 24 hours
            }
        )
    return Response(
        content="User-agent: *\nDisallow: /",
        media_type='text/plain'
    )

@app.get('/api/cors-test')
def cors_test():
    """Simple CORS test endpoint"""
    return {
        'message': 'CORS is working!',
        'timestamp': time.time(),
        'status': 'success'
    }

@app.get('/api/cors-config')
def cors_config():
    """Expose the active CORS configuration for quick diagnostics."""
    return {
        'allow_origins': allow_origins,
        'allow_origin_regex': allow_origin_regex,
        'allow_credentials': True,  # Match actual CORS middleware setting
    }

@app.get('/api/debug/inventory')
def debug_inventory():
    """Debug endpoint for inventory adjustments"""
    try:
        # Test environment variables
        env_status = {
            'inventory_db_host': '✅' if os.getenv('INVENTORY_LOGS_HOST') else '❌',
        }
        
        # Test database connection
        db_status = 'unknown'
        try:
            from core.db import get_inventory_log_connection, return_inventory_connection
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            return_inventory_connection(conn)
            db_status = '✅ connected'
        except Exception as e:
            db_status = f'❌ {str(e)}'
        
        return {
            'status': 'debug',
            'environment': env_status,
            'database': db_status,
            'cors_origins': allow_origins,
            'cors_regex': allow_origin_regex,
            'timestamp': time.time()
        }
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

# --- Fingerprint capture (lazy import) ---------------------------------------
@app.get('/scan-fingerprint')
def scan():
    try:
        from enrollment.fingerprint_reader import read_fingerprint_template  # lazy import
    except Exception:
        raise HTTPException(status_code=501, detail='Fingerprint capture isn\'t available on this host')
    try:
        tpl = read_fingerprint_template(timeout=8000)
        return {'template_b64': base64.b64encode(tpl).decode()}
    except Exception as e:
        raise HTTPException(status_code=501, detail=str(e))

# --- Optional DB smoke test --------------------------------------------------
# Removed test-db endpoint - not needed for production deployment

# Replace the router composition section in backend/app.py with this:

# --- Router composition (feature-first) --------------------------------------
API = '/api/v1'

try:
    from core.auth import router as auth_router
    app.include_router(auth_router, prefix=f'{API}/auth', tags=['auth'])
    app.include_router(auth_router, prefix='/auth', tags=['auth-legacy'])
except Exception as e:
    print(f'[boot] ERROR: {mod} failed to mount at {prefix}:', e)

# Only mount modules that are complete and working
working_modules = [
    ('modules.users.api', 'router', f'{API}/users', ['users']),
    ('modules.roles.api', 'router', f'{API}/roles', ['roles']),
    ('modules.attendance.api', 'router', f'{API}/attendance', ['attendance']),
    ('modules.enrollment.api', 'router', f'{API}/enrollment', ['enrollment']),
    ('modules.labels.api', 'router', f'{API}/labels', ['labels']),
    ('modules.salesdata.api', 'router', f'{API}/salesdata', ['salesdata']),
    ('modules.inventory.management.api', 'router', f'{API}/inventory/management', ['inventory-management']),
    ('modules.inventory.collaboration', 'router', f'{API}/inventory/collaboration', ['inventory-collaboration']),
    ('modules.inventory.order_fulfillment.api', 'router', f'{API}/magento', ['magento']),
]

for mod, attr, prefix, tags in working_modules:
    try:
        module = __import__(mod, fromlist=[attr])
        router = getattr(module, attr)
        app.include_router(router, prefix=prefix, tags=tags)
    except Exception as e:
        print(f'[boot] ERROR: {mod} failed to mount at {prefix}:', e)

# --- Static frontend mounts (after API routers) ------------------------------
FRONTEND_DIR = Path(__file__).resolve().parent.parent / 'frontend'
JS_DIR       = FRONTEND_DIR / 'js'
CSS_DIR      = FRONTEND_DIR / 'css'
HTML_DIR     = FRONTEND_DIR / 'html'
ASSETS_DIR   = FRONTEND_DIR / 'assets'
COMPONENTS_DIR = FRONTEND_DIR / 'components'

def _mount_if_exists(prefix: str, path: Path, *, html: bool = False, name: str = ''):
    if path.is_dir():
        app.mount(prefix, StaticFiles(directory=str(path), html=html), name=name or prefix.strip('/'))
    else:
        pass

# 1) Explicit asset mounts
_mount_if_exists('/js',         JS_DIR,         html=False, name='js')
_mount_if_exists('/css',        CSS_DIR,        html=False, name='css')
_mount_if_exists('/html',       HTML_DIR,       html=False, name='html')
_mount_if_exists('/assets',     ASSETS_DIR,     html=False, name='assets')
_mount_if_exists('/components', COMPONENTS_DIR, html=False, name='components')

# 2) SPA fallback - serve index.html at root and for SPA routes only (not API paths)
if FRONTEND_DIR.is_dir():
    # Serve index.html at root
    @app.get("/", include_in_schema=False)
    async def serve_root(response: Response):
        index_path = FRONTEND_DIR / "index.html"
        if index_path.is_file():
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend not found")
    
    # Custom 404 handler for SPA routing (serves index.html for non-API, non-static paths)
    # This must be registered AFTER all API routers are mounted
    @app.exception_handler(404)
    async def custom_404_handler(request: Request, exc: HTTPException):
        
        # If it's an API request, return JSON 404
        if request.url.path.startswith('/api/'):
            return JSONResponse(
                status_code=404,
                content={"detail": "API endpoint not found"}
            )
        
        # If it's a request for static assets that don't exist, return 404
        # Note: /components/ is handled by StaticFiles mount, but if file doesn't exist, return 404
        if any(request.url.path.startswith(prefix) for prefix in ['/js/', '/css/', '/html/', '/assets/', '/components/', '/ws/']):
            return JSONResponse(
                status_code=404,
                content={"detail": "File not found"}
            )
        
        # For all other paths (SPA routes), serve index.html
        index_path = FRONTEND_DIR / "index.html"
        if index_path.is_file():
            response = FileResponse(index_path)
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return response
        
        return JSONResponse(
            status_code=404,
            content={"detail": "Not found"}
        )
else:
    pass

fastapi_app = app  # Keep reference for wrapping/testing

# --- WebSocket Integration (After All Middleware) ---------------------------
# Wrap the FastAPI app with Socket.IO for real-time communication
try:
    from core.websocket import sio
    import socketio

    socket_app = socketio.ASGIApp(
        socketio_server=sio,
        other_asgi_app=fastapi_app,
        socketio_path='ws/socket.io'  # NOTE: ASGIApp prepends '/', so keep this bare
    )

    app = socket_app

    print("✅ WebSocket support enabled at /ws/socket.io")
except ImportError as e:
    app = fastapi_app
    print(f"⚠️  WebSocket dependencies not installed: {e}")
except Exception as e:
    app = fastapi_app
    print(f"⚠️  WebSocket initialization failed: {e}")
    import traceback
    traceback.print_exc()

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "false").lower() == "true"

    uvicorn.run("app:app", host=host, port=port, reload=reload)
