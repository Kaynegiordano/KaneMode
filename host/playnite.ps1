param([string]$Executable)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$taskCandidates = @($Executable, (Join-Path $env:LOCALAPPDATA 'Playnite\Playnite.DesktopApp.exe'), (Join-Path $env:ProgramFiles 'Playnite\Playnite.DesktopApp.exe'))
foreach ($taskRoot in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall') {
    Get-ChildItem -LiteralPath $taskRoot -ErrorAction SilentlyContinue | ForEach-Object {
        $taskEntry = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        if ($taskEntry.DisplayName -eq 'Playnite' -and $taskEntry.InstallLocation) { $taskCandidates += Join-Path $taskEntry.InstallLocation 'Playnite.DesktopApp.exe' }
    }
}
foreach ($taskExe in $taskCandidates) {
    if (-not $taskExe -or -not (Test-Path -LiteralPath $taskExe -PathType Leaf)) { continue }
    $taskBase = Split-Path -Parent $taskExe
    # Meme regle que PlaynitePaths : absence du desinstalleur = distribution portable.
    $taskProfile = if (Test-Path -LiteralPath (Join-Path $taskBase 'unins000.exe')) { Join-Path $env:APPDATA 'Playnite' } else { $taskBase }
    @{exe=$taskExe;extensions=(Join-Path $taskProfile 'Extensions')} | ConvertTo-Json -Compress
    exit 0
}
[Console]::WriteLine('{}')
