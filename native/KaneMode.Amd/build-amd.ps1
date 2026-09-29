<#
.SYNOPSIS
    Compile l'outil des réglages AMD de KaneMode (native\KaneMode.Amd) dans obj\amd.
.DESCRIPTION
    kanemode-amd.exe règle les fonctions graphiques du pilote AMD (limite d'images par seconde, RSR,
    AFMF, Anti-Lag, netteté) par ADLX, la bibliothèque du pilote. L'hôte le lance et lui parle
    ligne par ligne (host\lib\amd.js).
      1. télécharge le SDK ADLX d'AMD (GitHub, version fixée, empreinte vérifiée) : il n'est pas
         dans le dépôt, il a sa propre licence ;
      2. compile Amd.cpp avec l'assistant ADLX (runtime C++ statique : rien à installer sur la console).
    Copié dans le paquet (app\tools) par native\build.ps1.
#>
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$obj = Join-Path $here 'obj'
$out = Join-Path $obj 'amd'
# ADLX 2.0 (étiquette v2.0)
$Commit = '1ca2dd42f1df8cbd045489b7a20013a07692a446'
$Sha256 = '0182E66361760CADFF373437DB2C3914952D7DB11C7C903E8E24FCA0AF210EA8'

function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }
New-Item -ItemType Directory -Force $obj, $out | Out-Null

# ---------------------------------------------------------------- 1. SDK ADLX
$sdk = Join-Path $obj "ADLX-$Commit"
if (-not (Test-Path (Join-Path $sdk '.done'))) {
    Step 'SDK ADLX d''AMD (GitHub)'
    $zip = Join-Path $obj 'adlx.zip'
    Invoke-WebRequest "https://github.com/GPUOpen-LibrariesAndSDKs/ADLX/archive/$Commit.zip" -OutFile $zip -UseBasicParsing
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
    if ($hash -ne $Sha256) { Remove-Item $zip; throw "Empreinte du SDK ADLX inattendue ($hash) : téléchargement rejeté" }
    Remove-Item $sdk -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip $obj -Force
    Remove-Item $zip
    New-Item (Join-Path $sdk '.done') -ItemType File | Out-Null
}

# ---------------------------------------------------------------- 2. Compilation
Step 'Compilation de kanemode-amd.exe (ADLX)'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -prerelease -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio (outils C++) introuvable' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
$exe = Join-Path $out 'kanemode-amd.exe'
$sources = @(
    (Join-Path $here 'Amd.cpp'),
    (Join-Path $sdk 'SDK\ADLXHelper\Windows\Cpp\ADLXHelper.cpp'),
    (Join-Path $sdk 'SDK\Platform\Windows\WinAPIs.cpp')
) | ForEach-Object { "`"$_`"" }
$cl = "cl /nologo /std:c++17 /EHsc /O2 /MT /utf-8 /W3 /DUNICODE /D_UNICODE /DNOMINMAX " +
      "/I`"$sdk`" /Fo`"$obj\\`" /Fe`"$exe`" $($sources -join ' ') /link /SUBSYSTEM:CONSOLE"
# Un guillemet égaré dans PATH fait échouer vcvarsall (« \Windows était inattendu »)
$env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and $_ -notmatch '"' }) -join ';'
# vcvarsall cherche vswhere dans PATH ; ses messages d'erreur passent sur la sortie normale, sinon
# PowerShell les prend pour un échec quand la sortie de la compilation est redirigée
$env:PATH += ";${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
cmd /c "`"$vcvars`" x64 >nul 2>&1 && $cl 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation de kanemode-amd.exe' }
Write-Host "   Outil AMD prêt : $exe" -ForegroundColor Green
