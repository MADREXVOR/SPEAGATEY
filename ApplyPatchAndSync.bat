@echo off
setlocal

REM === CONFIG ===
set "PRIVATE_DIR=C:\ghost_dispatcher\ghost_dispatcher"
set "PUBLIC_DIR=C:\SPEAGATEY"
set "PATCH_NAME=patch_dashboard_profit.zip"
set "PATCH_PATH=%PRIVATE_DIR%\patches\%PATCH_NAME%"

echo.
echo === Ghost Dispatcher: Apply patch (if present) + sync public mirror ===
echo Private dir : %PRIVATE_DIR%
echo Public dir  : %PUBLIC_DIR%
echo Patch zip   : %PATCH_NAME%
echo.

REM ---------------------------------------------------------
REM [1/3] APPLY PATCH ZIP IF IT EXISTS
REM ---------------------------------------------------------
if exist "%PATCH_PATH%" (
    echo [1/3] Found patch zip: %PATCH_PATH%
    echo        Applying patch into private repo...
    pushd "%PRIVATE_DIR%"
    powershell -NoLogo -NoProfile -Command "Expand-Archive -Path 'patches\\%PATCH_NAME%' -DestinationPath '.' -Force"
    echo        Deleting patch zip after apply...
    del "%PATCH_PATH%"
    popd
) else (
    echo [1/3] No patch zip found, skipping patch step.
)

REM ---------------------------------------------------------
REM [2/3] ROBOCOPY PRIVATE -> PUBLIC (NO SECRETS / NO PATCHES)
REM ---------------------------------------------------------
echo.
echo [2/3] Syncing files from PRIVATE to PUBLIC with robocopy...
echo.

if not exist "%PUBLIC_DIR%" (
    echo        Public dir does not exist. Creating: %PUBLIC_DIR%
    mkdir "%PUBLIC_DIR%"
)

robocopy "%PRIVATE_DIR%" "%PUBLIC_DIR%" /MIR ^
    /XD .git .venv __pycache__ .idea .vscode patches ^
    /XF .env secrets.json config_private.py api_keys.json

echo.
echo Robocopy finished with errorlevel %ERRORLEVEL%.
echo (Non-zero here is usually fine unless it prints a hard error above.)
echo.

REM ---------------------------------------------------------
REM [3/3] GIT COMMIT & PUSH IN PUBLIC MIRROR
REM ---------------------------------------------------------
echo [3/3] Committing and pushing PUBLIC mirror...
echo.

pushd "%PUBLIC_DIR%"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %PUBLIC_DIR% is not a git repo. Init it and add remote to SPEAGATEY first.
    popd
    goto :EOF
)

git add .

git commit -m "Sync from private at %DATE% %TIME%"
if errorlevel 1 (
    echo    Nothing new to commit (working tree clean).
) else (
    echo    Commit created. Pushing to origin/main...
    git push -u origin main
)

popd

echo.
echo [DONE] Public mirror is synced (or already up to date).
echo.
endlocal
pause
