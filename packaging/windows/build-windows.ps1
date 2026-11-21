# Builds the PodStudio installer on a Windows machine that has MSYS2 (https://www.msys2.org) and Inno Setup 6.
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build-windows.ps1
# Output: dist\PodStudio-<version>-x64-setup.exe (+ .sha256) and dist\PodStudio-<version>-x64-portable.zip
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$msys = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { "C:\msys64" }
$bash = Join-Path $msys "usr\bin\bash.exe"
if (-not (Test-Path $bash)) { throw "MSYS2 not found at $msys. Install it from https://www.msys2.org or set MSYS2_ROOT." }

$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  foreach ($p in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $p) { $iscc = $p; break }
  }
}
if (-not $iscc) { throw "Inno Setup 6 not found. Install it from https://jrsoftware.org/isinfo.php" }

$env:MSYSTEM = "UCRT64"; $env:CHERE_INVOKING = "1"
$unixRepo = (& $bash -lc "cygpath -u '$repo'").Trim()
& $bash -lc "cd '$unixRepo' && ./packaging/windows/build.sh"
if ($LASTEXITCODE -ne 0) { throw "build.sh failed" }

$full = (Get-Content (Join-Path $repo "build\windows\version.txt")).Trim()
$src = Join-Path $repo "dist\PodStudio-$full"
& $iscc "/DVersion=$full" "/DSourceDir=$src" "/DOutputDir=$(Join-Path $repo 'dist')" (Join-Path $PSScriptRoot "podstudio.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }

$setup = Join-Path $repo "dist\PodStudio-$full-x64-setup.exe"
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
# sha256sum format, which is what the in-app updater reads
"$hash  PodStudio-$full-x64-setup.exe" | Out-File -Encoding ascii -NoNewline "$setup.sha256"
Add-Content -Encoding ascii "$setup.sha256" ""
Write-Host "Built $setup"
