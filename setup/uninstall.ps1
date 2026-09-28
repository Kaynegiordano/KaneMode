<#
.SYNOPSIS
    Retire KaneMode (raccourcis, lancement automatique) et, en option, désactive le mode Xbox.
.PARAMETER RevertXboxMode
    Restaure les réglages d'origine avec XboxFullScreenExperienceTool (/silentdisable).
    ATTENTION : l'outil redémarre le PC automatiquement 5 secondes après la restauration.
.NOTES
    Le dossier KaneMode (et vos réglages dans data\) n'est pas supprimé.
#>
param([switch]$RevertXboxMode)

$ErrorActionPreference = 'Stop'
$toolDir = Join-Path $env:ProgramFiles '8bit2qubit\Xbox FullScreen Experience Tool'
$toolExe = Join-Path $toolDir 'XboxFullScreenExperienceTool.exe'

foreach ($dir in [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')) {
    Remove-Item (Join-Path $dir 'KaneMode.lnk') -ErrorAction SilentlyContinue
}
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'KaneMode' -ErrorAction SilentlyContinue
Write-Host 'Raccourcis et lancement automatique retirés.' -ForegroundColor Green

if (-not $RevertXboxMode) { return }
if (-not (Test-Path $toolExe)) { Write-Host "XboxFullScreenExperienceTool introuvable : rien à restaurer." -ForegroundColor Yellow; return }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-RevertXboxMode')
    return
}
Write-Host "`nLe mode Xbox va être désactivé et les réglages d'origine restaurés." -ForegroundColor Yellow
Write-Host "L'outil REDÉMARRE LE PC automatiquement 5 secondes après. Enregistrez votre travail avant de continuer." -ForegroundColor Yellow
$answer = Read-Host 'Continuer ? (O/N)'
if ($answer -notmatch '^[oOyY]') { Write-Host 'Annulé.'; return }
Start-Process $toolExe -ArgumentList @('/silentdisable', "/installpath=`"$toolDir`"") -Wait
