# Apply migration to add adjusted_by column to inventory_logs table
# This script runs the SQL migration against the PostgreSQL database

param(
    [string]$ConnectionString = $null
)

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Inventory Logs Migration - Add adjusted_by" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Get the script directory and migration file path
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MigrationFile = Join-Path $ScriptDir "..\migrations\add_adjusted_by_to_inventory_logs.sql"

# Check if migration file exists
if (-not (Test-Path $MigrationFile)) {
    Write-Host "ERROR: Migration file not found at: $MigrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "Migration file: $MigrationFile" -ForegroundColor Gray
Write-Host ""

# Get connection string from environment or parameter
if (-not $ConnectionString) {
    # Try to get from .env file
    $EnvFile = Join-Path $ScriptDir "..\.env"
    if (Test-Path $EnvFile) {
        Write-Host "Reading connection string from .env file..." -ForegroundColor Gray
        Get-Content $EnvFile | ForEach-Object {
            if ($_ -match '^INVENTORY_LOG_DATABASE_URL=(.+)$') {
                $ConnectionString = $matches[1]
            }
        }
    }
    
    # If still not found, try environment variable
    if (-not $ConnectionString) {
        $ConnectionString = $env:INVENTORY_LOG_DATABASE_URL
    }
    
    # If still not found, use default
    if (-not $ConnectionString) {
        $ConnectionString = $env:DATABASE_URL
    }
}

if (-not $ConnectionString) {
    Write-Host "ERROR: No database connection string found!" -ForegroundColor Red
    Write-Host "Please set INVENTORY_LOG_DATABASE_URL or DATABASE_URL environment variable," -ForegroundColor Yellow
    Write-Host "or pass it as a parameter: -ConnectionString 'your_connection_string'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using database: " -NoNewline -ForegroundColor Gray
# Mask password in connection string for display
$MaskedConnectionString = $ConnectionString -replace '://([^:]+):([^@]+)@', '://$1:****@'
Write-Host $MaskedConnectionString -ForegroundColor Gray
Write-Host ""

# Check if psql is available
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlPath) {
    Write-Host "ERROR: psql command not found!" -ForegroundColor Red
    Write-Host "Please install PostgreSQL client tools and ensure psql is in your PATH" -ForegroundColor Yellow
    exit 1
}

Write-Host "Applying migration..." -ForegroundColor Yellow
Write-Host ""

# Run the migration
try {
    $migrationContent = Get-Content $MigrationFile -Raw
    $env:PGPASSWORD = ""  # psql uses connection string
    
    # Execute the migration
    $result = $migrationContent | & psql $ConnectionString 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Migration applied successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Changes made:" -ForegroundColor Cyan
        Write-Host "  - Added 'adjusted_by' column to inventory_logs table" -ForegroundColor White
        Write-Host "  - Created index on adjusted_by for better query performance" -ForegroundColor White
        Write-Host ""
        Write-Host "The inventory_logs table now tracks which user made each adjustment." -ForegroundColor Gray
    } else {
        Write-Host "✗ Migration failed!" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error running migration: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Migration Complete" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
