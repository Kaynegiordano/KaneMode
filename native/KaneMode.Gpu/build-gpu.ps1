<#
.SYNOPSIS
    Compile les outils des réglages NVIDIA et Intel de KaneMode (native\KaneMode.Gpu) dans obj\gpu.
.DESCRIPTION
    kanemode-nvidia.exe et kanemode-intel.exe règlent les fonctions graphiques du pilote (limite
    d'images par seconde, faible latence…) et lisent les mesures du GPU, comme kanemode-amd.exe
    pour AMD. L'hôte les lance et leur parle ligne par ligne (host\lib\gpuctl.js).
      1. télécharge les SDK des fabricants (GitHub, version fixée, empreinte vérifiée) : ils ne
         sont pas dans le dépôt, ils ont leur propre licence ;
           - NVAPI de NVIDIA (licence MIT) ;
           - Intel Graphics Control Library (licence d'Intel, copiée à côté de l'outil) ;
      2. compile Nvidia.cpp et Intel.cpp (runtime C++ statique : rien à installer).
    Copiés dans le paquet (app\tools) par native\build.ps1.
#>
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$obj = Join-Path $here 'obj'
$out = Join-Path $obj 'gpu'
$Sdks = @(
    @{ Name = 'NVAPI'; Repo = 'NVIDIA/nvapi'; Dir = 'nvapi'
       Commit = '70d337db9186e968eab622f7e786de7e437faf3d'; Sha256 = 'FA979B5D8D5115A106A24D331806C9B0A573035043FEC441A6579CCFC2B5669B' },
    @{ Name = 'IGCL'; Repo = 'intel/drivers.gpu.control-library'; Dir = 'drivers.gpu.control-library'
       Commit = 'b6c462933502e13d1537dd5024949a51be30e63d'; Sha256 = 'B822E5600FF9BDB1BA5EAFB72177E0D9DCF8E7D1027C6EAE571E24FE731D21FB' }
)

function Step($t) { Write-Host "== $t" -ForegroundColor Cyan }
New-Item -ItemType Directory -Force $obj, $out | Out-Null

# ---------------------------------------------------------------- 1. SDK
$paths = @{}
foreach ($s in $Sdks) {
    $sdk = Join-Path $obj "$($s.Dir)-$($s.Commit)"
    $paths[$s.Name] = $sdk
    if (Test-Path (Join-Path $sdk '.done')) { continue }
    Step "SDK $($s.Name) (GitHub)"
    $zip = Join-Path $obj "$($s.Dir).zip"
    Invoke-WebRequest "https://github.com/$($s.Repo)/archive/$($s.Commit).zip" -OutFile $zip -UseBasicParsing
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
    if ($hash -ne $s.Sha256) { Remove-Item $zip; throw "Empreinte du SDK $($s.Name) inattendue ($hash) : téléchargement rejeté" }
    Remove-Item $sdk -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip $obj -Force
    Remove-Item $zip
    New-Item (Join-Path $sdk '.done') -ItemType File | Out-Null
}
$nv = $paths['NVAPI']
$igcl = $paths['IGCL']

# ---------------------------------------------------------------- 2. Compilation
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -prerelease -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio (outils C++) introuvable' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
# Un guillemet égaré dans PATH fait échouer vcvarsall (« \Windows était inattendu »)
$env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and $_ -notmatch '"' }) -join ';'
# vcvarsall cherche vswhere dans PATH ; ses messages d'erreur passent sur la sortie normale, sinon
# PowerShell les prend pour un échec quand la sortie de la compilation est redirigée
$env:PATH += ";${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
$common = '/nologo /std:c++17 /EHsc /O2 /MT /utf-8 /W3 /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN'

function Compile($name, $exe, $objDir, $includes, $sources, $libs, $defines = '') {
    Step "Compilation de $exe"
    New-Item -ItemType Directory -Force $objDir | Out-Null
    $inc = ($includes | ForEach-Object { "/I`"$_`"" }) -join ' '
    $src = ($sources | ForEach-Object { "`"$_`"" }) -join ' '
    $cl = "cl $common $defines $inc /Fo`"$objDir\\`" /Fe`"$(Join-Path $out $exe)`" $src /link /SUBSYSTEM:CONSOLE $libs"
    cmd /c "`"$vcvars`" x64 >nul 2>&1 && $cl 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation de $exe" }
}

Compile 'NVIDIA' 'kanemode-nvidia.exe' (Join-Path $obj 'nvidia') @($here, $nv) `
    @((Join-Path $here 'Nvidia.cpp')) "`"$(Join-Path $nv 'amd64\nvapi64.lib')`""
Compile 'Intel' 'kanemode-intel.exe' (Join-Path $obj 'intel') @($here, (Join-Path $igcl 'include')) `
    @((Join-Path $here 'Intel.cpp'), (Join-Path $igcl 'Source\cApiWrapper.cpp')) ''  `
    '/DCTL_APIEXPORT=' # fonctions d'accès à ControlLib.dll internes à l'outil (pas exportées)

# Licence d'Intel : à reproduire avec le logiciel redistribué
Copy-Item (Join-Path $igcl 'License.txt') (Join-Path $out 'intel-igcl-license.txt') -Force
Write-Host "   Outils NVIDIA et Intel prêts : $out" -ForegroundColor Green
