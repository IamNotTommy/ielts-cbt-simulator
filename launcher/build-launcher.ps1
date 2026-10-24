# 把 dist（网页应用）打进单个 exe：英语机考模拟器.exe
# 只用 Windows 自带的 csc.exe（.NET Framework 4.x），**不需要 Node/npm/任何下载**
#
# 用法： powershell -ExecutionPolicy Bypass -File build-launcher.ps1 [-Name "英语机考模拟器.exe"] [-Dist ..\..\ielts-cbt-simulator-v1.5-listening\dist] [-OutDir ..]
#   -Dist / -OutDir 可以是相对本脚本目录的路径，也可以是绝对路径

param(
  [string]$Name = "英语机考模拟器.exe",
  [string]$Dist = "..\..\ielts-cbt-simulator-v1.5-listening\dist",
  [string]$OutDir = "."
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Resolve-Arg([string]$p) { if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $here $p } }
$distFull = [System.IO.Path]::GetFullPath((Resolve-Arg $Dist))
$outFull  = [System.IO.Path]::GetFullPath((Resolve-Arg $OutDir))
if (-not (Test-Path $distFull)) { throw "找不到 dist 目录：$distFull（先运行 vite build）" }

$csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
         "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "找不到 csc.exe（.NET Framework 4.x 应随 Windows 提供）" }

if (-not (Test-Path $outFull)) { New-Item -ItemType Directory -Path $outFull | Out-Null }
$exe = Join-Path $outFull $Name

# 目标 exe 正在运行时 csc 会报 CS0016"另一个程序正在使用此文件"，先给出明确提示
if (Test-Path $exe) {
  try { $fs = [System.IO.File]::Open($exe, 'Open', 'ReadWrite', 'None'); $fs.Close() }
  catch {
    $who = Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { $_.ProcessId }
    throw "目标文件被占用（多半是它正在运行$(if ($who) { "，PID $($who -join ',')" })）：$exe`n请先关闭那个黑窗口，或用 -OutDir 输出到别的目录。"
  }
}

# 1) 生成资源清单： 资源名=URL 路径
$files = Get-ChildItem -Path $distFull -Recurse -File | Sort-Object FullName
$mapLines = New-Object System.Collections.Generic.List[string]
$resArgs  = New-Object System.Collections.Generic.List[string]
$i = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($distFull.Length).Replace('\','/')
  if ($rel -notlike '/*') { $rel = "/$rel" }
  $res = "web$i"
  $mapLines.Add("$res=$rel")
  $resArgs.Add("/resource:`"$($f.FullName)`",$res")
  $i++
}
$mapPath = Join-Path $env:TEMP ("cbt-webmap-" + [guid]::NewGuid().ToString("N") + ".txt")
[System.IO.File]::WriteAllText($mapPath, ($mapLines -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
$resArgs.Add("/resource:`"$mapPath`",webmap")

Write-Host "打包 $($files.Count) 个网页文件 → $Name"
$files | ForEach-Object { Write-Host ("   {0,8:N1} KB  {1}" -f ($_.Length/1KB), $_.Name) }

# 2) 程序图标：使用与本脚本同目录的 icon.ico（由 make-icon.ps1 生成，多尺寸答题卡图标）
$icoPath = Join-Path $here "icon.ico"
if (-not (Test-Path $icoPath)) { Write-Host "（未找到 icon.ico，先用 make-icon.ps1 生成；本次不带图标）"; $icoPath = $null }

# 3) 编译为窗口程序（winexe，双击不再出现黑色控制台），引用 WPF 与 System.Drawing（均为 .NET Framework 自带）
#    WPF 程序集不在 csc 默认引用路径里，需从 GAC 取完整路径
function GacRef([string]$name) {
  $hit = Get-ChildItem "C:\Windows\Microsoft.NET\assembly" -Recurse -Filter "$name.dll" -ErrorAction SilentlyContinue |
         Where-Object { $_.Directory.Name -like 'v4.0*' } | Select-Object -First 1
  if (-not $hit) { throw "找不到 GAC 程序集：$name" }
  return "/r:`"$($hit.FullName)`""
}
$cscArgs = @("/nologo","/utf8output","/target:winexe","/platform:anycpu","/optimize+","/codepage:65001",
             (GacRef "PresentationFramework"),(GacRef "PresentationCore"),(GacRef "WindowsBase"),(GacRef "System.Xaml"),
             "/r:System.Drawing.dll","/r:System.Web.Extensions.dll")
if ($icoPath) { $cscArgs += "/win32icon:`"$icoPath`"" }
$cscArgs += @("/out:`"$exe`"") + $resArgs + @("`"$(Join-Path $here 'Launcher.cs')`"")
$prevEnc = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  & $csc @cscArgs | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
} finally {
  [Console]::OutputEncoding = $prevEnc
  Remove-Item $mapPath -Force -ErrorAction SilentlyContinue
}
if ($code -ne 0) { throw "csc 编译失败（退出码 $code）" }

# 4) 复位 exe 的"完整性级别"标签（很重要，不是可选步骤）
#    若输出目录本身带着 Windows 沙箱/受限工具留下的 Low 标签，新编译出来的 exe 会继承 Low。
#    带 Low 标签的 exe，双击时 Windows 也会以"低权限"运行它——低权限进程无法把链接交给用户的浏览器，
#    表现就是：点「打开练习页面」只把浏览器窗口带到前台、标签页却没打开（日志里会写"完整性级别: Low(4096)"）。
#    这里用 icacls 把标签显式设为 Medium（不带 -T，只动这个 exe 文件，不动目录权限）。
try {
  $before = (icacls $exe) -join "`n"
  $low = $before -match 'Mandatory Label\\Low'
  icacls $exe /setintegritylevel Medium | Out-Null
  $after = (icacls $exe) -join "`n"
  if ($after -match 'Mandatory Label\\Medium') {
    Write-Host "已把 exe 的完整性级别设为 Medium$(if ($low) { '（原来是 Low，会打不开浏览器）' } else { '' })"
  } else {
    Write-Warning "没能确认 exe 的完整性级别已复位，请手动执行： icacls `"$exe`" /setintegritylevel Medium"
  }
} catch {
  Write-Warning "设置完整性级别失败（$($_.Exception.Message)）。如果双击后点「打开练习页面」没反应，请手动执行： icacls `"$exe`" /setintegritylevel Medium"
}

Write-Host ""
Write-Host "完成： $exe  ($([math]::Round((Get-Item $exe).Length/1KB)) KB)"
Write-Host "双击即可运行（会自动选端口并用默认浏览器打开；再次双击也会打开浏览器，不会起第二个服务）"
