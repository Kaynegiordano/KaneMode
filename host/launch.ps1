# Une cible est une donnee JSON, jamais une commande PowerShell a evaluer.
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $target = [string]$request.target
    if (-not $target -or $target -match "[\x00\r\n]") { throw 'Cible de lancement invalide' }
    if ($target -match '^shell:') {
        if ($target -notmatch '^shell:AppsFolder\\([\w.-]+![\w.-]+)$') { throw 'Identifiant Windows invalide' }
        $shell = New-Object -ComObject Shell.Application
        $item = $shell.Namespace('shell:AppsFolder').ParseName($Matches[1])
        if (-not $item) { throw 'Application Windows introuvable' }
        if (-not $CheckOnly) { $item.InvokeVerb('open') }
    } else {
        $isUri = $target -match '^[a-z][a-z0-9+.-]*:' -and $target -notmatch '^[a-z]:[\\/]'
        if ($isUri) {
            $scheme = $target.Substring(0,$target.IndexOf(':'))
            $key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($scheme)
            try { if (-not $key -or $null -eq $key.GetValue('URL Protocol', $null)) { throw "Protocole non installe : $scheme" } }
            finally { if ($key) { $key.Dispose() } }
        } elseif (-not [IO.Path]::IsPathRooted($target) -or -not (Test-Path -LiteralPath $target)) { throw 'Fichier ou dossier introuvable' }
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $target
        $start.Arguments = [string]$request.args
        $start.UseShellExecute = $true
        $start.ErrorDialog = $false
        if ($request.cwd -and (Test-Path -LiteralPath $request.cwd -PathType Container)) { $start.WorkingDirectory = [string]$request.cwd }
        if (-not $CheckOnly) { [void][Diagnostics.Process]::Start($start) }
    }
    [Console]::WriteLine('{"ok":true}')
} catch {
    [Console]::WriteLine((@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress))
    exit 1
}
