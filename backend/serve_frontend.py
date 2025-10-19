#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys

# Get directory where the script is located (backend)
script_dir = os.path.dirname(os.path.abspath(__file__))
frontend_dir = os.path.join(os.path.dirname(script_dir), 'frontend')

print(f"Script directory: {script_dir}")
print(f"Frontend directory: {frontend_dir}")

if os.path.exists(frontend_dir):
    os.chdir(frontend_dir)
    print(f"Changed to frontend directory: {os.getcwd()}")
    
    PORT = 3000
    Handler = http.server.SimpleHTTPRequestHandler
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Frontend server at http://localhost:{PORT}")
        print("Press Ctrl+C to stop the server")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
else:
    print(f"Frontend directory not found: {frontend_dir}")
    sys.exit(1)