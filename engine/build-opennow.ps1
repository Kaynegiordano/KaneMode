<#
.SYNOPSIS
    Compile GeForce NOW pour KaneMode (client OpenNOW, sous-module engine\OpenNOW) dans engine\out-opennow.
.DESCRIPTION
    1. Récupère le sous-module engine\OpenNOW si besoin.
    2. Compile SDL3 (version de leurs scripts de compilation, code source officiel libsdl-org) dans engine\.deps.
    3. Configure et compile OpenNOW avec CMake (Qt 6 MSVC 64 bits, Rust/Cargo, libclang), puis l'installe
       dans engine\out-opennow (bin\OpenNOW.exe et ce qu'il lui faut : Qt, SDL3, FFmpeg, moteur Rust).
    KaneMode l'utilise ensuite en développement, et native\build.ps1 l'embarque (dossier opennow\).
    Prérequis : Visual Studio 18 (C++ et CMake), Qt 6.8+ msvc 64 bits avec Multimedia et Shader Tools,
    Rust (cargo), git, libclang (LLVM, ou le paquet Python « libclang »).
.PARAMETER QtDir
    Dossier Qt à utiliser (par défaut : le plus récent de C:\Qt).
#>
param([string]$QtDir)

$ErrorActionPreference = 'Stop'
$engine = $PSScriptRoot
$root = Split-Path -Parent $engine
$src = Join-Path $engine 'OpenNOW'
$deps = Join-Path $engine '.deps'
$build = Join-Path $deps 'opennow-build'
$out = Join-Path $engine 'out-opennow'
$sdlVersion = 'release-3.2.20' # celle de leur .github/workflows/qt-build.yml
function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }

# CMake de Visual Studio (pas besoin d'une installation à part)
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) {
    $cmake = Get-ChildItem "${env:ProgramFiles}\Microsoft Visual Studio\*\*\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" -ErrorAction SilentlyContinue |
        Select-Object -Last 1 -ExpandProperty FullName
}
if (-not $cmake) { throw 'CMake introuvable (installez la charge de travail C++ de Visual Studio)' }

if (-not $QtDir) {
    $QtDir = Get-ChildItem 'C:\Qt\6.*\msvc*_64' -Directory -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
}
if (-not $QtDir -or -not (Test-Path (Join-Path $QtDir 'bin\qsb.exe'))) { throw "Qt avec Shader Tools introuvable ($QtDir)" }

# libclang (bindgen de la partie Rust) : LLVM, sinon le paquet Python « libclang »
if (-not $env:LIBCLANG_PATH) {
    $llvm = Join-Path $env:ProgramFiles 'LLVM\bin'
    if (Test-Path (Join-Path $llvm 'libclang.dll')) { $env:LIBCLANG_PATH = $llvm }
    else {
        $py = & python -c "import clang, os; print(os.path.join(os.path.dirname(clang.__file__), 'native'))" 2>$null
        if ($py -and (Test-Path (Join-Path $py 'libclang.dll'))) { $env:LIBCLANG_PATH = $py }
        else { throw 'libclang introuvable : installez LLVM, ou « python -m pip install libclang »' }
    }
}

# ---------------------------------------------------------------- 1. Sources
Step 'Sources (sous-module engine\OpenNOW)'
if (-not (Test-Path (Join-Path $src 'opennow-qt\CMakeLists.txt'))) {
    git -C $root submodule update --init -- engine/OpenNOW
    if ($LASTEXITCODE -ne 0) { throw 'Récupération du sous-module impossible' }
}

# ---------------------------------------------------------------- 2. SDL3
New-Item -ItemType Directory -Force $deps | Out-Null
$sdlInstall = Join-Path $deps 'SDL-install'
if (-not (Test-Path (Join-Path $sdlInstall 'bin\SDL3.dll'))) {
    Step "SDL3 ($sdlVersion)"
    $sdlSrc = Join-Path $deps 'SDL'
    if (-not (Test-Path $sdlSrc)) { git clone -q --depth 1 --branch $sdlVersion https://github.com/libsdl-org/SDL.git $sdlSrc }
    & $cmake -S $sdlSrc -B (Join-Path $deps 'SDL-build') -DSDL_TEST_LIBRARY=OFF "-DCMAKE_INSTALL_PREFIX=$sdlInstall"
    & $cmake --build (Join-Path $deps 'SDL-build') --config Release --parallel
    & $cmake --install (Join-Path $deps 'SDL-build') --config Release
    if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation de SDL3' }
}

# ---------------------------------------------------------------- 3. OpenNOW
Step 'Compilation d''OpenNOW (Qt + Rust)'
& $cmake -S (Join-Path $src 'opennow-qt') -B $build "-DCMAKE_PREFIX_PATH=$($QtDir -replace '\\','/');$($sdlInstall -replace '\\','/')"
if ($LASTEXITCODE -ne 0) { throw 'Échec de la configuration' }
& $cmake --build $build --config Release --parallel
if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation' }

Step 'Installation dans engine\out-opennow'
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
& $cmake --install $build --config Release --prefix $out
if ($LASTEXITCODE -ne 0) { throw 'Échec de l''installation' }
$exe = Join-Path $out 'bin\OpenNOW.exe'
if (-not (Test-Path $exe)) { throw "OpenNOW.exe absent de $out" }
$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
$commit = git -C $src rev-parse --short HEAD
Write-Host "== GeForce NOW prêt : engine\out-opennow" -ForegroundColor Green
Write-Host "   OpenNOW ($commit), $size Mo"
