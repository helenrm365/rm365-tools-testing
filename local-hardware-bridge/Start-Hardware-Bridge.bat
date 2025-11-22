@echo off
echo Starting RM365 Local Hardware Bridge...
echo.

cd /d "%~dp0"

REM Check for venv
if exist venv\Scripts\python.exe (
    echo Using virtual environment...
    venv\Scripts\python.exe app.py
) else (
    echo Virtual environment not found. Trying system python...
    python app.py
)

pause
