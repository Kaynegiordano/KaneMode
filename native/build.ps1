<#
.SYNOPSIS
    Construit l'app native KaneMode et son paquet MSIX.
.DESCRIPTION
    Assemble dans native\out\layout : KaneMode.exe (WPF + WebView2), l'interface (ui\), l'hôte (host\),
    Node.js, les icônes du paquet, le manifeste et le fichier de capacité « gamingHome ».
.PARAMETER Register
    Installe la version de développement sur ce PC (mode développeur requis, sans certificat).
    KaneMode apparaît alors dans le menu Démarrer et dans le choix de l'app d'accueil du mode Xbox.
.PARAMETER Unregister
    Désinstalle la version de développement.
.PARAMETER Pack
    Produit native\out\KaneMode_<version>_x64.msix signé avec un certificat de test (créé au besoin
    dans le magasin de l'utilisateur) et exporte ce certificat (.cer) à côté.
.PARAMETER SelfContained
    Embarque le runtime .NET (paquet plus gros, aucun prérequis sur le PC cible).
.PARAMETER NoKanePlay
    Paquet sans le moteur de streaming. Sinon, le moteur (KanePlay, sous-module engine\KanePlay)
    est embarqué depuis engine\out, compilé au besoin par engine\build-engine.ps1.
.PARAMETER Release
    Paquet à publier : n'y note pas le chemin de ce dépôt (import des données du prototype).
.PARAMETER Version
    Version du paquet (x.y.z.0) ; par défaut, celle du fichier VERSION.
#>
param([switch]$Register, [switch]$Unregister, [switch]$Pack, [switch]$SelfContained, [switch]$NoKanePlay, [switch]$Release, [string]$Version)

$ErrorActionPreference = 'Stop'
$native = $PSScriptRoot
$root = Split-Path -Parent $native
$out = Join-Path $native 'out'
$layout = Join-Path $out 'layout'

function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }

# Version unique du projet : fichier VERSION (x.y.z) ; le paquet MSIX veut x.y.z.0
$semver = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
if (-not $Version) { $Version = "$semver.0" }

if ($Unregister) {
    Get-AppxPackage -Name KaneMode | Remove-AppxPackage
    Write-Host 'Version de développement désinstallée.' -ForegroundColor Green
    return
}

# ---------------------------------------------------------------- 1. Compilation
Step 'Compilation de KaneMode.exe'
if (Test-Path $layout) {
    # Une version enregistrée tourne peut-être depuis ce dossier : on la ferme d'abord.
    Get-Process KaneMode -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 300
    Remove-Item $layout -Recurse -Force
}
$sc = if ($SelfContained) { 'true' } else { 'false' }
dotnet publish (Join-Path $native 'KaneMode.App\KaneMode.App.csproj') -c Release -r win-x64 --self-contained $sc -o $layout --nologo -v quiet "-p:Version=$semver"
if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation (code $LASTEXITCODE)" }

# ---------------------------------------------------------------- 2. Interface, hôte, Node
Step 'Copie de l''interface, de l''hôte et de Node.js'
$app = Join-Path $layout 'app'
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item (Join-Path $root 'ui') (Join-Path $app 'ui') -Recurse
Copy-Item (Join-Path $root 'host') (Join-Path $app 'host') -Recurse
New-Item -ItemType Directory -Force (Join-Path $app 'setup') | Out-Null
Copy-Item (Join-Path $root 'VERSION') $app
# Développement : au premier lancement, l'app reprend les données du prototype depuis ce dépôt.
if (-not $Release) { Set-Content (Join-Path $app 'source-root.txt') $root -Encoding UTF8 }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js introuvable : winget install OpenJS.NodeJS.LTS' }
New-Item -ItemType Directory -Force (Join-Path $layout 'node') | Out-Null
Copy-Item $node (Join-Path $layout 'node\node.exe')
# Moteur de streaming (KanePlay), invisible : KaneMode affiche lui-même les PC, l'appairage et les jeux
if (-not $NoKanePlay) {
    $engineOut = Join-Path $root 'engine\out'
    if (-not (Test-Path (Join-Path $engineOut 'KanePlay.exe'))) { & (Join-Path $root 'engine\build-engine.ps1') }
    Step 'Copie du moteur de streaming (engine\out)'
    Copy-Item $engineOut (Join-Path $layout 'kaneplay') -Recurse
}

# ---------------------------------------------------------------- 3. Icônes du paquet
Step 'Icônes du paquet'
Add-Type -AssemblyName System.Drawing
$assets = Join-Path $layout 'Assets'
New-Item -ItemType Directory -Force $assets | Out-Null
function New-Logo([string]$file, [int]$w, [int]$h, [double]$scale, [bool]$transparent = $true) {
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear($(if ($transparent) { [Drawing.Color]::Transparent } else { [Drawing.Color]::FromArgb(11, 14, 19) }))
    $s = [Math]::Round([Math]::Min($w, $h) * $scale)
    $x = ($w - $s) / 2; $y = ($h - $s) / 2
    $r = $s / 4
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90); $path.AddArc($x + $s - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $s - $r, $y + $s - $r, $r, $r, 0, 90); $path.AddArc($x, $y + $s - $r, $r, $r, 90, 90); $path.CloseFigure()
    $brush = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.PointF]::new($x, $y)), ([Drawing.PointF]::new($x + $s, $y + $s)), ([Drawing.Color]::FromArgb(26, 159, 255)), ([Drawing.Color]::FromArgb(106, 92, 255))
    $g.FillPath($brush, $path)
    $k = $s / 48
    $pts = @(@(15,11),@(21,11),@(21,21.2),@(30.6,11),@(38,11),@(27.6,22.2),@(38.4,37),@(31.1,37),@(23.5,26.4),@(21,29),@(21,37),@(15,37)) |
        ForEach-Object { [Drawing.PointF]::new($x + $_[0] * $k, $y + $_[1] * $k) }
    $g.FillPolygon([Drawing.Brushes]::White, [Drawing.PointF[]]$pts)
    $bmp.Save((Join-Path $assets $file), [Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}
New-Logo 'Square44x44Logo.png' 44 44 1
New-Logo 'Square44x44Logo.targetsize-256_altform-unplated.png' 256 256 1
New-Logo 'Square150x150Logo.png' 150 150 0.66
New-Logo 'Wide310x150Logo.png' 310 150 0.66
New-Logo 'StoreLogo.png' 50 50 1
New-Logo 'SplashScreen.png' 620 300 0.5

# ---------------------------------------------------------------- 4. Manifeste
Step 'Manifeste (application de jeu, capacité gamingHome)'
$manifest = Get-Content (Join-Path $native 'package\AppxManifest.xml') -Raw -Encoding UTF8
[IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest.Replace('__VERSION__', $Version), (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $native 'package\CustomCapability.SCCD') $layout
New-Item -ItemType Directory -Force (Join-Path $layout 'Public') | Out-Null
Set-Content (Join-Path $layout 'Public\LISEZMOI.txt') 'Dossier public de l''extension windows.gamingApp de KaneMode.' -Encoding UTF8
$size = (Get-ChildItem $layout -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("   Dossier prêt : {0} ({1:N0} Mo)" -f $layout, $size)

# ---------------------------------------------------------------- 5. Installation de développement
if ($Register) {
    Step 'Installation de la version de développement'
    Add-AppxPackage -Register (Join-Path $layout 'AppxManifest.xml') -ForceApplicationShutdown -ForceUpdateFromAnyVersion
    $pkg = Get-AppxPackage -Name KaneMode
    Write-Host "   Installé : $($pkg.PackageFullName)" -ForegroundColor Green
    Write-Host '   Menu Démarrer > KaneMode, ou Paramètres > Jeux > Mode Xbox > Choisir l''application d''accueil.'
}

# ---------------------------------------------------------------- 6. Paquet MSIX signé
if ($Pack) {
    Step 'Création du paquet MSIX'
    $kit = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $kit) { throw 'makeappx.exe introuvable : installez le SDK Windows' }
    $makeappx = $kit.FullName
    $signtool = Join-Path $kit.DirectoryName 'signtool.exe'
    $msix = Join-Path $out "KaneMode_$($Version)_x64.msix"
    & $makeappx pack /d $layout /p $msix /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Échec de makeappx' }

    # Certificat de test (le Publisher du manifeste doit correspondre au sujet du certificat)
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=KaneMode' -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=KaneMode' -KeyUsage DigitalSignature -FriendlyName 'KaneMode (test)' `
            -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(10) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    }
    & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Échec de la signature' }
    Export-Certificate -Cert $cert -FilePath (Join-Path $out 'KaneMode.cer') | Out-Null
    Write-Host "   Paquet : $msix" -ForegroundColor Green
    Write-Host "   Pour l'installer sur un PC : faire confiance à KaneMode.cer (Personnes autorisées, ordinateur local), activer le mode développeur, puis ouvrir le .msix."
}
