<#
.SYNOPSIS
    Sauvegarde ou restaure le certificat qui signe KaneMode (« CN=KaneMode »).
.DESCRIPTION
    Sans ce certificat (clé privée comprise), les mises à jour ne peuvent plus s'installer
    par-dessus les versions déjà publiées : Windows exige le même éditeur et la même signature.

    -Backup  : exporte le certificat et sa clé privée dans un fichier .pfx protégé par un mot de
               passe que vous choisissez (demandé deux fois, jamais affiché ni enregistré).
    -Restore : réimporte un .pfx sur ce PC (nouveau PC, Windows réinstallé…).

    Rangez le .pfx HORS du dépôt (clé USB, coffre de mots de passe, stockage chiffré) et le mot de
    passe à part. Ne le publiez jamais : le .gitignore du dépôt exclut déjà les .pfx.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File native\certificate.ps1 -Backup -Path E:\KaneMode-signature.pfx
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File native\certificate.ps1 -Restore -Path E:\KaneMode-signature.pfx
#>
param([switch]$Backup, [switch]$Restore, [string]$Path = (Join-Path $env:USERPROFILE 'KaneMode-signature.pfx'))

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if ($Backup -eq $Restore) { throw 'Choisissez -Backup ou -Restore.' }

if ($Backup) {
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=KaneMode' -and $_.HasPrivateKey } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
    if (-not $cert) { throw 'Certificat « CN=KaneMode » avec clé privée introuvable sur ce PC.' }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw "Choisissez un emplacement hors du dépôt KaneMode ($repo)." }
    if (Test-Path $full) { throw "Le fichier existe déjà : $full" }

    Write-Host "Certificat : $($cert.Thumbprint) (expire le $($cert.NotAfter.ToString('dd/MM/yyyy')))"
    $p1 = Read-Host 'Mot de passe du fichier de sauvegarde' -AsSecureString
    $p2 = Read-Host 'Confirmez le mot de passe' -AsSecureString
    $plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
    if ((& $plain $p1) -ne (& $plain $p2)) { throw 'Les deux mots de passe sont différents.' }
    if ((& $plain $p1).Length -lt 8) { throw 'Mot de passe trop court (8 caractères minimum).' }

    New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null
    # Par défaut dans le dossier de l'utilisateur : Documents (souvent OneDrive) peut être protégé
    # par « Dossiers contrôlés » de Windows, qui refuse alors l'écriture (« fichier introuvable »).
    try { Export-PfxCertificate -Cert $cert -FilePath $full -Password $p1 -CryptoAlgorithmOption AES256_SHA256 | Out-Null }
    catch [IO.FileNotFoundException], [UnauthorizedAccessException] {
        throw "Windows refuse d'écrire dans $(Split-Path $full) (dossier protégé ou synchronisé). Relancez avec -Path vers un autre dossier, par exemple -Path E:\KaneMode-signature.pfx sur une clé USB."
    }

    # Vérification : le fichier s'ouvre avec ce mot de passe et contient bien la clé privée
    $check = New-Object Security.Cryptography.X509Certificates.X509Certificate2($full, $p1)
    if ($check.Thumbprint -ne $cert.Thumbprint -or -not $check.HasPrivateKey) { throw 'La sauvegarde est invalide.' }
    Write-Host "Sauvegarde vérifiée : $full" -ForegroundColor Green
    Write-Host 'Copiez-la hors de ce PC (clé USB, coffre de mots de passe) et gardez le mot de passe à part.'
}

if ($Restore) {
    if (-not (Test-Path $Path)) { throw "Fichier introuvable : $Path" }
    $pw = Read-Host 'Mot de passe de la sauvegarde' -AsSecureString
    $c = Import-PfxCertificate -FilePath $Path -CertStoreLocation Cert:\CurrentUser\My -Password $pw
    Write-Host "Certificat restauré : $($c.Thumbprint) (expire le $($c.NotAfter.ToString('dd/MM/yyyy')))" -ForegroundColor Green
}
