#!/usr/bin/env python3
"""
Startup script for RM365 Toolbox Backend
"""
import os
import sys
from pathlib import Path

# Get the directory where this script is located
script_dir = Path(__file__).parent.absolute()
backend_dir = script_dir

print(f"Script directory: {script_dir}")
print(f"Backend directory: {backend_dir}")

# Change to backend directory
os.chdir(backend_dir)
print(f"Changed to: {os.getcwd()}")

# Add backend directory to Python path
sys.path.insert(0, str(backend_dir))

# Check if app.py exists
app_py = backend_dir / "app.py"
if not app_py.exists():
    print(f"ERROR: app.py not found at {app_py}")
    sys.exit(1)

print("Starting backend server...")

try:
    # Import and run the app
    import app
    import uvicorn
    
    print("✅ App module imported successfully")
    print("🚀 Starting server on http://127.0.0.1:8000")
    
    # Start the server
    uvicorn.run(
        "app:app",  # Import string instead of app instance for reload
        host="127.0.0.1",
        port=8000,
        reload=False,  # Disable reload to avoid the warning
        log_level="info"
    )
    
except ImportError as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)
except Exception as e:
    print(f"❌ Error starting server: {e}")
    sys.exit(1)