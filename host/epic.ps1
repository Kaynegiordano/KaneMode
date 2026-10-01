# Fonctions partagees par le scan et ses essais, sans lecture du registre a l'import.
function Get-EpicExecutable([string]$command) {
    if (-not $command) { return $null }
    $command = [Environment]::ExpandEnvironmentVariables($command.Trim())
    if ($command -match '^"([^"\r\n]+\.exe)"' -or $command -match '^(.+?\.exe)(?:\s|,|$)') {
        $exe = $Matches[1]
        if ([IO.Path]::GetFileName($exe) -ieq 'EpicGamesLauncher.exe') { return $exe }
    }
    return $null
}

function Get-EpicLauncherCandidates($programs, [string[]]$programRoots, [string[]]$registeredCommands) {
    foreach ($u in @($programs | Where-Object { $_.Name -match '^Epic Games Launcher(?:\s|$)' })) {
        Get-EpicExecutable $u.Exe
        if ($u.Location) {
            foreach ($rel in 'Launcher\Portal\Binaries', 'Portal\Binaries', 'Binaries') {
                foreach ($arch in 'Win64', 'Win32') { Join-Path $u.Location "$rel\$arch\EpicGamesLauncher.exe" }
            }
        }
    }
    foreach ($command in $registeredCommands) { Get-EpicExecutable $command }
    foreach ($root in $programRoots) {
        if (-not $root) { continue }
        foreach ($arch in 'Win64', 'Win32') { Join-Path $root "Epic Games\Launcher\Portal\Binaries\$arch\EpicGamesLauncher.exe" }
    }
}

function Get-EpicGames([string]$manifestDir, [scriptblock]$icon) {
    Get-ChildItem -LiteralPath $manifestDir -Filter *.item -File -ErrorAction SilentlyContinue | ForEach-Object {
        try { $m = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
        if ($m.bIsIncompleteInstall -or -not $m.InstallLocation -or -not $m.AppName -or -not $m.DisplayName) { return }
        $cats = @($m.AppCategories)
        if ($cats -contains 'plugins' -or $cats -contains 'engines' -or $cats -contains 'digitalextras') { return }
        $exe = if ($m.LaunchExecutable) { Join-Path $m.InstallLocation $m.LaunchExecutable } else { $null }
        @{
            id = "epic:$($m.AppName)"; source = 'epic'; name = $m.DisplayName
            type = $(if ($cats -contains 'games' -or -not $m.AppCategories) { 'game' } else { 'app' })
            sizeOnDisk = [long]$m.InstallSize; installDir = $m.InstallLocation
            launch = @{ kind = 'uri'; target = "com.epicgames.launcher://apps/$($m.CatalogNamespace)%3A$($m.CatalogItemId)%3A$($m.AppName)?action=launch&silent=true" }
            art = @{ icon = $(if ($icon) { & $icon $exe }) }
        }
    }
}
