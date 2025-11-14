# Apply Database Performance Indexes
# This script helps you apply the performance indexes to your Railway databases

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Database Performance Index Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if psql is installed
$psqlInstalled = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlInstalled) {
    Write-Host "❌ Error: psql is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL client tools:" -ForegroundColor Yellow
    Write-Host "  - Windows: Download from https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "  - Or use Railway CLI to run commands directly" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "✅ PostgreSQL client found" -ForegroundColor Green
Write-Host ""

# Migration file path
$migrationFile = Join-Path $PSScriptRoot "migrations\add_performance_indexes.sql"

if (-not (Test-Path $migrationFile)) {
    Write-Host "❌ Error: Migration file not found at: $migrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "📄 Migration file: $migrationFile" -ForegroundColor Cyan
Write-Host ""

# Function to apply migration
function Invoke-IndexMigration {
    param (
        [string]$dbUrl,
        [string]$dbName
    )
    
    Write-Host "================================================" -ForegroundColor Yellow
    Write-Host "Applying indexes to: $dbName" -ForegroundColor Yellow
    Write-Host "================================================" -ForegroundColor Yellow
    
    try {
        # Run the migration
        $output = psql $dbUrl -f $migrationFile 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Successfully applied indexes to $dbName" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "⚠️  Warning: Some indexes may have failed for $dbName" -ForegroundColor Yellow
            Write-Host "Output: $output" -ForegroundColor Gray
            Write-Host ""
        }
    } catch {
        Write-Host "❌ Error applying indexes to $dbName" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host ""
    }
}

Write-Host "🔧 Database Index Setup Options:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Use Railway CLI (recommended)" -ForegroundColor White
Write-Host "2. Provide database URLs manually" -ForegroundColor White
Write-Host "3. Exit" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Select option (1-3)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Using Railway CLI..." -ForegroundColor Cyan
        Write-Host ""
        
        # Check if railway CLI is installed
        $railwayInstalled = Get-Command railway -ErrorAction SilentlyContinue
        if (-not $railwayInstalled) {
            Write-Host "❌ Error: Railway CLI is not installed" -ForegroundColor Red
            Write-Host ""
            Write-Host "Install Railway CLI:" -ForegroundColor Yellow
            Write-Host "  npm install -g @railway/cli" -ForegroundColor Yellow
            Write-Host "  or visit: https://docs.railway.app/develop/cli" -ForegroundColor Yellow
            exit 1
        }
        
        Write-Host "📋 Available Railway databases:" -ForegroundColor Cyan
        railway variables | Select-String "DB_HOST|DATABASE_URL"
        Write-Host ""
        
        Write-Host "To apply indexes, run these commands in your terminal:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "# Products/Sales Database:" -ForegroundColor Green
        Write-Host 'railway run psql $PRODUCTS_DB_URL -f backend/migrations/add_performance_indexes.sql' -ForegroundColor White
        Write-Host ""
        Write-Host "# Attendance Database:" -ForegroundColor Green
        Write-Host 'railway run psql $ATTENDANCE_DB_URL -f backend/migrations/add_performance_indexes.sql' -ForegroundColor White
        Write-Host ""
        Write-Host "# Inventory Database:" -ForegroundColor Green
        Write-Host 'railway run psql $INVENTORY_DB_URL -f backend/migrations/add_performance_indexes.sql' -ForegroundColor White
        Write-Host ""
    }
    
    "2" {
        Write-Host ""
        Write-Host "Manual Database URL Setup" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Enter your Railway database URLs (or press Enter to skip):" -ForegroundColor Yellow
        Write-Host ""
        
        # Products DB
        Write-Host "Products/Sales Database URL:" -ForegroundColor Cyan
        $productsUrl = Read-Host "postgres://..."
        if ($productsUrl) {
            Invoke-IndexMigration -dbUrl $productsUrl -dbName "Products/Sales DB"
        }
        
        # Attendance DB
        Write-Host ""
        Write-Host "Attendance Database URL:" -ForegroundColor Cyan
        $attendanceUrl = Read-Host "postgres://..."
        if ($attendanceUrl) {
            Invoke-IndexMigration -dbUrl $attendanceUrl -dbName "Attendance DB"
        }
        
        # Inventory DB
        Write-Host ""
        Write-Host "Inventory Database URL:" -ForegroundColor Cyan
        $inventoryUrl = Read-Host "postgres://..."
        if ($inventoryUrl) {
            Invoke-IndexMigration -dbUrl $inventoryUrl -dbName "Inventory DB"
        }
        
        Write-Host ""
        Write-Host "✅ Migration complete!" -ForegroundColor Green
    }
    
    "3" {
        Write-Host "Exiting..." -ForegroundColor Yellow
        exit 0
    }
    
    default {
        Write-Host "Invalid option. Exiting..." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. ✅ Deploy updated backend to Railway" -ForegroundColor White
Write-Host "2. ✅ Deploy updated frontend" -ForegroundColor White
Write-Host "3. 🔍 Monitor performance improvements" -ForegroundColor White
Write-Host ""
Write-Host "For more details, see: PERFORMANCE_OPTIMIZATIONS.md" -ForegroundColor Yellow
Write-Host ""
