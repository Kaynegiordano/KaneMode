param([Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../host/epic.ps1')
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
function Assert($value, $message) { if (-not $value) { throw $message } }
foreach ($layout in 'Win32', 'Win64') {
    $exe = Join-Path $TestRoot "Program Files (x86)/Epic Games/Launcher/Portal/Binaries/$layout/EpicGamesLauncher.exe"
    New-Item -ItemType Directory -Path (Split-Path -Parent $exe) -Force | Out-Null
    [IO.File]::WriteAllText($exe, 'fixture')
    $candidates = @(Get-EpicLauncherCandidates @() @((Join-Path $TestRoot 'Program Files (x86)'), (Join-Path $TestRoot 'Program Files')) @())
    Assert ($candidates -contains $exe.Replace('/', '\')) "Architecture Epic non reconnue : $layout"
}
$custom = Join-Path $TestRoot 'Jeux perso/Epic/Launcher'
$programs = @([pscustomobject]@{Name='Epic Games Launcher'; Location=$custom; Exe=''}, [pscustomobject]@{Name='Autre';Location='';Exe=''})
$candidates = @(Get-EpicLauncherCandidates $programs @() @('"D:\Boutique avec espaces\EpicGamesLauncher.exe" "%1"'))
Assert ($candidates -contains (Join-Path $custom 'Portal/Binaries/Win32/EpicGamesLauncher.exe')) 'Racine Launcher personnalisée oubliée'
Assert ($candidates -contains 'D:\Boutique avec espaces\EpicGamesLauncher.exe') 'Protocole Epic non reconnu'
Assert (-not (Get-EpicExecutable '"D:\Autre\uninstall.exe",0')) 'Un désinstallateur est pris pour Epic'
$manifests = Join-Path $TestRoot 'Manifests'
New-Item -ItemType Directory -Path $manifests -Force | Out-Null
$base = @{AppName='jeu'; DisplayName='Jeu acheté installé'; InstallLocation='D:\Jeux\Test'; InstallSize=123456789; CatalogNamespace='ns'; CatalogItemId='catalog'; LaunchExecutable='test.exe'; AppCategories=@('games')}
foreach ($kind in 'game', 'empty', 'downloading', 'engine', 'broken') {
    $m = $base.Clone(); $m.AppName=$kind
    if ($kind -eq 'empty') { $m.AppCategories=@() }
    if ($kind -eq 'downloading') { $m.bIsIncompleteInstall=$true }
    if ($kind -eq 'engine') { $m.AppCategories=@('engines') }
    $json = if ($kind -eq 'broken') { '{incomplet' } else { $m | ConvertTo-Json }
    [IO.File]::WriteAllText((Join-Path $manifests ($kind + '.item')), $json)
}
$games = @(Get-EpicGames $manifests { param($exe) 'icone-test' })
Assert ($games.Count -eq 2) 'Jeux installés filtrés à tort ou installation incomplète exposée'
Assert (@($games | Where-Object type -eq 'game').Count -eq 2) 'Les jeux sans catégorie doivent aussi être des jeux'
Assert ($games[0].launch.target -match '^com\.epicgames\.launcher://apps/ns%3Acatalog%3A') 'Identifiant de lancement Epic incorrect'
Assert ($games[0].sizeOnDisk -eq 123456789) 'Taille du manifeste incorrecte'
Assert ($games[0].art.icon -eq 'icone-test') 'Icône perdue'
Write-Output 'PASS Epic : Win32/Win64, chemins personnalisés, protocole, jeux et manifestes incomplets.'
