@echo off
echo Starting RM365 Local Hardware Bridge...
echo.

cd /d "%~dp0"

REM Check for venv
if exist venv\Scripts\python.exe (
    echo Using virtual environment...
    
    REM Generate certificates if they don't exist
    if not exist key.pem (
        echo Generating SSL certificates...
        venv\Scripts\python.exe generate_cert.py
    )
    
    venv\Scripts\python.exe app.py
) else (
    echo [WARNING] Virtual environment not found.
    echo.
    echo Please run 'Install-Hardware-Bridge.bat' first to set up the environment.
    echo.
    echo Attempting to run with system Python as fallback...
    python app.py
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Failed to run with system Python.
        echo Please run 'Install-Hardware-Bridge.bat' to install dependencies.
    )
)

pause
