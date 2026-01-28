import os
import psycopg2
import sys
from dotenv import load_dotenv

# Load env
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

host = os.getenv("ATTENDANCE_DB_HOST") or os.getenv("INVENTORY_LOGS_HOST")
user = os.getenv("ATTENDANCE_DB_USER") or os.getenv("INVENTORY_LOGS_USER")
password = os.getenv("ATTENDANCE_DB_PASSWORD") or os.getenv("INVENTORY_LOGS_PASSWORD")
dbname = os.getenv("ATTENDANCE_DB_NAME") or os.getenv("INVENTORY_LOGS_NAME")

if not host:
    print("❌ No DB host found in .env")
    sys.exit(1)

print(f"🔧 Testing connection to {host}...")

modes = ['prefer', 'require', 'disable', 'allow']

for mode in modes:
    print(f"\n🔄 Trying sslmode='{mode}'...")
    try:
        conn = psycopg2.connect(
            host=host,
            user=user,
            password=password,
            dbname=dbname,
            sslmode=mode,
            connect_timeout=5
        )
        print(f"   ✅ SUCCESS! Connected with sslmode='{mode}'")
        conn.close()
    except Exception as e:
        print(f"   ❌ FAILED: {e}")
