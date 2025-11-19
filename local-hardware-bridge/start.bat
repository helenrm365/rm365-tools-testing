@echo off
echo Starting RM365 Local Hardware Bridge...
echo.

REM Activate virtual environment if it exists
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
)

REM Run the service
python app.py

pause
