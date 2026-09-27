param(
  [string]$HostIp
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$platformDir = Join-Path $repoRoot 'apps/platform'
$websiteDir = Join-Path $repoRoot 'apps/website'
$stateDir = Join-Path $platformDir '.data/local-preview'
$stateFile = Join-Path $stateDir 'processes.json'

if (-not $HostIp) {
  $physicalInterfaces = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
  $network = Get-NetIPConfiguration | Where-Object {
    $_.InterfaceIndex -in $physicalInterfaces -and $_.IPv4DefaultGateway -and $_.IPv4Address -and
    $_.IPv4Address[0].IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  } | Select-Object -First 1
  if (-not $network) { throw 'No IPv4 network with a default gateway. Pass -HostIp.' }
  $HostIp = $network.IPv4Address[0].IPAddress
}

$localAddress = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $HostIp }
if (-not $localAddress) { throw "$HostIp is not a local IPv4 address." }
foreach ($port in @(3000, 4321)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop that service first."
  }
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$env:NODE_ENV = 'development'
$env:APP_ENV = 'local'
$env:DATABASE_URL = 'file://.data/local-preview-petbaby'
$env:OBJECT_STORAGE_PROVIDER = 'local'
$env:LOCAL_STORAGE_DIR = '.data/objects'
$env:PAYMENT_PROVIDER = 'development'
$env:PHYSICAL_PAYMENT_PROVIDER = 'development'
$env:PASSWORD_AUTH_ENABLED = 'true'
$env:PUBLIC_APP_URL = "http://${HostIp}:3000"
$miniConfig = Join-Path $repoRoot 'apps/miniprogram/config.local.js'
if ((Test-Path -LiteralPath $miniConfig) -and -not (Get-Content -LiteralPath $miniConfig -Raw).Contains($env:PUBLIC_APP_URL)) {
  Write-Warning "Mini Program apiBaseUrl differs from $env:PUBLIC_APP_URL. Update $miniConfig before Mini Program debugging."
}

$platform = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', "corepack.cmd pnpm dev --hostname $HostIp --port 3000") -WorkingDirectory $platformDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'platform.out.log') -RedirectStandardError (Join-Path $stateDir 'platform.err.log')

$env:SITE_URL = "http://${HostIp}:4321"
$website = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', "corepack.cmd pnpm dev --host $HostIp --port 4321") -WorkingDirectory $websiteDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'website.out.log') -RedirectStandardError (Join-Path $stateDir 'website.err.log')

function Wait-Listener([int]$port) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq $HostIp } | Select-Object -First 1
    if ($listener) { return $listener.OwningProcess }
    Start-Sleep -Milliseconds 500
  }
  throw "Port $port did not start. Check logs in $stateDir."
}

$platformListener = Wait-Listener 3000
$websiteListener = Wait-Listener 4321
@{ platform = $platform.Id; website = $website.Id; platformListener = $platformListener; websiteListener = $websiteListener; hostIp = $HostIp } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-Host "Platform and H5: http://${HostIp}:3000"
Write-Host "Website:         http://${HostIp}:4321"
Write-Host "Logs:            $stateDir"
Write-Host "Stop:            bash deploy/scripts/stop-local-preview.sh"
