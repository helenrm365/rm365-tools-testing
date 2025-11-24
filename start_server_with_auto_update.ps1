# Check if we are in the right directory
if (!(Test-Path "backend\app.py")) {
    Write-Host "Error: Please run this script from the root of the repository." -ForegroundColor Red
    exit 1
}

# --- SETUP & INSTALLATION ---

Write-Host "Checking system requirements..." -ForegroundColor Cyan

# 1. Find Python
$pythonCmd = "python"
try {
    $null = Get-Command $pythonCmd -ErrorAction Stop
} catch {
    try {
        $pythonCmd = "python3"
        $null = Get-Command $pythonCmd -ErrorAction Stop
    } catch {
        Write-Host "Error: Python is not installed or not in PATH." -ForegroundColor Red
        Write-Host "Please install Python from https://www.python.org/downloads/" -ForegroundColor Yellow
        Pause
        exit 1
    }
}

# 2. Setup Virtual Environment
$venvPath = ".venv"
if (!(Test-Path $venvPath)) {
    Write-Host "Creating virtual environment in $venvPath..." -ForegroundColor Cyan
    & $pythonCmd -m venv $venvPath
}

# 3. Activate Virtual Environment
$activateScript = "$venvPath\Scripts\Activate.ps1"
if (Test-Path $activateScript) {
    # Write-Host "Activating virtual environment..." -ForegroundColor Cyan
    . $activateScript
} else {
    Write-Host "Error: Could not find activation script at $activateScript" -ForegroundColor Red
    Pause
    exit 1
}

# 4. Install Dependencies
if (Test-Path "backend\requirements.txt") {
    Write-Host "Installing/Updating dependencies..." -ForegroundColor Cyan
    pip install -r backend\requirements.txt
}

# --- RUNTIME ---

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
