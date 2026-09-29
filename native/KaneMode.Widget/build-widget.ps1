<#
.SYNOPSIS
    Compile le widget Game Bar de KaneMode (native\KaneMode.Widget) dans obj\widget.
.DESCRIPTION
    Un widget Game Bar est forcément une application UWP (XAML). Celle-ci est écrite en C++/WinRT,
    sans fichier XAML, et compilée en ligne de commande avec les outils de Visual Studio
    (environnement « uwp » de vcvarsall). Elle affiche l'interface de KaneMode (widget.html) dans
    un contrôle WebView2 de WinUI 2.
      1. télécharge les kits (NuGet, versions fixées) : Game Bar, WinUI 2.8, WebView2 ;
      2. génère les en-têtes C++/WinRT (cppwinrt.exe du SDK Windows) ;
      3. compile Widget.cpp en application de conteneur (runtime C++ « store », fourni par VCLibs).
    Résultat dans obj\widget : KaneMode.Widget.exe, le composant Game Bar, le composant WebView2
    pour UWP, et le paquet d'exécution WinUI 2.8 (installé par l'installateur s'il manque).
    Copiés dans le paquet par native\build.ps1.
#>
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$obj = Join-Path $here 'obj'
$out = Join-Path $obj 'widget'
$gen = Join-Path $obj 'gen'
$Kits = [ordered]@{
    'microsoft.gaming.xboxgamebar' = '7.3.2607010'
    'microsoft.ui.xaml'            = '2.8.6'       # paquet d'exécution Microsoft.UI.Xaml.2.8 8.2310.30001.0
    'microsoft.web.webview2'       = '1.0.2903.40'
}

function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }
# Sortie refaite à chaque fois : pas de fichier oublié d'une ancienne version
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $obj, $out | Out-Null

# ---------------------------------------------------------------- 1. Kits
$dirs = @{}
foreach ($id in $Kits.Keys) {
    $v = $Kits[$id]
    $dir = Join-Path $obj "$id-$v"
    if (-not (Test-Path (Join-Path $dir '.done'))) {
        Step "Kit $id $v (NuGet)"
        $zip = Join-Path $obj "$id-$v.zip"
        Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/$id/$v/$id.$v.nupkg" -OutFile $zip -UseBasicParsing
        Expand-Archive $zip $dir -Force
        Remove-Item $zip
        New-Item (Join-Path $dir '.done') -ItemType File | Out-Null
    }
    $dirs[$id] = $dir
}
$gamebar = $dirs['microsoft.gaming.xboxgamebar']
$winui = $dirs['microsoft.ui.xaml']
$wv2 = $dirs['microsoft.web.webview2']
$winmds = @(
    (Join-Path $gamebar 'lib\uap10.0\Microsoft.Gaming.XboxGameBar.winmd'),
    (Join-Path $winui 'lib\uap10.0\Microsoft.UI.Xaml.winmd'),
    (Join-Path $wv2 'lib\Microsoft.Web.WebView2.Core.winmd')
)
$private = Join-Path $gamebar 'private\Microsoft.Gaming.XboxGameBar.Private.winmd'

# ---------------------------------------------------------------- 2. Outils
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -prerelease -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio (outils C++) introuvable' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\cppwinrt.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $sdkBin) { throw 'cppwinrt.exe introuvable : installez le SDK Windows' }
$sdkVersion = Split-Path (Split-Path (Split-Path $sdkBin.FullName)) -Leaf

# ---------------------------------------------------------------- 3. En-têtes C++/WinRT
$stamp = Join-Path $gen ('.kits-' + (($Kits.Values) -join '_'))
if (-not (Test-Path $stamp)) {
    Step "En-têtes C++/WinRT (SDK $sdkVersion, Game Bar, WinUI 2, WebView2)"
    Remove-Item $gen -Recurse -Force -ErrorAction SilentlyContinue
    $inputs = @('-input', $sdkVersion) + ($winmds | ForEach-Object { '-input', $_ })
    & $sdkBin.FullName @inputs -reference $private -output $gen
    if ($LASTEXITCODE -ne 0) { throw 'Échec de cppwinrt' }
    New-Item $stamp -ItemType File -Force | Out-Null
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
# vcvarsall cherche vswhere dans PATH ; ses messages passent sur la sortie normale, sinon PowerShell
# les prend pour un échec quand la sortie de la compilation est redirigée
$env:PATH += ";${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
$cmd = "`"$vcvars`" x64 uwp $sdkVersion >nul 2>&1 && $cl 2>&1"
cmd /c $cmd
if ($LASTEXITCODE -ne 0) { throw 'Échec de la compilation du widget' }

# Composants de Microsoft à côté de l'exe : Game Bar et WebView2 (UWP)
Copy-Item (Join-Path $gamebar 'runtimes\win10-x64\native\Microsoft.Gaming.XboxGameBar.dll') $out -Force
Copy-Item (Join-Path $gamebar 'runtimes\win10-x64\native\Microsoft.Gaming.XboxGameBar.pri') $out -Force
Copy-Item $winmds[0] $out -Force
Copy-Item $private $out -Force
# Composant WebView2 pour UWP dans un sous-dossier : il porte le même nom de fichier que la
# bibliothèque .NET de WebView2 dont se sert KaneMode.exe, à la racine du paquet
$uwp = Join-Path $out 'webview2-uwp'
New-Item -ItemType Directory -Force $uwp | Out-Null
Copy-Item (Join-Path $wv2 'runtimes\win-x64\native_uap\Microsoft.Web.WebView2.Core.dll') $uwp -Force
Copy-Item $winmds[2] $uwp -Force
# Paquet d'exécution WinUI 2.8 : l'installateur l'ajoute s'il manque sur le PC
$fw = Join-Path $obj 'framework'
New-Item -ItemType Directory -Force $fw | Out-Null
Copy-Item (Join-Path $winui 'tools\AppX\x64\Release\Microsoft.UI.Xaml.2.8.appx') $fw -Force
Write-Host "   Widget prêt : $out" -ForegroundColor Green
