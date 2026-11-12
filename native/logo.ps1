# Logo de KaneMode (4.33) : un K dont les branches s'ouvrent sur les quatre boutons d'une manette,
# en blanc sur un carre arrondi en degrade bleu -> violet. Meme dessin que le symbole i-brand de
# ui/index.html (grille de 48 unites). KaneOS garde l'ancien K.
#   . .\logo.ps1 ; New-KaneModeLogo -File x.png -Width 256 -Height 256 [-Scale 1] [-Opaque]
#   Get-KaneModeLogoBitmap 32   (System.Drawing.Bitmap carre, transparent)
Add-Type -AssemblyName System.Drawing

function Draw-KaneModeLogo([System.Drawing.Graphics]$g, [double]$x, [double]$y, [double]$s) {
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $k = $s / 48.0
    # Carre arrondi (rayon 12 sur 48), degrade #1A9FFF -> #6A5CFF en diagonale
    $d = 24 * $k
    $tile = New-Object Drawing.Drawing2D.GraphicsPath
    $tile.AddArc($x, $y, $d, $d, 180, 90); $tile.AddArc($x + $s - $d, $y, $d, $d, 270, 90)
    $tile.AddArc($x + $s - $d, $y + $s - $d, $d, $d, 0, 90); $tile.AddArc($x, $y + $s - $d, $d, $d, 90, 90); $tile.CloseFigure()
    $brush = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.PointF]::new($x, $y)), ([Drawing.PointF]::new($x + $s, $y + $s)), ([Drawing.Color]::FromArgb(26, 159, 255)), ([Drawing.Color]::FromArgb(106, 92, 255))
    $g.FillPath($brush, $tile)
    $white = [Drawing.Brushes]::White
    # Barre du K : 6,5 x 28 aux bouts ronds
    $w = 6.5 * $k
    $stem = New-Object Drawing.Drawing2D.GraphicsPath
    $sx = $x + 9 * $k; $sy = $y + 10 * $k; $sh = 28 * $k
    $stem.AddArc($sx, $sy, $w, $w, 180, 180); $stem.AddArc($sx, $sy + $sh - $w, $w, $w, 0, 180); $stem.CloseFigure()
    $g.FillPath($white, $stem)
    # Branches : traits de 6,5 aux bouts ronds
    $pen = New-Object Drawing.Pen ([Drawing.Color]::White), ([single]$w)
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
    $g.DrawLine($pen, [single]($x + 15.5 * $k), [single]($y + 25 * $k), [single]($x + 30 * $k), [single]($y + 12.5 * $k))
    $g.DrawLine($pen, [single]($x + 18.5 * $k), [single]($y + 22.5 * $k), [single]($x + 31.5 * $k), [single]($y + 35.5 * $k))
    # Les quatre boutons, en losange dans l'ouverture du K
    $r = 2.4 * $k
    foreach ($c in @(@(36.5, 19), @(41, 23.5), @(36.5, 28), @(32, 23.5))) {
        $g.FillEllipse($white, [single]($x + $c[0] * $k - $r), [single]($y + $c[1] * $k - $r), [single](2 * $r), [single](2 * $r))
    }
    $pen.Dispose(); $brush.Dispose(); $tile.Dispose(); $stem.Dispose()
}

function Get-KaneModeLogoBitmap([int]$size) {
    $bmp = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.Clear([Drawing.Color]::Transparent)
    Draw-KaneModeLogo $g 0 0 $size
    $g.Dispose()
    return $bmp
}

function New-KaneModeLogo([string]$File, [int]$Width, [int]$Height, [double]$Scale = 1, [switch]$Opaque) {
    $bmp = New-Object Drawing.Bitmap $Width, $Height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.Clear($(if ($Opaque) { [Drawing.Color]::FromArgb(11, 14, 19) } else { [Drawing.Color]::Transparent }))
    $s = [Math]::Round([Math]::Min($Width, $Height) * $Scale)
    Draw-KaneModeLogo $g (($Width - $s) / 2) (($Height - $s) / 2) $s
    $bmp.Save($File, [Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}
