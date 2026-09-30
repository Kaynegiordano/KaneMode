# Decrit l'appareil pour KaneMode : fabricant, modele, chassis, batterie, ecran, cartes graphiques
# et logiciels constructeur installes (menu Demarrer). Sortie : JSON sur la sortie standard.
$ErrorActionPreference = 'SilentlyContinue'

$cs = Get-CimInstance Win32_ComputerSystem
$en = Get-CimInstance Win32_SystemEnclosure
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$bat = Get-CimInstance Win32_Battery | Select-Object -First 1

# Ecran interne : taille physique (cm) de l'ecran integre, s'il y en a un
$screens = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams | ForEach-Object {
    [pscustomobject]@{ widthCm = [int]$_.MaxHorizontalImageSize; heightCm = [int]$_.MaxVerticalImageSize }
})
$internal = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams | Where-Object { $_.VideoOutputTechnology -in 0x80000000, 11, 6 }).Count -gt 0

# Version d'AMD Software : Adrenalin (ex. 26.8.1), notée par le pilote dans sa clé de la classe « Affichage »
$display = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
$radeon = @{}
Get-ChildItem $display -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p -and $p.RadeonSoftwareVersion -and $p.DriverDesc) { $radeon["$($p.DriverDesc)"] = "$($p.RadeonSoftwareVersion)" }
}
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    $ven = if ($_.PNPDeviceID -match 'VEN_([0-9A-F]{4})') { $Matches[1] } else { '' }
    [pscustomobject]@{
        name = $_.Name; driver = $_.DriverVersion
        date = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null }
        vendor = $ven; width = $_.CurrentHorizontalResolution; height = $_.CurrentVerticalResolution; hz = $_.CurrentRefreshRate
        adrenalin = $radeon["$($_.Name)"]
    }
})

# Logiciels utiles (constructeur de la console, pilotes graphiques)
$apps = @(Get-StartApps | Where-Object { $_.Name -match 'Armoury Crate|Legion Space|Lenovo Vantage|MSI Center|AYASpace|AYA Space|OneXConsole|Zone Command|Command Center|GPD|AOKZOE|AMD Software|Radeon Software|NVIDIA app|GeForce Experience|Intel.*Graphics|Arc Control|Driver & Support|Handheld Companion|Steam Deck Tools|MyASUS' } |
    ForEach-Object { [pscustomobject]@{ name = $_.Name; target = "shell:AppsFolder\$($_.AppID)" } })

# Veille moderne (S0 Low Power Idle, champ AoAc de SYSTEM_POWER_CAPABILITIES) : la veille
# classique (S3) n'existe pas sur ces machines, dont la plupart des consoles portables.
Add-Type -Namespace KaneMode -Name Pwr -MemberDefinition '[DllImport("powrprof.dll")] public static extern bool GetPwrCapabilities(byte[] caps);'
$caps = New-Object byte[] 76
$modern = $false; $s3 = $false
if ([KaneMode.Pwr]::GetPwrCapabilities($caps)) { $modern = $caps[20] -ne 0; $s3 = $caps[5] -ne 0 }

[pscustomobject]@{
    manufacturer = "$($cs.Manufacturer)".Trim(); model = "$($cs.Model)".Trim(); family = "$($cs.SystemFamily)".Trim(); sku = "$($cs.SystemSKUNumber)".Trim()
    chassis = @($en.ChassisTypes); bios = "$($bios.SMBIOSBIOSVersion)"; cpu = "$($cpu.Name)".Trim()
    battery = if ($bat) { [pscustomobject]@{ percent = $bat.EstimatedChargeRemaining; charging = $bat.BatteryStatus -in 2, 6, 7, 8, 9 } } else { $null }
    screens = $screens; internalScreen = $internal; gpus = $gpus; apps = $apps; modernStandby = [bool]$modern; s3 = [bool]$s3
    memoryGb = [math]::Round($cs.TotalPhysicalMemory / 1GB)
} | ConvertTo-Json -Depth 4 -Compress
