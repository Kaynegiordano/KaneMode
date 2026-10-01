# Scanne toutes les boutiques / lanceurs connus et ecrit data/library.json.
# Aucun chemin ni identifiant propre a une machine : tout est lu dans le registre,
# les manifestes des lanceurs et les dossiers de jeux.
param([string]$DataDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'))

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'icon.ps1')
. (Join-Path $PSScriptRoot 'epic.ps1')
. (Join-Path $PSScriptRoot 'known-games.ps1')
$iconDir = Join-Path $DataDir 'icons'
New-Item -ItemType Directory -Force $DataDir | Out-Null

$games = New-Object System.Collections.ArrayList
$knownDirs = @{}

function Add-Game([hashtable]$g) {
    if (-not $g.name) { return }
    foreach ($k in 'lastPlayed', 'sizeOnDisk') { if (-not $g.ContainsKey($k)) { $g[$k] = 0 } }
    if (-not $g.art) { $g.art = @{} }
    if ($g.installDir) { $knownDirs[$g.installDir.TrimEnd('\').ToLowerInvariant()] = $true }
    [void]$games.Add([pscustomobject]$g)
}
function Test-File($p) { return ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) }
function Test-KnownDir($dir) {
    if (-not $dir) { return $false }
    $d = $dir.TrimEnd('\').ToLowerInvariant()
    if ($d -match '\\steamapps\\') { return $true }
    return $knownDirs.ContainsKey($d)
}
function Clean-Exe($s) {
    if (-not $s) { return $null }
    $s = ($s.Trim().Trim('"') -replace ',\s*-?\d+$', '').Trim('"')
    if ($s -match '\.exe$' -and (Test-File $s)) { return $s } else { return $null }
}
function Get-Field($text, $key) {
    $m = [regex]::Match($text, '"' + $key + '"\s+"([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}
function Find-File($dir, [string[]]$names) {
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return $null }
    foreach ($n in $names) {
        $f = Get-ChildItem -LiteralPath $dir -Recurse -File -Filter $n -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($f) { return $f.FullName }
    }
    return $null
}

# Programmes installes (registre de desinstallation, machine + utilisateur)
$uninstall = foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                               'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
                               'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') {
    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
        $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        if ($p.DisplayName) {
            [pscustomobject]@{
                Key = $_.PSChildName; Name = $p.DisplayName; Publisher = [string]$p.Publisher
                Location = [string]$p.InstallLocation; Exe = (Clean-Exe $p.DisplayIcon)
                Size = [long]$p.EstimatedSize * 1024; Uninstall = [string]$p.UninstallString
            }
        }
    }
}

# ------------------------------------------------------------------ Steam
$steamPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
if ($steamPath) {
    $steamPath = $steamPath -replace '/', '\'
    $cache = Join-Path $steamPath 'appcache\librarycache'
    $libraries = @($steamPath)
    $vdf = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) {
        $libraries = @([regex]::Matches((Get-Content $vdf -Raw -Encoding UTF8), '"path"\s+"([^"]+)"') |
            ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' } | Select-Object -Unique)
    }
    foreach ($lib in $libraries) {
        Get-ChildItem (Join-Path $lib 'steamapps\appmanifest_*.acf') -ErrorAction SilentlyContinue | ForEach-Object {
            $t = Get-Content $_.FullName -Raw -Encoding UTF8
            $appid = Get-Field $t 'appid'
            $name = Get-Field $t 'name'
            if (-not $appid -or $name -match 'Redistributable|Steam Linux Runtime|Proton|Steamworks|SteamVR') { return }
            # Telechargement pas encore termine : le jeu apparait une fois installe (StateFlags, bit 4)
            if (([int](Get-Field $t 'StateFlags') -band 4) -eq 0) { return }
            $dir = Join-Path $lib ('steamapps\common\' + (Get-Field $t 'installdir'))
            $artDir = Join-Path $cache $appid
            Add-Game @{
                id = "steam:$appid"; source = 'steam'; steamAppId = [int]$appid; name = $name; type = 'game'
                lastPlayed = [long](Get-Field $t 'LastPlayed'); sizeOnDisk = [long](Get-Field $t 'SizeOnDisk')
                installDir = $dir
                launch = @{ kind = 'uri'; target = "steam://rungameid/$appid" }
                art = @{
                    portrait = Find-File $artDir @('library_600x900.jpg', 'library_capsule.jpg')
                    hero     = Find-File $artDir @('library_hero.jpg')
                    logo     = Find-File $artDir @('logo.png')
                    header   = Find-File $artDir @('library_header.jpg', 'header.jpg')
                }
            }
        }
    }
    # Les jeux "non-Steam" (raccourcis ajoutes dans Steam) sont lus par le serveur Node
    # (format VDF binaire) : on se contente d'indiquer ou les trouver.
    $steamUserdata = Join-Path $steamPath 'userdata'
}

# ------------------------------------------------------------------ Epic Games
$epicManifests = Join-Path $env:ProgramData 'Epic\EpicGamesLauncher\Data\Manifests'
Get-EpicGames $epicManifests { param($exe) Export-Icon $exe $iconDir } | ForEach-Object { Add-Game $_ }

# ------------------------------------------------------------------ GOG
Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games' -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath
    if (-not $p.gameName -or -not $p.path -or $p.dependsOn) { return }   # dependsOn = DLC
    $exe = if (Test-File $p.exe) { $p.exe } else { $null }
    Add-Game @{
        id = "gog:$($p.gameID)"; source = 'gog'; name = $p.gameName; type = 'game'; installDir = $p.path
        launch = $(if ($exe) { @{ kind = 'exe'; target = $exe; args = [string]$p.launchParam; cwd = [string]$p.workingDir } }
                   else { @{ kind = 'uri'; target = "goggalaxy://openGameView/$($p.gameID)" } })
        art = @{ icon = Export-Icon $exe $iconDir }
    }
}

# ------------------------------------------------------------------ Ubisoft Connect
Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs' -ErrorAction SilentlyContinue | ForEach-Object {
    $dir = (Get-ItemProperty $_.PSPath).InstallDir
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return }
    $id = $_.PSChildName
    $dir = $dir -replace '/', '\'
    $u = $uninstall | Where-Object { $_.Key -eq "Uplay Install $id" } | Select-Object -First 1
    $name = if ($u) { $u.Name } else { Split-Path $dir.TrimEnd('\') -Leaf }
    $exe = Get-ChildItem -LiteralPath $dir -Filter *.exe -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch 'crash|report|setup|unins|helper|launcher|easyanticheat|battleye' } |
        Sort-Object Length -Descending | Select-Object -First 1
    Add-Game @{
        id = "ubisoft:$id"; source = 'ubisoft'; name = $name; type = 'game'; installDir = $dir
        launch = @{ kind = 'uri'; target = "uplay://launch/$id/0" }
        art = @{ icon = Export-Icon $(if ($exe) { $exe.FullName }) $iconDir }
    }
}

# ------------------------------------------------------------------ Xbox / PC Game Pass
Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ChildItem (Join-Path $_.Root 'XboxGames') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $content = Join-Path $_.FullName 'Content'
        $cfg = Join-Path $content 'MicrosoftGame.config'
        if (-not (Test-Path -LiteralPath $cfg)) { return }
        try { [xml]$x = Get-Content -LiteralPath $cfg -Raw } catch { return }
        $identity = $x.Game.Identity.Name
        $pkg = Get-AppxPackage -Name $identity -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $pkg) { return }
        $appId = @($x.Game.ExecutableList.Executable)[0].Id
        if (-not $appId) { $appId = 'Game' }
        $name = $x.Game.ShellVisuals.DefaultDisplayName
        if (-not $name -or $name -like 'ms-resource*') { $name = $_.Name }
        $vis = $x.Game.ShellVisuals
        $pick = { param($rel) if ($rel) { $f = Join-Path $content $rel; if (Test-File $f) { $f } } }
        Add-Game @{
            id = "xbox:$identity"; source = 'xbox'; name = $name; type = 'game'; installDir = $_.FullName
            launch = @{ kind = 'uri'; target = "shell:AppsFolder\$($pkg.PackageFamilyName)!$appId" }
            art = @{ hero = & $pick $vis.SplashScreenImage; icon = & $pick $vis.Square150x150Logo }
        }
    }
}

# ------------------------------------------------------------------ Amazon Games
$uninstall | Where-Object { $_.Uninstall -match 'Amazon Game Remover' } | ForEach-Object {
    $m = [regex]::Match($_.Uninstall, '-p\s+([\w-]+)')
    if (-not $m.Success) { return }
    Add-Game @{
        id = "amazon:$($m.Groups[1].Value)"; source = 'amazon'; name = $_.Name; type = 'game'
        installDir = $_.Location; sizeOnDisk = $_.Size
        launch = @{ kind = 'uri'; target = "amazon-games://play/$($m.Groups[1].Value)" }
        art = @{ icon = Export-Icon $_.Exe $iconDir }
    }
}

# ------------------------------------------------------------------ Editeurs avec lanceur propre (registre)
$publishers = @(
    @{ source = 'ea';        publisher = 'Electronic Arts';        exclude = '^(EA app|EA Desktop|Origin)' },
    @{ source = 'battlenet'; publisher = 'Blizzard';               exclude = '^Battle\.net' },
    @{ source = 'rockstar';  publisher = 'Rockstar Games';         exclude = 'Launcher|Social Club' },
    @{ source = 'riot';      publisher = 'Riot Games';             exclude = 'Vanguard|Riot Client' }
)
foreach ($pub in $publishers) {
    $uninstall | Where-Object { $_.Publisher -match $pub.publisher -and $_.Name -notmatch $pub.exclude -and $_.Exe -and -not (Test-KnownDir $_.Location) } |
        Sort-Object Name -Unique | ForEach-Object {
            Add-Game @{
                id = "$($pub.source):$($_.Key)"; source = $pub.source; name = $_.Name; type = 'game'
                installDir = $_.Location; sizeOnDisk = $_.Size
                launch = @{ kind = 'exe'; target = $_.Exe }
                art = @{ icon = Export-Icon $_.Exe $iconDir }
            }
        }
}

# ------------------------------------------------------------------ Lanceurs
function Find-Uninstall($regex) { $uninstall | Where-Object { $_.Name -match $regex } | Select-Object -First 1 }
function First-File([string[]]$candidates) { foreach ($c in $candidates) { if (Test-File $c) { return $c } }; return $null }
function Join-Loc($u, $rel) { if ($u -and $u.Location) { Join-Path $u.Location $rel } }

$pf86 = ${env:ProgramFiles(x86)}; $pf = $env:ProgramFiles; $local = $env:LOCALAPPDATA
$robloxCommand = (Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\roblox-player\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
Get-KnownDesktopGames $local @($pf, $pf86) $uninstall $robloxCommand | ForEach-Object {
    $_.art = @{icon = Export-Icon $_.launch.target $iconDir}; Add-Game $_
}
$knownPackages = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^ROBLOXCORPORATION\.(ROBLOX|RobloxPlayer)$|^Microsoft\.(MinecraftUWP|MinecraftWindowsBeta|4297127D64EC6)$' } | ForEach-Object {
    try {
        $appId = @((Get-AppxPackageManifest $_ -ErrorAction Stop).Package.Applications.Application)[0].Id
        [pscustomobject]@{Name=$_.Name;Family=$_.PackageFamilyName;AppId=$appId}
    } catch { }
}
Get-KnownStoreGames $knownPackages | ForEach-Object {
    $g = $_
    if (-not @($games | Where-Object { $_.id -eq $g.id -or $_.id -eq "xbox:$($g.packageName)" }).Count) {
        $g.art = @{icon = Export-Icon $g.launch.target $iconDir}; Add-Game $g
    }
}
$epicRegistered = foreach ($key in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\EpicGamesLauncher.exe',
                                  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\EpicGamesLauncher.exe',
                                  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\EpicGamesLauncher.exe',
                                  'Registry::HKEY_CLASSES_ROOT\com.epicgames.launcher\shell\open\command') {
    (Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).'(default)'
}
$defs = @(
    @{ id = 'steam';     name = 'Steam';           sub = 'Big Picture';        uri = 'steam://open/bigpicture'
       exe = $(if ($steamPath) { Join-Path $steamPath 'steam.exe' }) },
    @{ id = 'epic';      name = 'Epic Games';      sub = 'Epic Games Store';   uri = 'com.epicgames.launcher://store'
       exe = First-File @(Get-EpicLauncherCandidates $uninstall @($pf86, $pf) @($epicRegistered)) },
    @{ id = 'gog';       name = 'GOG GALAXY';      sub = 'GOG.com'
       exe = First-File @((Join-Loc (Find-Uninstall '^GOG GALAXY') 'GalaxyClient.exe'), "$pf86\GOG Galaxy\GalaxyClient.exe") },
    @{ id = 'ubisoft';   name = 'Ubisoft Connect'; sub = 'Ubisoft'
       exe = First-File @((Join-Loc (Find-Uninstall '^Ubisoft Connect') 'UbisoftConnect.exe'), "$pf86\Ubisoft\Ubisoft Game Launcher\UbisoftConnect.exe") },
    @{ id = 'ea';        name = 'EA app';          sub = 'Electronic Arts'
       exe = First-File @((Join-Loc (Find-Uninstall '^EA app$') 'EA Desktop\EALauncher.exe'), "$pf\Electronic Arts\EA Desktop\EA Desktop\EALauncher.exe") },
    @{ id = 'battlenet'; name = 'Battle.net';      sub = 'Blizzard'
       exe = First-File @((Join-Loc (Find-Uninstall '^Battle\.net$') 'Battle.net Launcher.exe'), "$pf86\Battle.net\Battle.net Launcher.exe") },
    @{ id = 'amazon';    name = 'Amazon Games';    sub = 'Prime Gaming'
       exe = First-File @((Join-Loc (Find-Uninstall '^Amazon Games') 'App\Amazon Games.exe'), "$local\Amazon Games\App\Amazon Games.exe") },
    @{ id = 'rockstar';  name = 'Rockstar Games';  sub = 'Launcher'
       exe = First-File @((Join-Loc (Find-Uninstall '^Rockstar Games Launcher') 'Launcher.exe'), "$pf\Rockstar Games\Launcher\Launcher.exe") },
    @{ id = 'riot';      name = 'Riot Client';     sub = 'Riot Games'
       exe = First-File @('C:\Riot Games\Riot Client\RiotClientServices.exe') },
    @{ id = 'itch';      name = 'itch';            sub = 'itch.io'
       exe = First-File @((Join-Loc (Find-Uninstall '^itch$') 'itch.exe'), "$local\itch\itch.exe") },
    @{ id = 'playnite';  name = 'Playnite';        sub = 'Mode plein ecran'
       exe = First-File @((Join-Loc (Find-Uninstall '^Playnite') 'Playnite.FullscreenApp.exe'), "$local\Playnite\Playnite.FullscreenApp.exe") },
    @{ id = 'retroarch'; name = 'RetroArch';       sub = 'Emulation'
       exe = First-File @((Join-Loc (Find-Uninstall '^RetroArch') 'retroarch.exe'), 'C:\RetroArch-Win64\retroarch.exe') }
)
$launchers = foreach ($d in $defs) {
    $installed = Test-File $d.exe
    [pscustomobject]@{
        id = $d.id; name = $d.name; sub = $d.sub; installed = $installed; exe = $d.exe
        launch = $(if ($d.uri -and $installed) { @{ kind = 'uri'; target = $d.uri } }
                   elseif ($installed) { @{ kind = 'exe'; target = $d.exe } })
        art = @{ icon = $(if ($installed) { Export-Icon $d.exe $iconDir }) }
    }
}
# Application Xbox (paquet du Store, pas d'exe classique)
$xboxPkg = Get-AppxPackage -Name 'Microsoft.GamingApp' -ErrorAction SilentlyContinue | Select-Object -First 1
$xboxTarget = $null
if ($xboxPkg) {
    $appId = @((Get-AppxPackageManifest $xboxPkg).Package.Applications.Application)[0].Id
    $xboxTarget = "shell:AppsFolder\$($xboxPkg.PackageFamilyName)!$appId"
}
$launchers = @($launchers) + [pscustomobject]@{
    id = 'xbox'; name = 'Xbox'; sub = 'PC Game Pass'; installed = [bool]$xboxTarget
    launch = $(if ($xboxTarget) { @{ kind = 'uri'; target = $xboxTarget } })
    art = @{ icon = Export-Icon $xboxTarget $iconDir }
}

# ------------------------------------------------------------------ Ecriture
$result = [pscustomobject]@{
    generated     = (Get-Date).ToString('s')
    steamUserdata = $steamUserdata
    games         = @($games)
    launchers     = @($launchers)
}
[IO.File]::WriteAllText((Join-Path $DataDir 'library.json'), (ConvertTo-Json -InputObject $result -Depth 6), (New-Object Text.UTF8Encoding $false))
Write-Output ('{"games":' + $games.Count + ',"launchers":' + @($launchers | Where-Object installed).Count + '}')
