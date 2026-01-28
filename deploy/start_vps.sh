#!/bin/bash

# RM365 Tools - VPS Startup Script
# Designed to be run by systemd (non-interactive)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT" || exit 1

# --- Configuration ---
PYTHON_CMD="python3"
VENV_DIR=".venv"
CHECK_INTERVAL=10

echo "Starting RM365 Tools VPS Script"
echo "Project Root: $PROJECT_ROOT"

# --- 1. Python & Venv Setup ---

if ! command -v $PYTHON_CMD &> /dev/null; then
    echo "Error: $PYTHON_CMD not found."
    exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    $PYTHON_CMD -m venv "$VENV_DIR"
fi

# Activate Venv
source "$VENV_DIR/bin/activate"

# Define Venv paths for absolute certainty
VENV_PYTHON="$PROJECT_ROOT/$VENV_DIR/bin/python"
VENV_PIP="$PROJECT_ROOT/$VENV_DIR/bin/pip"

# --- 3. Main Loop (Auto-Update & Run) ---

cleanup() {
    if [ ! -z "$SERVER_PID" ]; then
        echo "Stopping server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null
        wait $SERVER_PID 2>/dev/null
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

while true; do
    # Self-healing: Ensure dependencies are installed on every boot
    # This covers manual changes or failed updates
    if [ -f "backend/requirements.txt" ]; then
        "$VENV_PIP" install -r backend/requirements.txt --quiet --disable-pip-version-check
    fi

    echo "Starting Backend Server..."
    
    # Start app in background using Venv Python
    "$VENV_PYTHON" backend/app.py &
    SERVER_PID=$!
    
    echo "Server started with PID: $SERVER_PID"
    
    # Check for updates loop
    while kill -0 $SERVER_PID 2>/dev/null; do
        sleep $CHECK_INTERVAL
        
        # Check remote for updates
        # Ensure we can actually access git (timeout after 10s to prevent hang on auth prompt)
        git fetch origin main --quiet 2>/dev/null
        
        # Logic to check commits
        LOCAL=$(git rev-parse HEAD)
        REMOTE=$(git rev-parse origin/main 2>/dev/null)
        
        # If fetch failed or no upstream, REMOTE might be empty. Skip check.
        if [ ! -z "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
            echo "Update detected! (Local: ${LOCAL:0:7}, Remote: ${REMOTE:0:7})"
            
            # HARD RESET to ensure exact mirror of checked-in code
            # This prevents merge conflicts from pausing deployment
            # NOTE: .env is in .gitignore, so it won't be touched by this reset
            git reset --hard origin/main
            echo "Updates applied (git reset --hard)."
            
            # Safety: Fix line endings again in case Windows commit introduced CRLF
            if command -v dos2unix &> /dev/null; then
                dos2unix deploy/*.sh > /dev/null 2>&1
                chmod +x deploy/*.sh
            fi
            
            echo "Restarting server..."
            kill $SERVER_PID
            wait $SERVER_PID 2>/dev/null
            
            # Re-execute the script itself to handle any changes to start_vps.sh
            # This prevents "shifted offset" execution errors
            exec "$0" "$@"
        fi
    done
    
    # If server crashed unexpectedly
    echo "Server stopped unexpectedly. Restarting in 5 seconds..."
    sleep 5
done
