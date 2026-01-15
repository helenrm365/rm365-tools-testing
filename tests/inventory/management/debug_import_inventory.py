
import sys
import os
from dotenv import load_dotenv

# Load .env file
load_dotenv()

sys.path.append(os.path.join(os.getcwd(), 'backend'))

try:
    from modules.inventory.management.api import router
    print("Successfully imported router")
except Exception as e:
    print(f"Failed to import router: {e}")
    import traceback
    traceback.print_exc()
