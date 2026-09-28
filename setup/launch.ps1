# Lance KaneMode : démarre l'hôte (si besoin) puis ouvre l'interface en plein écran
# dans une fenêtre Edge dédiée (profil séparé, sans barre d'adresse).
param([int]$Port = 5173)

$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:$Port"

function Test-KaneHost {
    try { return (Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 } catch { return $false }
}

if (-not (Test-KaneHost)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        Add-Type -AssemblyName PresentationFramework
        [Windows.MessageBox]::Show("Node.js est introuvable. Installez-le (winget install OpenJS.NodeJS.LTS) puis relancez KaneMode.", 'KaneMode') | Out-Null
        exit 1
    }
    $env:PORT = "$Port"
    Start-Process $node -ArgumentList "`"$root\host\server.js`"" -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 60 -and -not (Test-KaneHost); $i++) { Start-Sleep -Milliseconds 250 }
}

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Start-Process $url; exit 0 }

# Profil dédié : l'hôte s'en sert pour refermer uniquement cette fenêtre au retour au bureau.
$edgeProfile = Join-Path $root 'data\edge-profile'
Start-Process $edge -ArgumentList @(
    "--app=$url", '--start-fullscreen', "--user-data-dir=`"$edgeProfile`"",
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--disable-features=Translate'
)
