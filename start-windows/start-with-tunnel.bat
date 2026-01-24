@echo off
echo ============================================
echo   RM365 Tools - Production Mode
echo   With Cloudflare Tunnel (rm365-toolbox.com)
echo ============================================
echo.

REM Get the directory of this script
set "SCRIPT_DIR=%~dp0"

REM Change to the repository root (parent of start-windows)
cd /d "%SCRIPT_DIR%\.."

REM Check if cloudflared is installed
where cloudflared >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] cloudflared is not installed or not in PATH
    echo.
    echo Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
    echo.
    pause
    exit /b 1
)

echo [*] Starting Cloudflare Tunnel in background...
echo     Domain: rm365-toolbox.com
echo.

REM Start cloudflared tunnel in a new minimized window
start "Cloudflare Tunnel" /min cmd /c "cloudflared tunnel run --token eyJhIjoiZjAyYThkZjU1YjI4MmQxOTkwZjM2MDdlMmMxZTE4Y2YiLCJ0IjoiOWZiMGUzYzQtNzkwOS00YTgyLWJlOTktNDc0YjI3ZDI0NDgwIiwicyI6IlptUXlOak16TlRBdFltSmlOaTAwWm1KakxUaGtOakl0WldFelpESTBaR1ZoWTJSbCJ9"

REM Give the tunnel a moment to initialize
timeout /t 3 /nobreak >nul

echo [+] Cloudflare Tunnel started (running in minimized window)
echo.
echo [*] Starting FastAPI server...
echo     Press CTRL+C to stop the server
echo     (Close the "Cloudflare Tunnel" window to stop the tunnel)
echo.

REM Run the PowerShell script for the server (this blocks until stopped)
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1"

REM When server stops, also stop the tunnel
echo.
echo [*] Stopping Cloudflare Tunnel...
taskkill /FI "WINDOWTITLE eq Cloudflare Tunnel" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

echo [+] All services stopped
pause
