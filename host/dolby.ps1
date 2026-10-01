# Etat officiel du son spatial Windows et de Dolby Access, sans lecture des donnees de licence.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $null = [Windows.Media.Devices.MediaDevice,Windows.Media.Devices,ContentType=WindowsRuntime]
    $null = [Windows.Media.Audio.SpatialAudioDeviceConfiguration,Windows.Media.Audio,ContentType=WindowsRuntime]
    $null = [Windows.Media.Audio.SpatialAudioFormatSubtype,Windows.Media.Audio,ContentType=WindowsRuntime]
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    $operation = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Media.Devices.MediaDevice]::GetAudioRenderSelector())
    $task = $asTask.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection]).Invoke($null, @($operation))
    if (-not $task.Wait(5000)) { throw 'Lecture des sorties audio trop longue' }
    $defaultId = [Windows.Media.Devices.MediaDevice]::GetDefaultAudioRenderId([Windows.Media.Devices.AudioDeviceRole]::Default)
    $formats = [ordered]@{
        headphones = [Windows.Media.Audio.SpatialAudioFormatSubtype]::DolbyAtmosForHeadphones
        homeTheater = [Windows.Media.Audio.SpatialAudioFormatSubtype]::DolbyAtmosForHomeTheater
        speakers = [Windows.Media.Audio.SpatialAudioFormatSubtype]::DolbyAtmosForSpeakers
        sonic = [Windows.Media.Audio.SpatialAudioFormatSubtype]::WindowsSonic
    }
    $devices = @(foreach ($device in $task.Result) {
        if (-not $device.IsEnabled) { continue }
        try {
            $spatial = [Windows.Media.Audio.SpatialAudioDeviceConfiguration]::GetForDeviceId($device.Id)
            $supported = @('off')
            foreach ($key in $formats.Keys) { if ($spatial.IsSpatialAudioFormatSupported($formats[$key])) { $supported += $key } }
            $selected = [string]$spatial.DefaultSpatialAudioFormat
            $active = [string]$spatial.ActiveSpatialAudioFormat
            # L'outil de changement accepte l'identifiant Core Audio, contenu dans l'identifiant WinRT.
            if ($device.Id -notmatch '(\{0\.0\.0\.[0-9a-f]+\}\.\{[0-9a-f-]+\})') { continue }
            [pscustomobject]@{ id=$Matches[1]; name=$device.Name; default=($device.Id -eq $defaultId); supported=$supported; selectedGuid=$selected; activeGuid=$active }
        } catch { continue }
    })
    $package = Get-AppxPackage -Name 'DolbyLaboratories.DolbyAccess' -ErrorAction SilentlyContinue | Select-Object -First 1
    $appId = $null
    if ($package) {
        $manifest = Get-AppxPackageManifest $package
        $app = @($manifest.Package.Applications.Application)[0]
        if ($app.Id) { $appId = "$($package.PackageFamilyName)!$($app.Id)" }
    }
    [pscustomobject]@{ available=$true; installed=[bool]$appId; appId=$appId; appVersion=if($package){$package.Version.ToString()}else{$null}; license=$null; formats=$formats; devices=$devices } | ConvertTo-Json -Depth 5 -Compress
} catch {
    [pscustomobject]@{ available=$false; installed=$false; license=$null; devices=@(); reason='Son spatial Windows indisponible' } | ConvertTo-Json -Compress
}
