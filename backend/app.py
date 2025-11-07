import os
import time
import base64
from pathlib import Path

# Load environment variables from .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("🔧 Environment variables loaded from .env file")
except ImportError:
    print("⚠️  python-dotenv not installed, using system environment variables")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.config import settings
from core.middleware import install_middleware
from core.errors import install_handlers

BOOT_T0 = time.time()
app = FastAPI(
    title='VK API',
    version='1.0.0',
    docs_url='/api/docs',
    openapi_url='/api/openapi.json',
)

# --- Database Initialization (non-blocking) ---------------------------------
try:
    import threading
    from core.db import initialize_database

    def _init_db_bg():
        try:
            initialize_database()
        except Exception as e:
            print(f"❌ Background DB initialization failed: {e}")

    threading.Thread(target=_init_db_bg, daemon=True).start()
    print("🧩 DB initialization started in background thread")
except Exception as e:
    print(f"⚠️  Could not start background DB init: {e}")

# --- CORS (Respects env vars, falls back to wildcard) ----------------------
def _get_cors_config():
    """Get CORS configuration from environment or use permissive defaults."""
    origins_env = os.getenv('ALLOW_ORIGINS', '').strip()
    regex_env = os.getenv('ALLOW_ORIGIN_REGEX', '').strip()
    
    # Parse origins - support comma-separated values
    if origins_env:
        origins = [o.strip() for o in origins_env.split(',') if o.strip()]
        print(f"🌍 CORS: Using origins from env: {origins}")
    else:
        origins = ["*"]
        print("🌍 CORS: No ALLOW_ORIGINS set, using wildcard")
    
    # Use regex if provided
    if regex_env:
        print(f"🌍 CORS: Using regex from env: {regex_env}")
    else:
        regex_env = None
    
    return origins, regex_env

allow_origins, allow_origin_regex = _get_cors_config()

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Middleware & error handlers ---------------------------------------------
install_middleware(app)   # request logging, request-id, etc.
install_handlers(app)     # AppError → JSON

# --- Health ------------------------------------------------------------------
@app.get('/api/health')
def health():
    return {'status': 'ok', 'uptime': round(time.time() - BOOT_T0, 2)}

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
        'allow_credentials': False,
    }

@app.get('/api/debug/inventory')
def debug_inventory():
    """Debug endpoint for inventory adjustments"""
    try:
        # Test environment variables
        env_status = {
            'zoho_client_id': '✅' if os.getenv('ZC_CLIENT_ID') else '❌',
            'zoho_org_id': '✅' if os.getenv('ZC_ORG_ID') else '❌',
            'inventory_db_host': '✅' if os.getenv('INVENTORY_LOGS_HOST') else '❌',
        }
        
        # Test database connection
        db_status = 'unknown'
        try:
            from core.db import get_inventory_log_connection
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            conn.close()
            db_status = '✅ connected'
        except Exception as e:
            db_status = f'❌ {str(e)}'
        
        # Test Zoho token
        zoho_status = 'unknown'
        try:
            from modules._integrations.zoho.client import get_cached_inventory_token
            token = get_cached_inventory_token()
            zoho_status = '✅ token obtained' if token else '❌ no token'
        except Exception as e:
            zoho_status = f'❌ {str(e)}'
        
        return {
            'status': 'debug',
            'environment': env_status,
            'database': db_status,
            'zoho': zoho_status,
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
# Removed test-db endpoint - not needed for production Railway deployment

# Replace the router composition section in backend/app.py with this:

# --- Router composition (feature-first) --------------------------------------
API = '/api/v1'

try:
    from core.auth import router as auth_router
    app.include_router(auth_router, prefix=f'{API}/auth', tags=['auth'])
    app.include_router(auth_router, prefix='/auth', tags=['auth-legacy'])
    print('[boot] SUCCESS: mounted auth router')
except Exception as e:
    print('[boot] auth router failed:', e)

# Only mount modules that are complete and working
working_modules = [
    ('modules.users.api', 'router', f'{API}/users', ['users']),
    ('modules.roles.api', 'router', f'{API}/roles', ['roles']),
    ('modules.attendance.api', 'router', f'{API}/attendance', ['attendance']),
    ('modules.enrollment.api', 'router', f'{API}/enrollment', ['enrollment']),
    ('modules.labels.api', 'router', f'{API}/labels', ['labels']),
    ('modules.salesdata.api', 'router', f'{API}/salesdata', ['salesdata']),
    ('modules.inventory.adjustments.api', 'router', f'{API}/inventory/adjustments', ['inventory-adjustments']),
    ('modules.inventory.management.api', 'router', f'{API}/inventory/management', ['inventory-management']),
]

for mod, attr, prefix, tags in working_modules:
    try:
        print(f'[boot] Attempting to mount {mod} at {prefix}...')
        module = __import__(mod, fromlist=[attr])
        router = getattr(module, attr)
        app.include_router(router, prefix=prefix, tags=tags)
        print(f'[boot] SUCCESS: mounted {mod} at {prefix}')
    except Exception as e:
        print(f'[boot] ERROR: {mod} failed to mount at {prefix}:', e)

# --- Static frontend mounts (after API routers) ------------------------------
FRONTEND_DIR = Path(__file__).resolve().parent.parent / 'frontend'
JS_DIR     = FRONTEND_DIR / 'js'
CSS_DIR    = FRONTEND_DIR / 'css'
HTML_DIR   = FRONTEND_DIR / 'html'
ASSETS_DIR = FRONTEND_DIR / 'assets'

def _mount_if_exists(prefix: str, path: Path, *, html: bool = False, name: str = ''):
    if path.is_dir():
        app.mount(prefix, StaticFiles(directory=str(path), html=html), name=name or prefix.strip('/'))
        print(f'[boot] mounted {prefix} -> {path}')
    else:
        print(f'[boot] SKIP mount {prefix} (not found): {path}')

# 1) Explicit asset mounts
_mount_if_exists('/js',     JS_DIR,     html=False, name='js')
_mount_if_exists('/css',    CSS_DIR,    html=False, name='css')
_mount_if_exists('/html',   HTML_DIR,   html=False, name='html')
_mount_if_exists('/assets', ASSETS_DIR, html=False, name='assets')

# 2) SPA fallback at root
if FRONTEND_DIR.is_dir():
    app.mount('/', StaticFiles(directory=str(FRONTEND_DIR), html=True), name='frontend')
    print(f'[boot] mounted / -> {FRONTEND_DIR}')
else:
    print('[boot] frontend dir not found:', FRONTEND_DIR)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
