#!/bin/bash

# RM365 Nginx Reverse Proxy Setup Script
# Run this on your IONOS VPS to set up rm365-toolbox.com
# Usage: sudo ./setup_nginx.sh

# Exit on error
set -e

DOMAIN="rm365-toolbox.com"
APP_PORT=8000
SERVER_SCRIPT="/opt/rm365-tools-testing/backend/start_server.sh"

echo "🔧 Installing Nginx..."
sudo apt update
sudo apt install -y nginx ufw

echo "🛡️ Configuring Firewall (UFW)..."
# Ensure SSH is allowed so you don't lock yourself out!
sudo ufw allow OpenSSH
sudo ufw allow ssh
# Ensure Nginx is allowed
sudo ufw allow 'Nginx Full'
# Ensure port 8000 is still open for direct access debugging if needed, 
# although Nginx makes it redundant for public access.
sudo ufw allow $APP_PORT/tcp

echo "📝 Creating Nginx Configuration for $DOMAIN..."

cat <<EOF | sudo tee /etc/nginx/sites-available/rm365-tools
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;

    # Optimal client body size for file uploads
    client_max_body_size 50M;

    # Gzip Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts for long-running reports or imports
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
EOF

echo "🔗 Enabling the site..."
sudo ln -sf /etc/nginx/sites-available/rm365-tools /etc/nginx/sites-enabled/

echo "🧹 Removing default site if it exists..."
sudo rm -f /etc/nginx/sites-enabled/default

echo "⚙️  Optimizing Backend (Uvicorn) for Proxy..."
if [ -f "$SERVER_SCRIPT" ]; then
    # Check if proxy headers are already enabled
    if ! grep -q "proxy-headers" "$SERVER_SCRIPT"; then
        echo "   Adding proxy headers to start_server.sh..."
        # Use sed to append the flags to the start command
        sudo sed -i 's/uvicorn app:app --host 0.0.0.0 --port 8000/uvicorn app:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips "*"/' "$SERVER_SCRIPT"
        echo "   ✅ Backend script updated."
        NEED_RESTART=true
    else
        echo "   ✅ Backend script already optimized."
    fi
else
    echo "⚠️  Warning: start_server.sh not found at $SERVER_SCRIPT. Please verify backend path."
fi

echo "✅ Testing Nginx configuration..."
sudo nginx -t

echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx
sudo systemctl enable nginx

echo ""
echo "🎉 SUCCESS! Setup Complete."
echo "-----------------------------------------------------"
echo "1. DNS: Point your Cloudflare 'A' record for $DOMAIN to (Your VPS IP)"
echo "2. SSL: Set Cloudflare SSL/TLS mode to 'Flexible'"
echo "3. App: If backend script was updated, restart the app:"
echo "   sudo systemctl restart rm365-backend"
echo "-----------------------------------------------------"

