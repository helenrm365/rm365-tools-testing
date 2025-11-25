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

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RM365 Tools - Auto-Update Mode" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "[*] Checking for updates every 5 seconds" -ForegroundColor Gray
Write-Host "[*] Server will auto-restart on changes" -ForegroundColor Gray
Write-Host "[*] Hot-reload enabled for local edits" -ForegroundColor Gray
Write-Host "[!] Press CTRL+C to stop the server" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set environment variable for uvicorn auto-reload
$env:RELOAD = "true"

# Function to get current commit hash
function Get-CurrentCommit {
    try {
        return (git rev-parse HEAD 2>$null)
    } catch {
        return $null
    }
}

# Main loop: continuously check for updates and restart server
$restartCount = 0
while ($true) {
    $restartCount++
    $currentCommit = Get-CurrentCommit
    
    if ($restartCount -eq 1) {
        Write-Host "[+] Current commit: $($currentCommit.Substring(0,7))" -ForegroundColor Cyan
        Write-Host "[~] Watching for GitHub updates..." -ForegroundColor Cyan
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "[~] Server restarted (update #$($restartCount - 1))" -ForegroundColor Green
        Write-Host "[+] New commit: $($currentCommit.Substring(0,7))" -ForegroundColor Cyan
        Write-Host ""
    }
    
    # Start the server process
    Write-Host "[>] Starting Backend Server..." -ForegroundColor Green
    $serverProcess = Start-Process -FilePath $pythonCmd -ArgumentList "backend/app.py" -PassThru -NoNewWindow
    
    # Monitor for git updates in background
    $shouldRestart = $false
    $checkInterval = 5 # seconds
    
    while ($serverProcess -and !$serverProcess.HasExited) {
        Start-Sleep -Seconds $checkInterval
        
        # Fetch latest from remote
        try {
            $null = git fetch origin main 2>$null
            
            # Check if there are new commits
            $remoteCommit = git rev-parse origin/main 2>$null
            
            if ($remoteCommit -and $remoteCommit -ne $currentCommit) {
                Write-Host ""
                Write-Host "========================================" -ForegroundColor Yellow
                Write-Host "[!] NEW UPDATE DETECTED ON GITHUB!" -ForegroundColor Yellow
                Write-Host "========================================" -ForegroundColor Yellow
                Write-Host "[<] Pulling changes..." -ForegroundColor Cyan
                
                # Store current HEAD before pulling
                $beforePull = Get-CurrentCommit
                
                # Pull the changes
                $pullOutput = git pull origin main 2>&1 | Out-String
                
                # Get new HEAD after pulling
                $afterPull = Get-CurrentCommit
                
                # Check if actual changes were pulled
                if ($beforePull -eq $afterPull) {
                    # No actual changes (shouldn't happen, but safety check)
                    Write-Host "[=] No changes applied (syncing state...)" -ForegroundColor Gray
                    Write-Host "========================================" -ForegroundColor Yellow
                    # Update to remote commit to avoid re-triggering
                    $currentCommit = $remoteCommit
                } else {
                    Write-Host "[+] CHANGES PULLED SUCCESSFULLY!" -ForegroundColor Green
                    
                    # Show number of files changed
                    $changedFiles = git diff --name-only $beforePull $afterPull
                    $fileCount = ($changedFiles | Measure-Object -Line).Lines
                    if ($fileCount -gt 0) {
                        Write-Host "[*] Files changed: $fileCount" -ForegroundColor Cyan
                        
                        # Show which areas were updated
                        $backendChanged = $false
                        $frontendChanged = $false
                        
                        foreach ($file in $changedFiles) {
                            if ($file -like "backend/*") {
                                $backendChanged = $true
                            }
                            if ($file -like "frontend/*") {
                                $frontendChanged = $true
                            }
                        }
                        
                        if ($backendChanged) {
                            Write-Host "[*] Backend files updated" -ForegroundColor Cyan
                        }
                        if ($frontendChanged) {
                            Write-Host "[*] Frontend files updated" -ForegroundColor Cyan
                        }
                    }
                    
                    # Check if requirements.txt changed
                    if ($changedFiles -match "requirements\.txt") {
                        Write-Host "[*] requirements.txt changed - updating dependencies..." -ForegroundColor Yellow
                        pip install -r backend\requirements.txt --quiet
                        Write-Host "[+] Dependencies updated!" -ForegroundColor Green
                    }
                    
                    Write-Host "[~] RESTARTING SERVER WITH NEW CHANGES..." -ForegroundColor Yellow
                    Write-Host "========================================" -ForegroundColor Yellow
                    $shouldRestart = $true
                    break
                }
            }
        } catch {
            # Network error or git error - ignore and try again
        }
    }
    
    # Stop the server if it's still running
    if ($serverProcess -and !$serverProcess.HasExited) {
        Write-Host "[x] Stopping server..." -ForegroundColor Yellow
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    
    # If server crashed (not because of update), show error
    if (!$shouldRestart) {
        Write-Host ""
        Write-Host "[X] Server stopped unexpectedly!" -ForegroundColor Red
        Write-Host "[!] Check the error above. Restarting in 5 seconds..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
}
