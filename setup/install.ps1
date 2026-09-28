<#
.SYNOPSIS
    Installe KaneMode et active le mode Xbox (plein écran) complet de Windows 11.
.DESCRIPTION
    1. Crée les raccourcis KaneMode (menu Démarrer, Bureau) et, en option, le lancement à l'ouverture de session.
    2. Active le mode Xbox complet (celui qui permet de choisir l'application d'accueil) grâce à
       XboxFullScreenExperienceTool : installation de l'outil si besoin, puis activation silencieuse
       (/silentenable, voir vendor\XboxFullScreenExperienceTool) ou, à défaut, ouverture de l'outil.
.PARAMETER Check
    Affiche l'état sans rien modifier.
.PARAMETER Autostart
    Lance KaneMode automatiquement à l'ouverture de session.
.PARAMETER NoXboxMode
    N'active pas le mode Xbox.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File setup\install.ps1 -Autostart
#>
param([switch]$Check, [switch]$Autostart, [switch]$NoXboxMode)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$toolDir = Join-Path $env:ProgramFiles '8bit2qubit\Xbox FullScreen Experience Tool'
$toolExe = Join-Path $toolDir 'XboxFullScreenExperienceTool.exe'
$enabler = Join-Path $PSScriptRoot 'bin\xfset\XboxFullScreenExperienceTool.exe'
$releases = 'https://github.com/8bit2qubit/XboxFullScreenExperienceTool/releases/latest'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   [OK] $text" -ForegroundColor Green }
function Info($text) { Write-Host "   $text" }
function Warn($text) { Write-Host "   [!] $text" -ForegroundColor Yellow }

function Get-XboxModeState {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $build = [int]$cv.CurrentBuild; $ubr = [int]$cv.UBR
    $native = (($build -eq 26100 -or $build -eq 26200) -and $ubr -ge 8328) -or ($build -eq 26220 -and $ubr -ge 7271) -or ($build -gt 26220 -and $build -ne 28000)
    $legacy = ($build -eq 26100 -and $ubr -ge 7019) -or ($build -eq 26200 -and $ubr -ge 7015) -or ($build -eq 26220 -and $ubr -ge 6972) -or ($build -eq 28000 -and $ubr -ge 1450)
    $deviceForm = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\OEM' -Name DeviceForm -ErrorAction SilentlyContinue).DeviceForm
    [pscustomobject]@{
        Windows       = "$($cv.DisplayVersion) (build $build.$ubr)"
        Compatible    = $native -or $legacy
        Native        = $native
        ToolInstalled = Test-Path $toolExe
        Enabled       = ($deviceForm -eq 0x2E) -and (Test-Path (Join-Path $toolDir 'DeviceForm.bak'))
        Enabler       = Test-Path $enabler
    }
}

$state = Get-XboxModeState
Step 'État actuel'
Info "Windows            : $($state.Windows) - $(if ($state.Compatible) { if ($state.Native) { 'compatible (native)' } else { 'compatible (ancienne méthode)' } } else { 'NON compatible' })"
Info "Mode Xbox complet  : $(if ($state.Enabled) { 'activé' } else { 'non activé' })"
Info "Outil XFSE         : $(if ($state.ToolInstalled) { $toolDir } else { 'non installé' })"
Info "Activation muette  : $(if ($state.Enabler) { 'compilée' } else { 'non compilée (setup\build-xbox-enabler.ps1)' })"
Info "Node.js            : $(if (Get-Command node -ErrorAction SilentlyContinue) { (node --version) } else { 'absent' })"
if ($Check) { return }

# Le mode Xbox modifie le registre machine : droits administrateur requis.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $NoXboxMode -and -not $state.Enabled -and $state.Compatible -and -not $isAdmin) {
    Info 'Droits administrateur nécessaires pour le mode Xbox : relance en administrateur…'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Autostart) { $argList += '-Autostart' }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    return
}

# ---------------------------------------------------------------- 1. KaneMode
Step '1/3 KaneMode'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Warn 'Node.js est requis par le prototype : winget install OpenJS.NodeJS.LTS' }
$shell = New-Object -ComObject WScript.Shell
$launcher = Join-Path $PSScriptRoot 'launch.ps1'
$icon = Join-Path $PSScriptRoot 'kanemode.ico'
foreach ($dir in [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'KaneMode.lnk'))
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = $icon
    $lnk.Description = 'KaneMode : interface console'
    $lnk.Save()
}
Ok 'Raccourcis créés (menu Démarrer et Bureau)'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($Autostart) {
    Set-ItemProperty $run -Name 'KaneMode' -Value "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
    Ok 'Lancement automatique à l''ouverture de session activé'
}

# ---------------------------------------------------------------- 2. Mode Xbox
Step '2/3 Mode Xbox (plein écran)'
$restart = $false
if ($NoXboxMode) { Info 'Ignoré (-NoXboxMode).' }
elseif ($state.Enabled) { Ok 'Déjà activé.' }
elseif (-not $state.Compatible) { Warn "Cette version de Windows n'est pas compatible : faites les mises à jour Windows puis relancez." }
else {
    if (-not $state.ToolInstalled) {
        $msi = Get-ChildItem (Join-Path $PSScriptRoot 'msi') -Filter '*.msi' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($msi) {
            Info "Installation de $($msi.Name)…"
            $p = Start-Process msiexec.exe -ArgumentList "/i `"$($msi.FullName)`" /qb /norestart" -Wait -PassThru
            if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Échec de l'installation de l'outil (code $($p.ExitCode))" }
            Ok 'XboxFullScreenExperienceTool installé'
        } else {
            Warn "XboxFullScreenExperienceTool n'est pas installé. Téléchargez le .msi, placez-le dans setup\msi\ puis relancez ce script."
            Start-Process $releases
            return
        }
    }
    if (Test-Path $enabler) {
        Info 'Activation silencieuse…'
        $p = Start-Process $enabler -ArgumentList @('/silentenable', "/installpath=`"$toolDir`"") -Wait -PassThru
        switch ($p.ExitCode) {
            0 { Ok 'Mode Xbox activé.'; $restart = $true }
            2 { Warn 'Build Windows non compatible.' }
            3 { Warn "Dossier de l'outil introuvable : $toolDir" }
            default { Warn "Échec de l'activation (code $($p.ExitCode)). Journal : $env:TEMP\KaneMode-XboxMode.log" }
        }
    } else {
        Warn "Activation silencieuse non compilée : ouverture de l'outil. Cliquez sur « Enable Xbox Mode (FSE) », puis redémarrez."
        Start-Process $toolExe
    }
}

# ---------------------------------------------------------------- 3. Application d'accueil
Step "3/3 Application d'accueil"
Info 'Paramètres > Jeux > Mode Xbox : activez « Entrer en mode Xbox au démarrage ».'
Info "Le prototype KaneMode se lance par son raccourci (ou -Autostart). Il ne peut pas encore apparaître dans"
Info "« Choisir l'application d'accueil » : il faudra pour cela l'app native KaneMode (paquet MSIX), prochaine étape du projet."

if ($restart) {
    $answer = Read-Host "`nUn redémarrage est nécessaire pour finaliser le mode Xbox. Redémarrer maintenant ? (O/N)"
    if ($answer -match '^[oOyY]') { Restart-Computer -Force }
}
Write-Host "`nTerminé." -ForegroundColor Green
