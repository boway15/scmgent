# SCM Agent API smoke test (dev mode, localhost:8080)
$Base = if ($env:SCM_BASE_URL) { $env:SCM_BASE_URL } else { "http://localhost:8080" }
$Failed = 0
$Passed = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Path,
        [int]$ExpectStatus = 200,
        [string]$ExpectJsonKey = $null
    )
    $url = "$Base$Path"
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $ok = $resp.StatusCode -eq $ExpectStatus
        $isJson = $resp.Headers['Content-Type'] -match 'application/json' -or $resp.Content.TrimStart().StartsWith('{') -or $resp.Content.TrimStart().StartsWith('[')
        if ($resp.Content -match '<!doctype html>') { $ok = $false }
        elseif ($ExpectJsonKey -and $isJson) {
            $data = $resp.Content | ConvertFrom-Json
            if ($data.PSObject.Properties.Name -contains $ExpectJsonKey) { $ok = $true }
            elseif ($data -is [array] -and $data.Count -ge 0) { $ok = $true }
            else { $ok = $false }
        }
        elseif ($ExpectJsonKey -and -not $isJson) { $ok = $false }
        if ($ok) {
            Write-Host "[PASS] $Name ($Path)" -ForegroundColor Green
            $script:Passed++
        } else {
            Write-Host "[FAIL] $Name ($Path) status=$($resp.StatusCode) content=$($resp.Content.Substring(0, [Math]::Min(80, $resp.Content.Length)))" -ForegroundColor Red
            $script:Failed++
        }
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq $ExpectStatus) {
            Write-Host "[PASS] $Name ($Path) expected $ExpectStatus" -ForegroundColor Green
            $script:Passed++
        } else {
            Write-Host "[FAIL] $Name ($Path) error: $($_.Exception.Message)" -ForegroundColor Red
            $script:Failed++
        }
    }
}

Write-Host "=== SCM Agent Smoke Test ===" -ForegroundColor Cyan
Write-Host "Base: $Base`n"

Test-Endpoint "Health" "/api/health" -ExpectJsonKey "status"
Test-Endpoint "Auth config" "/api/auth/config" -ExpectJsonKey "feishuEnabled"
Test-Endpoint "Current user" "/api/me" -ExpectJsonKey "email"
Test-Endpoint "My menus" "/api/me/menus"
Test-Endpoint "Dashboard" "/api/dashboard" -ExpectJsonKey "kpis"
Test-Endpoint "Compliance overview" "/api/compliance/overview" -ExpectJsonKey "stats"
Test-Endpoint "Compliance SKUs" "/api/compliance/skus"
Test-Endpoint "Inventory overview" "/api/inventory/overview"
Test-Endpoint "Alerts" "/api/alerts"
Test-Endpoint "Reorder suggestions" "/api/reorder/suggestions"
Test-Endpoint "Sales history" "/api/sales/history"
Test-Endpoint "AI config" "/api/ai/config"
# SPA should return HTML
try {
    $spa = Invoke-WebRequest -Uri "$Base/" -UseBasicParsing -TimeoutSec 10
    if ($spa.Content -match '<!doctype html>') {
        Write-Host "[PASS] Frontend SPA (/) returns HTML" -ForegroundColor Green
        $Passed++
    } else { Write-Host "[FAIL] Frontend SPA (/) unexpected content" -ForegroundColor Red; $Failed++ }
} catch { Write-Host "[FAIL] Frontend SPA: $($_.Exception.Message)" -ForegroundColor Red; $Failed++ }

# Menu checks
try {
    $menus = (Invoke-WebRequest -Uri "$Base/api/me/menus" -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    $flat = @()
    function Flatten($items) {
        foreach ($m in $items) {
            if ($m.path) { $script:flat += $m.path }
            if ($m.children) { Flatten $m.children }
        }
    }
    Flatten $menus
    $required = @('/dashboard', '/compliance/overview', '/compliance/skus', '/system/roles')
    foreach ($p in $required) {
        if ($flat -contains $p) {
            Write-Host "[PASS] Menu path $p" -ForegroundColor Green
            $Passed++
        } else {
            Write-Host "[FAIL] Menu path missing: $p" -ForegroundColor Red
            $Failed++
        }
    }
    if ($flat -contains '/system/menus') {
        Write-Host "[WARN] Legacy menu /system/menus still present (0009 migration pending?)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[FAIL] Menu path check: $($_.Exception.Message)" -ForegroundColor Red
    $Failed++
}

Write-Host "`n=== Result: $Passed passed, $Failed failed ===" -ForegroundColor Cyan
if ($Failed -gt 0) { exit 1 }
exit 0
