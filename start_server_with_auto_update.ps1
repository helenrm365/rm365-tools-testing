# Check if we are in the right directory
if (!(Test-Path "backend\app.py")) {
    Write-Host "Error: Please run this script from the root of the repository." -ForegroundColor Red
    exit 1
}

# Activate Python Environment
if (Test-Path ".venv-2\Scripts\Activate.ps1") {
    . .venv-2\Scripts\Activate.ps1
} else {
    Write-Host "Warning: .venv-2 not found. Assuming Python is in PATH." -ForegroundColor Yellow
}

# Start the Git Auto-Updater in a background job
Write-Host "Starting Git Auto-Updater (checks every 60 seconds)..." -ForegroundColor Cyan
$gitJob = Start-Job -ScriptBlock {
    while ($true) {
        Start-Sleep -Seconds 60
        # Redirect output to null to keep console clean, unless error
        try {
            git pull | Out-Null
        } catch {
            # Ignore network errors, just try again later
        }
    }
}

# Start the Backend Server
Write-Host "Starting Backend Server..." -ForegroundColor Green
Write-Host "The server will automatically reload when changes are pulled from GitHub." -ForegroundColor Gray
try {
    # Run the app. uvicorn will handle hot-reloading.
    python backend/app.py
} finally {
    # Cleanup: Stop the git job when the server stops
    Write-Host "Stopping Git Auto-Updater..." -ForegroundColor Yellow
    Stop-Job $gitJob
    Remove-Job $gitJob
}
