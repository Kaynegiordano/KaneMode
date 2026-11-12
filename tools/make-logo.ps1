# Regenere les icones de KaneMode a partir de native\logo.ps1 :
#   ui\media\icon.png (256 px, favicon de l'interface) et setup\kanemode.ico (app, installateur, raccourcis).
# Chaque taille est dessinee a sa taille (net en petit). Dans le .ico, 16 a 128 px sont des bitmaps
# 32 bits classiques (BGRA + masque) : l'Explorateur n'affiche pas toujours un PNG en petit (icone vide) ;
# seule la 256 px est en PNG.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'native\logo.ps1')

$png = Join-Path $root 'ui\media\icon.png'
New-KaneModeLogo -File $png -Width 256 -Height 256
Write-Host "icon.png : 256 px"

$sizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
$entries = @()
foreach ($t in $sizes) {
    $bmp = Get-KaneModeLogoBitmap $t
    if ($t -eq 256) {
        $ms = New-Object IO.MemoryStream
        $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
        $data = $ms.ToArray()
    } else {
        $rect = New-Object Drawing.Rectangle 0, 0, $t, $t
        $bd = $bmp.LockBits($rect, 'ReadOnly', [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $px = New-Object byte[] ($t * $t * 4)
        # Lignes de bas en haut (BMP)
        for ($y = 0; $y -lt $t; $y++) {
            [Runtime.InteropServices.Marshal]::Copy([IntPtr]($bd.Scan0.ToInt64() + ($t - 1 - $y) * $bd.Stride), $px, $y * $t * 4, $t * 4)
        }
        $bmp.UnlockBits($bd)
        $maskRow = [int]([Math]::Floor(($t + 31) / 32) * 4)
        $mask = New-Object byte[] ($maskRow * $t)
        $ms = New-Object IO.MemoryStream
        $bw = New-Object IO.BinaryWriter $ms
        $bw.Write([int]40); $bw.Write([int]$t); $bw.Write([int]($t * 2)); $bw.Write([int16]1); $bw.Write([int16]32)
        $bw.Write([int]0); $bw.Write([int]($px.Length + $mask.Length)); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
        $bw.Write($px); $bw.Write($mask); $bw.Flush()
        $data = $ms.ToArray()
    }
    $bmp.Dispose()
    $entries += ,@($t, $data)
}
$out = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $out
$w.Write([int16]0); $w.Write([int16]1); $w.Write([int16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
    $t = $e[0]; $len = $e[1].Length
    $w.Write([byte]($t % 256)); $w.Write([byte]($t % 256)); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([int16]1); $w.Write([int16]32); $w.Write([int]$len); $w.Write([int]$offset)
    $offset += $len
}
foreach ($e in $entries) { $w.Write([byte[]]$e[1]) }
$w.Flush()
$ico = Join-Path $root 'setup\kanemode.ico'
[IO.File]::WriteAllBytes($ico, $out.ToArray())
Write-Host "kanemode.ico : $($entries.Count) tailles ($($sizes -join ', '))"
