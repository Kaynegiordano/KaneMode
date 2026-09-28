# Installe une mise a jour de KaneMode (paquet .msix deja verifie par l'hote), puis relance l'app.
# Lance hors de KaneMode (WMI) : Add-AppxPackage peut donc fermer l'app sans se fermer lui-meme.
param([Parameter(Mandatory)][string]$Msix, [Parameter(Mandatory)][string]$Log)

function Write-Log($msg) { Add-Content -Path $Log -Value ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg) -Encoding UTF8 }

Write-Log "Mise a jour : $Msix"
Start-Sleep -Seconds 2   # laisse l'interface afficher « Installation… »
try {
    Add-AppxPackage -Path $Msix -ForceApplicationShutdown -ForceUpdateFromAnyVersion -ErrorAction Stop
    Write-Log 'Installation reussie'
    Remove-Item $Msix -Force -ErrorAction SilentlyContinue
} catch {
    Write-Log "ECHEC : $($_.Exception.Message)"
}
# Relance KaneMode (nouvelle version, ou l'ancienne si l'installation a echoue)
$pkg = Get-AppxPackage -Name KaneMode | Select-Object -First 1
if ($pkg) {
    Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!App"
    Write-Log "Relance : $($pkg.PackageFullName)"
}
