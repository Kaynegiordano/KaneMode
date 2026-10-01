# Outil autonome NirSoft, distribue dans son archive complete et non modifiee.
# https://www.nirsoft.net/utils/sound_volume_view.html (freeware ; KaneMode est gratuit).
$ErrorActionPreference = 'Stop'
$audioCache = Join-Path $PSScriptRoot 'obj\soundvolumeview'
$audioZip = Join-Path $PSScriptRoot 'obj\soundvolumeview-x64.zip'
$zipHash = 'ee2c45553fb9fb31b71db88b537c18e25c1a387a4a9009d081bdb38265c68e1f'
$exeHash = 'b5af5bd60f7a29af8cb4d8a566382b90f0fe07cac97228d218cb913f3382d647'
if (-not (Test-Path -LiteralPath $audioZip)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $audioZip) -Force | Out-Null
    Invoke-WebRequest -Uri 'https://www.nirsoft.net/utils/soundvolumeview-x64.zip' -OutFile $audioZip
}
if ((Get-FileHash -LiteralPath $audioZip -Algorithm SHA256).Hash.ToLower() -ne $zipHash) { throw 'Archive audio differente de la version verifiee' }
Expand-Archive -LiteralPath $audioZip -DestinationPath $audioCache -Force
if ((Get-FileHash -LiteralPath (Join-Path $audioCache 'SoundVolumeView.exe') -Algorithm SHA256).Hash.ToLower() -ne $exeHash) { throw 'Outil audio invalide' }
foreach ($file in 'SoundVolumeView.exe','SoundVolumeView.chm','readme.txt') {
    if (-not (Test-Path -LiteralPath (Join-Path $audioCache $file))) { throw 'Archive audio incomplete' }
}
Write-Host 'Outil audio verifie (SoundVolumeView 2.53 x64).'
