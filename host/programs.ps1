# Liste les applications du menu Demarrer (Win32 + Microsoft Store) avec leur icone
# et ecrit data/programs.json. Le lancement passe par shell:AppsFolder\<AppID>, qui
# fonctionne pour tous les types d'applications.
param([string]$DataDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'))

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'icon.ps1')
$iconDir = Join-Path $DataDir 'icons'
New-Item -ItemType Directory -Force $DataDir | Out-Null

# Entrees sans interet dans une console (desinstalleurs, aides, pages web...)
$skipName = 'uninstall|d.sinstall|readme|lisez|help\b|aide\b|manual|manuel|documentation|release notes|licen[cs]e|changelog|what.s new|website|site web|support'
$skipId = '^(https?|steam|com\.epicgames|uplay|goggalaxy|amazon-games)://|\.(chm|txt|pdf|html?|url)$'

$list = foreach ($a in Get-StartApps) {
    if ($a.Name -match $skipName -or $a.AppID -match $skipId) { continue }
    $target = "shell:AppsFolder\$($a.AppID)"
    [pscustomobject]@{
        name   = $a.Name
        appId  = $a.AppID
        target = $target
        store  = $a.AppID -match '_[a-z0-9]{13}!'   # application empaquetee (Microsoft Store)
        icon   = Export-Icon $target $iconDir 128
    }
}
$list = @($list | Sort-Object name -Unique)
[IO.File]::WriteAllText((Join-Path $DataDir 'programs.json'), (ConvertTo-Json -InputObject $list -Depth 3), (New-Object Text.UTF8Encoding $false))
Write-Output ('{"programs":' + $list.Count + '}')
