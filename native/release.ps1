<#
.SYNOPSIS
    Construit une version publiable de KaneMode et, avec -Publish, la met en ligne sur GitHub.
.DESCRIPTION
    Dans native\out\release :
      KaneMode-Setup-<version>.exe     installateur unique (app + mode développeur + mode Xbox)
      KaneMode_<version>.0_x64.msix    paquet seul, utilisé par la mise à jour intégrée à l'app
      KaneMode.cer                     certificat public qui signe le paquet
      SHA256SUMS.txt                   empreintes, vérifiées par la mise à jour intégrée
    La version vient du fichier VERSION. Le paquet est signé avec le certificat « CN=KaneMode »
    du magasin de l'utilisateur (créé au premier -Pack) : sans lui, les mises à jour ne
    s'installeraient plus par-dessus. Gardez-en une sauvegarde (voir README).
.PARAMETER Publish
    Crée la version sur GitHub (gh release create) avec ces fichiers.
.PARAMETER Beta
    Publie en pré-version : seuls les utilisateurs du canal Bêta la reçoivent.
.PARAMETER Notes
    Fichier de notes de version (Markdown). Par défaut : texte générique.
#>
param([switch]$Publish, [switch]$Beta, [string]$Notes)

$ErrorActionPreference = 'Stop'
$native = $PSScriptRoot
$root = Split-Path -Parent $native
$out = Join-Path $native 'out'
$payload = Join-Path $out 'payload'
$rel = Join-Path $out 'release'
$version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
$tag = "v$version"
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Remove-Item $payload, $rel -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $payload, $rel | Out-Null

# ---------------------------------------------------------------- 1. Paquet MSIX signé (runtime .NET inclus)
Step "Paquet KaneMode $version"
& (Join-Path $native 'build.ps1') -Pack -SelfContained -Release
if (-not $?) { throw 'Échec du paquet' }
$msix = Join-Path $out "KaneMode_$($version).0_x64.msix"
Copy-Item $msix (Join-Path $payload 'KaneMode.msix')
Copy-Item (Join-Path $out 'KaneMode.cer') $payload

# ---------------------------------------------------------------- 2. Activation silencieuse du mode Xbox (un seul fichier)
Step 'Activation silencieuse du mode Xbox'
$vendor = Join-Path $root 'vendor\XboxFullScreenExperienceTool'
if (-not (Test-Path (Join-Path $vendor 'Modules\ViVe\ViVe\ViVe.csproj'))) { & (Join-Path $root 'setup\build-xbox-enabler.ps1') }
$enablerOut = Join-Path $out 'enabler'
dotnet publish (Join-Path $vendor 'XboxFullScreenExperienceTool\XboxFullScreenExperienceTool.csproj') -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $enablerOut --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation de l''activation du mode Xbox' }
Copy-Item (Join-Path $enablerOut 'XboxFullScreenExperienceTool.exe') (Join-Path $payload 'XboxModeEnabler.exe')

# ---------------------------------------------------------------- 3. Installateur unique
Step 'Installateur'
$setupOut = Join-Path $out 'setup'
dotnet publish (Join-Path $native 'KaneMode.Setup\KaneMode.Setup.csproj') -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    "-p:Version=$version" "-p:PayloadDir=$payload" -o $setupOut --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation de l''installateur' }
Copy-Item (Join-Path $setupOut 'KaneMode-Setup.exe') (Join-Path $rel "KaneMode-Setup-$version.exe")
Copy-Item $msix $rel
Copy-Item (Join-Path $out 'KaneMode.cer') $rel

# ---------------------------------------------------------------- 4. Empreintes
Step 'Empreintes SHA-256'
$sums = Get-ChildItem $rel -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
[IO.File]::WriteAllLines((Join-Path $rel 'SHA256SUMS.txt'), $sums)
Get-ChildItem $rel -File | ForEach-Object { Write-Host ('   {0,-40} {1,8:N1} Mo' -f $_.Name, ($_.Length / 1MB)) }

# ---------------------------------------------------------------- 5. Publication
if ($Publish) {
    Step "Publication de $tag sur GitHub"
    if (-not $Notes) {
        $Notes = Join-Path $out 'notes.md'
        Set-Content $Notes -Encoding UTF8 -Value @"
Installez **KaneMode-Setup-$version.exe** (droits administrateur demandés une fois).

Les versions déjà installées se mettent à jour depuis KaneMode : Paramètres → Système → Mises à jour.
"@
    }
    $files = Get-ChildItem $rel -File | ForEach-Object FullName
    $ghArgs = @('release', 'create', $tag) + $files + @('--title', "KaneMode $version", '--notes-file', $Notes)
    if ($Beta) { $ghArgs += '--prerelease' }
    gh @ghArgs
    if ($LASTEXITCODE -ne 0) { throw 'Échec de la publication' }
}
Write-Host "`nTerminé : $rel" -ForegroundColor Green
