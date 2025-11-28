# RM365 Tools - Startup Scripts

This repository contains platform-specific startup scripts for running the RM365 Tools server and local hardware bridge.

## 📁 Folder Structure

### Backend Server

#### `start-windows/` - For Windows
- **`start.bat`** - Double-click this file to start the backend server on Windows
- **`start.ps1`** - PowerShell script (called by start.bat)

#### `start-macos/` - For macOS
- **`start.command`** - Double-click this file to start the backend server on macOS
- **`start.sh`** - Bash script (called by start.command)

### Local Hardware Bridge

#### `local-hardware-bridge/start-windows/` - For Windows
- **`Start-Hardware-Bridge.bat`** - Double-click to start hardware bridge on Windows
- **`start-hardware-bridge.ps1`** - PowerShell script

#### `local-hardware-bridge/start-macos/` - For macOS
- **`Start-Hardware-Bridge.command`** - Double-click to start hardware bridge on macOS
- **`start-hardware-bridge.sh`** - Bash script

---

## 🚀 Quick Start

### Backend Server

**Windows:**
1. Navigate to the `start-windows/` folder
2. Double-click **`start.bat`**
3. The server will start on `http://localhost:8000`

**macOS:**
1. Navigate to the `start-macos/` folder
2. **First time only**: Make the script executable
   ```bash
   chmod +x start.command
   ```
3. Double-click **`start.command`**
4. The server will start on `http://localhost:8000`

### Local Hardware Bridge

**Windows:**
1. Navigate to `local-hardware-bridge/start-windows/`
2. Double-click **`Start-Hardware-Bridge.bat`**
3. Service runs on `http://127.0.0.1:8080`

**macOS:**
1. Navigate to `local-hardware-bridge/start-macos/`
2. **First time only**: 
   ```bash
   chmod +x Start-Hardware-Bridge.command
   ```
3. Double-click **`Start-Hardware-Bridge.command`**
4. Service runs on `http://127.0.0.1:8080`

---

## 💾 Shared Virtual Environment

Both the backend server and hardware bridge use the **same virtual environment** located at `.venv` in the repository root:

```
rm365-tools-testing/
├── .venv/                          ← Shared virtual environment
├── backend/
├── frontend/
├── local-hardware-bridge/
├── start-windows/                  ← Backend (Windows)
├── start-macos/                    ← Backend (macOS)
└── local-hardware-bridge/
    ├── start-windows/              ← Hardware Bridge (Windows)
    └── start-macos/                ← Hardware Bridge (macOS)
```

### Benefits:
- ✅ **Single environment** for entire project
- ✅ **No duplicate packages** (FastAPI, Uvicorn installed once)
- ✅ **Saves disk space**
- ✅ **Easier dependency management**
- ✅ **Platform-specific**: Windows scripts use Windows .venv, macOS scripts use macOS .venv

---

## ✨ Features

Both startup scripts provide:

### Backend Server
- ✅ Automatic Python environment detection
- ✅ Virtual environment setup (`.venv`)
- ✅ Dependency installation from `requirements.txt`
- ✅ Auto-restart on GitHub updates (checks every 5 seconds)
- ✅ Hot-reload for local file changes
- ✅ Colored console output with status indicators
- ✅ Graceful shutdown with CTRL+C

### Hardware Bridge
- ✅ Automatic Python 3.10+ detection
- ✅ Shared virtual environment with backend
- ✅ Fingerprint reader support (Windows only - SecuGen)
- ✅ RFID card reader support (cross-platform)
- ✅ Platform detection and appropriate error messages
- ✅ CORS and Private Network Access support
- ✅ Graceful shutdown with CTRL+C

---

## 🖥️ Platform Compatibility

### Backend Server
| Platform | Supported | Notes |
|----------|-----------|-------|
| Windows | ✅ | Full support |
| macOS | ✅ | Full support |
| Linux | ✅ | Use macOS scripts |

### Hardware Bridge
| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| RFID Card Readers | ✅ | ✅ | ✅ |
| SecuGen Fingerprint | ✅ | ❌* | ❌* |

*macOS/Linux: SecuGen requires Windows drivers. See `local-hardware-bridge/SETUP_GUIDE_MACOS.md` for Touch ID alternatives.

---

## 📝 Notes

- The scripts will create a shared virtual environment in the repository root (`.venv/`)
- Python 3.10+ is required for hardware bridge, Python 3.x for backend
- Backend server runs on `http://localhost:8000` by default
- Hardware bridge runs on `http://127.0.0.1:8080`
- Git repository monitoring allows automatic updates from remote changes
- Both services can run simultaneously and share the same virtual environment

---

## 🆘 Troubleshooting

### Windows
- If scripts don't run, right-click → "Run as Administrator"
- Check PowerShell execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### macOS
- If permission denied: `chmod +x start.command` (or `Start-Hardware-Bridge.command`)
- If Gatekeeper blocks: Right-click → Open → Open anyway
- For serial port access: May need to grant terminal permissions in System Preferences

### Both Platforms
- Ensure Python is in PATH: `python --version` or `python3 --version`
- If dependencies fail: Delete `.venv` folder and run script again
- Check firewall settings if localhost connections fail

---

## 📚 Additional Documentation

- **Backend Setup**: See `backend/README.md`
- **Hardware Bridge (Windows)**: See `local-hardware-bridge/SETUP_GUIDE.md`
- **Hardware Bridge (macOS)**: See `local-hardware-bridge/SETUP_GUIDE_MACOS.md`
- **Frontend**: See `frontend/README.md`
