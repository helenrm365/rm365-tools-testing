# Example SSH Tunnel Script for Magento Database Access
# Usage: .\start-tunnel.ps1

# Configuration
$SSH_USER = "your_ssh_username"
$SSH_HOST = "your_magento_server_ip"
$SSH_KEY_PATH = "C:\Users\RM365\.ssh\id_rsa" # Optional: Path to your private key

# Database Port Forwarding
# Local Port : Remote DB Host : Remote DB Port
$FORWARDING = "3306:localhost:3306"

Write-Host "Starting SSH Tunnel to $SSH_HOST..." -ForegroundColor Cyan
Write-Host "Forwarding localhost:3306 -> remote:3306" -ForegroundColor Gray

# Build the command
$Command = "ssh -N -L $FORWARDING $SSH_USER@$SSH_HOST"
if (Test-Path $SSH_KEY_PATH) {
    $Command += " -i $SSH_KEY_PATH"
}

Write-Host "Running: $Command" -ForegroundColor DarkGray
Write-Host "Keep this window open to maintain the connection." -ForegroundColor Yellow

# Execute
Invoke-Expression $Command
