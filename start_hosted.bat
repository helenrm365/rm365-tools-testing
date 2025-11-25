@echo off
echo Starting RM365 Tools (Self-Hosted Mode)...
echo.

:: Forward to the robust PowerShell script
powershell -ExecutionPolicy Bypass -File "start_server_with_auto_update.ps1"

pause