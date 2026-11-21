# Launches PodStudio on each page with the demo signal, captures the app window, and prints a small JPEG of each as base64
# between SCREENSHOT-BEGIN/END markers in the log (the CI network can't hand artifacts to every viewer).
param([string]$Exe, [int[]]$Pages = @(0), [int]$Width = 900, [int]$Quality = 60, [string]$OutDir = "shots", [switch]$NoPrint)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$env:PODSTUDIO_DEMO = "1"
foreach ($page in $Pages) {
  $p = Start-Process $Exe -ArgumentList @("--page", "$page") -PassThru
  Start-Sleep -Seconds 8
  if ($p.HasExited) { Write-Host "page ${page}: exited early with code $($p.ExitCode)"; continue }
  try {
    $h = $p.MainWindowHandle
    [Win]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 0x0041) | Out-Null      # move to 0,0, keep size, show
    [Win]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Seconds 1
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.R - $r.L; $ht = $r.B - $r.T
    Write-Host "page ${page}: window ${w}x${ht}"
    $bmp = New-Object System.Drawing.Bitmap $w, $ht
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $w, $ht))
    $bmp.Save("$OutDir\page$page.png")
    $nh = [int]($ht * $Width / $w)
    $small = New-Object System.Drawing.Bitmap $Width, $nh
    $gs = [System.Drawing.Graphics]::FromImage($small)
    $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gs.DrawImage($bmp, 0, 0, $Width, $nh)
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([int64]$Quality)
    $jpg = "$OutDir\page$page.jpg"
    $small.Save($jpg, $codec, $ep)
    if ($NoPrint) { Stop-Process -Id $p.Id -Force; continue }
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($jpg))
    Write-Host "SCREENSHOT-BEGIN page$page $($b64.Length)"
    for ($i = 0; $i -lt $b64.Length; $i += 3000) { Write-Host $b64.Substring($i, [Math]::Min(3000, $b64.Length - $i)) }
    Write-Host "SCREENSHOT-END page$page"
  } catch { Write-Host "page ${page}: no screenshot: $_" }
  Stop-Process -Id $p.Id -Force
}
