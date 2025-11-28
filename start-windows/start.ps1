# RM365 Tools - Self-Hosted Server Startup Script
# Monitors GitHub for changes and auto-restarts on updates

# ==================== HELPER FUNCTIONS ====================

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Icon, [string]$Text, [string]$Color = "Cyan")
    Write-Host "  $Icon " -ForegroundColor $Color -NoNewline
    Write-Host $Text -ForegroundColor Gray
}

function Write-Success {
    param([string]$Text)
    Write-Host "  [+] " -ForegroundColor Green -NoNewline
    Write-Host $Text -ForegroundColor White
}

function Write-Error {
    param([string]$Text)
    Write-Host "  [X] " -ForegroundColor Red -NoNewline
    Write-Host $Text -ForegroundColor White
}

function Write-Info {
    param([string]$Text)
    Write-Host "  [i] " -ForegroundColor Blue -NoNewline
    Write-Host $Text -ForegroundColor Gray
}

function Write-Warning {
    param([string]$Text)
    Write-Host "  [!] " -ForegroundColor Yellow -NoNewline
    Write-Host $Text -ForegroundColor White
}

function Write-Status {
    param([string]$Label, [string]$Value, [string]$Color = "Cyan")
    Write-Host "  > " -ForegroundColor Gray -NoNewline
    Write-Host $Label -ForegroundColor Gray -NoNewline
    Write-Host " " -NoNewline
    Write-Host $Value -ForegroundColor $Color
}

# ==================== PRE-FLIGHT CHECKS ====================

Clear-Host
Write-Header "RM365 TOOLS - SELF-HOSTED SERVER"

# Check if we are in the right directory
if (!(Test-Path "backend\app.py")) {
    Write-Error "Not in repository root directory"
    Write-Info "Please run this script from the root of the repository"
    Pause
    exit 1
}
Write-Success "Repository directory verified"

# ==================== SYSTEM REQUIREMENTS ====================

Write-Header "SYSTEM REQUIREMENTS"

# 1. Find Python
$pythonCmd = "python"
Write-Step "[*]" "Checking Python installation..."
try {
    $null = Get-Command $pythonCmd -ErrorAction Stop
    $pythonVersion = & $pythonCmd --version 2>&1
    Write-Success "Python found: $pythonVersion"
}
catch {
    try {
        $pythonCmd = "python3"
        $null = Get-Command $pythonCmd -ErrorAction Stop
        $pythonVersion = & $pythonCmd --version 2>&1
        Write-Success "Python found: $pythonVersion"
    }
    catch {
        Write-Error "Python not installed or not in PATH"
        Write-Info "Install from: https://www.python.org/downloads/"
        Pause
        exit 1
    }
}

# 2. Setup Virtual Environment
Write-Step "[*]" "Checking virtual environment..."
$venvPath = ".venv"
if (!(Test-Path $venvPath)) {
    Write-Info "Creating virtual environment..."
    & $pythonCmd -m venv $venvPath
    Write-Success "Virtual environment created"
} else {
    Write-Success "Virtual environment found"
}

# 3. Activate Virtual Environment
$activateScript = "$venvPath\Scripts\Activate.ps1"
if (Test-Path $activateScript) {
    . $activateScript
    Write-Success "Virtual environment activated"
}
else {
    Write-Error "Activation script not found: $activateScript"
    Pause
    exit 1
}

# 4. Install Dependencies
if (Test-Path "backend\requirements.txt") {
    Write-Step "[*]" "Checking dependencies..."
    pip install -r backend\requirements.txt --quiet --disable-pip-version-check
    Write-Success "Dependencies up to date"
}

# ==================== SERVER STARTUP ====================

Write-Header "AUTO-UPDATE SERVER MODE"
Write-Info "Monitoring GitHub for changes every 5 seconds"
Write-Info "Server will auto-restart when new commits detected"
Write-Info "Hot-reload enabled for local file changes"
Write-Warning "Press CTRL+C to stop the server"
Write-Host ""

# Set environment variable for uvicorn auto-reload
$env:RELOAD = "true"

# Function to get current commit hash
function Get-CurrentCommit {
    try {
        return (git rev-parse HEAD 2>$null)
    }
    catch {
        return $null
    }
}

# ==================== MAIN LOOP ====================

$restartCount = 0
while ($true) {
    $restartCount++
    $currentCommit = Get-CurrentCommit
    
    if ($restartCount -eq 1) {
        Write-Header "INITIAL STARTUP"
        Write-Status "Git Commit:" $currentCommit.Substring(0,7) "Yellow"
        Write-Status "Watch Mode:" "Active (checking every 5s)" "Green"
        Write-Host ""
    }
    else {
        Write-Header "SERVER RESTART #$($restartCount - 1)"
        Write-Status "New Commit:" $currentCommit.Substring(0,7) "Yellow"
        Write-Host ""
    }
    
    # Start the server process
    Write-Step "[>]" "Starting FastAPI server..." "Green"
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host "======================================== SERVER OUTPUT ========================================" -ForegroundColor DarkGray
    Write-Host ""
    
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
                Write-Host "  " -NoNewline
                Write-Host "==============================================================================================" -ForegroundColor DarkGray
                Write-Host ""
                Write-Header "UPDATE DETECTED"
                
                # Store current HEAD before pulling
                $beforePull = Get-CurrentCommit
                
                # Pull the changes
                Write-Step "[<]" "Pulling changes from GitHub..." "Cyan"
                $pullOutput = git pull origin main 2>&1 | Out-String
                
                # Get new HEAD after pulling
                $afterPull = Get-CurrentCommit
                
                # Check if actual changes were pulled
                if ($beforePull -eq $afterPull) {
                    Write-Info "No new changes (already in sync)"
                    $currentCommit = $remoteCommit
                }
                else {
                    Write-Success "Changes pulled successfully"
                    Write-Host ""
                    
                    # Show number of files changed
                    $changedFiles = git diff --name-only $beforePull $afterPull
                    $fileCount = ($changedFiles | Measure-Object -Line).Lines
                    
                    if ($fileCount -gt 0) {
                        Write-Status "Files Changed:" $fileCount "Yellow"
                        
                        # Show which areas were updated
                        $backendChanged = $false
                        $frontendChanged = $false
                        $changedFilesList = @()
                        
                        foreach ($file in $changedFiles) {
                            if ($file -like "backend/*") {
                                $backendChanged = $true
                            }
                            if ($file -like "frontend/*") {
                                $frontendChanged = $true
                            }
                            $changedFilesList += $file
                        }
                        
                        Write-Host ""
                        Write-Info "Modified files:"
                        foreach ($file in $changedFilesList | Select-Object -First 10) {
                            Write-Host "    • " -ForegroundColor DarkGray -NoNewline
                            Write-Host $file -ForegroundColor White
                        }
                        if ($fileCount -gt 10) {
                            Write-Host "    • " -ForegroundColor DarkGray -NoNewline
                            Write-Host "... and $($fileCount - 10) more" -ForegroundColor DarkGray
                        }
                        Write-Host ""
                        
                        if ($backendChanged) {
                            Write-Step "[*]" "Backend files updated" "Cyan"
                        }
                        if ($frontendChanged) {
                            Write-Step "[*]" "Frontend files updated" "Cyan"
                        }
                    }
                    
                    # Check if requirements.txt changed
                    if ($changedFiles -match "requirements\.txt") {
                        Write-Host ""
                        Write-Warning "requirements.txt changed"
                        Write-Step "[*]" "Updating Python dependencies..." "Yellow"
                        pip install -r backend\requirements.txt --quiet --disable-pip-version-check
                        Write-Success "Dependencies updated"
                    }
                    
                    Write-Host ""
                    Write-Step "[~]" "Restarting server with new changes..." "Yellow"
                    $shouldRestart = $true
                    break
                }
            }
        }
        catch {
            # Network error or git error - ignore and try again
        }
    }
    
    # Stop the server if it's still running
    if ($serverProcess -and !$serverProcess.HasExited) {
        Write-Host ""
        Write-Host "  " -NoNewline
        Write-Host "==============================================================================================" -ForegroundColor DarkGray
        Write-Host ""
        Write-Step "[x]" "Stopping server..." "Yellow"
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Write-Success "Server stopped"
    }
    
    # If server crashed (not because of update), show error
    if (!$shouldRestart) {
        Write-Host ""
        Write-Host "  " -NoNewline
        Write-Host "==============================================================================================" -ForegroundColor DarkGray
        Write-Host ""
        Write-Error "Server stopped unexpectedly"
        Write-Warning "Check error messages above"
        Write-Info "Auto-restarting in 5 seconds..."
        Start-Sleep -Seconds 5
    }
}
