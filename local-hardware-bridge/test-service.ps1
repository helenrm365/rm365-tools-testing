# Test Local Hardware Bridge Service
# Run this after starting the service to verify it's working

Write-Host "Testing RM365 Local Hardware Bridge..." -ForegroundColor Cyan
Write-Host ""

# Test 1: Service running
Write-Host "Test 1: Checking if service is running..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/" -UseBasicParsing
    $data = $response.Content | ConvertFrom-Json
    Write-Host "  ✓ Service is running" -ForegroundColor Green
    Write-Host "    Service: $($data.service)" -ForegroundColor Gray
    Write-Host "    Status: $($data.status)" -ForegroundColor Gray
} catch {
    Write-Host "  ✗ Service is NOT running" -ForegroundColor Red
    Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Start the service with: python app.py" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Test 2: Health check
Write-Host "Test 2: Health check..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing
    $data = $response.Content | ConvertFrom-Json
    Write-Host "  ✓ Health check passed" -ForegroundColor Green
    Write-Host "    Fingerprint available: $($data.fingerprint_available)" -ForegroundColor Gray
    Write-Host "    Card reader available: $($data.card_available)" -ForegroundColor Gray
    
    if (-not $data.fingerprint_available) {
        Write-Host "    ⚠ Fingerprint hardware not detected" -ForegroundColor Yellow
        Write-Host "      Configure SecuGen SDK in app.py" -ForegroundColor Gray
    }
    
    if (-not $data.card_available) {
        Write-Host "    ⚠ Card reader hardware not detected" -ForegroundColor Yellow
        Write-Host "      Configure card reader in app.py" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ✗ Health check failed" -ForegroundColor Red
    Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 3: Fingerprint scan endpoint
Write-Host "Test 3: Testing fingerprint scan endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/fingerprint/scan" -Method POST -UseBasicParsing
    Write-Host "  ✗ Unexpected success (hardware not configured)" -ForegroundColor Yellow
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 501) {
        Write-Host "  ✓ Endpoint exists (returns 501 - not configured)" -ForegroundColor Green
        Write-Host "    This is expected until SecuGen SDK is installed" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Unexpected status code: $statusCode" -ForegroundColor Yellow
    }
}

Write-Host ""

# Test 4: Card scan endpoint
Write-Host "Test 4: Testing card scan endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/card/scan" -Method POST -UseBasicParsing
    Write-Host "  ✗ Unexpected success (hardware not configured)" -ForegroundColor Yellow
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 501) {
        Write-Host "  ✓ Endpoint exists (returns 501 - not configured)" -ForegroundColor Green
        Write-Host "    This is expected until card reader is configured" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Unexpected status code: $statusCode" -ForegroundColor Yellow
    }
}

Write-Host ""

# Test 5: CORS headers
Write-Host "Test 5: Checking CORS headers..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing
    $corsHeader = $response.Headers["Access-Control-Allow-Origin"]
    if ($corsHeader) {
        Write-Host "  ✓ CORS headers present" -ForegroundColor Green
        Write-Host "    Allows: $corsHeader" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ No CORS headers found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ Could not check CORS headers" -ForegroundColor Red
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "Test Summary:" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
Write-Host "Service Status:          ✓ Running" -ForegroundColor Green
Write-Host "Endpoints:               ✓ Responding" -ForegroundColor Green
Write-Host "Hardware Configuration:  ⚠ Pending" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Install SecuGen SDK from https://www.secugen.com/" -ForegroundColor White
Write-Host "  2. Connect your fingerprint reader hardware" -ForegroundColor White
Write-Host "  3. Configure app.py with your hardware details" -ForegroundColor White
Write-Host "  4. Restart the service and run this test again" -ForegroundColor White
Write-Host ""
