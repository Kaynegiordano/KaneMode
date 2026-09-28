# Mises a jour de pilotes via Windows Update (l'agent Windows Update, comme Parametres >
# Windows Update > Mises a jour facultatives).
#   -Search              : cherche les pilotes proposes (sans droits administrateur)
#   -Install -Ids a,b    : telecharge et installe ces mises a jour (administrateur requis)
# Le resultat (JSON) est ecrit dans -Out.
param([switch]$Search, [switch]$Install, [string]$Ids = '', [Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = 'Stop'
function Save($obj) { [IO.File]::WriteAllText($Out, ($obj | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding $false)) }

try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $session.ClientApplicationID = 'KaneMode'
    $searcher = $session.CreateUpdateSearcher()
    $searcher.Online = $true
    $found = $searcher.Search("IsInstalled=0 and Type='Driver' and IsHidden=0").Updates

    if ($Search) {
        $items = @(foreach ($u in $found) {
            [pscustomobject]@{
                id = $u.Identity.UpdateID; title = $u.Title; class = $u.DriverClass; maker = $u.DriverManufacturer
                model = $u.DriverModel; provider = $u.DriverProvider
                date = if ($u.DriverVerDate) { ([datetime]$u.DriverVerDate).ToString('yyyy-MM-dd') } else { $null }
                size = [int64]$u.MaxDownloadSize
            }
        })
        Save ([pscustomobject]@{ ok = $true; checked = (Get-Date).ToString('o'); items = $items })
        return
    }

    if ($Install) {
        $want = $Ids -split ',' | Where-Object { $_ }
        $todo = New-Object -ComObject Microsoft.Update.UpdateColl
        foreach ($u in $found) { if (-not $want -or $want -contains $u.Identity.UpdateID) { if (-not $u.EulaAccepted) { $u.AcceptEula() }; [void]$todo.Add($u) } }
        if ($todo.Count -eq 0) { Save ([pscustomobject]@{ ok = $true; installed = 0; reboot = $false }); return }
        $dl = $session.CreateUpdateDownloader(); $dl.Updates = $todo; [void]$dl.Download()
        $inst = $session.CreateUpdateInstaller(); $inst.Updates = $todo
        $r = $inst.Install()
        $ok = 0; for ($i = 0; $i -lt $todo.Count; $i++) { if ($r.GetUpdateResult($i).ResultCode -eq 2) { $ok++ } }
        Save ([pscustomobject]@{ ok = $r.ResultCode -in 2, 3; installed = $ok; total = $todo.Count; reboot = [bool]$r.RebootRequired })
    }
} catch {
    Save ([pscustomobject]@{ ok = $false; error = $_.Exception.Message })
}
