<#
.SYNOPSIS
    Compile le widget Game Bar de KaneMode (native\KaneMode.Widget) dans obj\widget.
.DESCRIPTION
    Un widget Game Bar est forcément une application UWP (XAML). Celle-ci est écrite en C++/WinRT,
    sans fichier XAML, et compilée en ligne de commande avec les outils de Visual Studio
    (environnement « uwp » de vcvarsall) :
      1. télécharge le kit Game Bar de Microsoft (NuGet Microsoft.Gaming.XboxGameBar, version fixée) ;
      2. génère les en-têtes C++/WinRT (cppwinrt.exe du SDK Windows) ;
      3. compile Widget.cpp en application de conteneur (runtime C++ « store », fourni par VCLibs).
    Résultat : obj\widget\KaneMode.Widget.exe + Microsoft.Gaming.XboxGameBar.dll/.winmd, copiés
    dans le paquet par native\build.ps1 (dossier widget\).
#>
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$obj = Join-Path $here 'obj'
$out = Join-Path $obj 'widget'
$gen = Join-Path $obj 'gen'
$GameBarVersion = '7.3.2607010'

function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }
New-Item -ItemType Directory -Force $obj, $out | Out-Null

# ---------------------------------------------------------------- 1. Kit Game Bar
$kit = Join-Path $obj "gamebar-$GameBarVersion"
if (-not (Test-Path (Join-Path $kit 'lib\uap10.0\Microsoft.Gaming.XboxGameBar.winmd'))) {
    Step "Kit Game Bar $GameBarVersion (NuGet)"
    $nupkg = Join-Path $obj "gamebar-$GameBarVersion.zip"
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.gaming.xboxgamebar/$GameBarVersion/microsoft.gaming.xboxgamebar.$GameBarVersion.nupkg" -OutFile $nupkg -UseBasicParsing
    Expand-Archive $nupkg $kit -Force
}
$winmd = Join-Path $kit 'lib\uap10.0\Microsoft.Gaming.XboxGameBar.winmd'
$private = Join-Path $kit 'private\Microsoft.Gaming.XboxGameBar.Private.winmd'

# ---------------------------------------------------------------- 2. Outils
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -prerelease -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio (outils C++) introuvable' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\cppwinrt.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $sdkBin) { throw 'cppwinrt.exe introuvable : installez le SDK Windows' }
$sdkVersion = Split-Path (Split-Path (Split-Path $sdkBin.FullName)) -Leaf

# ---------------------------------------------------------------- 3. En-têtes C++/WinRT
if (-not (Test-Path (Join-Path $gen 'winrt\Microsoft.Gaming.XboxGameBar.h'))) {
    Step "En-têtes C++/WinRT (SDK $sdkVersion + Game Bar)"
    & $sdkBin.FullName -input $sdkVersion -input $winmd -reference $private -output $gen
    if ($LASTEXITCODE -ne 0) { throw 'Échec de cppwinrt' }
}

# ---------------------------------------------------------------- 4. Compilation
Step 'Compilation du widget (C++/WinRT, conteneur d''application)'
$src = Join-Path $here 'Widget.cpp'
$exe = Join-Path $out 'KaneMode.Widget.exe'
$cl = "cl /nologo /std:c++20 /EHsc /O2 /MD /bigobj /utf-8 /permissive- /W3 " +
      "/DWINAPI_FAMILY=WINAPI_FAMILY_APP /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN " +
      "/I`"$gen`" /Fo`"$obj\\`" /Fe`"$exe`" `"$src`" " +
      "/link /APPCONTAINER /SUBSYSTEM:WINDOWS /ENTRY:wWinMainCRTStartup WindowsApp.lib"
# Un guillemet égaré dans PATH fait échouer vcvarsall (« \Windows était inattendu »)
$env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and $_ -notmatch '"' }) -join ';'
$cmd = "`"$vcvars`" x64 uwp $sdkVersion >nul && $cl"
cmd /c $cmd
if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation du widget' }

# Composant Game Bar (runtime de Microsoft) et ses métadonnées, à côté de l'exe
Copy-Item (Join-Path $kit 'runtimes\win10-x64\native\Microsoft.Gaming.XboxGameBar.dll') $out -Force
Copy-Item (Join-Path $kit 'runtimes\win10-x64\native\Microsoft.Gaming.XboxGameBar.pri') $out -Force
Copy-Item $winmd $out -Force
Copy-Item $private $out -Force
Write-Host "   Widget prêt : $out" -ForegroundColor Green
