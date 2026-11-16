$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'src\renderer\assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$pngPath = Join-Path $assets 'icon.png'
$icoPath = Join-Path $root 'build\icon.ico'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $icoPath) | Out-Null

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$bgPath = New-RoundedPath 8 8 240 240 52
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(8, 8)),
  (New-Object System.Drawing.Point(248, 248)),
  [System.Drawing.Color]::FromArgb(255, 8, 14, 26),
  [System.Drawing.Color]::FromArgb(255, 20, 34, 62)
)
$g.FillPath($bgBrush, $bgPath)

$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 39, 224, 255), 5)
$g.DrawPath($borderPen, $bgPath)

$cyan = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 39, 224, 255), 17)
$cyan.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$cyan.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$cyan.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$magenta = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 63, 216), 17)
$magenta.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$magenta.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$magenta.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$g.DrawLine($cyan, 66, 96, 178, 96)
$g.DrawLines($cyan, [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point(150, 66)),
  (New-Object System.Drawing.Point(186, 96)),
  (New-Object System.Drawing.Point(150, 126))
))

$g.DrawLine($magenta, 190, 160, 78, 160)
$g.DrawLines($magenta, [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point(106, 130)),
  (New-Object System.Drawing.Point(70, 160)),
  (New-Object System.Drawing.Point(106, 190))
))

$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Wrap the 256x256 PNG into a single-image ICO (Vista+ PNG-compressed icon).
$png = [System.IO.File]::ReadAllBytes($pngPath)
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$png.Length)
$bw.Write([UInt32]22)
$bw.Write($png)
$bw.Flush()
$bw.Close()
$fs.Close()

$g.Dispose()
$bmp.Dispose()

Write-Output "Wrote $pngPath"
Write-Output "Wrote $icoPath"
