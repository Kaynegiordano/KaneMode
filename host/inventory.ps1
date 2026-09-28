# Pilotes installes sur ce PC (peripheriques presents) : identifiants materiels et version du pilote.
# Sert a comparer avec les pilotes publies par le constructeur de la console (lib/oem.js).
# Sortie : JSON sur la sortie standard.
$ErrorActionPreference = 'SilentlyContinue'
@(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DriverVersion -and ($_.HardWareID -or $_.DeviceID) } | ForEach-Object {
    [pscustomobject]@{ ids = @(@($_.HardWareID, $_.DeviceID) | Where-Object { $_ } | ForEach-Object { "$_".ToUpperInvariant() }); version = "$($_.DriverVersion)" }
}) | ConvertTo-Json -Depth 3 -Compress
