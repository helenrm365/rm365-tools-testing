import os
import sys
import pymysql
from sshtunnel import SSHTunnelForwarder
from dotenv import load_dotenv
import logging
import paramiko

# Setup logging
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("paramiko").setLevel(logging.DEBUG)

# Monkey patch paramiko
if not hasattr(paramiko, 'DSSKey'):
    class DummyDSSKey:
        pass
    paramiko.DSSKey = DummyDSSKey

# Load env
# Assuming this script is in backend/
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

ssh_host = os.getenv("SSH_HOST")
ssh_user = os.getenv("SSH_USER")
ssh_key_path = os.getenv("SSH_KEY_PATH")
db_user = os.getenv("MAGENTO_DB_USER_UK")
db_password = os.getenv("MAGENTO_DB_PASSWORD_UK")

print(f"SSH Host: {ssh_host}")
print(f"SSH User: {ssh_user}")
print(f"SSH Key: {ssh_key_path}")
print(f"DB User: {db_user}")

try:
    # Try loading key
    try:
        pkey = paramiko.Ed25519Key.from_private_key_file(ssh_key_path)
    except Exception as e:
        print(f"Failed to load Ed25519 key: {e}")
        try:
            pkey = paramiko.RSAKey.from_private_key_file(ssh_key_path)
        except Exception as e2:
            print(f"Failed to load RSA key: {e2}")
            pkey = ssh_key_path

    print("Testing direct SSH connection with paramiko...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ssh_host, username=ssh_user, pkey=pkey)
    print("Direct SSH connection successful!")
    client.close()

    print("Starting tunnel...")
    server = SSHTunnelForwarder(
        (ssh_host, 22),
        ssh_username=ssh_user,
        ssh_pkey=pkey,
        remote_bind_address=('127.0.0.1', 3306),
        host_pkey_directories=[] 
    )
    
    server.start()
    print(f"Tunnel started on port {server.local_bind_port}")
    
    # Connect to MySQL (no db specified to list all)
    print("Connecting to MySQL...")
    conn = pymysql.connect(
        host='127.0.0.1',
        port=server.local_bind_port,
        user=db_user,
        password=db_password
    )
    
    with conn.cursor() as cursor:
        cursor.execute("SHOW DATABASES;")
        dbs = cursor.fetchall()
        print("\nAvailable Databases:")
        for db in dbs:
            print(f" - {db[0]}")
            
    conn.close()
    server.stop()
    
except Exception as e:
    print(f"\nError: {e}")
