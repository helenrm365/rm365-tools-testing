@echo off
echo Starting RM365 Tools (Self-Hosted Mode)...
echo.

:: 1. Check if Postgres is running (optional check, but good practice)
:: You can add checks here if needed.

:: 2. Activate Python Environment
call .venv-2\Scripts\activate

:: 3. Set Environment Variables for Local Hosting
set DB_SSLMODE=disable
set ATTENDANCE_DB_HOST=localhost
set ATTENDANCE_DB_USER=postgres
:: You might need to set the password here or in your system env vars
:: set ATTENDANCE_DB_PASSWORD=your_password

:: 4. Start the Backend (which also serves the Frontend)
echo Starting Server on port 8000...
python backend/app.py

pause
