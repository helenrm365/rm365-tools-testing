# Apply Database Performance Indexes
# This script helps you apply the performance indexes to your PostgreSQL databases

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
Write-Host "1. Provide database URLs manually" -ForegroundColor White
Write-Host "2. Exit" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Select option (1-2)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Manual Database URL Setup" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Enter your PostgreSQL database URLs (or press Enter to skip):" -ForegroundColor Yellow
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
Write-Host "1. ✅ Indexes applied successfully" -ForegroundColor White
Write-Host "2. 🔍 Monitor performance improvements" -ForegroundColor White
Write-Host ""
Write-Host "For more details, see: PERFORMANCE_OPTIMIZATIONS.md" -ForegroundColor Yellow
Write-Host ""
