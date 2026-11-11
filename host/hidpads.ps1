# Manettes PlayStation et Nintendo branchées (DualShock 4, DualSense, Pro Controller, Joy-Con…), y
# compris la manette virtuelle que Sunshine crée pour une console en streaming : vendeur et produit.
# Seuls les périphériques HID présents comptent (une manette Bluetooth appairée mais éteinte n'en a pas).
# KaneMode s'en sert pour remettre à Eden et Lichii la disposition réglée pour cette manette.
# Sortie : JSON [{ vid, pid }] (liste vide sans manette).
$ErrorActionPreference = 'Stop'
try {
  $seen = @{}
  $pads = @()
  foreach ($d in Get-PnpDevice -PresentOnly -Class HIDClass -ErrorAction SilentlyContinue) {
    $id = [string]$d.InstanceId
    if (-not $id.StartsWith('HID\')) { continue }
    # USB (et manette virtuelle) : VID_054C&PID_05C4 ; Bluetooth : VID&0002054C_PID&0CE6
    $m = [regex]::Match($id, 'VID[_&](?:0002)?(054C|057E)[_&]PID[_&]([0-9A-F]{4})', 'IgnoreCase')
    if (-not $m.Success) { continue }
    $key = ($m.Groups[1].Value + ':' + $m.Groups[2].Value).ToLower()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $pads += [pscustomobject]@{ vid = [Convert]::ToInt32($m.Groups[1].Value, 16); pid = [Convert]::ToInt32($m.Groups[2].Value, 16) }
  }
  ConvertTo-Json -InputObject @($pads) -Compress
} catch { '[]' }
