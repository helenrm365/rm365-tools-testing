#!/bin/bash

# RM365 Tools - Self-Hosted Server Startup Script (macOS/Linux)
# Monitors GitHub for changes and auto-restarts on updates

# ==================== HELPER FUNCTIONS ====================

function write_header {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

function write_step {
    echo "  $1 $2"
}

function write_success {
    echo "  ✓ $1"
}

function write_error {
    echo "  ✗ $1"
}

function write_info {
    echo "  ℹ $1"
}

function write_warning {
    echo "  ⚠ $1"
}

function write_status {
    echo "  ▸ $1 $2"
}

# ==================== PRE-FLIGHT CHECKS ====================

clear
write_header "RM365 TOOLS - SELF-HOSTED SERVER"

# Check if we are in the right directory
if [ ! -f "backend/app.py" ]; then
    write_error "Not in repository root directory"
    write_info "Please run this script from the root of the repository"
    read -p "Press Enter to exit..."
    exit 1
fi
write_success "Repository directory verified"

# ==================== SYSTEM REQUIREMENTS ====================

write_header "SYSTEM REQUIREMENTS"

# 1. Find Python
pythonCmd="python3"
write_step "🔍" "Checking Python installation..."
if command -v $pythonCmd &> /dev/null; then
    pythonVersion=$($pythonCmd --version 2>&1)
    write_success "Python found: $pythonVersion"
else
    if command -v python &> /dev/null; then
        pythonCmd="python"
        pythonVersion=$($pythonCmd --version 2>&1)
        write_success "Python found: $pythonVersion"
    else
        write_error "Python not installed or not in PATH"
        write_info "Install from: https://www.python.org/downloads/"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# 2. Setup Virtual Environment
write_step "📦" "Checking virtual environment..."
venvPath=".venv"
if [ ! -d "$venvPath" ]; then
    write_info "Creating virtual environment..."
    $pythonCmd -m venv $venvPath
    write_success "Virtual environment created"
else
    write_success "Virtual environment found"
fi

# 3. Activate Virtual Environment
activateScript="$venvPath/bin/activate"
if [ -f "$activateScript" ]; then
    source "$activateScript"
    write_success "Virtual environment activated"
else
    write_error "Activation script not found: $activateScript"
    read -p "Press Enter to exit..."
    exit 1
fi

# 4. Install Dependencies
if [ -f "backend/requirements.txt" ]; then
    write_step "⚙️" "Checking dependencies..."
    pip install -r backend/requirements.txt --quiet --disable-pip-version-check
    write_success "Dependencies up to date"
fi

# ==================== SERVER STARTUP ====================

write_header "AUTO-UPDATE SERVER MODE"
write_info "Monitoring GitHub for changes every 5 seconds"
write_info "Server will auto-restart when new commits detected"
write_info "Hot-reload enabled for local file changes"
write_warning "Press CTRL+C to stop the server"
echo ""

# Set environment variable for uvicorn auto-reload
export RELOAD=true

# Function to get current commit hash
function get_current_commit {
    git rev-parse HEAD 2>/dev/null || echo ""
}

# Function to cleanup background processes on exit
function cleanup {
    if [ ! -z "$serverPid" ] && kill -0 $serverPid 2>/dev/null; then
        echo ""
        echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        write_step "⏸️" "Stopping server..."
        kill $serverPid 2>/dev/null
        wait $serverPid 2>/dev/null
        write_success "Server stopped"
    fi
    exit 0
}

# Set trap to catch SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

# ==================== MAIN LOOP ====================

restartCount=0
while true; do
    restartCount=$((restartCount + 1))
    currentCommit=$(get_current_commit)
    
    if [ $restartCount -eq 1 ]; then
        write_header "INITIAL STARTUP"
        write_status "Git Commit:" "${currentCommit:0:7}"
        write_status "Watch Mode:" "Active (checking every 5s)"
        echo ""
    else
        write_header "SERVER RESTART #$((restartCount - 1))"
        write_status "New Commit:" "${currentCommit:0:7}"
        echo ""
    fi
    
    # Start the server process
    write_step "🚀" "Starting FastAPI server..."
    echo ""
    echo "  ━━━━━━━━━━━━━━━━━━━━━━━ SERVER OUTPUT ━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Start server in background and get its PID
    $pythonCmd backend/app.py &
    serverPid=$!
    
    # Monitor for git updates
    shouldRestart=false
    checkInterval=5
    
    while kill -0 $serverPid 2>/dev/null; do
        sleep $checkInterval
        
        # Fetch latest from remote
        git fetch origin main 2>/dev/null
        
        # Check if there are new commits
        remoteCommit=$(git rev-parse origin/main 2>/dev/null)
        
        if [ ! -z "$remoteCommit" ] && [ "$remoteCommit" != "$currentCommit" ]; then
            echo ""
            echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            write_header "UPDATE DETECTED"
            
            # Store current HEAD before pulling
            beforePull=$(get_current_commit)
            
            # Pull the changes
            write_step "⬇️" "Pulling changes from GitHub..."
            git pull origin main >/dev/null 2>&1
            
            # Get new HEAD after pulling
            afterPull=$(get_current_commit)
            
            # Check if actual changes were pulled
            if [ "$beforePull" == "$afterPull" ]; then
                write_info "No new changes (already in sync)"
                currentCommit=$remoteCommit
            else
                write_success "Changes pulled successfully"
                echo ""
                
                # Show number of files changed
                changedFiles=$(git diff --name-only $beforePull $afterPull)
                if [ -n "$changedFiles" ]; then
                    fileCount=$(echo "$changedFiles" | wc -l | tr -d ' ')
                else
                    fileCount=0
                fi
                
                if [ $fileCount -gt 0 ]; then
                    write_status "Files Changed:" $fileCount
                    
                    # Show which areas were updated
                    backendChanged=false
                    frontendChanged=false
                    
                    if echo "$changedFiles" | grep -q "^backend/"; then
                        backendChanged=true
                    fi
                    if echo "$changedFiles" | grep -q "^frontend/"; then
                        frontendChanged=true
                    fi
                    
                    echo ""
                    write_info "Modified files:"
                    echo "$changedFiles" | head -10 | while read -r file; do
                        echo "    • $file"
                    done
                    if [ $fileCount -gt 10 ]; then
                        echo "    • ... and $((fileCount - 10)) more"
                    fi
                    echo ""
                    
                    if [ "$backendChanged" = true ]; then
                        write_step "🔧" "Backend files updated"
                    fi
                    if [ "$frontendChanged" = true ]; then
                        write_step "🎨" "Frontend files updated"
                    fi
                fi
                
                # Check if requirements.txt changed
                if echo "$changedFiles" | grep -q "requirements\.txt"; then
                    echo ""
                    write_warning "requirements.txt changed"
                    write_step "📦" "Updating Python dependencies..."
                    pip install -r backend/requirements.txt --quiet --disable-pip-version-check
                    write_success "Dependencies updated"
                fi
                
                echo ""
                write_step "🔄" "Restarting server with new changes..."
                shouldRestart=true
                break
            fi
        fi
    done
    
    # Stop the server if it's still running
    if kill -0 $serverPid 2>/dev/null; then
        echo ""
        echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        write_step "⏸️" "Stopping server..."
        kill $serverPid 2>/dev/null
        wait $serverPid 2>/dev/null
        write_success "Server stopped"
    fi
    
    # If server crashed (not because of update), show error
    if [ "$shouldRestart" = false ]; then
        echo ""
        echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        write_error "Server stopped unexpectedly"
        write_warning "Check error messages above"
        write_info "Auto-restarting in 5 seconds..."
        sleep 5
    fi
done
