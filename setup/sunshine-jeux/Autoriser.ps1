# KaneMode : autorise ce compte Windows à mettre à jour les applis de Sunshine (jeux de KaneMode
# proposés aux consoles qui streament ce PC) et à redémarrer son service, pour que Sunshine les
# relise. Lancé une seule fois, avec les droits d'administrateur, depuis Paramètres → Streaming.
#   -Sid     : compte autorisé (celui de KaneMode)
#   -Applis  : fichier des applis de Sunshine (apps.json, ou celui de file_apps)
param([Parameter(Mandatory)][string]$Sid, [Parameter(Mandatory)][string]$Applis)
$ErrorActionPreference = 'Stop'
if ($Sid -notmatch '^S-1-5-[\d-]+$') { throw "Compte invalide : $Sid" }
if (-not (Test-Path -LiteralPath $Applis)) { throw "Applis de Sunshine introuvables : $Applis" }

# 1. Écriture du fichier des applis (modification seulement, pas le dossier ni le reste de Sunshine)
& icacls.exe $Applis /grant "*${Sid}:(M)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Droits sur le fichier des applis refusés' }

# 2. Démarrer, arrêter et interroger le service de Sunshine (RP, WP, LC, LO)
$sd = ((& sc.exe sdshow SunshineService) -join '').Trim()
if (-not $sd.StartsWith('D:')) { throw "Service SunshineService introuvable" }
$ace = "(A;;RPWPLCLO;;;$Sid)"
if (-not $sd.Contains($ace)) {
    $i = $sd.IndexOf('S:')
    $new = if ($i -ge 0) { $sd.Substring(0, $i) + $ace + $sd.Substring($i) } else { $sd + $ace }
    & sc.exe sdset SunshineService $new | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Droits sur le service refusés' }
}
exit 0
