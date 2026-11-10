# Jaquettes converties en PNG pour Sunshine (il n'envoie que ce format aux consoles) : décodage par
# WIC (JPEG, PNG, WebP, BMP…), au plus 600 × 900 points, sans déformation.
# -List : fichier JSON [{ "src": "...", "dst": "....png" }]
param([Parameter(Mandatory)][string]$List)
Add-Type -AssemblyName PresentationCore
$items = Get-Content -LiteralPath $List -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($it in @($items)) {
    try {
        $in = [IO.File]::OpenRead($it.src)
        try {
            $dec = [Windows.Media.Imaging.BitmapDecoder]::Create($in, [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
            $frame = $dec.Frames[0]
        } finally { $in.Dispose() }
        $scale = [Math]::Min(1.0, [Math]::Min(600.0 / $frame.PixelWidth, 900.0 / $frame.PixelHeight))
        $img = if ($scale -lt 1.0) { New-Object Windows.Media.Imaging.TransformedBitmap($frame, (New-Object Windows.Media.ScaleTransform($scale, $scale))) } else { $frame }
        $enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
        $enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($img))
        $tmp = "$($it.dst).part"
        $out = [IO.File]::Create($tmp)
        try { $enc.Save($out) } finally { $out.Dispose() }
        Move-Item -LiteralPath $tmp -Destination $it.dst -Force
    } catch { Write-Output "échec : $($it.src) : $($_.Exception.Message)" }
}
