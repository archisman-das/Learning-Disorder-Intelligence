Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $projectRoot

function Test-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )
  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { return $true }
    } catch {
      Start-Sleep -Milliseconds 600
    }
  }
  return $false
}

Write-Host "Starting backend (Flask) on http://127.0.0.1:5050 ..."
$backendCmd = "Set-Location '$projectRoot'; python dashboard_web.py"
Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList @("-NoProfile", "-Command", $backendCmd)

Write-Host "Starting frontend (Vite) on http://127.0.0.1:5173 ..."
Set-Location "$projectRoot\frontend"

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing frontend dependencies (npm install) ..."
  npm install
}

$frontendCmd = "Set-Location '$projectRoot\frontend'; npm run dev"
Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList @("-NoProfile", "-Command", $frontendCmd)

Write-Host "Waiting for services to become ready..."
$backendReady = Test-HttpReady -Url "http://127.0.0.1:5050/api/health" -TimeoutSeconds 60
$frontendReady = Test-HttpReady -Url "http://127.0.0.1:5173" -TimeoutSeconds 90

if ($backendReady -and $frontendReady) {
  Write-Host "Backend and frontend are ready."
  Write-Host "Opening http://127.0.0.1:5173 ..."
  Start-Process "http://127.0.0.1:5173"
  exit 0
}

if (-not $backendReady) {
  Write-Host "Backend did not become ready at http://127.0.0.1:5050/api/health" -ForegroundColor Yellow
}
if (-not $frontendReady) {
  Write-Host "Frontend did not become ready at http://127.0.0.1:5173" -ForegroundColor Yellow
}
Write-Host "You can still check processes manually." -ForegroundColor Yellow
exit 1
