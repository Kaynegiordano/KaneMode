# Compile la copie de XboxFullScreenExperienceTool modifiée pour KaneMode (mode /silentenable)
# vers setup\bin\xfset. Prérequis : git et le SDK .NET 8 ou plus récent
# (winget install Microsoft.DotNet.SDK.8).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'vendor\XboxFullScreenExperienceTool'
$out = Join-Path $PSScriptRoot 'bin\xfset'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue) -or -not (dotnet --list-sdks)) {
    throw 'SDK .NET introuvable : winget install Microsoft.DotNet.SDK.8'
}

# Dépendance ViVe (sous-module Git du projet d'origine, absent de l'archive source)
$vive = Join-Path $src 'Modules\ViVe'
if (-not (Test-Path (Join-Path $vive 'ViVe\ViVe.csproj'))) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git introuvable : winget install Git.Git' }
    Remove-Item $vive -Recurse -Force -ErrorAction SilentlyContinue
    git clone --depth 1 https://github.com/thebookisclosed/ViVe.git $vive
}
# La version actuelle de ViVe cible .NET Framework 4.8.1 (projet ancien format) : on la compile
# en .NET 8 avec un projet moderne, sans toucher à ses fichiers source.
$viveProj = Join-Path $vive 'ViVe\ViVe.csproj'
if ((Get-Content $viveProj -Raw) -notmatch 'Sdk="Microsoft.NET.Sdk"') {
    Remove-Item (Join-Path $vive 'ViVe\obj'), (Join-Path $vive 'ViVe\bin') -Recurse -Force -ErrorAction SilentlyContinue
    Set-Content $viveProj -Encoding UTF8 -Value @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0-windows</TargetFramework>
    <AssemblyName>Albacore.ViVe</AssemblyName>
    <RootNamespace>Albacore.ViVe</RootNamespace>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
  </PropertyGroup>
</Project>
'@
}

dotnet publish (Join-Path $src 'XboxFullScreenExperienceTool\XboxFullScreenExperienceTool.csproj') `
    -c Release -r win-x64 --self-contained true -o $out
if ($LASTEXITCODE -ne 0) { throw "Échec de la compilation (code $LASTEXITCODE)" }
Write-Host "Activation silencieuse compilée : $out\XboxFullScreenExperienceTool.exe" -ForegroundColor Green
