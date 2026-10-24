# 生成方案1「答题卡」多尺寸图标 icon.ico（16/24/32/48/64/128/256，PNG 内嵌，Vista+ 均支持）
# 用法： powershell -ExecutionPolicy Bypass -File make-icon.ps1
# 输出： 与本脚本同目录的 icon.ico；build-launcher.ps1 会自动使用它

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path $here "icon.ico"

Add-Type -AssemblyName System.Drawing

function RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$dark  = [System.Drawing.Color]::FromArgb(255, 38, 40, 44)     # 26282C
$paper = [System.Drawing.Color]::FromArgb(255, 232, 233, 235)  # E8E9EB
$grey1 = [System.Drawing.Color]::FromArgb(255, 185, 189, 197)  # B9BDC5
$grey2 = [System.Drawing.Color]::FromArgb(255, 201, 204, 209)  # C9CCD1
$grey3 = [System.Drawing.Color]::FromArgb(255, 221, 217, 207)  # DDD9CF
$green = [System.Drawing.Color]::FromArgb(255, 76, 195, 138)   # 4CC38A
$white = [System.Drawing.Color]::White

$pngList = New-Object System.Collections.Generic.List[byte[]]
foreach ($s in @(16, 24, 32, 48, 64, 128, 256)) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $s / 256.0
  $g.ScaleTransform($k, $k)

  # 底座
  $base = RoundedRectPath 16 16 224 224 52
  $g.FillPath((New-Object System.Drawing.SolidBrush $dark), $base)
  $base.Dispose()

  # 白色答题卡
  $card = RoundedRectPath 68 52 120 152 10
  $g.FillPath((New-Object System.Drawing.SolidBrush $paper), $card)
  $card.Dispose()

  if ($s -ge 48) {
    # 完整细节：两行未答 + 一行绿色对勾 + 底部横线
    foreach ($y in @(86, 114)) {
      $g.FillEllipse((New-Object System.Drawing.SolidBrush $grey1), 94-7, $y-7, 14, 14)
      $line = RoundedRectPath 108 ($y-4.5) 56 9 4.5
      $g.FillPath((New-Object System.Drawing.SolidBrush $grey2), $line)
      $line.Dispose()
    }
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $green), 94-10, 142-10, 20, 20)
    $pen = New-Object System.Drawing.Pen $white, 4
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLines($pen, [System.Drawing.PointF[]]@(
      (New-Object System.Drawing.PointF 88, 142),
      (New-Object System.Drawing.PointF 93, 147),
      (New-Object System.Drawing.PointF 101, 137)))
    $line3 = RoundedRectPath 108 137.5 56 9 4.5
    $g.FillPath((New-Object System.Drawing.SolidBrush $grey2), $line3)
    $line3.Dispose()
    $tail = RoundedRectPath 88 168 76 9 4.5
    $g.FillPath((New-Object System.Drawing.SolidBrush $grey3), $tail)
    $tail.Dispose()
  } else {
    # 小尺寸简化：只保留绿色对勾圆点，保证 16px 可辨
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $green), 94-14, 114-14, 28, 28)
    if ($s -ge 32) {
      $pen = New-Object System.Drawing.Pen $white, 6
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $g.DrawLines($pen, [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF 86, 114),
        (New-Object System.Drawing.PointF 92, 120),
        (New-Object System.Drawing.PointF 103, 108)))
    }
  }

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngList.Add($ms.ToArray())
  $ms.Dispose(); $g.Dispose(); $bmp.Dispose()
}

# 组装 .ico：ICONDIR + ICONDIRENTRY*N + PNG 数据
$msIco = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($msIco)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$pngList.Count)
$offset = 6 + 16 * $pngList.Count
for ($i = 0; $i -lt $pngList.Count; $i++) {
  $s = @(16, 24, 32, 48, 64, 128, 256)[$i]
  $bw.Write([byte]($s % 256))   # 256 记为 0
  $bw.Write([byte]($s % 256))
  $bw.Write([byte]0)            # 调色板颜色数
  $bw.Write([byte]0)            # 保留
  $bw.Write([uint16]1)          # planes
  $bw.Write([uint16]32)         # bpp
  $bw.Write([uint32]$pngList[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $pngList[$i].Length
}
foreach ($png in $pngList) { $bw.Write($png) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($out, $msIco.ToArray())
$bw.Dispose(); $msIco.Dispose()

Write-Host "完成： $out  ($([math]::Round((Get-Item $out).Length/1KB)) KB)"
