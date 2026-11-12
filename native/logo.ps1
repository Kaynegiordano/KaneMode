# Logo de KaneMode (4.34) : un K massif et les quatre boutons d'une manette, en degrade bleu -> violet
# sur un carre arrondi sombre cercle du meme degrade. Meme dessin que le symbole i-brand de
# ui/index.html (grille de 48 unites). KaneOS garde l'ancien K blanc sur fond degrade.
#   . .\logo.ps1 ; New-KaneModeLogo -File x.png -Width 256 -Height 256 [-Scale 1] [-Opaque]
#   Get-KaneModeLogoBitmap 32   (System.Drawing.Bitmap carre, transparent)
Add-Type -AssemblyName System.Drawing

function New-KaneModeRound([double]$x, [double]$y, [double]$s, [double]$d) {
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $s - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $s - $d, $y + $s - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $s - $d, $d, $d, 90, 90); $p.CloseFigure()
    return $p
}

function Draw-KaneModeLogo([System.Drawing.Graphics]$g, [double]$x, [double]$y, [double]$s) {
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $k = $s / 48.0
    # Degrade #1A9FFF -> #6A5CFF en diagonale sur toute la tuile
    $brush = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.PointF]::new($x, $y)), ([Drawing.PointF]::new($x + $s, $y + $s)), ([Drawing.Color]::FromArgb(26, 159, 255)), ([Drawing.Color]::FromArgb(106, 92, 255))
    # Carre arrondi sombre (rayon 12 sur 48)
    $tile = New-KaneModeRound $x $y $s (24 * $k)
    $dark = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(11, 14, 19))
    $g.FillPath($dark, $tile)
    # Cercle : trait de 2 a 1 unite du bord (rayon 11)
    $ring = New-KaneModeRound ($x + $k) ($y + $k) (46 * $k) (22 * $k)
    $pen = New-Object Drawing.Pen $brush, ([single](2 * $k))
    $g.DrawPath($pen, $ring)
    # K massif
    $pts = @(@(8,11),@(14,11),@(14,21.2),@(23.6,11),@(31,11),@(20.6,22.2),@(31.4,37),@(24.1,37),@(16.5,26.4),@(14,29),@(14,37),@(8,37)) |
        ForEach-Object { [Drawing.PointF]::new([single]($x + $_[0] * $k), [single]($y + $_[1] * $k)) }
    $g.FillPolygon($brush, [Drawing.PointF[]]$pts)
    # Les quatre boutons, en losange
    $r = 2.7 * $k
    foreach ($c in @(@(35.5, 18.6), @(40.6, 24), @(35.5, 29.4), @(30.4, 24))) {
        $g.FillEllipse($brush, [single]($x + $c[0] * $k - $r), [single]($y + $c[1] * $k - $r), [single](2 * $r), [single](2 * $r))
    }
    $pen.Dispose(); $brush.Dispose(); $dark.Dispose(); $tile.Dispose(); $ring.Dispose()
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
