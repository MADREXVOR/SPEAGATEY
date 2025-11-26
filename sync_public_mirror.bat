@echo off
setlocal

REM === CONFIG: FOLDERS ===
REM Private repo (real code, secrets)
set "PRIVATE_DIR=C:\ghost_dispatcher\ghost_dispatcher"

REM Public mirror repo (sanitized, no secrets)
set "PUBLIC_DIR=C:\SPEAGATEY"

echo.
echo [1/4] Syncing files from PRIVATE to PUBLIC...
echo     FROM: %PRIVATE_DIR%
echo     TO  : %PUBLIC_DIR%
echo.

REM Create public dir if it doesn't exist yet
if not exist "%PUBLIC_DIR%" (
    mkdir "%PUBLIC_DIR%"
)

REM Mirror files, but exclude git, venv, caches, and some secret files
robocopy "%PRIVATE_DIR%" "%PUBLIC_DIR%" ^
    /MIR ^
    /XD .git .venv __pycache__ .idea .vscode ^
    /XF .env secrets.json config_private.py api_keys.json

if errorlevel 8 (
    echo [ERROR] Robocopy failed.
    pause
    goto :eof
)

echo.
echo [2/4] Scrubbing sensitive strings in PUBLIC mirror...
echo     (Edit this section to match your actual secrets/names)
echo.

REM EXAMPLE: Scrub real company name "Rexis Trucking" -> "Demo Carrier"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "(Get-ChildItem -LiteralPath '%PUBLIC_DIR%' -Recurse -Include *.py,*.js,*.json,*.html) |" ^
  " ForEach-Object {" ^
  "   (Get-Content -LiteralPath $_.FullName) -replace 'Rexis Trucking', 'Demo Carrier' |" ^
  "   Set-Content -LiteralPath $_.FullName" ^
  " }"

echo.
echo [3/4] Capturing dashboard screenshot into PUBLIC mirror...
echo     (Primary monitor -> %PUBLIC_DIR%\screenshots\dashboard-YYYYMMDD-HHMMSS.png)
echo.

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$publicRoot = '%PUBLIC_DIR%';" ^
  "$screensDir = Join-Path $publicRoot 'screenshots';" ^
  "if (-not (Test-Path $screensDir)) { New-Item -ItemType Directory -Path $screensDir | Out-Null }" ^
  "Add-Type -AssemblyName System.Windows.Forms;" ^
  "Add-Type -AssemblyName System.Drawing;" ^
  "$ts = Get-Date -Format 'yyyyMMdd-HHmmss';" ^
  "$fileName = 'dashboard-' + $ts + '.png';" ^
  "$outPath = Join-Path $screensDir $fileName;" ^
  "$screen = [System.Windows.Forms.Screen]::PrimaryScreen;" ^
  "$bounds = $screen.Bounds;" ^
  "$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;" ^
  "$gfx = [System.Drawing.Graphics]::FromImage($bmp);" ^
  "$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);" ^
  "$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png);" ^
  "$gfx.Dispose(); $bmp.Dispose();" ^
  "Write-Host ('Screenshot saved to ' + $outPath)"

echo.
echo [4/4] Committing and pushing PUBLIC mirror...
echo.

cd /d "%PUBLIC_DIR%"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %PUBLIC_DIR% is not a git repo. Init it first and add the SPEAGATEY remote.
    pause
    goto :eof
)

REM Stage everything (code + new screenshot)
git add .

REM Commit; if there's nothing new, this will fail and we just skip push
git commit -m "Sync patch + screenshot"
if errorlevel 1 (
    echo Nothing new to commit. Skipping push.
) else (
    git push
)

echo.
echo Done. Public mirror is synced to SPEAGATEY (code + screenshot).
echo.

endlocal
pause
