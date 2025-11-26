@echo off
setlocal

REM === PATHS ===
REM Folder where this .bat lives (your private ghost_dispatcher repo)
set BASE_DIR=%~dp0
set PRIVATE_DIR=%BASE_DIR%

REM Public mirror repo (SPEAGATEY clone)
set PUBLIC_DIR=C:\SPEAGATEY

REM Optional patch zip from ChatGPT (already downloaded)
set PATCH_ZIP=patch_dashboard_profit.zip

echo.
echo === Ghost Dispatcher: Apply patch (if present) + sync public mirror ===
echo Private dir : %PRIVATE_DIR%
echo Public dir  : %PUBLIC_DIR%
echo Patch zip   : %PATCH_ZIP%
echo.

REM -----------------------------------------------------------------
REM 1) Apply zip patch into PRIVATE repo (ONLY if the zip exists)
REM -----------------------------------------------------------------
if exist "%PRIVATE_DIR%%PATCH_ZIP%" (
    echo [1/4] Found %PATCH_ZIP%, applying patch...
    powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%PRIVATE_DIR%%PATCH_ZIP%' -DestinationPath '%PRIVATE_DIR%' -Force"

    if errorlevel 1 (
        echo [ERROR] Expand-Archive failed. Patch not applied.
        pause
        goto :eof
    )

    del "%PRIVATE_DIR%%PATCH_ZIP%" >nul 2>&1
    echo [OK] Patch applied to private repo and zip removed.
) else (
    echo [1/4] No patch zip found, skipping patch step.
)

REM -----------------------------------------------------------------
REM 2) Mirror PRIVATE -> PUBLIC (code only, no secrets)
REM -----------------------------------------------------------------
echo.
echo [2/4] Syncing PRIVATE -> PUBLIC (SPEAGATEY)...

if not exist "%PUBLIC_DIR%" (
    echo Public dir does not exist, creating: %PUBLIC_DIR%
    mkdir "%PUBLIC_DIR%"
)


robocopy "C:\ghost_dispatcher\ghost_dispatcher" "C:\SPEAGATEY" /MIR /XD .git .venv __pycache__ .idea .vscode patches /XF .env secrets.json config_private.py api_keys.json
 config_private.py api_keys.json

if errorlevel 8 (
    echo [ERROR] Robocopy failed (code %ERRORLEVEL%).
    pause
    goto :eof
)

echo [OK] Files synced to public mirror.
echo.

REM -----------------------------------------------------------------
REM 3) Git add/commit/push from PUBLIC repo
REM -----------------------------------------------------------------
echo [3/4] Committing and pushing PUBLIC mirror...

cd /d "%PUBLIC_DIR%"

REM Make sure this really is a git repo
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %PUBLIC_DIR% is not a git repo.
    echo Run this once in C:\:
    echo   git clone https://github.com/MADREXVOR/SPEAGATEY.git SPEAGATEY
    pause
    goto :eof
)

git add .

set MSG=Sync from ApplyPatchAndSync
git commit -m "%MSG%"
if errorlevel 1 (
    echo No new changes to commit (probably already in sync).
) else (
    echo [OK] Commit created: %MSG%
    git push
    if errorlevel 1 (
        echo [WARN] git push failed, check error above.
    ) else (
        echo [OK] Pushed to remote SPEAGATEY.
    )
)

echo.
echo [4/4] Done.
echo - If a patch zip was present, it was applied and deleted.
echo - Public mirror is synced and (if needed) pushed.
echo.

endlocal
pause
