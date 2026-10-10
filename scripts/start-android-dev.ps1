[CmdletBinding()]
param(
  [switch]$ClearAppData,
  [string]$Device = "emulator-5554",
  [int]$PreferredPort = 8081
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageName = "com.gracielleperez.shedmo"
$candidatePorts = @($PreferredPort) + @(8081, 8082, 8083, 8084) |
  Select-Object -Unique
$metroLog = Join-Path $env:TEMP "shedmo-metro.log"

function Write-Step([string]$Message) {
  Write-Host "[android-dev] $Message"
}

function Get-ProjectMetroProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    $_.CommandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $_.CommandLine -match "expo.*\sstart(?:\s|$)"
  }
}

function Stop-ProjectMetro {
  $processes = @(Get-ProjectMetroProcesses)
  if ($processes.Count -eq 0) {
    Write-Step "No stale Metro process for this project was found."
    return
  }

  foreach ($process in $processes) {
    Write-Step "Stopping project Metro process $($process.ProcessId)."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 750
}

function Get-Listener([int]$Port) {
  Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Test-Metro([int]$Port) {
  $response = $null
  $reader = $null
  try {
    $request = [System.Net.WebRequest]::Create("http://localhost:$Port/status")
    $request.Proxy = $null
    $request.Timeout = 2000
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    return $reader.ReadToEnd() -eq "packager-status:running"
  } catch {
    return $false
  } finally {
    if ($reader) { $reader.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

Write-Step "Project: $projectRoot"
Stop-ProjectMetro

$selectedPort = $null
foreach ($port in $candidatePorts) {
  $listener = Get-Listener $port
  if (-not $listener) {
    $selectedPort = $port
    break
  }
  Write-Step "Port $port is owned by unrelated PID $($listener.OwningProcess); leaving it untouched."
}
if (-not $selectedPort) {
  throw "Ports 8081-8084 are occupied by unrelated processes."
}
Write-Step "Using Metro port $selectedPort."

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
  $sdkAdb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
  if (-not (Test-Path $sdkAdb)) { throw "ADB was not found." }
  $adbPath = $sdkAdb
} else {
  $adbPath = $adb.Source
}

& $adbPath start-server | Out-Null
$deviceState = (& $adbPath -s $Device get-state 2>$null)
if ($deviceState -ne "device") {
  Write-Step "ADB did not find $Device; restarting the ADB server once."
  & $adbPath kill-server | Out-Null
  & $adbPath start-server | Out-Null
  $deviceState = (& $adbPath -s $Device get-state 2>$null)
}
if ($deviceState -ne "device") {
  throw "$Device is not online. Start the emulator and rerun this script."
}
Write-Step "$Device is online."

$packagePath = (& $adbPath -s $Device shell pm path $packageName 2>$null)
if (-not ($packagePath -match "^package:")) {
  throw "$packageName is not installed on $Device."
}
Write-Step "$packageName is installed."

& $adbPath -s $Device shell am force-stop $packageName | Out-Null
if ($ClearAppData) {
  Write-Step "Clearing app data because -ClearAppData was explicitly supplied."
  & $adbPath -s $Device shell pm clear $packageName | Out-Null
}

& $adbPath -s $Device reverse "tcp:$selectedPort" "tcp:$selectedPort" | Out-Null
$metroCommand = "npx expo start --dev-client --port $selectedPort > `"$metroLog`" 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", $metroCommand -WorkingDirectory $projectRoot -WindowStyle Hidden

$metroReady = $false
for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
  Start-Sleep -Seconds 1
  if (Test-Metro $selectedPort) {
    $metroReady = $true
    break
  }
}
if (-not $metroReady) {
  $tail = if (Test-Path $metroLog) {
    (Get-Content $metroLog -Tail 30) -join [Environment]::NewLine
  } else {
    "Metro did not create a log file."
  }
  throw "Metro did not become ready. Log tail:`n$tail"
}

Write-Step "Metro is healthy at http://localhost:$selectedPort."
Write-Step "Metro log: $metroLog"
$encodedMetroUrl = [Uri]::EscapeDataString("http://localhost:$selectedPort")
$developmentUrl = "shedmo://expo-development-client/?url=$encodedMetroUrl"
& $adbPath -s $Device shell am start -W -a android.intent.action.VIEW -d $developmentUrl $packageName | Out-Null
Write-Step "The development build was launched on $Device."
