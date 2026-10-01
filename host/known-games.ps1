# Detection ciblee : pas de parcours recursif de Program Files ni de jeu fictif.
function Get-KnownGameFile([string[]]$candidates) {
    foreach ($file in $candidates) { if ($file -and (Test-Path -LiteralPath $file -PathType Leaf)) { return $file } }
    return $null
}
function Get-KnownDesktopGames([string]$localRoot, [string[]]$programRoots, $programs, [string]$robloxCommand) {
    $robloxCandidates = @()
    if ($robloxCommand -match '^"([^"\r\n]+\.exe)"' -or $robloxCommand -match '^(.+?\.exe)(?:\s|$)') {
        $registered = [Environment]::ExpandEnvironmentVariables($Matches[1])
        if ([IO.Path]::GetFileName($registered) -ieq 'RobloxPlayerBeta.exe') { $robloxCandidates += $registered }
        elseif ([IO.Path]::GetFileName($registered) -ieq 'RobloxPlayerLauncher.exe') { $robloxCandidates += Join-Path (Split-Path -Parent $registered) 'RobloxPlayerBeta.exe' }
    }
    foreach ($root in @($localRoot) + $programRoots) {
        if (-not $root) { continue }
        $robloxCandidates += Join-Path $root 'Roblox\Player\RobloxPlayerBeta.exe'
        $versions = Join-Path $root 'Roblox\Versions'
        foreach ($version in @(Get-ChildItem -LiteralPath $versions -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            $robloxCandidates += Join-Path $version.FullName 'RobloxPlayerBeta.exe'
        }
    }
    $roblox = Get-KnownGameFile $robloxCandidates
    if ($roblox) {
        @{id='roblox:player';source='roblox';name='Roblox';type='game';installDir=(Split-Path -Parent $roblox);launch=@{kind='exe';target=$roblox;args='--app'}}
    }
    $minecraftCandidates = @()
    foreach ($u in @($programs | Where-Object { $_.Name -match '^Minecraft Launcher$' })) {
        if ($u.Exe -and [IO.Path]::GetFileName($u.Exe) -ieq 'MinecraftLauncher.exe') { $minecraftCandidates += $u.Exe }
        if ($u.Location) { $minecraftCandidates += Join-Path $u.Location 'MinecraftLauncher.exe' }
    }
    foreach ($root in $programRoots) { if ($root) { $minecraftCandidates += Join-Path $root 'Minecraft Launcher\MinecraftLauncher.exe' } }
    if ($localRoot) { $minecraftCandidates += Join-Path $localRoot 'Programs\Minecraft Launcher\MinecraftLauncher.exe' }
    $minecraft = Get-KnownGameFile $minecraftCandidates
    if ($minecraft) {
        @{id='minecraft:launcher';source='minecraft';name='Minecraft Launcher';type='game';installDir=(Split-Path -Parent $minecraft);launch=@{kind='exe';target=$minecraft}}
    }
}
function Get-KnownStoreGames($packages) {
    $known = @{
        'ROBLOXCORPORATION.ROBLOX' = @('roblox:player','roblox','Roblox')
        'ROBLOXCORPORATION.RobloxPlayer' = @('roblox:player','roblox','Roblox')
        'Microsoft.MinecraftUWP' = @('minecraft:bedrock','minecraft','Minecraft for Windows')
        'Microsoft.MinecraftWindowsBeta' = @('minecraft:preview','minecraft','Minecraft Preview')
        'Microsoft.4297127D64EC6' = @('minecraft:launcher','minecraft','Minecraft Launcher')
    }
    foreach ($pkg in $packages) {
        $entry = $known[$pkg.Name]
        if (-not $entry -or -not $pkg.Family -or -not $pkg.AppId) { continue }
        @{id=$entry[0];source=$entry[1];name=$entry[2];type='game';packageName=$pkg.Name;installDir=$null;launch=@{kind='uri';target="shell:AppsFolder\$($pkg.Family)!$($pkg.AppId)"}}
    }
}
