<#
.SYNOPSIS
    Compile le moteur de streaming de KaneMode (KanePlay, sous-module engine\KanePlay) dans engine\out.
.DESCRIPTION
    1. Récupère le sous-module et ses propres sous-modules (moonlight-common-c, qmdnsengine…).
    2. Télécharge au besoin les bibliothèques précompilées officielles (setup-deps.ps1 de KanePlay :
       FFmpeg, SDL, OpenSSL… publiées par moonlight-stream).
    3. Compile avec Qt (MSVC 64 bits) et Visual Studio (scripts\build-arch.bat de KanePlay).
    4. Copie le résultat dans engine\out avec le runtime Visual C++ (le moteur doit démarrer sur un
       PC qui ne l'a pas) ; KaneMode l'utilise ensuite en développement, et build.ps1 l'embarque.
    Prérequis : Visual Studio (C++), Qt 6 msvc 64 bits (C:\Qt\<version>\msvc*_64), git.
.PARAMETER QtDir
    Dossier Qt à utiliser, ex. C:\Qt\6.11.3\msvc2022_64 (par défaut : le plus récent de C:\Qt).
#>
param([string]$QtDir)

$ErrorActionPreference = 'Stop'
$engine = $PSScriptRoot
$root = Split-Path -Parent $engine
$src = Join-Path $engine 'KanePlay'
$out = Join-Path $engine 'out'
function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. Sources
Step 'Sources du moteur (sous-module engine\KanePlay)'
# Première fois : récupère le sous-module. Ensuite, on compile ce qui est dans engine\KanePlay
# (éventuellement en cours de modification) sans le remettre sur la version enregistrée.
if (-not (Test-Path (Join-Path $src 'moonlight-qt.pro'))) {
    git -C $root submodule update --init --recursive -- engine/KanePlay
} else {
    git -C $src submodule update --init --recursive
}
if ($LASTEXITCODE -ne 0) { throw 'Récupération du sous-module impossible' }

# ---------------------------------------------------------------- 2. Bibliothèques précompilées
if (-not (Get-ChildItem (Join-Path $src 'libs\windows') -ErrorAction SilentlyContinue)) {
    Step 'Bibliothèques précompilées (setup-deps.ps1)'
    & (Join-Path $src 'setup-deps.ps1')
}

# ---------------------------------------------------------------- 3. Compilation
if (-not $QtDir) {
    $QtDir = Get-ChildItem 'C:\Qt\*\msvc*_64' -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $QtDir -or -not (Test-Path (Join-Path $QtDir 'bin\qmake.exe'))) { throw 'Qt (msvc 64 bits) introuvable : installez Qt 6 ou passez -QtDir' }
$vswhereDir = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
if (-not (Test-Path (Join-Path $vswhereDir 'vswhere.exe'))) { throw 'Visual Studio introuvable (vswhere.exe)' }

Step "Compilation (Qt : $QtDir)"
$deploy = Join-Path $src 'build\deploy-x64-release'
$started = Get-Date
# vswhere dans le PATH : évite son chemin « (x86) », que les blocs if (...) des .bat ne supportent pas.
# Les guillemets égarés dans le PATH (ex. « C:\Program Files\GitHub CLI" ») font échouer vcvarsall.bat.
$cleanPath = (($env:PATH -split ';') | Where-Object { $_ } | ForEach-Object { $_.Trim('"') }) -join ';'
# 7-Zip : build-arch.bat archive les symboles de débogage avec 7z
$sevenZip = @((Join-Path $env:ProgramFiles '7-Zip'), (Join-Path ${env:ProgramFiles(x86)} '7-Zip')) | Where-Object { Test-Path (Join-Path $_ '7z.exe') } | Select-Object -First 1
if (-not $sevenZip -and -not (Get-Command 7z -ErrorAction SilentlyContinue)) { throw '7-Zip introuvable : winget install 7zip.7zip' }
if ($sevenZip) { $cleanPath = "$sevenZip;$cleanPath" }
$cmd = Join-Path $env:TEMP 'kanemode-build-engine.cmd'
Set-Content $cmd -Encoding ASCII -Value @"
@echo off
set "PATH=$QtDir\bin;$vswhereDir;$cleanPath"
cd /d "$src"
call scripts\build-arch.bat release
exit /b %ERRORLEVEL%
"@
# Messages d'erreur de cmd sur la sortie normale : sinon PowerShell les prend pour un échec quand la
# sortie de la compilation est redirigée (ex. « le dossier build existe déjà »)
& cmd.exe /c "`"$cmd`" 2>&1"
$code = $LASTEXITCODE
Remove-Item $cmd -ErrorAction SilentlyContinue
$exe = Join-Path $deploy 'KanePlay.exe'
if (-not (Test-Path $exe) -or (Get-Item $exe).LastWriteTime -lt $started.AddMinutes(-1) -and $code -ne 0) {
    throw "Échec de la compilation du moteur (code $code)"
}
# Les dernières étapes de build-arch.bat (installateur MSI de KanePlay) ne servent pas ici
if ($code -ne 0) { Write-Warning "build-arch.bat s'est terminé avec le code $code après avoir déployé le moteur (étape de l'installateur KanePlay) : sans effet pour KaneMode." }

# ---------------------------------------------------------------- 4. Résultat
Step 'Moteur prêt : engine\out'
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $deploy $out -Recurse
Get-ChildItem $out -Filter 'portable.dat*' | Remove-Item -Force

# Runtime Visual C++ à côté du moteur (déploiement local autorisé par Microsoft)
$vs = & (Join-Path $vswhereDir 'vswhere.exe') -latest -property installationPath
$crt = Get-ChildItem (Join-Path $vs 'VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT') -Directory -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $crt) { throw 'Runtime Visual C++ (VC\Redist) introuvable dans Visual Studio' }
Copy-Item (Join-Path $crt.FullName '*.dll') $out

$commit = (git -C $src rev-parse --short HEAD).Trim()
$version = (Get-Content (Join-Path $src 'app\version.txt') -Raw).Trim()
[IO.File]::WriteAllText((Join-Path $out 'engine.json'), (@{ engine = 'KanePlay'; version = $version; commit = $commit; built = (Get-Date).ToString('o') } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
$size = (Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("   KanePlay {0} ({1}), {2:N0} Mo, runtime VC++ {3}" -f $version, $commit, $size, $crt.Name) -ForegroundColor Green
