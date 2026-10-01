param([Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../host/known-games.ps1')
function Assert($condition,$message){if(-not $condition){throw $message}}
function Fixture($relative){$file=Join-Path $TestRoot $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force|Out-Null;[IO.File]::WriteAllText($file,'fixture');return $file}
$local=Join-Path $TestRoot 'Local';$pf=Join-Path $TestRoot 'Program Files'
Assert (@(Get-KnownDesktopGames $local @($pf) @() '').Count -eq 0) 'Jeux fictifs sans installation'
$old=Fixture 'Local/Roblox/Versions/version-old/RobloxPlayerBeta.exe'
(Get-Item (Split-Path -Parent $old)).LastWriteTime=(Get-Date).AddDays(-2)
$new=Fixture 'Local/Roblox/Versions/version-new/RobloxPlayerBeta.exe'
$studio=Fixture 'Local/Roblox/Versions/version-studio/RobloxStudioBeta.exe'
$minecraft=Fixture 'Program Files/Minecraft Launcher/MinecraftLauncher.exe'
$games=@(Get-KnownDesktopGames $local @($pf) @() '')
Assert ($games.Count -eq 2) 'Detection Roblox/Minecraft incorrecte'
$roblox=@($games|Where-Object source -eq 'roblox')[0]
Assert ($roblox.launch.target -eq $new -and $roblox.launch.args -eq '--app') 'Dernier Roblox Player non choisi'
Assert ($roblox.id -eq 'roblox:player') 'Identifiant Roblox instable'
$registered=@(Get-KnownDesktopGames $local @($pf) @() ('"'+$old+'" "%1"'))|Where-Object source -eq 'roblox'
Assert ($registered.launch.target -eq $old) 'Le client enregistre doit primer sur un dossier residuel'
$packages=@([pscustomobject]@{Name='ROBLOXCORPORATION.ROBLOX';Family='Roblox_123';AppId='App'},[pscustomobject]@{Name='Microsoft.MinecraftUWP';Family='Minecraft_123';AppId='App'},[pscustomobject]@{Name='ROBLOXCORPORATION.RobloxStudio';Family='Studio_123';AppId='App'},[pscustomobject]@{Name='Microsoft.MinecraftUWP';Family='Minecraft_123';AppId=''})
$store=@(Get-KnownStoreGames $packages)
Assert ($store.Count -eq 2) 'Le Store inclut une appli inconnue ou sans identifiant'
Assert ($store[0].id -eq $roblox.id) 'Roblox doit conserver son identifiant entre installations'
Assert ($store[0].launch.target -eq 'shell:AppsFolder\Roblox_123!App') 'Mauvais identifiant Store'
Write-Output 'PASS Jeux connus : Roblox Player, versions, registre, Minecraft et applications Store.'
