Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$BackendDir = Join-Path $ProjectRoot "backend"
$RuntimeDir = Join-Path $ProjectRoot "backend-runtime"
$BuildDir = Join-Path $ProjectRoot ".pyinstaller-build\win"
$SpecFile = Join-Path $BackendDir "pyinstaller\chat2cartoon-backend.spec"
$ExpectedExe = Join-Path $RuntimeDir "dist\chat2cartoon-backend\chat2cartoon-backend.exe"
$RootExe = Join-Path $RuntimeDir "chat2cartoon-backend.exe"

$IsWindowsPlatform = [System.Environment]::OSVersion.Platform -eq "Win32NT"
if (-not $IsWindowsPlatform) {
  throw "This script builds the Windows backend runtime and must run on Windows."
}

function Invoke-BackendPython {
  if ($env:CHAT2CARTOON_BACKEND_PYTHON) {
    & $env:CHAT2CARTOON_BACKEND_PYTHON @args
    if ($LASTEXITCODE -ne 0) {
      throw "Backend Python failed with exit code $LASTEXITCODE."
    }
    return
  }

  if ($env:CONDA_DEFAULT_ENV -eq "history-video") {
    & python @args
    if ($LASTEXITCODE -ne 0) {
      throw "Backend Python failed with exit code $LASTEXITCODE."
    }
    return
  }

  $condaCommand = Get-Command conda -ErrorAction SilentlyContinue
  if ($condaCommand) {
    & conda run -n history-video python @args
    if ($LASTEXITCODE -ne 0) {
      throw "Backend Python failed with exit code $LASTEXITCODE."
    }
    return
  }

  throw "Could not find history-video conda environment. Activate it or set CHAT2CARTOON_BACKEND_PYTHON."
}

Write-Host "Using backend Python:"
Invoke-BackendPython -c "import platform, sys; print(sys.executable); print(sys.version); print(platform.architecture()[0])"

Invoke-BackendPython -c @"
import platform
import sys

if sys.version_info < (3, 9) or sys.version_info >= (3, 12):
    raise SystemExit("Python >=3.9,<3.12 is required")
if platform.architecture()[0] != "64bit":
    raise SystemExit("64-bit Python is required")
"@

$hasPyInstaller = $true
try {
  Invoke-BackendPython -c "import PyInstaller"
} catch {
  $hasPyInstaller = $false
}

if (-not $hasPyInstaller) {
  Write-Host "PyInstaller is not installed; installing pyinstaller>=6.10,<7..."
  Invoke-BackendPython -m pip install "pyinstaller>=6.10,<7"
}

Write-Host "Cleaning previous backend runtime build..."
Remove-Item -LiteralPath $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $RuntimeDir "dist") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $RootExe -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

Write-Host "Building Windows backend runtime..."
Invoke-BackendPython -m PyInstaller `
  --noconfirm `
  --clean `
  --workpath $BuildDir `
  --distpath (Join-Path $RuntimeDir "dist") `
  $SpecFile

if (-not (Test-Path -LiteralPath $ExpectedExe)) {
  throw "Expected backend executable was not created: $ExpectedExe"
}

Copy-Item -LiteralPath $ExpectedExe -Destination $RootExe -Force

Write-Host "Backend runtime created:"
Get-Item -LiteralPath $ExpectedExe | Format-List FullName,Length,LastWriteTime
Write-Host ""
Write-Host "Electron packaged mode can use:"
Write-Host "  backend-runtime\chat2cartoon-backend.exe"
Write-Host "  backend-runtime\dist\chat2cartoon-backend\chat2cartoon-backend.exe"
