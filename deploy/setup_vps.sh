#!/bin/bash
# RM365 Tools - Initial VPS Setup Script
# Run this once on your clean VPS (Ubuntu/Debian) to install dependencies.

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (or use sudo)"
  exit 1
fi

echo "Updating system packages..."
apt-get update

echo "Installing system dependencies..."
# git: for cloning repo
# python3-venv: for virtual environment
# python3-pip: for python packages
# build-essential & libpq-dev: often needed for compiling python database drivers
# dos2unix: to fix windows line endings
apt-get install -y git python3 python3-pip python3-venv build-essential libpq-dev dos2unix

echo ""
echo "✅ System dependencies installed."
echo ""
echo "Next steps:"
echo "1. Fix line endings:       dos2unix deploy/*.sh"
echo "2. Copy your .env file:    (via SCP from your local machine)"
echo "3. Enable execute perm:    chmod +x deploy/*.sh"
echo "4. Symlink service file:   ln -s $(pwd)/deploy/rm365-tools.service /etc/systemd/system/"
echo "5. Reload daemon:          systemctl daemon-reload"
echo "6. Start service:          systemctl enable --now rm365-tools"
