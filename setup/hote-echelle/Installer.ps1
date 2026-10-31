# Complément KaneMode pour le PC hôte : mise à l'échelle de l'écran pendant le streaming.
# À lancer une fois sur le PC qui diffuse (Sunshine), en administrateur (Installer.cmd le demande).
#   - copie Echelle.ps1 dans %ProgramData%\KaneMode\HoteEchelle
#   - ajoute à Sunshine, pour chaque appli, des variantes « <appli> [125 %] »… dont la préparation
#     règle l'échelle puis la remet à la fin. KaneMode (réglage « Mise à l'échelle du PC hôte ») lance
#     la variante voulue et ne les montre jamais dans la liste des applis.
#   - redémarre Sunshine pour qu'il les voie
# À relancer après avoir ajouté une appli dans Sunshine. -Desinstaller retire tout.
# -Essai <fichier> : travaille sur une copie d'apps.json (sans droits, sans copie du script ni redémarrage).
param([switch]$Desinstaller, [string]$Essai)

$ErrorActionPreference = 'Stop'
$valeurs = 100, 125, 150, 175, 200
$cible = Join-Path $env:ProgramData 'KaneMode\HoteEchelle'
$script = Join-Path $cible 'Echelle.ps1'
$variante = '^(.+) \[(\d{3}) %\]$'   # même forme que engine/KanePlay/app/backend/kanemodescale.h

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $Essai) { throw 'À lancer en administrateur (Installer.cmd)' }

# Fichier des applis de Sunshine : réglage file_apps de sunshine.conf, sinon config\apps.json
$sunshine = Join-Path $env:ProgramFiles 'Sunshine'
$conf = Join-Path $sunshine 'config\sunshine.conf'
$apps = Join-Path $sunshine 'config\apps.json'
if (Test-Path $conf) {
    $ligne = Get-Content $conf | Where-Object { $_ -match '^\s*file_apps\s*=\s*(.+?)\s*$' } | Select-Object -First 1
    if ($ligne -and $ligne -match '=\s*(.+?)\s*$') { $apps = $Matches[1]; if (-not [IO.Path]::IsPathRooted($apps)) { $apps = Join-Path $sunshine "config\$apps" } }
}
if ($Essai) { $apps = $Essai }
if (-not (Test-Path $apps)) { throw "Applis de Sunshine introuvables : $apps (Sunshine est-il installé ?)" }

$json = Get-Content $apps -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $Essai) { Copy-Item $apps "$apps.avant-kanemode" -Force }  # copie de sécurité
$origine = @($json.apps | Where-Object { $_.name -notmatch $variante })

if ($Desinstaller) {
    $json.apps = $origine
    if (-not $Essai) { Remove-Item $cible -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host "Variantes retirées ($apps)."
} else {
    if (-not $Essai) {
        New-Item -ItemType Directory -Force $cible | Out-Null
        Copy-Item (Join-Path $PSScriptRoot 'Echelle.ps1') $script -Force
    }
    $ps = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
    $liste = New-Object System.Collections.ArrayList
    foreach ($a in $origine) { [void]$liste.Add($a) }
    foreach ($a in $origine) {
        foreach ($v in $valeurs) {
            # Copie complète de l'appli (commande, image, préparations…) + la mise à l'échelle en premier
            $copie = $a | ConvertTo-Json -Depth 10 | ConvertFrom-Json
            $copie.name = "$($a.name) [$v %]"
            $prep = @([pscustomobject]@{ do = "$ps -Debut -Pourcentage $v"; undo = "$ps -Fin"; elevated = $false })
            if ($copie.PSObject.Properties['prep-cmd']) { $prep += @($copie.'prep-cmd' | Where-Object { $_ }) }
            $copie | Add-Member -NotePropertyName 'prep-cmd' -NotePropertyValue $prep -Force
            [void]$liste.Add($copie)
        }
    }
    $json.apps = @($liste)
    Write-Host "$($origine.Count) appli(s) × $($valeurs.Count) échelles ajoutées ($apps)."
}
[IO.File]::WriteAllText($apps, ($json | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))

# Sunshine relit ses applis au démarrage
if ($Essai) { return }
$svc = Get-Service SunshineService -ErrorAction SilentlyContinue
if ($svc) { Restart-Service SunshineService -Force; Write-Host 'Sunshine redémarré.' }
else { Write-Host 'Redémarrez Sunshine pour qu''il voie les changements.' }
