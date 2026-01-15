
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).resolve().parent))

try:
    print("Attempting to import modules.magentodata.api...")
    from modules.magentodata import api
    print("✅ Import successful!")
    print(f"Router: {api.router}")
except Exception as e:
    print(f"❌ Import failed: {e}")
    import traceback
    traceback.print_exc()
